// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Synchronous, transport-independent device operations.

use super::walkplay::{
    CMD_AMP_MODE, CMD_BALANCE, CMD_FILTER_MODE, CMD_GAIN_MODE, CMD_MIC_VOLUME, CMD_VERSION, END,
    READ, WRITE,
};
use super::{
    normalize_peq_for_profile, validate_peq, validate_peq_for_capabilities, DeviceProfile,
    DeviceProtocol, EqProtocol, Packet, WalkplayProtocol,
};
use crate::eq::{Filter, PEQData};

const INIT_DRAIN_ATTEMPTS: usize = 100;
const FILTER_READ_ATTEMPTS: usize = 60;
const GAIN_READ_ATTEMPTS: usize = 20;
const UTILITY_READ_ATTEMPTS: usize = 25;
const UTILITY_READ_RETRIES: usize = 3;
const WRITE_ATTEMPTS: usize = 3;
const RETRY_DELAY_MS: u64 = 100;

fn combine_errors(first: String, retry: String) -> String {
    if first == retry {
        first
    } else {
        format!("{first}; retry failed: {retry}")
    }
}

pub trait DeviceIo {
    fn write(&mut self, data: &[u8]) -> Result<(), String>;
    fn read(&mut self, timeout_ms: i32) -> Result<Vec<u8>, String>;
    fn sleep_ms(&mut self, ms: u64) {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct DacUtilityState {
    pub supported: bool,
    pub filter_mode: String,
    pub amp_mode_class_ab: bool,
    pub high_gain_mode: bool,
    pub mic_volume_db: i8,
    pub channel_balance: i8,
}

impl Default for DacUtilityState {
    fn default() -> Self {
        Self {
            supported: false,
            filter_mode: "FAST-LL".into(),
            amp_mode_class_ab: false,
            high_gain_mode: false,
            mic_volume_db: 0,
            channel_balance: 0,
        }
    }
}

pub(crate) type ProgressCallback<'a> = dyn FnMut(&str, f32) + 'a;

pub struct DeviceSession<'a> {
    io: &'a mut dyn DeviceIo,
    profile: &'static DeviceProfile,
    progress: Option<&'a mut ProgressCallback<'a>>,
    next_nonce: u8,
    last_pull_had_invalid_response: bool,
}

impl<'a> DeviceSession<'a> {
    #[cfg(test)]
    fn new(io: &'a mut dyn DeviceIo, profile: &'static DeviceProfile) -> Self {
        Self {
            io,
            profile,
            progress: None,
            next_nonce: 0,
            last_pull_had_invalid_response: false,
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
        }
    }

    fn progress(&mut self, message: &str, percentage: f32) {
        if let Some(callback) = &mut self.progress {
            callback(message, percentage);
        }
    }

    fn protocol(&self) -> &'static dyn EqProtocol {
        self.profile.protocol.implementation()
    }

