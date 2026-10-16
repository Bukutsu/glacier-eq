// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! `DeviceProfile` — static identity and capability metadata for a USB DAC model.

use crate::device::capabilities::{DeviceCapabilities, EditorCapabilities};
use crate::device::protocol::Protocol;
use serde::{Deserialize, Serialize};

/// Device controls beyond EQ. Each set has its own commands and UI panel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Controls {
    /// Walkplay utility registers: firmware version, DAC filter, amp and gain
    /// mode, balance, mic volume, factory reset.
    Walkplay,
    /// Original Dawn Pro (2FC6:F06A): volume, gain, filter, LED.
    DawnPro,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeviceInfo {
    pub vendor_id: u16,
    pub product_id: u16,
    pub path: String,
    pub manufacturer: Option<String>,
    pub product_string: Option<String>,
    pub profile_name: Option<String>,
    pub hardware_eq: bool,
    pub controls: Option<Controls>,
    #[serde(flatten)]
    pub capabilities: EditorCapabilities,
}

/// Static identity and capability metadata for a supported USB DAC model.
pub struct DeviceProfile {
    pub name: &'static str,
    pub protocol: &'static Protocol,
    pub vendor_id: u16,
    pub product_id: Option<u16>,
    pub status: &'static str,
    pub family: &'static str,
    pub caps: DeviceCapabilities,
    pub controls: Option<Controls>,
}

/// A catalog entry as the UI receives it.
#[derive(Debug, Clone, Serialize)]
pub struct SupportedDeviceInfo {
    pub name: &'static str,
    pub protocol: &'static str,
    pub vendor_id: u16,
    pub product_id: Option<u16>,
    pub status: &'static str,
    pub family: &'static str,
    pub hardware_eq: bool,
    pub controls: Option<Controls>,
    #[serde(flatten)]
    pub capabilities: EditorCapabilities,
}

impl From<&DeviceProfile> for SupportedDeviceInfo {
    fn from(profile: &DeviceProfile) -> Self {
        Self {
            name: profile.name,
            protocol: profile.protocol.id,
            vendor_id: profile.vendor_id,
            product_id: profile.product_id,
            status: profile.status,
            family: profile.family,
            hardware_eq: profile.protocol.has_hardware_eq(),
            controls: profile.controls,
            capabilities: (&profile.caps).into(),
        }
    }
}
