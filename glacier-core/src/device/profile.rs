// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! `DeviceProfile` — static identity and capability metadata for a USB DAC model.

use crate::device::capabilities::{DeviceCapabilities, EditorCapabilities};
use crate::device::protocol::Protocol;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeviceInfo {
    pub vendor_id: u16,
    pub product_id: u16,
    pub path: String,
    pub manufacturer: Option<String>,
    pub product_string: Option<String>,
    pub profile_name: Option<String>,
    pub hardware_eq: bool,
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
}
