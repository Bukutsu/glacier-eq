// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

//! `DeviceProfile` — static identity and capability metadata for a USB DAC model.

use crate::device::capabilities::DeviceCapabilities;

/// Static identity and capability metadata for a supported USB DAC model.
pub struct DeviceProfile {
    pub name: &'static str,
    pub vendor_id: u16,
    pub product_id: u16,
    pub caps: DeviceCapabilities,
}
