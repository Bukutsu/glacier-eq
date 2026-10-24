// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Typed device operations at the browser boundary. The session owns all I/O
//! ordering, validation, verification and rollback; adapters only move bytes.

use super::{DeviceIo, DeviceSession};
use crate::device::DacUtilityState;
use crate::eq::PEQData;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "command", deny_unknown_fields)]
pub enum DeviceCommand {
    #[serde(rename = "get_eq_state")]
    Pull,
    #[serde(rename = "set_eq_state")]
    Push {
        peq: PEQData,
        skip_verification: bool,
        melody_slot: Option<u8>,
        fiio_slot: Option<u8>,
    },
    #[serde(rename = "apply_eq_state")]
    Apply { peq: PEQData },
    #[serde(rename = "live_apply_eq_state")]
    LiveApply {
        peq: PEQData,
        melody_slot: Option<u8>,
    },
    #[serde(rename = "ja11_control")]
    Ja11Control { control: String, value: Option<u8> },
    #[serde(rename = "melody_control")]
    MelodyControl { value: Option<u8> },
    #[serde(rename = "melody_name")]
    MelodyName { slot: u8, name: Option<String> },
    #[serde(rename = "set_user_eq_bank")]
    UserEqBank { slot: u8 },
    #[serde(rename = "get_firmware_version")]
    Firmware,
    #[serde(rename = "get_dac_utility_state")]
    UtilityStatus,
    #[serde(rename = "set_dac_filter_mode")]
    FilterMode { mode: String },
    #[serde(rename = "set_dac_work_mode")]
    AmpMode {
        #[serde(rename = "isClassAb")]
        class_ab: bool,
    },
    #[serde(rename = "set_dac_output_gain")]
    GainMode {
        #[serde(rename = "isHighGain")]
        high: bool,
    },
    #[serde(rename = "set_dac_balance")]
    Balance { balance: i8 },
    #[serde(rename = "set_mic_volume")]
    MicVolume {
        #[serde(rename = "volumeDb")]
        db: i8,
    },
    #[serde(rename = "reset_device_eq")]
    ResetEq {
        melody_slot: Option<u8>,
        fiio_slot: Option<u8>,
    },
    #[serde(rename = "reset_device_controls")]
    ResetControls,
    #[serde(rename = "execute_factory_reset")]
    FactoryReset,
}

/// Verified writes return the readback; skipped verification returns the request
/// and an explicit warning. A restart-causing Save is verified in RAM beforehand,
/// not across reboot. Both native and WASM publish this same response shape.
#[derive(Serialize)]
pub struct EqWriteOutcome {
    #[serde(flatten)]
    pub committed: PEQData,
    pub warnings: Vec<String>,
    pub restarts: bool,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum DeviceOutcome {
    Peq(PEQData),
    Write(EqWriteOutcome),
    Firmware(Option<String>),
    Control(Option<u8>),
    Name(String),
    /// Whether the DAC restarts after the command (see `reset_eq`).
    Restarts(bool),
    Utility(DacUtilityState),
    Unit,
}

impl<I: DeviceIo> DeviceSession<'_, I> {
    pub async fn execute(&mut self, command: DeviceCommand) -> Result<DeviceOutcome, String> {
        use DeviceCommand::*;
        let outcome = match command {
            Pull => DeviceOutcome::Peq(self.pull().await?),
            Push {
                peq,
                skip_verification,
                melody_slot,
                fiio_slot,
            } => {
                if let Some(slot) = fiio_slot {
                    self.set_fiio_write_slot(slot)?;
                } else if let Some(slot) = melody_slot {
                    self.set_melody_write_slot(slot)?;
                }
                let (committed, warnings) = if skip_verification {
                    self.unverified_push(peq).await?
                } else {
                    self.persistent_push(peq).await?
                };
                DeviceOutcome::Write(EqWriteOutcome {
                    committed,
                    warnings,
                    restarts: self.save_restarts_device(),
                })
            }
            Apply { peq } => {
                let (committed, warnings) = self.apply_ram(peq).await?;
                DeviceOutcome::Write(EqWriteOutcome {
                    committed,
                    warnings,
                    restarts: false,
                })
            }
            LiveApply { peq, melody_slot } => {
                self.set_live_melody_slot(melody_slot)?;
                let (committed, warnings) = self.live_apply(peq).await?;
                DeviceOutcome::Write(EqWriteOutcome {
                    committed,
                    warnings,
                    restarts: false,
                })
            }
            Ja11Control { control, value } => DeviceOutcome::Control(match value {
                Some(value) => self.set_ja11_control(&control, value).await?,
                None => Some(self.ja11_control(&control).await?),
            }),
            // Unsolicited preset replies can be stale even when the id is valid.
            MelodyControl { value } => {
                self.require_melody()?;
                DeviceOutcome::Control(match value {
                    Some(value) => Some(self.set_melody_preset(value).await?),
                    None => None,
                })
            }
            MelodyName { slot, name } => DeviceOutcome::Name(match name {
                Some(name) => self.set_melody_name(slot, &name).await?,
                None => self.melody_name(slot).await?,
            }),
            UserEqBank { slot } => DeviceOutcome::Control(Some(self.set_user_eq_bank(slot).await?)),
            Firmware => DeviceOutcome::Firmware(self.firmware_version().await?),
            UtilityStatus => DeviceOutcome::Utility(self.utility_status().await?),
            ResetControls => DeviceOutcome::Utility(self.reset_controls().await?),
            FilterMode { mode } => {
                self.set_filter_mode(&mode).await?;
                DeviceOutcome::Unit
            }
            AmpMode { class_ab } => {
                self.set_amp_mode(class_ab).await?;
                DeviceOutcome::Unit
            }
            GainMode { high } => {
                self.set_gain_mode(high).await?;
                DeviceOutcome::Unit
            }
            Balance { balance } => {
                self.set_balance(balance).await?;
                DeviceOutcome::Unit
            }
            MicVolume { db } => {
                self.set_mic_volume(db).await?;
                DeviceOutcome::Unit
            }
            ResetEq {
                melody_slot,
                fiio_slot,
            } => {
                if let Some(slot) = fiio_slot {
                    self.set_fiio_write_slot(slot)?;
                } else if let Some(slot) = melody_slot {
                    self.set_melody_write_slot(slot)?;
                }
                DeviceOutcome::Restarts(self.reset_eq().await?)
            }
            FactoryReset => {
                self.factory_reset().await?;
                DeviceOutcome::Unit
            }
        };
        Ok(outcome)
    }
}
