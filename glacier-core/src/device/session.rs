// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Synchronous, transport-independent device operations.

use super::walkplay::{
    CMD_AMP_MODE, CMD_BALANCE, CMD_FILTER_MODE, CMD_GAIN_MODE, CMD_MIC_VOLUME, CMD_VERSION, END,
    READ, WRITE,
};
use super::{DeviceProfile, DeviceProtocol, EqProtocol, Packet, WalkplayProtocol};
use crate::eq::{Filter, PEQData};
use crate::profile_match::normalize_for_match;

const INIT_DRAIN_ATTEMPTS: usize = 100;
const FILTER_READ_ATTEMPTS: usize = 60;
const MAX_MISMATCHES: usize = 8;
const GAIN_READ_ATTEMPTS: usize = 20;
const WRITE_ATTEMPTS: usize = 3;
const RETRY_DELAY_MS: u64 = 100;

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

pub struct DeviceSession<'a> {
    io: &'a mut dyn DeviceIo,
    profile: &'static DeviceProfile,
    progress: Option<&'a mut dyn FnMut(&str, f32)>,
}

impl<'a> DeviceSession<'a> {
    pub fn new(io: &'a mut dyn DeviceIo, profile: &'static DeviceProfile) -> Self {
        Self {
            io,
            profile,
            progress: None,
        }
    }

