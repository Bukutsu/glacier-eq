// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

//! Static registry of supported USB DACs.

use crate::device::DeviceInfo;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SupportedDevice {
    pub name: &'static str,
    pub vendor_id: u16,
    pub product_id: u16,
    pub status: &'static str,
    pub family: &'static str,
}

pub const SUPPORTED_DEVICES: &[SupportedDevice] = &[
    SupportedDevice {
        name: "EPZ TP35 Pro",
        vendor_id: 0x3302,
        product_id: 0x43E6,
        status: "Tested",
        family: "Walkplay Family",
    },
    SupportedDevice {
        name: "TRN Black Pearl",
        vendor_id: 0x3302,
        product_id: 0x43E8,
        status: "Untested",
        family: "Walkplay Family",
    },
    SupportedDevice {
        name: "Moondrop Dawn Pro",
        vendor_id: 0x2FC6,
        product_id: 0xDF30,
        status: "Untested",
        family: "Walkplay Family",
    },
    SupportedDevice {
        name: "Truthear KEYX",
        vendor_id: 0x0D8C,
        product_id: 0x0210,
        status: "Untested",
        family: "Walkplay Family",
    },
];

pub fn get_device_profile(
    vendor_id: u16,
    product_id: u16,
) -> Option<&'static crate::device::profile::DeviceProfile> {
    crate::device::walkplay::PROFILES
        .iter()
        .find(|p| p.vendor_id == vendor_id && p.product_id == product_id)
}

pub fn get_supported_device(vendor_id: u16, product_id: u16) -> Option<&'static SupportedDevice> {
    SUPPORTED_DEVICES
        .iter()
        .find(|device| device.vendor_id == vendor_id && device.product_id == product_id)
}

pub fn is_supported_device(info: &DeviceInfo) -> bool {
    get_supported_device(info.vendor_id, info.product_id).is_some()
}
