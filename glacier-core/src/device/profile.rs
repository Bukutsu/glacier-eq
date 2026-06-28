// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! `DeviceProfile` — static identity and capability metadata for a USB DAC model.

use crate::device::capabilities::DeviceCapabilities;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceProtocol {
    // Keep protocol identity in profiles so the next hardware family gets an
    // explicit command path instead of being routed through Walkplay by accident.
    Walkplay,
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
}
