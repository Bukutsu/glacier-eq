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
    /// JA11 microphone, USB audio mode and output volume (source-reviewed only).
    Ja11,
    /// SNOWSKY Melody active EQ preset and firmware version (FiiO Control Web).
    Melody,
}

/// Official published specs for display only, never protocol capabilities.
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct DacSpec {
    pub name: &'static str,
    pub chip: &'static str,
    pub outputs: &'static str,
    #[serde(rename = "maxPower", skip_serializing_if = "Option::is_none")]
    pub max_power: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decoding: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snr: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thd: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DeviceInfo {
    pub vendor_id: u16,
    pub product_id: u16,
    pub path: String,
    pub manufacturer: Option<String>,
    pub product_string: Option<String>,
    pub profile_name: Option<String>,
    pub hardware_eq: bool,
    pub controls: Option<Controls>,
    pub spec: Option<DacSpec>,
    /// Exact protocol preset IDs for writable user EQ banks.
    pub user_eq_slots: Vec<u8>,
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
    pub spec: Option<DacSpec>,
}

/// A catalog entry as the UI receives it.
#[derive(Debug, Clone, Serialize)]
pub struct SupportedDeviceInfo {
    pub name: &'static str,
    /// Empty for numeric-only entries; otherwise an exact (case-insensitive)
    /// USB product descriptor is needed when the PID has not been recorded.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub usb_product_names: Vec<&'static str>,
    pub protocol: &'static str,
    pub vendor_id: u16,
    pub product_id: Option<u16>,
    pub status: &'static str,
    pub family: &'static str,
    pub hardware_eq: bool,
    pub controls: Option<Controls>,
    pub spec: Option<DacSpec>,
    /// Exact protocol preset IDs for writable user EQ banks.
    pub user_eq_slots: Vec<u8>,
    #[serde(flatten)]
    pub capabilities: EditorCapabilities,
}

impl From<&DeviceProfile> for EditorCapabilities {
    fn from(profile: &DeviceProfile) -> Self {
        let mut caps = Self::from(&profile.caps);
        caps.response_model = profile.protocol.eq.map_or_default(|eq| eq.response_model());
        caps
    }
}

impl From<&DeviceProfile> for SupportedDeviceInfo {
    fn from(profile: &DeviceProfile) -> Self {
        Self {
            name: profile.name,
            usb_product_names: crate::device::families::fiio::registry::product_names(profile.name)
                .to_vec(),
            protocol: profile.protocol.id,
            vendor_id: profile.vendor_id,
            product_id: profile.product_id,
            status: profile.status,
            family: profile.family,
            hardware_eq: profile.protocol.has_hardware_eq(),
            controls: profile.controls,
            spec: profile.spec,
            user_eq_slots: profile.protocol.user_eq_slots().to_vec(),
            capabilities: profile.into(),
        }
    }
}
