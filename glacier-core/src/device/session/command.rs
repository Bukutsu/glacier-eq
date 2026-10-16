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
    },
    #[serde(rename = "apply_eq_state")]
    Apply { peq: PEQData },
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
    ResetEq,
    #[serde(rename = "reset_device_controls")]
    ResetControls,
    #[serde(rename = "execute_factory_reset")]
    FactoryReset,
}

#[derive(Serialize)]
pub struct EqWriteOutcome {
    #[serde(flatten)]
    pub committed: PEQData,
    pub warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum DeviceOutcome {
    Peq(PEQData),
    Write(EqWriteOutcome),
    Firmware(Option<String>),
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
            } => {
                let (committed, warnings) = if skip_verification {
                    self.unverified_push(peq).await?
                } else {
                    self.persistent_push(peq).await?
                };
                DeviceOutcome::Write(EqWriteOutcome {
                    committed,
                    warnings,
                })
            }
            Apply { peq } => {
                let (committed, warnings) = self.apply_ram(peq).await?;
                DeviceOutcome::Write(EqWriteOutcome {
                    committed,
                    warnings,
                })
            }
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
            ResetEq => {
                self.reset_eq().await?;
                DeviceOutcome::Unit
            }
            FactoryReset => {
                self.factory_reset().await?;
                DeviceOutcome::Unit
            }
        };
        Ok(outcome)
    }
}
