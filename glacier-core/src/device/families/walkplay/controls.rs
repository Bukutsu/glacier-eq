// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Walkplay utility controls (`Controls::Walkplay`): firmware version, DAC
//! filter, amp and gain mode, balance, mic volume, factory reset.

use super::{
    WalkplayProtocol, CMD_AMP_MODE, CMD_BALANCE, CMD_FILTER_MODE, CMD_FLASH_EQ, CMD_GAIN_MODE,
    CMD_MIC_VOLUME, CMD_VERSION, END, READ, WRITE,
};
use crate::device::profile::Controls;
use crate::device::session::{DeviceIo, DeviceSession};
use crate::device::Packet;

const UTILITY_READ_ATTEMPTS: usize = 25;
const UTILITY_READ_RETRIES: usize = 3;

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

impl<I: DeviceIo> DeviceSession<'_, I> {
    pub async fn firmware_version(&mut self) -> Result<Option<String>, String> {
        if self.profile.controls != Some(Controls::Walkplay) {
            return Ok(None);
        }
        let mut last_err = "Firmware version read timeout".to_string();
        for attempt in 1..=UTILITY_READ_RETRIES {
            self.send(&Packet::new(
                WalkplayProtocol::report_id(),
                vec![READ, CMD_VERSION, END],
            ))
            .await?;
            self.io.sleep_ms(50).await;
            match self
                .read_matching("Firmware version", 20, |data| {
                    data.len() >= 10 && data[0] == READ && data[1] == CMD_VERSION
                })
                .await
            {
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
                        self.drain().await;
                        self.io.sleep_ms(35).await;
                    }
                }
            }
        }
        Err(last_err)
    }

    pub async fn utility_status(&mut self) -> Result<DacUtilityState, String> {
        if self.profile.controls != Some(Controls::Walkplay) {
            return Ok(DacUtilityState::default());
        }
        self.drain().await;
        self.io.sleep_ms(30).await;
        let filter = self.read_utility(CMD_FILTER_MODE).await?;
        self.io.sleep_ms(25).await;
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
        self.io.sleep_ms(25).await;
        let amp_mode_class_ab = self
            .read_utility(CMD_AMP_MODE)
            .await?
            .get(3)
            .copied()
            .ok_or_else(|| "Amp mode response was incomplete".to_string())?
            == 1;
        self.io.sleep_ms(25).await;
        let high_gain_mode = self
            .read_utility(CMD_GAIN_MODE)
            .await?
            .get(3)
            .copied()
            .ok_or_else(|| "Gain mode response was incomplete".to_string())?
            == 1;
        self.io.sleep_ms(25).await;
        let mic_volume_db =
            self.read_utility(CMD_MIC_VOLUME)
                .await?
                .get(4)
                .copied()
                .ok_or_else(|| "Mic volume response was incomplete".to_string())? as i8;
        self.io.sleep_ms(25).await;
        let left = decode_attenuation(self.read_balance(0).await?);
        self.io.sleep_ms(25).await;
        let right = decode_attenuation(self.read_balance(1).await?);
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

    pub async fn set_filter_mode(&mut self, mode: &str) -> Result<(), String> {
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
            .await
    }

    pub async fn set_amp_mode(&mut self, class_ab: bool) -> Result<(), String> {
        self.require_walkplay()?;
        self.write_utility(WalkplayProtocol::build_amp_mode_write_packet(class_ab))
            .await
    }

    pub async fn set_gain_mode(&mut self, high: bool) -> Result<(), String> {
        self.require_walkplay()?;
        self.write_utility(WalkplayProtocol::build_gain_mode_write_packet(high))
            .await
    }

    pub async fn set_mic_volume(&mut self, db: i8) -> Result<(), String> {
        self.require_walkplay()?;
        validate_control_range("Mic volume", db)?;
        self.write_utility(WalkplayProtocol::build_mic_volume_write_packet(db))
            .await
    }

    pub async fn set_balance(&mut self, balance: i8) -> Result<(), String> {
        self.require_walkplay()?;
        validate_control_range("Balance", balance)?;
        for payload in WalkplayProtocol::build_balance_write_packets(balance) {
            self.send(&Packet::new(WalkplayProtocol::report_id(), payload))
                .await?;
            self.io.sleep_ms(20).await;
        }
        self.flash().await
    }

    pub async fn reset_controls(&mut self) -> Result<DacUtilityState, String> {
        self.require_walkplay()?;
        // Each step below sends its register write and then immediately
        // commits to flash, so a failure part-way through leaves the device
        // permanently holding a half-applied reset — the modes that landed
        // are already durable and no later step can undo them. Capture what
        // is there now and put it back if any step fails, the way
        // persistent_push and apply_ram roll back a failed EQ write.
        let previous = self.utility_status().await?;
        let reset = (async {
            self.set_filter_mode("FAST-LL").await?;
            self.set_amp_mode(false).await?;
            self.set_gain_mode(false).await?;
            self.set_mic_volume(0).await?;
            self.set_balance(0).await
        })
        .await;
        if let Err(error) = reset {
            return Err(self.restore_utilities(&previous, &error).await);
        }
        self.utility_status().await
    }

    /// Re-applies a captured utility state after a reset failed part-way, and
    /// names the outcome in the error the caller reports.
    async fn restore_utilities(&mut self, previous: &DacUtilityState, cause: &str) -> String {
        let restore = (async {
            self.set_filter_mode(&previous.filter_mode).await?;
            self.set_amp_mode(previous.amp_mode_class_ab).await?;
            self.set_gain_mode(previous.high_gain_mode).await?;
            self.set_mic_volume(previous.mic_volume_db).await?;
            self.set_balance(previous.channel_balance).await
        })
        .await;
        match restore {
            Ok(()) => format!("{cause}; previous settings restored"),
            Err(restore) => format!("{cause}; restoring the previous settings failed: {restore}"),
        }
    }

    pub async fn factory_reset(&mut self) -> Result<(), String> {
        self.require_walkplay()?;
        self.write_utility(WalkplayProtocol::build_factory_reset_packet())
            .await
    }

    fn require_walkplay(&self) -> Result<(), String> {
        if self.profile.controls == Some(Controls::Walkplay) {
            Ok(())
        } else {
            Err(format!(
                "{} does not support Walkplay utility controls",
                self.profile.name
            ))
        }
    }

    async fn read_utility(&mut self, cmd: u8) -> Result<Vec<u8>, String> {
        let min_len = if cmd == CMD_MIC_VOLUME { 5 } else { 4 };
        let mut last_err = format!("Utility register {cmd} read timeout");
        for attempt in 1..=UTILITY_READ_RETRIES {
            self.send(&Packet::new(
                WalkplayProtocol::report_id(),
                WalkplayProtocol::build_utility_read_request(cmd),
            ))
            .await?;
            self.io.sleep_ms(30).await;
            match self
                .read_matching("Utility register", UTILITY_READ_ATTEMPTS, |data| {
                    data.len() >= min_len && data[0] == READ && data[1] == cmd
                })
                .await
            {
                Ok(data) => return Ok(data),
                Err(err) => {
                    last_err = err;
                    if attempt < UTILITY_READ_RETRIES {
                        self.drain().await;
                        self.io.sleep_ms(35).await;
                    }
                }
            }
        }
        Err(last_err)
    }

    async fn read_balance(&mut self, channel: u8) -> Result<u8, String> {
        let mut last_err = format!("Balance register {channel} read timeout");
        for attempt in 1..=UTILITY_READ_RETRIES {
            self.send(&Packet::new(
                WalkplayProtocol::report_id(),
                WalkplayProtocol::build_balance_read_request(channel),
            ))
            .await?;
            self.io.sleep_ms(30).await;
            match self
                .read_matching("Balance register", UTILITY_READ_ATTEMPTS, |data| {
                    data.len() >= 6
                        && data[0] == READ
                        && data[1] == CMD_BALANCE
                        && data[3] == channel
                })
                .await
            {
                Ok(data) => return Ok(data[5]),
                Err(err) => {
                    last_err = err;
                    if attempt < UTILITY_READ_RETRIES {
                        self.drain().await;
                        self.io.sleep_ms(35).await;
                    }
                }
            }
        }
        Err(last_err)
    }

    async fn write_utility(&mut self, payload: Vec<u8>) -> Result<(), String> {
        self.send(&Packet::new(WalkplayProtocol::report_id(), payload))
            .await?;
        self.io.sleep_ms(50).await;
        self.flash().await
    }

    async fn flash(&mut self) -> Result<(), String> {
        self.send(&Packet::new(
            WalkplayProtocol::report_id(),
            vec![WRITE, CMD_FLASH_EQ, 0],
        ))
        .await
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::get_supported_device;
    use crate::device::session::fake::FakeIo;

    #[test]
    fn a_failed_control_reset_restores_the_settings_that_already_landed() {
        crate::device::session::block_on(async {
            let profile = get_supported_device(0x3302, 0x43e8).unwrap();
            let mut io = FakeIo::default();
            // The device is on a non-default filter mode, Class-AB, high gain,
            // mic +4 dB, balanced. Every set_* below sends its register write and
            // then commits to flash, so a failure part-way through would leave
            // those durable changes on the hardware with no way back.
            queue_utility_status(&mut io, 2, 1, 1, 4, 0, 0);
            // The snapshot's six register reads are writes 1..6. The reset's first
            // two steps then take writes 7..10 (register write plus flash commit
            // each). Fail every attempt of the third step's register write —
            // send() retries three times — so the filter and amp modes are already
            // committed to flash when the gain step gives up, and let the rollback
            // through.
            io.failing_write_calls.extend([11, 12, 13]);
            queue_utility_status(&mut io, 1, 0, 0, 0, 0, 0);
            queue_utility_status(&mut io, 2, 1, 1, 4, 0, 0);

            let error = DeviceSession::new(&mut io, profile)
                .reset_controls()
                .await
                .expect_err("a half-applied reset must not report success");
            assert!(
                error.contains("previous settings restored"),
                "the error must name the rollback: {error}"
            );
            // The rollback re-sent the original filter mode, so a write carrying
            // CMD_FLASH_EQ for it is on the wire after the failure.
            assert!(
                io.writes
                    .iter()
                    .any(|write| write.get(2) == Some(&super::super::CMD_FLASH_EQ)),
                "rollback writes were not attempted"
            );
        });
    }

    #[test]
    fn a_successful_control_reset_does_not_roll_back() {
        crate::device::session::block_on(async {
            let profile = get_supported_device(0x3302, 0x43e8).unwrap();
            let mut io = FakeIo::default();
            queue_utility_status(&mut io, 2, 1, 1, 4, 0, 0);
            queue_utility_status(&mut io, 1, 0, 0, 0, 0, 0);

            let state = DeviceSession::new(&mut io, profile)
                .reset_controls()
                .await
                .expect("a clean reset must succeed");
            assert_eq!(state.filter_mode, "FAST-LL");
            assert!(!state.amp_mode_class_ab);
            assert!(!state.high_gain_mode);
            assert_eq!(state.mic_volume_db, 0);
        });
    }

    #[test]
    fn control_range_is_checked_before_write() {
        crate::device::session::block_on(async {
            let profile = get_supported_device(0x3302, 0x43e8).unwrap();
            let mut io = FakeIo::default();
            let mut session = DeviceSession::new(&mut io, profile);
            assert!(session.set_balance(16).await.is_err());
            assert!(io.writes.is_empty());
        });
    }

    #[test]
    fn non_walkplay_utility_is_rejected_before_write() {
        crate::device::session::block_on(async {
            let profile = get_supported_device(0x2fc6, 1).unwrap();
            let mut io = FakeIo::default();
            let mut session = DeviceSession::new(&mut io, profile);
            assert!(session.set_gain_mode(true).await.is_err());
            assert!(io.writes.is_empty());
        });
    }

    #[test]
    fn utility_status_propagates_read_failure() {
        crate::device::session::block_on(async {
            let profile = get_supported_device(0x3302, 0x43e8).unwrap();
            let mut io = FakeIo {
                read_error: Some("simulated read failure".into()),
                ..Default::default()
            };
            let error = DeviceSession::new(&mut io, profile)
                .utility_status()
                .await
                .unwrap_err();
            assert!(error.contains("simulated read failure"));
        });
    }

    #[test]
    fn utility_status_succeeds_with_valid_responses() {
        crate::device::session::block_on(async {
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
                .await
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
        });
    }

    #[test]
    fn utility_status_handles_stale_packets_and_recovers() {
        crate::device::session::block_on(async {
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
                .await
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
        });
    }

    /// Queues one complete `utility_status` read: the drain terminator, the
    /// four register reads, and both balance channels.
    fn queue_utility_status(
        io: &mut FakeIo,
        filter_mode: u8,
        amp_mode_class_ab: u8,
        high_gain_mode: u8,
        mic_volume: u8,
        left: u8,
        right: u8,
    ) {
        use crate::device::families::walkplay as wp;
        io.reads.push_back(vec![]); // drain terminator
        io.reads
            .push_back(vec![READ, wp::CMD_FILTER_MODE, 0, filter_mode]);
        io.reads
            .push_back(vec![READ, wp::CMD_AMP_MODE, 0, amp_mode_class_ab]);
        io.reads
            .push_back(vec![READ, wp::CMD_GAIN_MODE, 0, high_gain_mode]);
        io.reads
            .push_back(vec![READ, wp::CMD_MIC_VOLUME, 0, 0, mic_volume]);
        io.reads
            .push_back(vec![READ, wp::CMD_BALANCE, 0, 0, 0, left]);
        io.reads
            .push_back(vec![READ, wp::CMD_BALANCE, 0, 1, 0, right]);
    }
}