    pub fn pull(&mut self) -> Result<PEQData, String> {
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
                self.io.sleep_ms(RETRY_DELAY_MS);
                match self.pull_once() {
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
        let (normalized, warnings) = self.normalize(peq)?;
        let backup = self.pull()?;
        if self.last_pull_had_invalid_response {
            return Err("Cannot push while the device returned an invalid EQ response".into());
        }
        validate_peq_for_capabilities(&backup, &self.profile.caps)?;
        let attempt: Result<PEQData, String> = (|| {
            self.write_to_ram(&normalized)
                .map_err(|error| format!("Push write failed: {error}"))?;
            self.commit()
                .map_err(|error| format!("Push commit failed: {error}"))?;
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
            compare_peq(&actual, &normalized, &self.profile.caps)
                .map_err(|error| format!("Push verification failed: {error}"))?;
            Ok(actual)
        })();
        match attempt {
            Ok(actual) => {
                self.progress("Push successful", 100.0);
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
        self.commit()?;
        self.io.sleep_ms(RETRY_DELAY_MS);
        let actual = self.pull()?;
        if self.last_pull_had_invalid_response {
            return Err("Device returned an invalid EQ response during restore".into());
        }
        validate_peq_for_capabilities(&actual, &self.profile.caps)?;
        compare_peq(&actual, backup, &self.profile.caps)
    }

    /// Writes persistently without a readback. Kept for the GUI's explicit
    /// skip-verification setting; CLI writes always use `persistent_push`.
    pub fn unverified_push(&mut self, peq: PEQData) -> Result<(PEQData, Vec<String>), String> {
        let (normalized, warnings) = self.normalize(peq)?;
        self.write_to_ram(&normalized)?;
        self.commit()?;
        self.progress("Push successful", 100.0);
        Ok((normalized, warnings))
    }

    pub fn apply_ram(&mut self, peq: PEQData) -> Result<(PEQData, Vec<String>), String> {
        validate_peq(&peq)?;
        if !self.profile.caps.supports_ram_apply {
            return Err(format!(
                "{} does not advertise volatile RAM apply support",
                self.profile.name
            ));
        }
        let (normalized, warnings) = self.normalize(peq)?;
        self.write_to_ram(&normalized)?;
        for packet in self.protocol().ram_apply_packets() {
            self.send(&packet)?;
            self.io
                .sleep_ms(self.protocol().write_timing().commit_step_ms);
        }
        self.progress("Apply successful", 100.0);
        Ok((normalized, warnings))
    }

    pub fn firmware_version(&mut self) -> Result<Option<String>, String> {
        if self.profile.protocol != DeviceProtocol::Walkplay {
            return Ok(None);
        }
        let mut last_err = "Firmware version read timeout".to_string();
        for attempt in 1..=UTILITY_READ_RETRIES {
            self.send(&Packet::new(
                WalkplayProtocol::report_id(),
                vec![READ, CMD_VERSION, END],
            ))?;
            self.io.sleep_ms(50);
            match self.read_matching("Firmware version", 20, |data| {
                data.len() >= 10 && data[0] == READ && data[1] == CMD_VERSION
            }) {
                Ok(data) => {
                    let version: String = data
                        .iter()
                        .skip(3)
                        .take(7)
                        .take_while(|byte| byte.is_ascii_graphic())
                        .map(|byte| *byte as char)
                        .collect();
                    return Ok((!version.is_empty()).then_some(version));
                }
                Err(err) => {
                    last_err = err;
                    if attempt < UTILITY_READ_RETRIES {
                        self.drain();
                        self.io.sleep_ms(35);
                    }
                }
            }
        }
        Err(last_err)
    }

    pub fn utility_status(&mut self) -> Result<DacUtilityState, String> {
        if self.profile.protocol != DeviceProtocol::Walkplay {
            return Ok(DacUtilityState::default());
        }
        self.drain();
        self.io.sleep_ms(30);
        let filter = self.read_utility(CMD_FILTER_MODE)?;
        self.io.sleep_ms(25);
        let filter_mode = match filter
            .get(3)
            .copied()
            .ok_or_else(|| "Filter mode response was incomplete".to_string())?
        {
            1 => "FAST-LL",
            2 => "FAST-PC",
            3 => "Slow-LL",
            4 => "Slow-PC",
            5 => "NON-OS",
            value => return Err(format!("Unknown filter mode value: {value}")),
        }
        .to_string();
        self.io.sleep_ms(25);
        let amp_mode_class_ab = self
            .read_utility(CMD_AMP_MODE)?
            .get(3)
            .copied()
            .ok_or_else(|| "Amp mode response was incomplete".to_string())?
            == 1;
        self.io.sleep_ms(25);
        let high_gain_mode = self
            .read_utility(CMD_GAIN_MODE)?
            .get(3)
            .copied()
            .ok_or_else(|| "Gain mode response was incomplete".to_string())?
            == 1;
        self.io.sleep_ms(25);
        let mic_volume_db =
            self.read_utility(CMD_MIC_VOLUME)?
                .get(4)
                .copied()
                .ok_or_else(|| "Mic volume response was incomplete".to_string())? as i8;
        self.io.sleep_ms(25);
        let left = decode_attenuation(self.read_balance(0)?);
        self.io.sleep_ms(25);
        let right = decode_attenuation(self.read_balance(1)?);
        Ok(DacUtilityState {
            supported: true,
            filter_mode,
            amp_mode_class_ab,
            high_gain_mode,
            mic_volume_db,
            channel_balance: if left > 0 {
                left
            } else {
                right.saturating_neg()
            },
        })
    }

    pub fn set_filter_mode(&mut self, mode: &str) -> Result<(), String> {
        self.require_walkplay()?;
        let mode = match mode {
            "FAST-LL" => 1,
            "FAST-PC" => 2,
            "Slow-LL" => 3,
            "Slow-PC" => 4,
            "NON-OS" => 5,
            _ => return Err("Invalid filter mode".into()),
        };
        self.write_utility(WalkplayProtocol::build_filter_mode_write_packet(mode))
    }

    pub fn set_amp_mode(&mut self, class_ab: bool) -> Result<(), String> {
        self.require_walkplay()?;
        self.write_utility(WalkplayProtocol::build_amp_mode_write_packet(class_ab))
    }

    pub fn set_gain_mode(&mut self, high: bool) -> Result<(), String> {
        self.require_walkplay()?;
        self.write_utility(WalkplayProtocol::build_gain_mode_write_packet(high))
    }

    pub fn set_mic_volume(&mut self, db: i8) -> Result<(), String> {
        self.require_walkplay()?;
        validate_control_range("Mic volume", db)?;
        self.write_utility(WalkplayProtocol::build_mic_volume_write_packet(db))
    }

    pub fn set_balance(&mut self, balance: i8) -> Result<(), String> {
        self.require_walkplay()?;
        validate_control_range("Balance", balance)?;
        for payload in WalkplayProtocol::build_balance_write_packets(balance) {
            self.send(&Packet::new(WalkplayProtocol::report_id(), payload))?;
            self.io.sleep_ms(20);
        }
        self.flash()
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

    pub fn reset_controls(&mut self) -> Result<DacUtilityState, String> {
        self.require_walkplay()?;
        self.set_filter_mode("FAST-LL")?;
        self.set_amp_mode(false)?;
        self.set_gain_mode(false)?;
        self.set_mic_volume(0)?;
        self.set_balance(0)?;
        self.utility_status()
    }

    pub fn factory_reset(&mut self) -> Result<(), String> {
        self.require_walkplay()?;
        self.write_utility(WalkplayProtocol::build_factory_reset_packet())
    }

    fn normalize(&self, peq: PEQData) -> Result<(PEQData, Vec<String>), String> {
        normalize_peq_for_profile(peq, self.profile)
    }

    fn require_walkplay(&self) -> Result<(), String> {
        if self.profile.protocol == DeviceProtocol::Walkplay {
            Ok(())
        } else {
            Err(format!(
                "{} does not support Walkplay utility controls",
                self.profile.name
            ))
        }
    }

    fn pull_once(&mut self) -> Result<PEQData, String> {
        self.last_pull_had_invalid_response = false;
        self.progress("Initializing read connection...", 5.0);
        self.init()?;
        let timing = self.protocol().write_timing();
        self.progress("Reading device preamp...", 10.0);
        let global_gain = self.read_gain()?;
        self.io.sleep_ms(timing.post_gain_read_ms);
        let count = self.profile.caps.num_bands;
        let mut filters = Vec::with_capacity(count);
        for index in 0..count {
            self.progress(
                &format!("Reading band {}/{}...", index + 1, count),
                10.0 + index as f32 / count as f32 * 75.0,
            );
            filters.push(self.read_filter(index as u8)?);
            self.io.sleep_ms(timing.flood_delay_ms);
        }
        self.progress("Read successful", 100.0);
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
                    last_error = Some(error);
                    remaining -= take;
                }
            }
        }
        Err(last_error.unwrap_or_else(|| "Filter read timeout".into()))
    }

    fn read_gain(&mut self) -> Result<f64, String> {
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

    fn read_matching(
        &mut self,
        label: &str,
        attempts: usize,
        matches: impl Fn(&[u8]) -> bool,
    ) -> Result<Vec<u8>, String> {
        let protocol = self.protocol();
        for attempt in 1..=attempts {
            let bytes = self
                .io
                .read(60)
                .map_err(|error| format!("{label} read failed on attempt {attempt}: {error}"))?;
            if bytes.is_empty() {
                continue;
            }
            let data = match protocol.unframe_packet(&bytes) {
                Ok(data) => data,
                Err(_) => continue,
            };
            if matches(data) {
                return Ok(data.to_vec());
            }
        }
        Err(format!("{label} read timeout"))
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

    fn drain(&mut self) {
        for _ in 0..INIT_DRAIN_ATTEMPTS {
            match self.io.read(20) {
                Ok(bytes) if bytes.is_empty() => break,
                Ok(_) => continue,
                Err(_) => break,
            }
        }
    }

    fn write_to_ram(&mut self, peq: &PEQData) -> Result<(), String> {
        self.progress("Initializing push connection...", 10.0);
        self.init()?;
        let protocol = self.protocol();
        let total = peq.filters.len();
        for (index, filter) in peq.filters.iter().enumerate() {
            self.progress(
                &format!("Writing band {}/{}...", index + 1, total),
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
        self.progress("Writing preamp...", 75.0);
        self.io.sleep_ms(protocol.write_timing().batch_ms);
        for packet in protocol.write_global_gain_packets(peq.global_gain) {
            self.send(&packet)
                .map_err(|error| format!("Global gain write failed: {error}"))?;
        }
        self.io.sleep_ms(protocol.write_timing().global_gain_ms);
        Ok(())
    }

    fn commit(&mut self) -> Result<(), String> {
        self.progress("Committing changes to device...", 80.0);
        for packet in self.protocol().commit_packets() {
            self.send(&packet)
                .map_err(|error| format!("Commit write failed: {error}"))?;
            self.io
                .sleep_ms(self.protocol().write_timing().commit_step_ms);
        }
        Ok(())
    }

    fn send(&mut self, packet: &Packet) -> Result<(), String> {
        let framed = packet.framed();
        let mut last = "Write failed".to_string();
        for _ in 0..WRITE_ATTEMPTS {
            match self.io.write(&framed) {
                Ok(()) => return Ok(()),
                Err(error) => {
                    last = error;
                    self.io.sleep_ms(50);
                }
            }
        }
        Err(last)
    }

    fn read_utility(&mut self, cmd: u8) -> Result<Vec<u8>, String> {
        let min_len = if cmd == CMD_MIC_VOLUME { 5 } else { 4 };
        let mut last_err = format!("Utility register {cmd} read timeout");
        for attempt in 1..=UTILITY_READ_RETRIES {
            self.send(&Packet::new(
                WalkplayProtocol::report_id(),
                WalkplayProtocol::build_utility_read_request(cmd),
            ))?;
            self.io.sleep_ms(30);
            match self.read_matching("Utility register", UTILITY_READ_ATTEMPTS, |data| {
                data.len() >= min_len && data[0] == READ && data[1] == cmd
            }) {
                Ok(data) => return Ok(data),
                Err(err) => {
                    last_err = err;
                    if attempt < UTILITY_READ_RETRIES {
                        self.drain();
                        self.io.sleep_ms(35);
                    }
                }
            }
        }
        Err(last_err)
    }

    fn read_balance(&mut self, channel: u8) -> Result<u8, String> {
        let mut last_err = format!("Balance register {channel} read timeout");
        for attempt in 1..=UTILITY_READ_RETRIES {
            self.send(&Packet::new(
                WalkplayProtocol::report_id(),
                WalkplayProtocol::build_balance_read_request(channel),
            ))?;
            self.io.sleep_ms(30);
            match self.read_matching("Balance register", UTILITY_READ_ATTEMPTS, |data| {
                data.len() >= 6 && data[0] == READ && data[1] == CMD_BALANCE && data[3] == channel
            }) {
                Ok(data) => return Ok(data[5]),
                Err(err) => {
                    last_err = err;
                    if attempt < UTILITY_READ_RETRIES {
                        self.drain();
                        self.io.sleep_ms(35);
                    }
                }
            }
        }
        Err(last_err)
    }

    fn write_utility(&mut self, payload: Vec<u8>) -> Result<(), String> {
        self.send(&Packet::new(WalkplayProtocol::report_id(), payload))?;
        self.io.sleep_ms(50);
        self.flash()
    }

    fn flash(&mut self) -> Result<(), String> {
        self.send(&Packet::new(
            WalkplayProtocol::report_id(),
            vec![WRITE, super::walkplay::CMD_FLASH_EQ, 0],
        ))
    }
}

fn decode_attenuation(raw: u8) -> i8 {
    if raw == 0 {
        0
    } else {
        let val = 256i16 - (raw as i16);
        val.clamp(-15, 15) as i8
    }
}

fn validate_control_range(label: &str, value: i8) -> Result<(), String> {
    if (-15..=15).contains(&value) {
        Ok(())
    } else {
        Err(format!("{label} must be between -15 and 15"))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::get_supported_device;
    use std::collections::VecDeque;

    #[derive(Debug, PartialEq)]
    enum IoEvent {
        Write(u8),
        Read,
        Sleep(u64),
    }

    #[derive(Default)]
    struct FakeIo {
        reads: VecDeque<Vec<u8>>,
        writes: Vec<Vec<u8>>,
        events: Vec<IoEvent>,
        read_error: Option<String>,
        read_errors: VecDeque<Option<String>>,
        read_error_until: Option<(usize, usize, String)>,
        read_calls: usize,
        write_calls: usize,
        failing_write_calls: VecDeque<usize>,
    }

    impl DeviceIo for FakeIo {
        fn write(&mut self, data: &[u8]) -> Result<(), String> {
            self.write_calls += 1;
            self.writes.push(data.to_vec());
            self.events
                .push(IoEvent::Write(data.get(2).copied().unwrap_or_default()));
            if self.failing_write_calls.front() == Some(&self.write_calls) {
                self.failing_write_calls.pop_front();
                Err("simulated write failure".into())
            } else {
                Ok(())
            }
        }
        fn read(&mut self, _: i32) -> Result<Vec<u8>, String> {
            self.events.push(IoEvent::Read);
            self.read_calls += 1;
            if let Some((first, last, error)) = &self.read_error_until {
                if self.read_calls >= *first && self.read_calls <= *last {
                    return Err(error.clone());
                }
            }
            if let Some(error) = &self.read_error {
                return Err(error.clone());
            }
            if let Some(bytes) = self.reads.pop_front() {
                return Ok(bytes);
            }
            if let Some(Some(error)) = self.read_errors.pop_front() {
                return Err(error);
            }
            Ok(Vec::new())
        }
        fn sleep_ms(&mut self, ms: u64) {
            self.events.push(IoEvent::Sleep(ms));
        }
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
    fn control_range_is_checked_before_write() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        let mut session = DeviceSession::new(&mut io, profile);
        assert!(session.set_balance(16).is_err());
        assert!(io.writes.is_empty());
    }

    #[test]
    fn non_walkplay_utility_is_rejected_before_write() {
        let profile = get_supported_device(0x2fc6, 1).unwrap();
        let mut io = FakeIo::default();
        let mut session = DeviceSession::new(&mut io, profile);
        assert!(session.set_gain_mode(true).is_err());
        assert!(io.writes.is_empty());
    }

    #[test]
    fn utility_status_propagates_read_failure() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo {
            read_error: Some("simulated read failure".into()),
            ..Default::default()
        };
        let error = DeviceSession::new(&mut io, profile)
            .utility_status()
            .unwrap_err();
        assert!(error.contains("simulated read failure"));
    }

    #[test]
    fn utility_status_succeeds_with_valid_responses() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // drain terminator
        io.reads.push_back(vec![READ, CMD_FILTER_MODE, 1, 1]); // FAST-LL
        io.reads.push_back(vec![READ, CMD_AMP_MODE, 1, 1]); // Class AB = true
        io.reads.push_back(vec![READ, CMD_GAIN_MODE, 1, 0]); // High gain = false
        io.reads.push_back(vec![READ, CMD_MIC_VOLUME, 2, 128, 5]); // Mic = 5 dB
        io.reads.push_back(vec![READ, CMD_BALANCE, 1, 0, 0, 0]); // Balance L = 0
        io.reads.push_back(vec![READ, CMD_BALANCE, 1, 1, 0, 0]); // Balance R = 0

        let status = DeviceSession::new(&mut io, profile)
            .utility_status()
            .unwrap();
        assert_eq!(
            status,
            DacUtilityState {
                supported: true,
                filter_mode: "FAST-LL".into(),
                amp_mode_class_ab: true,
                high_gain_mode: false,
                mic_volume_db: 5,
                channel_balance: 0,
            }
        );
    }

    #[test]
    fn utility_status_handles_stale_packets_and_recovers() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // drain terminator
                                    // Several stale non-matching packets before the actual filter response
        for _ in 0..12 {
            io.reads.push_back(vec![READ, 0x99, 0, 0]);
        }
        io.reads.push_back(vec![READ, CMD_FILTER_MODE, 1, 2]); // FAST-PC
        io.reads.push_back(vec![READ, CMD_AMP_MODE, 1, 0]); // Class AB = false
        io.reads.push_back(vec![READ, CMD_GAIN_MODE, 1, 1]); // High gain = true
        io.reads.push_back(vec![READ, CMD_MIC_VOLUME, 2, 128, 0]); // Mic = 0 dB
        io.reads.push_back(vec![READ, CMD_BALANCE, 1, 0, 0, 0]); // Balance L = 0
        io.reads.push_back(vec![READ, CMD_BALANCE, 1, 1, 0, 0]); // Balance R = 0

        let status = DeviceSession::new(&mut io, profile)
            .utility_status()
            .unwrap();
        assert_eq!(
            status,
            DacUtilityState {
                supported: true,
                filter_mode: "FAST-PC".into(),
                amp_mode_class_ab: false,
                high_gain_mode: true,
                mic_volume_db: 0,
                channel_balance: 0,
            }
        );
    }

    fn queue_pull(io: &mut FakeIo, gain: i8) {
        queue_pull_with_nonce_start(io, gain, 1);
    }

    fn queue_pull_with_nonce_start(io: &mut FakeIo, gain: i8, nonce_start: u8) {
        io.reads.push_back(vec![]); // init drain terminator
        io.reads.push_back(vec![
            READ,
            super::super::walkplay::CMD_GLOBAL_GAIN,
            0,
            0,
            gain as u8,
            0,
        ]);
        for index in 0..10u8 {
            let mut packet = vec![0; 34];
            packet[0] = READ;
            packet[1] = super::super::walkplay::CMD_PEQ_VALUES;
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
            super::super::walkplay::CMD_GLOBAL_GAIN,
            0,
            0,
            0,
            0,
        ]);
        for index in 0..10u8 {
            let mut packet = vec![0; 34];
            packet[0] = READ;
            packet[1] = super::super::walkplay::CMD_PEQ_VALUES;
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
    fn pull_rejects_a_default_returned_after_an_initial_read_error() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // first init drain
        io.read_error_until = Some((2, 4, "transient read".into()));
        queue_default_pull(&mut io);
        let error = DeviceSession::new(&mut io, profile).pull().unwrap_err();
        assert!(error.contains("unconfirmed default"), "{error}");
    }

    #[test]
    fn pull_clears_invalid_response_state_before_a_valid_retry() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]);
        io.reads.push_back(vec![
            READ,
            super::super::walkplay::CMD_GLOBAL_GAIN,
            0,
            0,
            0,
            0,
        ]);
        let mut invalid = vec![0u8; 34];
        invalid[0] = READ;
        invalid[1] = super::super::walkplay::CMD_PEQ_VALUES;
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
    fn pull_reads_gain_and_waits_before_first_band() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1);

