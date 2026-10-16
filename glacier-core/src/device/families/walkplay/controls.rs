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
mod tests;
