// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Synchronous, transport-independent device operations.

mod io;

#[cfg(test)]
pub(crate) use io::fake;
pub use io::{DeviceIo, HID_READ_BUFFER_BYTES};

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
/// Attached when the DAC never answered the preamp query, so the preamp was
/// written but neither read nor verified.
pub const UNKNOWN_GAIN_WARNING: &str =
    "DAC did not report its preamp; preamp was written but not verified";
const UNCORRELATED_GAIN_ERROR: &str =
    "Global gain read required retry; refusing uncorrelated state";

fn combine_errors(first: String, retry: String) -> String {
    if first == retry {
        first
    } else {
        format!("{first}; retry failed: {retry}")
    }
}

pub(crate) type ProgressCallback<'a> = dyn FnMut(&str, f32) + 'a;

pub struct DeviceSession<'a> {
    pub(crate) io: &'a mut dyn DeviceIo,
    pub(crate) profile: &'static DeviceProfile,
    progress: Option<&'a mut ProgressCallback<'a>>,
    next_nonce: u8,
    last_pull_had_invalid_response: bool,
    last_pull_sent_gain_request: bool,
    last_pull_gain_read_completed: bool,
    gain_read_requires_correlation: bool,
    last_read_was_retried: bool,
    /// The last pull got no gain reply from a protocol where that is allowed;
    /// its global_gain is a 0 dB placeholder, not device truth.
    last_pull_gain_unknown: bool,
}

impl<'a> DeviceSession<'a> {
    #[cfg(test)]
    pub(crate) fn new(io: &'a mut dyn DeviceIo, profile: &'static DeviceProfile) -> Self {
        Self {
            io,
            profile,
            progress: None,
            next_nonce: 0,
            last_pull_had_invalid_response: false,
            last_pull_sent_gain_request: false,
            last_pull_gain_read_completed: false,
            gain_read_requires_correlation: false,
            last_read_was_retried: false,
            last_pull_gain_unknown: false,
        }
    }

    pub fn with_progress(
        io: &'a mut dyn DeviceIo,
        profile: &'static DeviceProfile,
        progress: &'a mut ProgressCallback<'a>,
    ) -> Self {
        Self::with_progress_and_nonce(io, profile, progress, 0)
    }

