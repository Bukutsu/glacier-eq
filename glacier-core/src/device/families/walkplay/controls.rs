// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Walkplay utility controls (`Controls::Walkplay`): firmware version, DAC
//! filter, amp and gain mode, balance, mic volume, factory reset.

use super::{
    WalkplayProtocol, CMD_AMP_MODE, CMD_BALANCE, CMD_FILTER_MODE, CMD_FLASH_EQ, CMD_GAIN_MODE,
    CMD_MIC_VOLUME, CMD_VERSION, END, HID_INTERVAL_MS, READ, WRITE,
};
use crate::device::profile::Controls;
use crate::device::session::{DeviceIo, DeviceSession};
use crate::device::Packet;

const UTILITY_READ_ATTEMPTS: usize = 25;
const UTILITY_READ_RETRIES: usize = 3;
/// After a flash commit the DAC ignores writes for about 100 ms and reads for
/// about 200 ms (measured on an EPZ TP35 Pro: a write 50 ms after the commit
/// was dropped, one 100 ms after it landed). Nothing may be sent sooner.
const FLASH_SETTLE_MS: u64 = 250;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct DacUtilityState {
    pub supported: bool,
    pub filter_mode: String,
    pub amp_mode_class_ab: bool,
    pub high_gain_mode: bool,
    pub mic_volume_db: i8,
    pub channel_balance: i8,
}

impl DacUtilityState {
    /// What the DAC returns to when its own restore command (`01 17 00`, sent
    /// by the official app's RESET) runs: FAST-LL, Class-AB, centred balance.
    /// That command leaves gain mode and mic volume alone, so they are the
    /// documented low gain and 0 dB.
    fn factory() -> Self {
        Self {
            supported: true,
            filter_mode: "FAST-LL".into(),
            amp_mode_class_ab: true,
            high_gain_mode: false,
            mic_volume_db: 0,
            channel_balance: 0,
        }
    }
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
        let filter = self.read_utility(CMD_FILTER_MODE).await?;
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
            .read_utility(CMD_AMP_MODE)
            .await?
            .get(3)
            .copied()
            .ok_or_else(|| "Amp mode response was incomplete".to_string())?
            == 1;
        let high_gain_mode = self
            .read_utility(CMD_GAIN_MODE)
            .await?
            .get(3)
            .copied()
            .ok_or_else(|| "Gain mode response was incomplete".to_string())?
            == 1;
        let mic_volume_db =
            self.read_utility(CMD_MIC_VOLUME)
                .await?
                .get(4)
                .copied()
                .ok_or_else(|| "Mic volume response was incomplete".to_string())? as i8;
        let left = decode_attenuation(self.read_balance(0).await?);
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
        self.stage_filter_mode(mode).await?;
        self.commit_controls().await
    }

    pub async fn set_amp_mode(&mut self, class_ab: bool) -> Result<(), String> {
        self.require_walkplay()?;
        self.stage(WalkplayProtocol::build_amp_mode_write_packet(class_ab))
            .await?;
        self.commit_controls().await
    }

    pub async fn set_gain_mode(&mut self, high: bool) -> Result<(), String> {
        self.require_walkplay()?;
        self.stage(WalkplayProtocol::build_gain_mode_write_packet(high))
            .await?;
        self.commit_controls().await
    }

    pub async fn set_mic_volume(&mut self, db: i8) -> Result<(), String> {
        self.require_walkplay()?;
        validate_control_range("Mic volume", db)?;
        self.stage(WalkplayProtocol::build_mic_volume_write_packet(db))
            .await?;
        self.commit_controls().await
    }

    pub async fn set_balance(&mut self, balance: i8) -> Result<(), String> {
        self.require_walkplay()?;
        self.stage_balance(balance).await?;
        self.commit_controls().await
    }

    pub async fn reset_controls(&mut self) -> Result<DacUtilityState, String> {
        self.require_walkplay()?;
        // Every register is written first and one flash commit follows. A
        // commit between registers makes the DAC drop the next write, which
        // is how a reset used to leave most settings unchanged. A failure
        // part-way still leaves earlier registers changed, so capture what is
        // there now and put it back, the way persistent_push and apply_ram
        // roll back a failed EQ write.
        let previous = self.utility_status().await?;
        let reset = self.apply_utilities(&DacUtilityState::factory()).await;
        if let Err(error) = reset {
            return Err(self.restore_utilities(&previous, &error).await);
        }
        self.utility_status().await
    }

    /// Re-applies a captured utility state after a reset failed part-way, and
    /// names the outcome in the error the caller reports.
    async fn restore_utilities(&mut self, previous: &DacUtilityState, cause: &str) -> String {
        match self.apply_utilities(previous).await {
            Ok(()) => format!("{cause}; previous settings restored"),
            Err(restore) => format!("{cause}; restoring the previous settings failed: {restore}"),
        }
    }

    /// Writes all five settings 16 ms apart, then commits once.
    async fn apply_utilities(&mut self, state: &DacUtilityState) -> Result<(), String> {
        self.stage_filter_mode(&state.filter_mode).await?;
        self.stage(WalkplayProtocol::build_amp_mode_write_packet(
            state.amp_mode_class_ab,
        ))
        .await?;
        self.stage(WalkplayProtocol::build_gain_mode_write_packet(
            state.high_gain_mode,
        ))
        .await?;
        self.stage(WalkplayProtocol::build_mic_volume_write_packet(
            state.mic_volume_db,
        ))
        .await?;
        self.stage_balance(state.channel_balance).await?;
        self.commit_controls().await
    }

    /// The official app's RESET: a flat EQ, then `01 17 00`, which restores
    /// the filter, amp mode and balance to the DAC's defaults. That command
    /// leaves gain mode and mic volume alone, so those are written too.
    pub async fn factory_reset(&mut self) -> Result<(), String> {
        self.require_walkplay()?;
        self.reset_eq().await?;
        self.stage(WalkplayProtocol::build_restore_defaults_packet())
            .await?;
        self.io.sleep_ms(FLASH_SETTLE_MS).await;
        self.apply_utilities(&DacUtilityState::factory()).await
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

    /// Sends one register write and waits one HID interval, like the official
    /// app. It does not commit: the caller commits after the last write.
    async fn stage(&mut self, payload: Vec<u8>) -> Result<(), String> {
        self.send(&Packet::new(WalkplayProtocol::report_id(), payload))
            .await?;
        self.io.sleep_ms(HID_INTERVAL_MS).await;
        Ok(())
    }

    async fn stage_filter_mode(&mut self, mode: &str) -> Result<(), String> {
        let mode = match mode {
            "FAST-LL" => 1,
            "FAST-PC" => 2,
            "Slow-LL" => 3,
            "Slow-PC" => 4,
            "NON-OS" => 5,
            _ => return Err("Invalid filter mode".into()),
        };
        self.stage(WalkplayProtocol::build_filter_mode_write_packet(mode))
            .await
    }

    async fn stage_balance(&mut self, balance: i8) -> Result<(), String> {
        validate_control_range("Balance", balance)?;
        for payload in WalkplayProtocol::build_balance_write_packets(balance) {
            self.stage(payload).await?;
        }
        Ok(())
    }

    /// Persists the staged writes. The DAC then ignores everything for
    /// `FLASH_SETTLE_MS`, so the next request must wait.
    async fn commit_controls(&mut self) -> Result<(), String> {
        self.send(&Packet::new(
            WalkplayProtocol::report_id(),
            vec![WRITE, CMD_FLASH_EQ, 0],
        ))
        .await?;
        self.io.sleep_ms(FLASH_SETTLE_MS).await;
        Ok(())
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
