// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! `DeviceProfile` — static identity and capability metadata for a USB DAC model.

use crate::device::capabilities::{DeviceCapabilities, EditorCapabilities};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceProtocol {
    // Keep protocol identity in profiles so the next hardware family gets an
    // explicit command path instead of being routed through Walkplay by accident.
    Walkplay,
    Moondrop,
    FiioJa11,
    Fiio,
    FiioKa17,
    /// Matching fallback for unrecognized devices; never drives hardware.
    Unknown,
}

impl DeviceProtocol {
    pub fn name(self) -> &'static str {
        match self {
            Self::Walkplay => "Walkplay",
            Self::Moondrop => "Moondrop",
            Self::FiioJa11 => "FiiO JA11",
            Self::Fiio => "FiiO",
            Self::FiioKa17 => "FiiO KA17",
            Self::Unknown => "Unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeviceInfo {
    pub vendor_id: u16,
    pub product_id: u16,
    pub path: String,
    pub manufacturer: Option<String>,
    pub product_string: Option<String>,
    pub profile_name: Option<String>,
    pub write_block_reason: Option<String>,
    pub mic_gain_block_reason: Option<String>,
    #[serde(flatten)]
    pub capabilities: EditorCapabilities,
}

/// Static identity and capability metadata for a supported USB DAC model.
pub struct DeviceProfile {
    pub name: &'static str,
    pub protocol: DeviceProtocol,
    pub vendor_id: u16,
    pub product_id: Option<u16>,
    pub status: &'static str,
    pub family: &'static str,
    pub caps: DeviceCapabilities,
    /// None only when the model's write contract is established. This gate
    /// applies to persistent, volatile, and utility writes, including callers
    /// that explicitly skip verification.
    pub write_block_reason: Option<&'static str>,
    /// Mic gain has a separate wire encoding that is not established by PEQ.
    pub mic_gain_block_reason: Option<&'static str>,
    /// Nonzero nonce echoes are verified only on the tested EPZ/TRN models.
    pub read_nonce_supported: bool,
}

impl DeviceProfile {
    pub fn ensure_writable(&self) -> Result<(), String> {
        match self.write_block_reason {
            Some(reason) => Err(format!("{} is read-only: {reason}", self.name)),
            None => Ok(()),
        }
    }

    pub fn ensure_mic_gain_writable(&self) -> Result<(), String> {
        self.ensure_writable()?;
        match self.mic_gain_block_reason {
            Some(reason) => Err(format!("Microphone gain writes are disabled: {reason}")),
            None => Ok(()),
        }
    }
}
