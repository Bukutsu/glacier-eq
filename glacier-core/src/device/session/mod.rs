// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! One asynchronous read/write/verify flow for native HID and WebHID transports.

mod command;
mod io;
mod ja11;
mod melody;
pub use command::{DeviceCommand, DeviceOutcome, EqWriteOutcome};

pub use io::{DeviceIo, HID_READ_BUFFER_BYTES};
mod blocking;
pub use blocking::{block_on, BlockingDeviceIo, BlockingIo};

use super::{
    normalize_peq_for_profile, validate_peq, validate_peq_for_capabilities, DeviceProfile,
    EqProtocol, Packet,
};
use crate::eq::{Filter, PEQData};

const FILTER_READ_ATTEMPTS: usize = 60;
const GAIN_READ_ATTEMPTS: usize = 20;
const RETRY_DELAY_MS: u64 = 100;
/// Attached to every `unverified_push` result. Without a readback the PEQ
/// returned is what was *asked for*, not what the device stored, and the UI
/// needs to stop reading it as a confirmed commit.
pub const UNVERIFIED_PUSH_WARNING: &str =
    "pushed without reading the DAC back, so its stored EQ was not verified";
/// JA11 failed its required preamp read; do not continue into band timeouts.
pub const DAC_UNRESPONSIVE_ERROR: &str = "DAC is not responding. Unplug and replug the DAC";
const UNCORRELATED_GAIN_ERROR: &str =
    "Global gain read required retry; refusing uncorrelated state";

/// What a session failure means to the retry and rollback policy. Policy
/// matches on the kind, never on message text, so rewording a message cannot
/// silently change behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FaultKind {
    /// No acceptable reply arrived; the message distinguishes silence from
    /// replies rejected by the frame/command matcher.
    ReadTimeout,
    /// A global-gain read that could not be told apart from a late reply.
    UncorrelatedGain,
    /// JA11 stayed silent on its required preamp read.
    DacUnresponsive,
    /// The readback of a push differs from what was written.
    VerifyMismatch,
    Other,
}

/// A session error: policy kind plus the user-facing message. Public session
/// operations return the message as `String`.
#[derive(Debug, Clone)]
pub(crate) struct Fault {
    kind: FaultKind,
    message: String,
}