    pub fn with_progress_and_nonce(
        io: &'a mut dyn DeviceIo,
        profile: &'static DeviceProfile,
        progress: &'a mut ProgressCallback<'a>,
        initial_nonce: u8,
    ) -> Self {
        Self {
            io,
            profile,
            progress: Some(progress),
            next_nonce: initial_nonce,
            last_pull_had_invalid_response: false,
            last_pull_sent_gain_request: false,
            last_pull_gain_read_completed: false,
            gain_read_requires_correlation: false,
            last_read_was_retried: false,
            last_pull_gain_unknown: false,
        }
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

    fn require_hardware_eq(&self) -> Result<(), String> {
        if self.profile.protocol.has_hardware_eq() {
            Ok(())
        } else {
            Err(format!("{} has no hardware EQ", self.profile.name))
        }
    }

    pub fn pull(&mut self) -> Result<PEQData, String> {
        self.require_hardware_eq()?;
        // A complete-pull retry is only safe when the failed attempt did not
        // issue an uncorrelatable global-gain request. Clear this one-shot
        // guard before starting a new user-visible operation.
        self.gain_read_requires_correlation = false;
        let protocol = self.protocol();
        match self.pull_once() {
            Ok(peq) if !protocol.is_default_state(&peq) => Ok(peq),
            Ok(_) => {
                self.io.sleep_ms(RETRY_DELAY_MS);
                // The retry exists because a default-state read may be a
                // transient lie. When this corroborating attempt fails,
                // surface its error instead of reporting the uncorroborated
                // default as device truth.
                self.pull_once()
            }
            Err(first) => {
                if first.contains(UNCORRELATED_GAIN_ERROR) {
                    return Err(first);
                }
                let first_sent_gain = self.last_pull_sent_gain_request;
                self.io.sleep_ms(RETRY_DELAY_MS);
                if first_sent_gain && !self.last_pull_gain_read_completed {
                    // Moondrop/FiiO do not carry a gain nonce. If the first
                    // complete pull already sent that request, a response read
                    // by the retry could be the late answer to the first one.
                    self.gain_read_requires_correlation = true;
                }
                let retry = self.pull_once();
                self.gain_read_requires_correlation = false;
                match retry {
                    Ok(peq) if protocol.is_default_state(&peq) => Err(format!(
                        "{first}; retry returned an unconfirmed default EQ state"
                    )),
                    Ok(peq) => Ok(peq),
                    Err(retry) => Err(combine_errors(first, retry)),
                }
            }
        }
    }

    /// Normalizes before writing, snapshots, commits, verifies, and rolls back on failure.
    /// Returns the committed PEQ plus the capability-clamp warnings, which
    /// callers must surface — the clamp rewrites the user's values.
    pub fn persistent_push(&mut self, peq: PEQData) -> Result<(PEQData, Vec<String>), String> {
        self.require_hardware_eq()?;
        let (normalized, warnings) = self.normalize(peq)?;
        let backup = self.pull()?;
        if self.last_pull_had_invalid_response {
            return Err("Cannot push while the device returned an invalid EQ response".into());
        }
        validate_peq_for_capabilities(&backup, &self.profile.caps)?;
        // A DAC that resets on save cannot be read back afterwards, so its
        // RAM state is verified first and the save is the last packet sent.
        let save_last = self.protocol().quirks().save_resets_device;
        let attempt: Result<PEQData, String> = (|| {
            self.write_to_ram(&normalized)
                .map_err(|error| format!("Push write failed: {error}"))?;
            if !save_last {
                self.commit()
                    .map_err(|error| format!("Push commit failed: {error}"))?;
            }
            self.io.sleep_ms(RETRY_DELAY_MS);
            let actual = self
                .pull()
                .map_err(|error| format!("Push verification failed: {error}"))?;
            if self.last_pull_had_invalid_response {
                return Err(
                    "Push verification failed: device returned an invalid EQ response".into(),
                );
            }
            validate_peq_for_capabilities(&actual, &self.profile.caps)
                .map_err(|error| format!("Push verification failed: {error}"))?;
            compare_peq(
                &actual,
                &normalized,
                &self.profile.caps,
                !self.last_pull_gain_unknown,
            )
            .map_err(|error| format!("Push verification failed: {error}"))?;
            if save_last {
                self.commit()
                    .map_err(|error| format!("Push commit failed: {error}"))?;
            }
            Ok(actual)
        })();
        match attempt {
            Ok(mut actual) => {
                let mut warnings = warnings;
                if self.last_pull_gain_unknown {
                    // The readback has no preamp; report what was written.
                    actual.global_gain = normalized.global_gain;
                    warnings.push(UNKNOWN_GAIN_WARNING.to_string());
                }
                self.progress("Write complete", 100.0);
                Ok((actual, warnings))
            }
            Err(error) => Err(match self.restore_and_verify(&backup) {
                Ok(()) => format!("{error}; previous state restored"),
                Err(rollback) => format!("{error}; rollback failed: {rollback}"),
            }),
        }
    }

    fn restore_and_verify(&mut self, backup: &PEQData) -> Result<(), String> {
        self.write_to_ram(backup)?;
        // The backup is still what the DAC has saved unless a save was sent;
        // re-saving would reset a save-resets device mid-verification.
        if !self.protocol().quirks().save_resets_device {
            self.commit()?;
        }
        self.io.sleep_ms(RETRY_DELAY_MS);
        let actual = self.pull()?;
        if self.last_pull_had_invalid_response {
            return Err("Device returned an invalid EQ response during restore".into());
        }
        validate_peq_for_capabilities(&actual, &self.profile.caps)?;
        compare_peq(
            &actual,
            backup,
            &self.profile.caps,
            !self.last_pull_gain_unknown,
        )
    }

    /// Writes persistently without a readback. Kept for the GUI's explicit
    /// skip-verification setting; CLI writes always use `persistent_push`.
    ///
    /// The returned PEQ is the *request*, not a readback of what the device
    /// stored — there is none, by construction. Callers that publish this as
    /// the device's committed state must say so, which is what the extra
    /// warning below is for.
    pub fn unverified_push(&mut self, peq: PEQData) -> Result<(PEQData, Vec<String>), String> {
        self.require_hardware_eq()?;
        let (normalized, mut warnings) = self.normalize(peq)?;
        let backup = self.pull()?;
        if self.last_pull_had_invalid_response {
            return Err("Cannot push while the device returned an invalid EQ response".into());
        }
        validate_peq_for_capabilities(&backup, &self.profile.caps)?;
        let attempt = self.write_to_ram(&normalized).and_then(|_| self.commit());
        if let Err(error) = attempt {
            return Err(match self.restore_and_verify(&backup) {
                Ok(()) => format!("{error}; previous state restored"),
                Err(rollback) => format!("{error}; rollback failed: {rollback}"),
            });
        }
        warnings.push(UNVERIFIED_PUSH_WARNING.to_string());
        self.progress("Write complete", 100.0);
        Ok((normalized, warnings))
    }

    pub fn apply_ram(&mut self, peq: PEQData) -> Result<(PEQData, Vec<String>), String> {
        self.require_hardware_eq()?;
        validate_peq(&peq)?;
        if !self.profile.caps.supports_ram_apply {
            return Err(format!(
                "{} does not advertise volatile RAM apply support",
                self.profile.name
            ));
        }
        let backup = self.pull()?;
        if self.last_pull_had_invalid_response {
            return Err("Cannot apply while the device returned an invalid EQ response".into());
        }
        validate_peq_for_capabilities(&backup, &self.profile.caps)?;
        let (normalized, warnings) = self.normalize(peq)?;
        let attempt = self.write_ram_and_apply(&normalized);
        if let Err(error) = attempt {
            return Err(self.rollback_ram(&backup, error));
        }
        self.progress("Temporary EQ applied", 100.0);
        Ok((normalized, warnings))
    }

    fn verify_ram_state(&mut self, expected: &PEQData) -> Result<(), String> {
        self.io.sleep_ms(RETRY_DELAY_MS);
        let actual = self.pull()?;
        if self.last_pull_had_invalid_response {
            return Err("Device returned an invalid EQ response during RAM verification".into());
        }
        validate_peq_for_capabilities(&actual, &self.profile.caps)?;
        compare_peq(
            &actual,
            expected,
            &self.profile.caps,
            !self.last_pull_gain_unknown,
        )
    }

    fn rollback_ram(&mut self, backup: &PEQData, apply_error: String) -> String {
        let restore = self
            .write_ram_and_apply(backup)
            .and_then(|_| self.verify_ram_state(backup));
        match restore {
            Ok(()) => format!("{apply_error}; previous RAM state restored"),
            Err(rollback) => format!("{apply_error}; RAM rollback failed: {rollback}"),
        }
    }

    fn write_ram_and_apply(&mut self, peq: &PEQData) -> Result<(), String> {
        self.write_to_ram(peq)?;
        for packet in self.protocol().ram_apply_packets() {
            self.send(&packet)?;
            self.io
                .sleep_ms(self.protocol().write_timing().commit_step_ms);
        }
        Ok(())
    }

    pub fn reset_eq(&mut self) -> Result<(), String> {
        let peq = PEQData {
            filters: (0..self.profile.caps.num_bands)
                .map(|index| Filter::enabled(index as u8, false))
                .collect(),
            global_gain: 0.0,
        };
        self.persistent_push(peq).map(|_| ())
    }

    fn normalize(&self, peq: PEQData) -> Result<(PEQData, Vec<String>), String> {
        normalize_peq_for_profile(peq, self.profile)
    }

    fn pull_once(&mut self) -> Result<PEQData, String> {
        self.last_pull_had_invalid_response = false;
        self.last_pull_sent_gain_request = false;
        self.last_pull_gain_read_completed = false;
        self.last_pull_gain_unknown = false;
        self.progress("Preparing EQ read…", 5.0);
        self.init()?;
        let timing = self.protocol().write_timing();
        self.progress("Reading device preamp…", 10.0);
        self.last_pull_sent_gain_request = true;
        let global_gain = match self.read_gain() {
            Ok(gain) => gain,
            // Only a clean timeout qualifies; transport errors still fail.
            Err(error)
                if self.protocol().quirks().gain_read_optional
                    && error == "Global gain read timeout" =>
            {
                self.last_pull_gain_unknown = true;
                self.progress("DAC did not report its preamp; showing 0 dB", 10.0);
                0.0
            }
            Err(error) => return Err(error),
        };
        self.last_pull_gain_read_completed = true;
        self.io.sleep_ms(timing.post_gain_read_ms);
        let count = self.profile.caps.num_bands;
        let mut filters = Vec::with_capacity(count);
        for index in 0..count {
            self.progress(
                &format!("Reading band {}/{}…", index + 1, count),
                10.0 + index as f32 / count as f32 * 75.0,
            );
            filters.push(self.read_filter(index as u8)?);
            self.io.sleep_ms(timing.flood_delay_ms);
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

    fn read_filter(&mut self, index: u8) -> Result<Filter, String> {
        let protocol = self.protocol();
        let per_round = protocol
            .resend_unanswered_after()
            .unwrap_or(FILTER_READ_ATTEMPTS);
        let mut remaining = FILTER_READ_ATTEMPTS;
        let mut first_error: Option<String> = None;
        let mut last_error = None;
        while remaining > 0 {
            // Use a fresh nonce for every retry where the protocol carries
            // one. A late response from an earlier attempt then cannot satisfy
            // the new request's correlation predicate.
            self.next_nonce = self.next_nonce.wrapping_add(1).max(1);
            let nonce = self.next_nonce;
            let request = protocol.read_filter_request(index, nonce);
            let take = per_round.min(remaining);
            self.send(&request)?;
            match self.read_matching("Filter", take, |data| {
                protocol.matches_filter_response(data, index, nonce)
            }) {
                Ok(data) => {
                    let valid = protocol.is_filter_response_valid(&data, index, nonce);
                    if !valid {
                        self.last_pull_had_invalid_response = true;
                        return Err(format!(
                            "Device returned an invalid EQ response: filter {} values",
                            index + 1
                        ));
                    }
                    return protocol.parse_filter_response(&data).ok_or_else(|| {
                        format!("Filter {} response could not be parsed", index + 1)
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
            (None, None) => "Filter read timeout".into(),
        })
    }

    fn read_gain(&mut self) -> Result<f64, String> {
        let gain = self.read_gain_once()?;
        if self.last_read_was_retried || self.gain_read_requires_correlation {
            // Global-gain frames do not carry a transaction nonce. A retry can
            // accept a late response from the first command, so fail closed
            // instead of allowing it to become rollback truth.
            return Err(UNCORRELATED_GAIN_ERROR.into());
        }
        Ok(gain)
    }

    fn read_gain_once(&mut self) -> Result<f64, String> {
        let protocol = self.protocol();
        let request = protocol.read_global_gain_request();
        let data = self.send_and_read(
            "Global gain",
            &request,
            GAIN_READ_ATTEMPTS,
            25,
            |data| protocol.matches_global_gain_response(data),
            true,
        )?;
        protocol
            .parse_global_gain_response(&data)
            .ok_or_else(|| "Global gain response could not be parsed".into())
    }

    /// Sends a read request, re-sending it when the protocol opts in and a full
    /// round of attempts goes unanswered. The total read budget is unchanged.
    fn send_and_read(
        &mut self,
        label: &str,
        request: &Packet,
        attempts: usize,
        settle_ms: u64,
        matches: impl Fn(&[u8]) -> bool,
        quarantine_before_resend: bool,
    ) -> Result<Vec<u8>, String> {
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
                self.drain();
                self.last_read_was_retried = true;
            }
            self.send(request)?;
            sent_request = true;
            self.io.sleep_ms(settle_ms);
            let take = per_round.min(remaining);
            match self.read_matching(label, take, &matches) {
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
            (None, None) => format!("{label} read timeout"),
        })
    }

    fn init(&mut self) -> Result<(), String> {
        for packet in self.protocol().init_packets() {
            self.send(&packet)
                .map_err(|error| format!("Init write failed: {error}"))?;
        }
        self.io.sleep_ms(self.protocol().write_timing().init_ms);
        self.drain();
        Ok(())
    }

    fn write_to_ram(&mut self, peq: &PEQData) -> Result<(), String> {
        self.progress("Preparing EQ write…", 10.0);
        self.init()?;
        let protocol = self.protocol();
        let total = peq.filters.len();
        for (index, filter) in peq.filters.iter().enumerate() {
            self.progress(
                &format!("Writing band {}/{}…", index + 1, total),
                15.0 + index as f32 / total as f32 * 60.0,
            );
            for packet in protocol
                .write_filter_packets(
                    index as u8,
                    filter,
                    self.profile.caps.dsp_sample_rate,
                    peq.global_gain,
                )
                .map_err(|error| format!("Band {} write failed: {error}", index + 1))?
            {
                self.send(&packet)
                    .map_err(|error| format!("Band {} write failed: {error}", index + 1))?;
            }
            self.io.sleep_ms(protocol.write_timing().per_filter_ms);
        }
        self.progress("Writing preamp…", 75.0);
        self.io.sleep_ms(protocol.write_timing().batch_ms);
        for packet in protocol.write_global_gain_packets(peq.global_gain) {
            self.send(&packet)
                .map_err(|error| format!("Global gain write failed: {error}"))?;
        }
        self.io.sleep_ms(protocol.write_timing().global_gain_ms);
        Ok(())
    }

    fn commit(&mut self) -> Result<(), String> {
        self.progress("Saving EQ to DAC…", 80.0);
        for packet in self.protocol().commit_packets() {
            self.send(&packet)
                .map_err(|error| format!("Commit write failed: {error}"))?;
            self.io
                .sleep_ms(self.protocol().write_timing().commit_step_ms);
        }
        Ok(())
    }
}

fn compare_peq(
    actual: &PEQData,
    expected: &PEQData,
    caps: &super::DeviceCapabilities,
    check_gain: bool,
) -> Result<(), String> {
    if check_gain && (actual.global_gain - expected.global_gain).abs() > 0.001 {
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

#[cfg(test)]
mod tests {
    use super::io::fake::{FakeIo, IoEvent};
    use super::*;
    use crate::device::families::walkplay::READ;
    use crate::device::get_supported_device;

    #[test]
    fn original_dawn_pro_refuses_eq_without_touching_the_device() {
        let profile = get_supported_device(0x2FC6, 0xF06A).unwrap();
        let mut io = FakeIo::default();
        let mut session = DeviceSession::new(&mut io, profile);
        let peq = PEQData {
            filters: vec![],
            global_gain: 0.0,
        };
        for error in [
            session.pull().unwrap_err(),
            session.persistent_push(peq.clone()).unwrap_err(),
            session.unverified_push(peq.clone()).unwrap_err(),
            session.apply_ram(peq).unwrap_err(),
        ] {
            assert_eq!(error, "Moondrop Dawn Pro has no hardware EQ");
        }
        assert!(io.writes.is_empty());
        assert_eq!(io.read_calls, 0);
    }

    #[test]
    fn invalid_mutation_writes_nothing() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        let mut session = DeviceSession::new(&mut io, profile);
        let error = session
            .apply_ram(PEQData {
                filters: vec![],
                global_gain: f64::NAN,
            })
            .unwrap_err();
        assert!(error.contains("finite"));
        assert!(io.writes.is_empty());
    }

    #[test]
    fn apply_ram_restores_the_snapshot_when_apply_fails() {
        let profile = get_supported_device(0x2972, 0x0102).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]);
        io.reads
            .push_back(vec![0xBB, 0x0B, 0, 0, 0x17, 2, 0, 10, 0, 0xEE]);
        for index in 0..5u8 {
            io.reads.push_back(vec![
                0xBB, 0x0B, 0, 0, 0x15, 8, index, 0, 10, 0x03, 0xE8, 0, 100, 0, 0, 0xEE,
            ]);
        }
        // Requested write, rollback write, and verification pull each perform
        // their own init drain before the verification responses.
        io.reads.push_back(vec![]);
        io.reads.push_back(vec![]);
        io.reads.push_back(vec![]);
        io.reads
            .push_back(vec![0xBB, 0x0B, 0, 0, 0x17, 2, 0, 10, 0, 0xEE]);
        for index in 0..5u8 {
            io.reads.push_back(vec![
                0xBB, 0x0B, 0, 0, 0x15, 8, index, 0, 10, 0x03, 0xE8, 0, 100, 0, 0, 0xEE,
            ]);
        }
        // Initial pull uses writes 1..6. Fail all three attempts for the
        // requested filter at writes 9..11, then allow the rollback writes.
        io.failing_write_calls.extend([9, 10, 11]);
        let peq = PEQData {
            filters: (0..5).map(|index| Filter::enabled(index, false)).collect(),
            global_gain: -2.0,
        };

        let error = DeviceSession::new(&mut io, profile)
            .apply_ram(peq)
            .expect_err("a failed RAM apply must report the rollback result");
        assert!(error.contains("previous RAM state restored"), "{error}");
        assert!(io.write_calls >= 15, "rollback writes were not attempted");
    }

    fn queue_pull(io: &mut FakeIo, gain: i8) {
        queue_pull_with_nonce_start(io, gain, 1);
    }

    fn queue_pull_with_nonce_start(io: &mut FakeIo, gain: i8, nonce_start: u8) {
        io.reads.push_back(vec![]); // init drain terminator
        io.reads.push_back(vec![
            READ,
            super::super::families::walkplay::CMD_GLOBAL_GAIN,
            0,
            0,
            gain as u8,
            0,
        ]);
        for index in 0..10u8 {
            let mut packet = vec![0; 34];
            packet[0] = READ;
            packet[1] = super::super::families::walkplay::CMD_PEQ_VALUES;
            packet[2] = nonce_start + index;
            packet[4] = index;
            packet[27..29].copy_from_slice(&(100 + index as u16).to_le_bytes());
            packet[29..31].copy_from_slice(&256u16.to_le_bytes());
            packet[31..33].copy_from_slice(&256i16.to_le_bytes());
            packet[33] = 2;
            io.reads.push_back(packet);
        }
    }

    /// One complete pull whose responses parse to a flat, zero-preamp state:
    /// exactly the transient default that `pull`'s retry exists to confirm.
    fn queue_default_pull(io: &mut FakeIo) {
        io.reads.push_back(vec![]); // init drain terminator
        io.reads.push_back(vec![
            READ,
            super::super::families::walkplay::CMD_GLOBAL_GAIN,
            0,
            0,
            0,
            0,
        ]);
        for index in 0..10u8 {
            let mut packet = vec![0; 34];
            packet[0] = READ;
            packet[1] = super::super::families::walkplay::CMD_PEQ_VALUES;
            packet[2] = index + 1;
            packet[4] = index;
            packet[27..29].copy_from_slice(&(100 + index as u16).to_le_bytes());
            packet[29..31].copy_from_slice(&256u16.to_le_bytes());
            // raw gain stays 0 → parsed gain 0.0 → flat bands → default state.
            packet[33] = 2;
            io.reads.push_back(packet);
        }
    }

    #[test]
    fn pull_surfaces_retry_error_instead_of_uncorroborated_default() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_default_pull(&mut io);
        // First attempt returns the suspect default; the confirming retry
        // exhausts its read budget unanswered and must fail the pull rather
        // than hand back the uncorroborated default as device truth.
        let error = DeviceSession::new(&mut io, profile).pull().unwrap_err();
        assert!(!error.is_empty());
    }

    #[test]
    fn pull_rejects_a_default_after_an_unanswered_gain_request() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // first init drain
        io.read_error_until = Some((2, 4, "transient read".into()));
        queue_default_pull(&mut io);
        let error = DeviceSession::new(&mut io, profile).pull().unwrap_err();
        assert!(error.contains("uncorrelated"), "{error}");
    }

    #[test]
    fn a_filter_read_keeps_the_transport_error_that_started_the_failure() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        // Drain, gain, then band 1's reads. The very first band read hits a
        // USB error; every later attempt in every round simply times out, so
        // the last error the loop saw is the generic timeout.
        io.reads.push_back(vec![]); // init drain
        io.reads.push_back(vec![
            READ,
            super::super::families::walkplay::CMD_GLOBAL_GAIN,
            0,
            0,
            0,
            0,
        ]);
        // read_error_until counts io.read calls, and the drain + gain read
        // already consumed the first two.
        io.read_error_until = Some((3, 3, "USB stall: transfer failed".into()));

        let error = DeviceSession::new(&mut io, profile)
            .pull()
            .expect_err("a band read that never answers must fail the pull");

        // The user is told what actually went wrong on the wire, not just
        // that the band read timed out. The gain path has reported both for
        // every round since it gained combine_errors; the band path did not,
        // so a real transport error only survived if it happened to land on
        // the final attempt of the final round.
        assert!(
            error.contains("USB stall: transfer failed"),
            "the first transport error must survive: {error}"
        );
    }