        DeviceSession::new(&mut io, profile).pull().unwrap();

        let gain_request = io
            .events
            .iter()
            .position(|event| *event == IoEvent::Write(super::super::walkplay::CMD_GLOBAL_GAIN))
            .unwrap();
        let first_band_request = io
            .events
            .iter()
            .position(|event| *event == IoEvent::Write(super::super::walkplay::CMD_PEQ_VALUES))
            .unwrap();
        assert!(gain_request < first_band_request);
        assert!(
            io.events[gain_request + 1..first_band_request].contains(&IoEvent::Sleep(
                profile
                    .protocol
                    .implementation()
                    .write_timing()
                    .post_gain_read_ms
            ))
        );
    }

    #[test]
    fn dropped_band_response_is_resent_and_pull_succeeds() {
        use super::super::walkplay::CMD_PEQ_VALUES;
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // init drain terminator
        io.reads.push_back(vec![
            READ,
            super::super::walkplay::CMD_GLOBAL_GAIN,
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
        use super::super::walkplay::CMD_PEQ_VALUES;
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
        use super::super::walkplay::CMD_PEQ_VALUES;
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
                .filter(|packet| packet.get(2) == Some(&super::super::walkplay::CMD_TEMP_WRITE))
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
            super::super::walkplay::CMD_GLOBAL_GAIN,
            0,
            0,
            0xFF,
            0,
        ]);
        for index in 0..10u8 {
            let mut packet = vec![0; 34];
            packet[0] = READ;
            packet[1] = super::super::walkplay::CMD_PEQ_VALUES;
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
                .filter(|packet| packet.get(2) == Some(&super::super::walkplay::CMD_PEQ_VALUES))
                .count(),
            1
        );
        assert!(io
            .writes
            .iter()
            .filter(|packet| packet.get(2) == Some(&super::super::walkplay::CMD_PEQ_VALUES))
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
}