    pub fn with_progress(
        io: &'a mut dyn DeviceIo,
        profile: &'static DeviceProfile,
        progress: &'a mut dyn FnMut(&str, f32),
    ) -> Self {
        Self {
            io,
            profile,
            progress: Some(progress),
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
        let _ = self.send(&protocol.read_global_gain_request());
        self.io.sleep_ms(50);
        let first = self.pull_once();
        let retry = first
            .as_ref()
            .map_or(true, |peq| protocol.is_default_state(peq));
        if !retry {
            return first;
        }
        self.io.sleep_ms(RETRY_DELAY_MS);
        match self.pull_once() {
            Ok(peq) => Ok(peq),
            Err(error) => first.map_err(|_| error),
        }
    }

    /// Normalizes before writing, snapshots, commits, verifies, and rolls back on mismatch.
    pub fn persistent_push(&mut self, peq: PEQData) -> Result<PEQData, String> {
        let normalized = self.normalize(peq)?;
        let backup = self.pull()?;
        self.write_to_ram(&normalized)?;
        self.commit()?;
        self.io.sleep_ms(RETRY_DELAY_MS);
        let verification = self.pull().and_then(|actual| {
            compare_peq(&actual, &normalized, &self.profile.caps).map(|_| actual)
        });
        match verification {
            Ok(_) => {
                self.progress("Push successful", 100.0);
                Ok(normalized)
            }
            Err(error) => {
                let rollback = self
                    .write_to_ram(&backup)
                    .and_then(|_| self.commit())
                    .and_then(|_| {
                        self.io.sleep_ms(RETRY_DELAY_MS);
                        let actual = self.pull()?;
                        compare_peq(&actual, &backup, &self.profile.caps)
                    });
                Err(match rollback {
                    Ok(()) => format!("Push verification failed: {error}; previous state restored"),
                    Err(rollback) => {
                        format!("Push verification failed: {error}; rollback failed: {rollback}")
                    }
                })
            }
        }
    }

    /// Writes persistently without a readback. Kept for the GUI's explicit
    /// skip-verification setting; CLI writes always use `persistent_push`.
    pub fn unverified_push(&mut self, peq: PEQData) -> Result<PEQData, String> {
        let normalized = self.normalize(peq)?;
        self.write_to_ram(&normalized)?;
        self.commit()?;
        self.progress("Push successful", 100.0);
        Ok(normalized)
    }

    pub fn apply_ram(&mut self, peq: PEQData) -> Result<PEQData, String> {
        validate_peq(&peq)?;
        if !self.profile.caps.supports_ram_apply {
            return Err(format!(
                "{} does not advertise volatile RAM apply support",
                self.profile.name
            ));
        }
        let normalized = self.normalize(peq)?;
        self.write_to_ram(&normalized)?;
        for packet in self.protocol().ram_apply_packets() {
            self.send(&packet)?;
            self.io
                .sleep_ms(self.protocol().write_timing().commit_step_ms);
        }
        self.progress("Apply successful", 100.0);
        Ok(normalized)
    }

    pub fn firmware_version(&mut self) -> Result<Option<String>, String> {
        if self.profile.protocol != DeviceProtocol::Walkplay {
            return Ok(None);
        }
        self.send(&Packet::new(
            WalkplayProtocol::report_id(),
            vec![READ, CMD_VERSION, END],
        ))?;
        self.io.sleep_ms(50);
        let data = self.read_matching("Firmware version", 20, |data| {
            data.len() >= 10 && data[0] == READ && data[1] == CMD_VERSION
        })?;
        let version: String = data
            .iter()
            .skip(3)
            .take(7)
            .take_while(|byte| byte.is_ascii_graphic())
            .map(|byte| *byte as char)
            .collect();
        Ok((!version.is_empty()).then_some(version))
    }

    pub fn utility_status(&mut self) -> Result<DacUtilityState, String> {
        if self.profile.protocol != DeviceProtocol::Walkplay {
            return Ok(DacUtilityState::default());
        }
        self.drain();
        let filter = self.read_utility(CMD_FILTER_MODE)?;
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
        let amp_mode_class_ab = self
            .read_utility(CMD_AMP_MODE)?
            .get(3)
            .copied()
            .ok_or_else(|| "Amp mode response was incomplete".to_string())?
            == 1;
        let high_gain_mode = self
            .read_utility(CMD_GAIN_MODE)?
            .get(3)
            .copied()
            .ok_or_else(|| "Gain mode response was incomplete".to_string())?
            == 1;
        let mic_volume_db =
            self.read_utility(CMD_MIC_VOLUME)?
                .get(4)
                .copied()
                .ok_or_else(|| "Mic volume response was incomplete".to_string())? as i8;
        let left = decode_attenuation(self.read_balance(0)?);
        let right = decode_attenuation(self.read_balance(1)?);
        Ok(DacUtilityState {
            supported: true,
            filter_mode,
            amp_mode_class_ab,
            high_gain_mode,
            mic_volume_db,
            channel_balance: if left > 0 { left } else { -right },
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

    fn normalize(&self, peq: PEQData) -> Result<PEQData, String> {
        validate_peq(&peq)?;
        let normalized = normalize_for_match(peq, &self.profile.caps, self.profile.protocol);
        validate_peq(&normalized)?;
        Ok(normalized)
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
        self.progress("Initializing read connection...", 5.0);
        self.init()?;
        let count = self.profile.caps.num_bands;
        let mut filters = Vec::with_capacity(count);
        for index in 0..count {
            self.progress(
                &format!("Reading band {}/{}...", index + 1, count),
                10.0 + index as f32 / count as f32 * 75.0,
            );
            filters.push(self.read_filter(index as u8)?);
            self.io.sleep_ms(35);
        }
        self.io.sleep_ms(50);
        self.progress("Reading device preamp...", 90.0);
        let global_gain = self.read_gain()?;
        self.progress("Read successful", 100.0);
        Ok(PEQData {
            filters,
            global_gain,
        })
    }

    fn read_filter(&mut self, index: u8) -> Result<Filter, String> {
        let protocol = self.protocol();
        let nonce = index.wrapping_add(1).max(1);
        self.send(&protocol.read_filter_request(index, nonce))?;
        let data = self.read_matching("Filter", FILTER_READ_ATTEMPTS, |data| {
            protocol.matches_filter_response(data, index, nonce)
        })?;
        protocol
            .parse_filter_response(&data)
            .ok_or_else(|| format!("Filter {} response could not be parsed", index + 1))
    }

    fn read_gain(&mut self) -> Result<f64, String> {
        let protocol = self.protocol();
        self.send(&protocol.read_global_gain_request())?;
        self.io.sleep_ms(25);
        let data = self.read_matching("Global gain", GAIN_READ_ATTEMPTS, |data| {
            protocol.matches_global_gain_response(data)
        })?;
        protocol
            .parse_global_gain_response(&data)
            .ok_or_else(|| "Global gain response could not be parsed".into())
    }

    fn read_matching(
        &mut self,
        label: &str,
        attempts: usize,
        matches: impl Fn(&[u8]) -> bool,
    ) -> Result<Vec<u8>, String> {
        let protocol = self.protocol();
        let mut mismatches = 0;
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
            mismatches += 1;
            if mismatches > MAX_MISMATCHES {
                break;
            }
        }
        Err(format!("{label} read timeout"))
    }

    fn init(&mut self) -> Result<(), String> {
        for packet in self.protocol().init_packets() {
            self.send(&packet)
                .map_err(|error| format!("Init write failed: {error}"))?;
        }
        self.io.sleep_ms(50);
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
        self.send(&Packet::new(
            WalkplayProtocol::report_id(),
            WalkplayProtocol::build_utility_read_request(cmd),
        ))?;
        self.read_matching("Utility register", 10, |data| {
            data.len() >= 5 && data[0] == READ && data[1] == cmd
        })
    }

    fn read_balance(&mut self, channel: u8) -> Result<u8, String> {
        self.send(&Packet::new(
            WalkplayProtocol::report_id(),
            WalkplayProtocol::build_balance_read_request(channel),
        ))?;
        self.read_matching("Balance register", 10, |data| {
            data.len() >= 6 && data[0] == READ && data[1] == CMD_BALANCE && data[3] == channel
        })
        .map(|data| data[5])
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
        (256 - raw as u16) as i8
    }
}

fn validate_control_range(label: &str, value: i8) -> Result<(), String> {
    if (-15..=15).contains(&value) {
        Ok(())
    } else {
        Err(format!("{label} must be between -15 and 15"))
    }
}

pub fn validate_peq(peq: &PEQData) -> Result<(), String> {
    if !peq.global_gain.is_finite() {
        return Err("Preamp must be finite".into());
    }
    for (index, filter) in peq.filters.iter().enumerate() {
        if !filter.gain.is_finite() || !filter.q.is_finite() || filter.q <= 0.0 {
            return Err(format!("Band {} has invalid gain or Q", index + 1));
        }
    }
    Ok(())
}

pub fn compare_peq(
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
        if (actual.gain - expected.gain).abs() > caps.gain_tolerance
            || (actual.freq as i32 - expected.freq as i32).abs() > caps.freq_tolerance
            || (actual.q - expected.q).abs() > caps.q_tolerance
            || actual.filter_type != expected.filter_type
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

    #[derive(Default)]
    struct FakeIo {
        reads: VecDeque<Vec<u8>>,
        writes: Vec<Vec<u8>>,
        read_error: Option<String>,
    }

    impl DeviceIo for FakeIo {
        fn write(&mut self, data: &[u8]) -> Result<(), String> {
            self.writes.push(data.to_vec());
            Ok(())
        }
        fn read(&mut self, _: i32) -> Result<Vec<u8>, String> {
            if let Some(error) = &self.read_error {
                return Err(error.clone());
            }
            Ok(self.reads.pop_front().unwrap_or_default())
        }
        fn sleep_ms(&mut self, _: u64) {}
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

    fn queue_pull(io: &mut FakeIo, gain: i8) {
        io.reads.push_back(vec![]); // init drain terminator
        for index in 0..10u8 {
            let mut packet = vec![0; 34];
            packet[0] = READ;
            packet[1] = super::super::walkplay::CMD_PEQ_VALUES;
            packet[2] = index + 1;
            packet[4] = index;
            packet[27..29].copy_from_slice(&(100 + index as u16).to_le_bytes());
            packet[29..31].copy_from_slice(&256u16.to_le_bytes());
            packet[31..33].copy_from_slice(&256i16.to_le_bytes());
            packet[33] = 2;
            io.reads.push_back(packet);
        }
        io.reads.push_back(vec![
            READ,
            super::super::walkplay::CMD_GLOBAL_GAIN,
            0,
            0,
            gain as u8,
            0,
        ]);
    }

    #[test]
    fn verification_mismatch_rolls_back_and_verifies_backup() {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1); // snapshot
        io.reads.push_back(vec![]); // push init drain
        queue_pull(&mut io, -2); // mismatching readback
        io.reads.push_back(vec![]); // rollback init drain
        queue_pull(&mut io, -1); // rollback readback
        let peq = PEQData {
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
        };
        let error = DeviceSession::new(&mut io, profile)
            .persistent_push(peq)
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
}