    #[test]
    fn pull_clears_invalid_response_state_before_a_valid_retry() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]);
        io.reads.push_back(vec![
            READ,
            super::super::families::walkplay::CMD_GLOBAL_GAIN,
            0,
            0,
            0,
            0,
        ]);
        let mut invalid = vec![0u8; 34];
        invalid[0] = READ;
        invalid[1] = super::super::families::walkplay::CMD_PEQ_VALUES;
        invalid[2] = 1;
        invalid[4] = 0;
        invalid[29..31].copy_from_slice(&256u16.to_le_bytes());
        invalid[31..33].copy_from_slice(&256i16.to_le_bytes());
        invalid[33] = 2;
        io.reads.push_back(invalid);
        queue_pull_with_nonce_start(&mut io, -1, 2);
        let peq = DeviceSession::new(&mut io, profile).pull().unwrap();
        assert_eq!(peq.global_gain, -1.0);
    }

    #[test]
    fn pull_preserves_a_concrete_read_error_across_retry() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // init drain terminator
        io.read_errors.push_back(Some("device disconnected".into()));

        let error = DeviceSession::new(&mut io, profile).pull().unwrap_err();
        assert!(error.contains("device disconnected"), "{error}");
    }

    #[test]
    fn pull_rejects_gain_retry_as_uncorrelated_state() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // init drain terminator
        for _ in 0..15 {
            io.reads.push_back(vec![]); // first gain round is unanswered
        }
        io.reads.push_back(vec![]); // retry quarantine terminator
        io.reads.push_back(vec![
            READ,
            super::super::families::walkplay::CMD_GLOBAL_GAIN,
            0,
            0,
            (-7i8) as u8,
            0,
        ]);
        let error = DeviceSession::new(&mut io, profile).pull().unwrap_err();
        assert!(error.contains("uncorrelated"), "{error}");
    }

    #[test]
    fn pull_rejects_late_moondrop_gain_after_complete_pull_retry() {
        let profile = get_supported_device(0x35d8, 0x011d).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // first init drain
        for _ in 0..GAIN_READ_ATTEMPTS {
            io.reads.push_back(vec![]); // unanswered first gain request
        }
        io.reads.push_back(vec![]); // retry init drain
        io.reads.push_back(vec![0x80, 0x23, 0, 26, 0]); // late +1.0 dB response
        for index in 0..10u8 {
            let mut response = vec![0u8; 63];
            response[0] = 0x80;
            response[1] = 0x09;
            response[4] = index;
            response[27..29].copy_from_slice(&1_000u16.to_le_bytes());
            response[29..31].copy_from_slice(&256u16.to_le_bytes());
            response[31..33].copy_from_slice(&256i16.to_le_bytes());
            response[33] = 2;
            io.reads.push_back(response);
        }

        let error = DeviceSession::new(&mut io, profile).pull().unwrap_err();
        assert!(error.contains("uncorrelated"), "{error}");
    }

    #[test]
    fn ja11_push_verifies_ram_then_saves_last() {
        let profile = get_supported_device(0x2972, 0x0102).unwrap();
        let mut io = FakeIo::default();
        let queue_ja11_pull = |io: &mut FakeIo| {
            io.reads.push_back(vec![]); // init drain
            io.reads
                .push_back(vec![0xBB, 0x0B, 0, 0, 0x17, 2, 0, 10, 0, 0xEE]);
            for index in 0..5u8 {
                io.reads.push_back(vec![
                    0xBB, 0x0B, 0, 0, 0x15, 8, index, 0, 10, 0x03, 0xE8, 0, 100, 0, 0, 0xEE,
                ]);
            }
        };
        queue_ja11_pull(&mut io); // snapshot
        io.reads.push_back(vec![]); // push init drain
        queue_ja11_pull(&mut io); // RAM verification
        let peq = PEQData {
            filters: (0..5)
                .map(|index| Filter {
                    index,
                    enabled: true,
                    freq: 1000,
                    gain: 1.0,
                    q: 1.0,
                    filter_type: crate::FilterType::Peak,
                })
                .collect(),
            global_gain: 1.0,
        };

        DeviceSession::new(&mut io, profile)
            .persistent_push(peq)
            .unwrap();

        // The DAC re-enumerates after the save: it must be the final I/O.
        let save = [2, 0xAA, 0x0A, 0, 0, 0x19, 1, 3, 0, 0xEE];
        assert_eq!(io.writes.last().unwrap().as_slice(), save);
        assert_eq!(io.writes.iter().filter(|w| w[5] == 0x19).count(), 1);
        let last_write = io
            .events
            .iter()
            .rposition(|event| matches!(event, IoEvent::Write(_)))
            .unwrap();
        assert!(!io.events[last_write..]
            .iter()
            .any(|event| matches!(event, IoEvent::Read)));
    }

    #[test]
    fn ja11_pull_tolerates_an_unanswered_gain_read() {
        let profile = get_supported_device(0x2972, 0x0102).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]);
        for _ in 0..GAIN_READ_ATTEMPTS {
            io.reads.push_back(vec![]);
        }
        for index in 0..5u8 {
            io.reads.push_back(vec![
                0xBB, 0x0B, 0, 0, 0x15, 8, index, 0, 10, 0x03, 0xE8, 0, 100, 0, 0, 0xEE,
            ]);
        }

        let mut session = DeviceSession::new(&mut io, profile);
        let peq = session.pull().unwrap();
        assert_eq!(peq.global_gain, 0.0);
        assert!(session.last_pull_gain_unknown);
        assert_eq!(peq.filters.len(), 5);
    }

    #[test]
    fn pull_rejects_late_fiio_gain_after_complete_pull_retry() {
        // KA15: its gain read is mandatory, unlike JA11's.
        let profile = get_supported_device(0x2972, 0x0104).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]);
        for _ in 0..GAIN_READ_ATTEMPTS {
            io.reads.push_back(vec![]);
        }
        io.reads.push_back(vec![]);
        io.reads
            .push_back(vec![0xBB, 0x0B, 0, 0, 0x17, 2, 0, 10, 0, 0xEE]);
        for index in 0..10u8 {
            io.reads.push_back(vec![
                0xBB, 0x0B, 0, 0, 0x15, 8, index, 0, 10, 0x03, 0xE8, 0, 100, 0, 0, 0xEE,
            ]);
        }

        let error = DeviceSession::new(&mut io, profile).pull().unwrap_err();
        assert!(error.contains("uncorrelated"), "{error}");
    }

    #[test]
    fn pull_reads_gain_and_waits_before_first_band() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1);

        DeviceSession::new(&mut io, profile).pull().unwrap();

        let gain_request = io
            .events
            .iter()
            .position(|event| {
                *event == IoEvent::Write(super::super::families::walkplay::CMD_GLOBAL_GAIN)
            })
            .unwrap();
        let first_band_request = io
            .events
            .iter()
            .position(|event| {
                *event == IoEvent::Write(super::super::families::walkplay::CMD_PEQ_VALUES)
            })
            .unwrap();
        assert!(gain_request < first_band_request);
        assert!(
            io.events[gain_request + 1..first_band_request].contains(&IoEvent::Sleep(
                profile
                    .protocol
                    .eq
                    .unwrap()
                    .write_timing()
                    .post_gain_read_ms
            ))
        );
    }

    #[test]
    fn dropped_band_response_is_resent_and_pull_succeeds() {
        use super::super::families::walkplay::CMD_PEQ_VALUES;
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // init drain terminator
        io.reads.push_back(vec![
            READ,
            super::super::families::walkplay::CMD_GLOBAL_GAIN,
            0,
            0,
            0xFF,
            0,
        ]);
        // The DAC drops the first band-0 request: a full round of attempts
        // goes unanswered, then the resent request (with a fresh nonce) is
        // answered.
        for _ in 0..15 {
            io.reads.push_back(vec![]);
        }
        for index in 0..10u8 {
            let mut packet = vec![0; 34];
            packet[0] = READ;
            packet[1] = CMD_PEQ_VALUES;
            packet[2] = index + 2;
            packet[4] = index;
            packet[27..29].copy_from_slice(&(100 + index as u16).to_le_bytes());
            packet[29..31].copy_from_slice(&256u16.to_le_bytes());
            packet[31..33].copy_from_slice(&256i16.to_le_bytes());
            packet[33] = 2;
            io.reads.push_back(packet);
        }

        let peq = DeviceSession::new(&mut io, profile).pull().unwrap();
        assert_eq!(peq.filters.len(), 10);
        let band_requests = io
            .events
            .iter()
            .filter(|event| **event == IoEvent::Write(CMD_PEQ_VALUES))
            .count();
        assert_eq!(band_requests, 11);
    }

    #[test]
    fn healthy_pull_sends_each_band_request_once() {
        use super::super::families::walkplay::CMD_PEQ_VALUES;
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1);

        DeviceSession::new(&mut io, profile).pull().unwrap();

        let band_requests = io
            .events
            .iter()
            .filter(|event| **event == IoEvent::Write(CMD_PEQ_VALUES))
            .count();
        assert_eq!(band_requests, 10);
    }

    #[test]
    fn pull_rotates_filter_nonces_between_reads() {
        use super::super::families::walkplay::CMD_PEQ_VALUES;
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1);
        queue_pull_with_nonce_start(&mut io, -1, 11);
        let mut session = DeviceSession::new(&mut io, profile);
        session.pull().unwrap();
        session.pull().unwrap();

        let nonces: Vec<u8> = io
            .writes
            .iter()
            .filter(|packet| packet.get(2) == Some(&CMD_PEQ_VALUES))
            .map(|packet| packet[3])
            .collect();
        assert_eq!(nonces, (1..=20).collect::<Vec<_>>());
    }

    fn test_peq() -> PEQData {
        PEQData {
            filters: (0..10)
                .map(|index| Filter {
                    index,
                    enabled: true,
                    freq: 100 + index as u16,
                    gain: 1.0,
                    q: 1.0,
                    filter_type: crate::FilterType::Peak,
                })
                .collect(),
            global_gain: -1.0,
        }
    }

    #[test]
    fn mid_write_failure_rolls_back_and_verifies_backup() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1); // snapshot
        io.reads.push_back(vec![]); // push init drain
        io.reads.push_back(vec![]); // rollback init drain
        queue_pull_with_nonce_start(&mut io, -1, 11); // rollback readback
        io.failing_write_calls = [15, 16, 17].into();

        let error = DeviceSession::new(&mut io, profile)
            .persistent_push(test_peq())
            .unwrap_err();

        assert!(error.contains("Push write failed"), "{error}");
        assert!(error.contains("simulated write failure"), "{error}");
        assert!(error.contains("previous state restored"), "{error}");
    }

    #[test]
    fn commit_failure_rolls_back_and_verifies_backup() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1); // snapshot
        io.reads.push_back(vec![]); // push init drain
        io.reads.push_back(vec![]); // rollback init drain
        queue_pull_with_nonce_start(&mut io, -1, 11); // rollback readback
        io.failing_write_calls = [25, 26, 27].into();

        let error = DeviceSession::new(&mut io, profile)
            .persistent_push(test_peq())
            .unwrap_err();

        assert!(error.contains("Push commit failed"), "{error}");
        assert!(error.contains("simulated write failure"), "{error}");
        assert!(error.contains("previous state restored"), "{error}");
    }

    #[test]
    fn verification_mismatch_rolls_back_and_verifies_backup() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1); // snapshot
        io.reads.push_back(vec![]); // push init drain
        queue_pull_with_nonce_start(&mut io, -2, 11); // mismatching readback
        io.reads.push_back(vec![]); // rollback init drain
        queue_pull_with_nonce_start(&mut io, -1, 21); // rollback readback
        let error = DeviceSession::new(&mut io, profile)
            .persistent_push(test_peq())
            .unwrap_err();
        assert!(error.contains("previous state restored"));
        assert_eq!(
            io.writes
                .iter()
                .filter(|packet| packet.get(2)
                    == Some(&super::super::families::walkplay::CMD_TEMP_WRITE))
                .count(),
            2
        );
    }

    #[test]
    fn persistent_push_refuses_an_invalid_rollback_snapshot() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // init drain terminator
        io.reads.push_back(vec![
            READ,
            super::super::families::walkplay::CMD_GLOBAL_GAIN,
            0,
            0,
            0xFF,
            0,
        ]);
        for index in 0..10u8 {
            let mut packet = vec![0; 34];
            packet[0] = READ;
            packet[1] = super::super::families::walkplay::CMD_PEQ_VALUES;
            packet[2] = index + 1;
            packet[4] = index;
            if index == 0 {
                packet[27..29].copy_from_slice(&0u16.to_le_bytes());
            } else {
                packet[27..29].copy_from_slice(&(100 + index as u16).to_le_bytes());
            }
            packet[29..31].copy_from_slice(&256u16.to_le_bytes());
            packet[31..33].copy_from_slice(&256i16.to_le_bytes());
            packet[33] = 2;
            io.reads.push_back(packet);
        }

        let error = DeviceSession::new(&mut io, profile)
            .persistent_push(test_peq())
            .unwrap_err();
        assert!(error.contains("invalid EQ response"), "{error}");
        assert_eq!(
            io.writes
                .iter()
                .filter(|packet| packet.get(2)
                    == Some(&super::super::families::walkplay::CMD_PEQ_VALUES))
                .count(),
            1
        );
        assert!(io
            .writes
            .iter()
            .filter(
                |packet| packet.get(2) == Some(&super::super::families::walkplay::CMD_PEQ_VALUES)
            )
            .all(|packet| packet.get(1) == Some(&READ)));
    }

    #[test]
    fn persistent_push_returns_the_verified_quantized_state() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1); // snapshot
        io.reads.push_back(vec![]); // push init drain
        queue_pull_with_nonce_start(&mut io, -1, 11); // verification readback

        let mut requested = test_peq();
        for filter in &mut requested.filters {
            filter.gain = 1.004;
        }
        let (committed, _warnings) = DeviceSession::new(&mut io, profile)
            .persistent_push(requested)
            .unwrap();

        assert_eq!(committed.filters[0].gain, 1.0);
        assert!(committed.filters.iter().all(|filter| filter.gain == 1.0));
    }

    #[test]
    fn push_surfaces_capability_clamp_warnings_instead_of_discarding_them() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, 0);

        // 99 dB is far outside this profile's preamp range; the clamp must
        // both rewrite the value AND report it. The old push path discarded
        // the warnings at normalization, so "Saved EQ to DAC" hid a silent
        // change to the user's EQ.
        let (committed, warnings) = DeviceSession::new(&mut io, profile)
            .unverified_push(PEQData {
                filters: vec![],
                global_gain: 99.0,
            })
            .unwrap();

        assert_eq!(committed.global_gain, 6.0, "value must be clamped");
        assert!(
            warnings.iter().any(|warning| warning.contains("preamp")),
            "clamp must be reported to the caller, got {warnings:?}"
        );
    }

    #[test]
    fn an_unverified_push_says_the_returned_state_was_not_read_back() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, 0);

        // The caller publishes this PEQ as the device's committed state and
        // clears the editor's dirty flag against it. With no readback there is
        // nothing behind it, so the result must say so rather than let a DAC
        // that silently dropped the write read as a confirmed commit.
        let (_, warnings) = DeviceSession::new(&mut io, profile)
            .unverified_push(PEQData {
                filters: vec![],
                global_gain: 0.0,
            })
            .unwrap();
        assert!(
            warnings.iter().any(|w| w == UNVERIFIED_PUSH_WARNING),
            "the unverified push must carry its caveat, got {warnings:?}"
        );
    }

    #[test]
    fn a_verified_push_carries_no_unverified_caveat() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1); // snapshot
        io.reads.push_back(vec![]); // push init drain
        queue_pull_with_nonce_start(&mut io, -1, 11); // verification readback

        let (_, warnings) = DeviceSession::new(&mut io, profile)
            .persistent_push(test_peq())
            .unwrap();
        // This path really did read the device back, so its PEQ is the
        // committed state and must stay unqualified — the caveat would
        // train the user to ignore it on the path where it matters.
        assert!(
            !warnings.iter().any(|w| w == UNVERIFIED_PUSH_WARNING),
            "a verified push must not claim it was unverified, got {warnings:?}"
        );
    }
}