impl Fault {
    pub(crate) fn new(kind: FaultKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

impl From<String> for Fault {
    fn from(message: String) -> Self {
        Self::new(FaultKind::Other, message)
    }
}

impl From<&str> for Fault {
    fn from(message: &str) -> Self {
        Self::new(FaultKind::Other, message)
    }
}

impl From<Fault> for String {
    fn from(fault: Fault) -> Self {
        fault.message
    }
}

impl std::fmt::Display for Fault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// Identical failures collapse to one (keeping their kind); different ones
/// are joined into an `Other`.
fn combine_errors(first: Fault, retry: Fault) -> Fault {
    if first.message == retry.message {
        first
    } else {
        Fault::new(
            FaultKind::Other,
            format!("{}; retry failed: {}", first.message, retry.message),
        )
    }
}

pub(crate) type ProgressCallback<'a> = dyn FnMut(&str, f32) + 'a;

pub struct DeviceSession<'a, I: DeviceIo = BlockingIo<'a>> {
    pub(crate) io: I,
    pub(crate) profile: &'static DeviceProfile,
    progress: Option<&'a mut ProgressCallback<'a>>,
    next_nonce: u8,
    melody_write_slot: Option<u8>,
    fiio_write_slot: Option<u8>,
    last_pull_had_invalid_response: bool,
    last_pull_sent_gain_request: bool,
    last_pull_gain_read_completed: bool,
    gain_read_requires_correlation: bool,
    last_read_was_retried: bool,
    /// A restart-causing write may have landed; no more I/O in this transaction.
    restart_attempted: bool,
}

impl<'a, I: DeviceIo> DeviceSession<'a, I> {
    pub fn from_io(
        io: I,
        profile: &'static DeviceProfile,
        progress: Option<&'a mut ProgressCallback<'a>>,
        initial_nonce: u8,
    ) -> Self {
        Self {
            io,
            profile,
            progress,
            next_nonce: initial_nonce,
            melody_write_slot: None,
            fiio_write_slot: None,
            last_pull_had_invalid_response: false,
            last_pull_sent_gain_request: false,
            last_pull_gain_read_completed: false,
            gain_read_requires_correlation: false,
            last_read_was_retried: false,
            restart_attempted: false,
        }
    }

    /// Last allocated filter nonce, including failed requests and retries.
    /// A short-lived adapter must retain this as the next session's seed.
    pub fn filter_nonce(&self) -> u8 {
        self.next_nonce
    }

    fn progress(&mut self, message: &str, percentage: f32) {
        if let Some(callback) = &mut self.progress {
            callback(message, percentage);
        }
    }

    fn protocol(&self) -> &'static dyn EqProtocol {
        self.profile
            .protocol
            .eq
            .expect("EQ operations check require_hardware_eq first")
    }

    fn require_open_transaction(&self) -> Result<(), String> {
        if self.restart_attempted {
            Err("DAC restart write attempted; reconnect before further operations".into())
        } else {
            Ok(())
        }
    }

    pub fn save_restarts_device(&self) -> bool {
        self.profile.protocol.quirks().save_resets_device
    }

    /// Melody writes never guess a bank: the caller must pick a USER bank.
    fn require_melody_write_slot(&self) -> Result<u8, String> {
        self.melody_write_slot
            .ok_or_else(|| "Melody writes require an explicit USER bank".to_string())
    }

    fn require_hardware_eq(&self) -> Result<(), String> {
        self.require_open_transaction()?;
        if self.profile.protocol.has_hardware_eq() {
            super::normalization::validate_capabilities(&self.profile.caps)
        } else {
            Err(format!("{} has no hardware EQ", self.profile.name))
        }
    }

    /// Override the exact target bank for a persistent FiiO write or reset.
    pub fn set_fiio_write_slot(&mut self, slot: u8) -> Result<(), String> {
        self.require_hardware_eq()?;
        if !self.protocol().user_eq_slots().contains(&slot) {
            return Err(format!(
                "User EQ bank {slot} is not writable on {}",
                self.profile.name
            ));
        }
        if self.profile.controls == Some(super::profile::Controls::Melody) {
            self.set_melody_write_slot(slot)
        } else {
            self.fiio_write_slot = Some(slot);
            Ok(())
        }
    }

    /// Select and verify an editable FiiO user bank before reading it.
    pub async fn set_user_eq_bank(&mut self, slot: u8) -> Result<u8, String> {
        self.require_hardware_eq()?;
        if self.profile.controls == Some(super::profile::Controls::Melody) {
            return Err("Use the Melody preset control for its User banks".into());
        }
        if !self.protocol().user_eq_slots().contains(&slot) {
            return Err(format!(
                "User EQ bank {slot} is not available on {}",
                self.profile.name
            ));
        }
        self.check_filter_count().await?;
        self.drain().await;
        let packet = super::families::fiio::preset_packet(self.protocol().report_id(), 0x16, slot);
        self.io.write(&packet.framed()).await?;
        self.io
            .sleep_ms(self.protocol().write_timing().packet_gap_ms)
            .await;
        self.verify_fiio_write_target(slot).await?;
        Ok(slot)
    }

    pub async fn pull(&mut self) -> Result<PEQData, String> {
        Ok(self.pull_checked().await?)
    }

    async fn pull_checked(&mut self) -> Result<PEQData, Fault> {
        self.require_hardware_eq()?;
        // A complete-pull retry is only safe when the failed attempt did not
        // issue an uncorrelatable global-gain request. Clear this one-shot
        // guard before starting a new user-visible operation.
        self.gain_read_requires_correlation = false;
        let protocol = self.protocol();
        match self.pull_once().await {
            Ok(peq) if !protocol.is_default_state(&peq) => Ok(peq),
            Ok(_) => {
                self.io.sleep_ms(RETRY_DELAY_MS).await;
                // The retry exists because a default-state read may be a
                // transient lie. When this corroborating attempt fails,
                // surface its error instead of reporting the uncorroborated
                // default as device truth.
                self.pull_once().await
            }
            Err(first) => {
                if matches!(
                    first.kind,
                    FaultKind::UncorrelatedGain | FaultKind::DacUnresponsive
                ) {
                    return Err(first);
                }
                let first_sent_gain = self.last_pull_sent_gain_request;
                self.io.sleep_ms(RETRY_DELAY_MS).await;
                if first_sent_gain && !self.last_pull_gain_read_completed {
                    // Moondrop/FiiO do not carry a gain nonce. If the first
                    // complete pull already sent that request, a response read
                    // by the retry could be the late answer to the first one.
                    self.gain_read_requires_correlation = true;
                }
                let retry = self.pull_once().await;
                self.gain_read_requires_correlation = false;
                match retry {
                    Ok(peq) if protocol.is_default_state(&peq) => Err(Fault::from(format!(
                        "{first}; retry returned an unconfirmed default EQ state"
                    ))),
                    Ok(peq) => Ok(peq),
                    Err(retry) => Err(combine_errors(first, retry)),
                }
            }
        }
    }

    /// Normalizes before writing, snapshots, commits, verifies, and rolls back on failure.
    /// Returns the committed PEQ plus the capability-clamp warnings, which
    /// callers must surface — the clamp rewrites the user's values.
    pub async fn persistent_push(
        &mut self,
        peq: PEQData,
    ) -> Result<(PEQData, Vec<String>), String> {
        self.require_hardware_eq()?;
        let (normalized, warnings) = self.normalize(peq)?;
        // Snapshot the destination, not whichever bank happened to be playing.
        self.prepare_write_destination().await?;
        let backup = self.pull().await?;
        if self.last_pull_had_invalid_response {
            return Err("Cannot push while the device returned an invalid EQ response".into());
        }
        validate_peq_for_capabilities(&backup, &self.profile.caps)?;
        // A DAC that resets on save cannot be read back afterwards, so its
        // RAM state is verified first and the save is the last packet sent.
        // JA11 ordering follows jeromeof/devicePEQ (disconnectOnSave) and
        // Ircama/ja11-config (save_to_flash sends the final packet).
        let save_last = self.protocol().quirks().save_resets_device;
        let mut attempt = self.push_attempt(&normalized, save_last).await;
        // A DAC that silently drops about 1% of reports (the ones that resend
        // unanswered reads) loses a band or the preamp write in roughly one
        // push in ten. The official app never reads back, so it never sees
        // that. A write is idempotent: rewrite once before rolling back.
        let drops_reports = self.protocol().resend_unanswered_after().is_some();
        if drops_reports && !self.restart_attempted {
            if let Err(error) = &attempt {
                if error.kind == FaultKind::VerifyMismatch {
                    attempt = self.push_attempt(&normalized, save_last).await;
                }
            }
        }
        match attempt {
            Ok(actual) => {
                self.progress("Write complete", 100.0);
                Ok((actual, warnings))
            }
            // Delivery may have succeeded even when the transport returned an error.
            Err(error) if self.restart_attempted => Err(error.into()),
            Err(error) => Err(match self.restore_and_verify(&backup).await {
                Ok(()) => format!("{error}; previous state restored"),
                Err(rollback) => format!("{error}; rollback failed: {rollback}"),
            }),
        }
    }

    /// One write, commit and readback comparison of an already-normalized EQ.
    async fn push_attempt(
        &mut self,
        normalized: &PEQData,
        save_last: bool,
    ) -> Result<PEQData, Fault> {
        self.write_to_ram(normalized)
            .await
            .map_err(|error| format!("Push write failed: {error}"))?;
        if !save_last {
            self.commit()
                .await
                .map_err(|error| format!("Push commit failed: {error}"))?;
        }
        self.io.sleep_ms(RETRY_DELAY_MS).await;
        let actual = self
            .pull()
            .await
            .map_err(|error| format!("Push verification failed: {error}"))?;
        if self.last_pull_had_invalid_response {
            return Err("Push verification failed: device returned an invalid EQ response".into());
        }
        validate_peq_for_capabilities(&actual, &self.profile.caps)
            .map_err(|error| format!("Push verification failed: {error}"))?;
        compare_peq(&actual, normalized, &self.profile.caps).map_err(|error| {
            Fault::new(
                FaultKind::VerifyMismatch,
                format!("Push verification failed: {error}"),
            )
        })?;
        if save_last {
            self.commit()
                .await
                .map_err(|error| format!("Push commit failed: {error}"))?;
        }
        Ok(actual)
    }

    async fn restore_and_verify(&mut self, backup: &PEQData) -> Result<(), String> {
        if self.fiio_write_slot.is_some() {
            // Never restore into an uncertain or externally changed bank.
            self.prepare_write_destination().await?;
        }
        self.write_to_ram(backup).await?;
        // The backup is still what the DAC has saved unless a save was sent;
        // re-saving would reset a save-resets device mid-verification.
        if !self.protocol().quirks().save_resets_device {
            self.commit().await?;
        }
        self.io.sleep_ms(RETRY_DELAY_MS).await;
        let actual = self.pull().await?;
        if self.last_pull_had_invalid_response {
            return Err("Device returned an invalid EQ response during restore".into());
        }
        validate_peq_for_capabilities(&actual, &self.profile.caps)?;
        compare_peq(&actual, backup, &self.profile.caps)
    }

    /// Writes persistently without a readback. Kept for the GUI's explicit
    /// skip-verification setting; CLI writes always use `persistent_push`.
    ///
    /// The returned PEQ is the *request*, not a readback of what the device
    /// stored — there is none, by construction. Callers that publish this as
    /// the device's committed state must say so, which is what the extra
    /// warning below is for.
    pub async fn unverified_push(
        &mut self,
        peq: PEQData,
    ) -> Result<(PEQData, Vec<String>), String> {
        self.require_hardware_eq()?;
        let (normalized, mut warnings) = self.normalize(peq)?;
        self.prepare_write_destination().await?;
        let backup = self.pull().await?;
        if self.last_pull_had_invalid_response {
            return Err("Cannot push while the device returned an invalid EQ response".into());
        }
        validate_peq_for_capabilities(&backup, &self.profile.caps)?;
        let attempt = (async {
            self.write_to_ram(&normalized).await?;
            self.commit().await
        })
        .await;
        if let Err(error) = attempt {
            if self.restart_attempted {
                return Err(error);
            }
            return Err(match self.restore_and_verify(&backup).await {
                Ok(()) => format!("{error}; previous state restored"),
                Err(rollback) => format!("{error}; rollback failed: {rollback}"),
            });
        }
        warnings.push(UNVERIFIED_PUSH_WARNING.to_string());
        self.progress("Write complete", 100.0);
        Ok((normalized, warnings))
    }

    pub async fn apply_ram(&mut self, peq: PEQData) -> Result<(PEQData, Vec<String>), String> {
        self.require_hardware_eq()?;
        if self.profile.controls == Some(super::profile::Controls::Melody) {
            return Err("Melody temporary EQ requires bank-specific live editing".into());
        }
        validate_peq(&peq)?;
        if !self.profile.caps.supports_ram_apply {
            return Err(format!(
                "{} does not advertise volatile RAM apply support",
                self.profile.name
            ));
        }
        let backup = self.pull().await?;
        if self.last_pull_had_invalid_response {
            return Err("Cannot apply while the device returned an invalid EQ response".into());
        }
        validate_peq_for_capabilities(&backup, &self.profile.caps)?;
        let (normalized, warnings) = self.normalize(peq)?;
        let attempt = self.write_ram_and_apply(&normalized).await;
        if let Err(error) = attempt {
            return Err(self.rollback_ram(&backup, error).await);
        }
        self.progress("Temporary EQ applied", 100.0);
        Ok((normalized, warnings))
    }

    /// Applies an EQ to the DAC's RAM only, for live editing. Unlike
    /// `apply_ram` it neither reads a backup first nor rolls back: nothing is
    /// saved, so a failed write leaves the stored EQ intact and the next edit
    /// rewrites every band.
    pub async fn live_apply(&mut self, peq: PEQData) -> Result<(PEQData, Vec<String>), String> {
        self.require_hardware_eq()?;
        validate_peq(&peq)?;
        if !self.profile.caps.supports_ram_apply {
            return Err(format!(
                "{} does not advertise volatile RAM apply support",
                self.profile.name
            ));
        }
        let (normalized, warnings) = self.normalize(peq)?;
        // Melody edits must target and verify an explicit USER bank. Never
        // infer a destination from an arbitrary (potentially stale) query.
        if self.profile.controls == Some(super::profile::Controls::Melody) {
            if self.melody_write_slot.is_none() {
                return Err("Melody live editing requires an explicit USER bank".into());
            }
            self.prepare_write_destination().await?;
        }
        // Live edits fire constantly; a progress bar for each would flicker.
        let progress = self.progress.take();
        let written = self.write_ram_live(&normalized).await;
        self.progress = progress;
        written?;
        Ok((normalized, warnings))
    }

    async fn write_ram_live(&mut self, peq: &PEQData) -> Result<(), String> {
        self.write_to_ram(peq).await?;
        // No settle wait: it exists for the flash commit, and the official app's
        // live path sends the next edit right behind the apply.
        for packet in self.protocol().ram_apply_packets() {
            self.send(&packet).await?;
        }
        Ok(())
    }

    async fn verify_ram_state(&mut self, expected: &PEQData) -> Result<(), String> {
        self.io.sleep_ms(RETRY_DELAY_MS).await;
        let actual = self.pull().await?;
        if self.last_pull_had_invalid_response {
            return Err("Device returned an invalid EQ response during RAM verification".into());
        }
        validate_peq_for_capabilities(&actual, &self.profile.caps)?;
        compare_peq(&actual, expected, &self.profile.caps)
    }

    async fn rollback_ram(&mut self, backup: &PEQData, apply_error: String) -> String {
        let restore = (async {
            self.write_ram_and_apply(backup).await?;
            self.verify_ram_state(backup).await
        })
        .await;
        match restore {
            Ok(()) => format!("{apply_error}; previous RAM state restored"),
            Err(rollback) => format!("{apply_error}; RAM rollback failed: {rollback}"),
        }
    }

    async fn write_ram_and_apply(&mut self, peq: &PEQData) -> Result<(), String> {
        self.write_to_ram(peq).await?;
        for packet in self.protocol().ram_apply_packets() {
            self.send(&packet).await?;
            self.io
                .sleep_ms(self.protocol().write_timing().commit_step_ms)
                .await;
        }
        Ok(())
    }

    /// Writes a flat EQ and saves it. Returns whether the DAC restarts after the
    /// save (the JA11 does), so callers wait for the reconnect instead of
    /// reading the EQ back from a device that is rebooting.
    pub async fn reset_eq(&mut self) -> Result<bool, String> {
        self.require_hardware_eq()?;
        let peq = PEQData {
            filters: (0..self.profile.caps.num_bands)
                .map(|index| Filter::enabled(index as u8, false))
                .collect(),
            global_gain: 0.0,
        };
        self.persistent_push(peq).await?;
        Ok(self.save_restarts_device())
    }

    fn normalize(&self, peq: PEQData) -> Result<(PEQData, Vec<String>), String> {
        normalize_peq_for_profile(peq, self.profile)
    }

    async fn pull_once(&mut self) -> Result<PEQData, Fault> {
        self.last_pull_had_invalid_response = false;
        self.last_pull_sent_gain_request = false;
        self.last_pull_gain_read_completed = false;
        self.progress("Preparing EQ read…", 5.0);
        self.init().await?;
        let timing = self.protocol().write_timing();
        self.check_filter_count().await?;
        self.progress("Reading device preamp…", 10.0);
        self.last_pull_sent_gain_request = true;
        let global_gain = match self.read_gain().await {
            Ok(gain) => gain,
            // Silence on JA11 is not an unknown/zero preamp. Fail before bands.
            Err(error) if self.save_restarts_device() && error.kind == FaultKind::ReadTimeout => {
                return Err(Fault::new(
                    FaultKind::DacUnresponsive,
                    DAC_UNRESPONSIVE_ERROR,
                ));
            }
            Err(error) => return Err(error),
        };
        self.last_pull_gain_read_completed = true;
        self.io.sleep_ms(timing.post_gain_read_ms).await;
        let count = self.profile.caps.num_bands;
        let mut filters = Vec::with_capacity(count);
        for index in 0..count {
            self.progress(
                &format!("Reading band {}/{}…", index + 1, count),
                10.0 + index as f32 / count as f32 * 75.0,
            );
            filters.push(self.read_filter(index as u8).await?);
            self.io.sleep_ms(timing.flood_delay_ms).await;
        }
        self.progress("Read complete", 100.0);
        let peq = PEQData {
            filters,
            global_gain,
        };
        validate_peq_for_capabilities(&peq, &self.profile.caps)
            .map_err(|error| format!("Device returned invalid EQ state: {error}"))?;
        if self.last_pull_had_invalid_response {
            return Err("Device returned an invalid EQ response".into());
        }
        Ok(peq)
    }

    async fn read_filter(&mut self, index: u8) -> Result<Filter, Fault> {
        let protocol = self.protocol();
        let per_round = protocol
            .resend_unanswered_after()
            .unwrap_or(FILTER_READ_ATTEMPTS);
        let mut remaining = FILTER_READ_ATTEMPTS;
        let mut first_error: Option<Fault> = None;
        let mut last_error = None;
        while remaining > 0 {
            // Use a fresh nonce for every retry where the protocol carries
            // one. A late response from an earlier attempt then cannot satisfy
            // the new request's correlation predicate.
            self.next_nonce = self.next_nonce.wrapping_add(1).max(1);
            let nonce = self.next_nonce;
            let request = protocol.read_filter_request(index, nonce);
            let take = per_round.min(remaining);
            self.send(&request).await?;
            match self
                .read_matching("Filter", take, |data| {
                    protocol.matches_filter_response(data, index, nonce)
                })
                .await
            {
                Ok(data) => {
                    let valid = protocol.is_filter_response_valid(&data, index, nonce);
                    if !valid {
                        self.last_pull_had_invalid_response = true;
                        return Err(format!(
                            "Device returned an invalid EQ response: filter {} values",
                            index + 1
                        )
                        .into());
                    }
                    return protocol.parse_filter_response(&data).ok_or_else(|| {
                        Fault::from(format!("Filter {} response could not be parsed", index + 1))
                    });
                }
                Err(error) => {
                    // Keep the first failure as well as the last. Every round
                    // ends in read_matching's generic "Filter read timeout",
                    // so keeping only the last one erased a concrete
                    // transport error — "USB stall: transfer failed" surfaced
                    // to the user as a bare timeout. send_and_read already
                    // reports both for the global-gain path.
                    if first_error.is_none() {
                        first_error = Some(error.clone());
                    }
                    last_error = Some(error);
                    remaining -= take;
                }
            }
        }
        Err(match (first_error, last_error) {
            (Some(first), Some(last)) => combine_errors(first, last),
            (Some(error), None) | (None, Some(error)) => error,
            (None, None) => Fault::new(FaultKind::ReadTimeout, "Filter read timeout"),
        })
    }

    async fn check_filter_count(&mut self) -> Result<(), Fault> {
        if let Some(request) = self.protocol().read_filter_count_request() {
            let protocol = self.protocol();
            let data = self
                .send_and_read(
                    "Band count",
                    &request,
                    20,
                    0,
                    |data| protocol.parse_filter_count_response(data).is_some(),
                    false,
                )
                .await?;
            let actual = protocol
                .parse_filter_count_response(&data)
                .ok_or("Invalid band count")?;
            if actual != self.profile.caps.num_bands {
                return Err(format!("{} reports {actual} EQ bands; this profile requires {}. No EQ was written; please report the firmware and a diagnostic capture.",
                    self.profile.name, self.profile.caps.num_bands).into());
            }
        }
        Ok(())
    }

    /// Select before the snapshot, so rollback restores the bank we overwrite.
    async fn prepare_write_destination(&mut self) -> Result<(), String> {
        if self.profile.controls == Some(super::profile::Controls::Melody) {
            self.check_filter_count().await?;
            self.set_melody_preset(self.require_melody_write_slot()?)
                .await?;
        } else if let Some(slot) = self
            .fiio_write_slot
            .or_else(|| self.protocol().write_target_preset())
        {
            use super::families::fiio;
            self.drain().await;
            self.check_filter_count().await?;
            let report_id = self.protocol().report_id();
            // The official QX13 adapter requires EQ already enabled; the BTR15
            // adapter enables it implicitly. Keep BTR19/25 writes off when
            // their standard EQ switch is off too. Do not silently change that
            // separate setting or report a successful EQ that is still bypassed.
            if ["FIIO QX13", "FIIO BTR15", "FIIO BTR19", "FIIO BTR25"]
                .contains(&self.profile.protocol.id)
            {
                self.drain().await;
                let request = Packet::new(report_id, vec![0xbb, 0x0b, 0, 0, 0x1a, 0, 0, 0xee]);
                let data = self
                    .send_and_read(
                        "EQ switch",
                        &request,
                        20,
                        0,
                        |data| fiio::parse_eq_switch_response(data).is_some(),
                        false,
                    )
                    .await?;
                if fiio::parse_eq_switch_response(&data) != Some(true) {
                    return Err(
                        "EQ is disabled. Enable EQ in FiiO Control before writing with Glacier."
                            .into(),
                    );
                }
            }
            self.drain().await;
            self.io
                .write(&fiio::preset_packet(report_id, 0x16, slot).framed())
                .await?;
            self.io
                .sleep_ms(self.protocol().write_timing().packet_gap_ms)
                .await;
            self.verify_fiio_write_target(slot).await?;
        }
        Ok(())
    }

    async fn verify_fiio_write_target(&mut self, slot: u8) -> Result<(), String> {
        use super::families::fiio;
        self.drain().await;
        let request = Packet::new(
            self.protocol().report_id(),
            vec![0xbb, 0x0b, 0, 0, 0x16, 0, 0, 0xee],
        );
        let data = self
            .send_and_read(
                "User bank",
                &request,
                20,
                0,
                |data| fiio::parse_preset_response(data).is_some(),
                false,
            )
            .await?;
        if fiio::parse_preset_response(&data) != Some(slot) {
            return Err(format!("User bank verification failed: expected {slot}"));
        }
        Ok(())
    }

    async fn read_gain(&mut self) -> Result<f64, Fault> {
        let uncorrelated = |detail: Option<String>| {
            Fault::new(
                FaultKind::UncorrelatedGain,
                match detail {
                    Some(detail) => format!("{UNCORRELATED_GAIN_ERROR}; {detail}"),
                    None => UNCORRELATED_GAIN_ERROR.to_string(),
                },
            )
        };
        let gain = self.read_gain_once().await?;
        if self.gain_read_requires_correlation {
            return Err(uncorrelated(None));
        }
        if self.last_read_was_retried {
            // Global-gain frames do not carry a transaction nonce, so the
            // answer to a resend cannot be told from a late answer to the
            // dropped first request. Nothing writes during a read, so two
            // independent reads that agree describe the same state; one that
            // needs another resend, or disagrees, still fails closed instead
            // of becoming rollback truth.
            let confirmed = self.read_gain_once().await.map_err(|error| {
                uncorrelated(Some(format!("confirmation read failed: {error}")))
            })?;
            if self.last_read_was_retried || confirmed != gain {
                return Err(uncorrelated(None));
            }
        }
        Ok(gain)
    }

    async fn read_gain_once(&mut self) -> Result<f64, Fault> {
        let protocol = self.protocol();
        let request = protocol.read_global_gain_request();
        let data = self
            .send_and_read(
                "Global gain",
                &request,
                GAIN_READ_ATTEMPTS,
                25,
                |data| protocol.matches_global_gain_response(data),
                true,
            )
            .await?;
        protocol
            .parse_global_gain_response(&data)
            .ok_or_else(|| "Global gain response could not be parsed".into())
    }

    /// Sends a read request, re-sending it when the protocol opts in and a full
    /// round of attempts goes unanswered. The total read budget is unchanged.
    async fn send_and_read(
        &mut self,
        label: &str,
        request: &Packet,
        attempts: usize,
        settle_ms: u64,
        matches: impl Fn(&[u8]) -> bool,
        quarantine_before_resend: bool,
    ) -> Result<Vec<u8>, Fault> {
        self.last_read_was_retried = false;
        let per_round = self
            .protocol()
            .resend_unanswered_after()
            .unwrap_or(attempts);
        let mut remaining = attempts;
        let mut first_err = None;
        let mut last_err = None;
        let mut sent_request = false;
        while remaining > 0 {
            if sent_request && quarantine_before_resend {
                // A late response from the previous request must not satisfy
                // a resend of the same uncorrelated command.
                self.drain().await;
                self.last_read_was_retried = true;
            }
            self.send(request).await?;
            sent_request = true;
            self.io.sleep_ms(settle_ms).await;
            let take = per_round.min(remaining);
            match self.read_matching(label, take, &matches).await {
                Ok(data) => return Ok(data),
                Err(error) => {
                    if first_err.is_none() {
                        first_err = Some(error.clone());
                    }
                    last_err = Some(error);
                    remaining -= take;
                }
            }
        }
        Err(match (first_err, last_err) {
            (Some(first), Some(last)) => combine_errors(first, last),
            (Some(error), None) | (None, Some(error)) => error,
            (None, None) => Fault::new(FaultKind::ReadTimeout, format!("{label} read timeout")),
        })
    }

    async fn init(&mut self) -> Result<(), String> {
        for packet in self.protocol().init_packets() {
            self.send(&packet)
                .await
                .map_err(|error| format!("Init write failed: {error}"))?;
        }
        self.io
            .sleep_ms(self.protocol().write_timing().init_ms)
            .await;
        self.drain().await;
        Ok(())
    }

    async fn write_to_ram(&mut self, peq: &PEQData) -> Result<(), String> {
        self.progress("Preparing EQ write…", 10.0);
        self.init().await?;
        let protocol = self.protocol();
        let total = peq.filters.len();
        for (index, filter) in peq.filters.iter().enumerate() {
            self.progress(
                &format!("Writing band {}/{}…", index + 1, total),
                15.0 + index as f32 / total as f32 * 60.0,
            );
            for (packet_index, packet) in protocol
                .write_filter_packets(
                    index as u8,
                    filter,
                    self.profile.caps.dsp_sample_rate,
                    peq.global_gain,
                )
                .map_err(|error| format!("Band {} write failed: {error}", index + 1))?
                .into_iter()
                .enumerate()
            {
                if packet_index > 0 {
                    self.io
                        .sleep_ms(protocol.write_timing().packet_gap_ms)
                        .await;
                }
                if self.profile.controls == Some(super::profile::Controls::Melody)
                    && packet.payload.get(4) == Some(&0x16)
                {
                    self.set_melody_preset(self.require_melody_write_slot()?)
                        .await?;
                } else if (self.fiio_write_slot.is_some()
                    || protocol.write_target_preset().is_some())
                    && packet.payload.get(4) == Some(&0x16)
                {
                    // Already selected and verified before the destination snapshot.
                } else {
                    self.send(&packet)
                        .await
                        .map_err(|error| format!("Band {} write failed: {error}", index + 1))?;
                }
            }
            self.io
                .sleep_ms(protocol.write_timing().per_filter_ms)
                .await;
        }
        self.progress("Writing preamp…", 75.0);
        self.io.sleep_ms(protocol.write_timing().batch_ms).await;
        for (packet_index, packet) in protocol
            .write_global_gain_packets(peq.global_gain)
            .into_iter()
            .enumerate()
        {
            if packet_index > 0 {
                self.io
                    .sleep_ms(protocol.write_timing().packet_gap_ms)
                    .await;
            }
            self.send(&packet)
                .await
                .map_err(|error| format!("Global gain write failed: {error}"))?;
        }
        self.io
            .sleep_ms(protocol.write_timing().global_gain_ms)
            .await;
        Ok(())
    }

    async fn commit(&mut self) -> Result<(), String> {
        self.progress(
            if self.save_restarts_device() {
                "Saving EQ to DAC (restart expected)…"
            } else {
                "Saving EQ to DAC…"
            },
            80.0,
        );
        if self.profile.controls == Some(super::profile::Controls::Melody) {
            // SAVE has a short acknowledgement, not a normal command echo.
            // The following read drains it first; SAVE is not replayed.
            let slot = self.require_melody_write_slot()?;
            let packet = super::families::fiio::melody::save_request(slot)?;
            self.io.write(&packet.framed()).await?;
            self.io
                .sleep_ms(self.protocol().write_timing().commit_step_ms)
                .await;
            let actual = self.melody_preset().await?;
            if actual != slot {
                return Err(format!("Melody save selected {actual}, expected {slot}"));
            }
            return Ok(());
        }
        if let Some(slot) = self
            .fiio_write_slot
            .or_else(|| self.protocol().write_target_preset())
        {
            let dynamic_target = self.fiio_write_slot.is_some();
            let mut packets = self.protocol().commit_packets();
            if dynamic_target {
                for packet in &mut packets {
                    if packet.payload.get(4) == Some(&0x19) && packet.payload.len() > 6 {
                        packet.payload[6] = slot;
                    } else {
                        return Err("FiiO user-bank save packet is not recognized".into());
                    }
                }
            }
            for packet in packets {
                self.io.write(&packet.framed()).await?;
                self.io
                    .sleep_ms(self.protocol().write_timing().commit_step_ms)
                    .await;
            }
            return self.verify_fiio_write_target(slot).await;
        }
        for packet in self.protocol().commit_packets() {
            if self.save_restarts_device() {
                // Save is single-shot: an error is ambiguous delivery, not permission
                // to resend or roll back against a DAC that may be restarting.
                self.require_open_transaction()?;
                self.restart_attempted = true;
                self.io.write(&packet.framed()).await.map_err(|error| {
                    format!("Save delivery uncertain; reconnect and read the DAC: {error}")
                })?;
            } else {
                self.send(&packet)
                    .await
                    .map_err(|error| format!("Commit write failed: {error}"))?;
            }
            self.io
                .sleep_ms(self.protocol().write_timing().commit_step_ms)
                .await;
        }
        Ok(())
    }
}

fn compare_peq(
    actual: &PEQData,
    expected: &PEQData,
    caps: &super::DeviceCapabilities,
) -> Result<(), String> {
    if (actual.global_gain - expected.global_gain).abs() > 0.001 {
        return Err(format!(
            "Global gain mismatch: expected {}, got {}",
            expected.global_gain, actual.global_gain
        ));
    }
    if actual.filters.len() != expected.filters.len() {
        return Err(format!(
            "Filter count mismatch: expected {}, got {}",
            expected.filters.len(),
            actual.filters.len()
        ));
    }
    for (actual, expected) in actual.filters.iter().zip(&expected.filters) {
        let expected_gain = if expected.enabled { expected.gain } else { 0.0 };
        let metadata_mismatch = expected.enabled
            && ((actual.freq as i32 - expected.freq as i32).abs() > caps.freq_tolerance
                || (actual.q - expected.q).abs() > caps.q_tolerance
                || actual.filter_type != expected.filter_type);
        if (actual.gain - expected_gain).abs() > caps.gain_tolerance
            || metadata_mismatch
            || (caps.supports_per_band_enable && actual.enabled != expected.enabled)
        {
            return Err(format!("Band {} mismatch", expected.index + 1));
        }
    }
    Ok(())
}
