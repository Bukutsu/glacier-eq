// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Static registry of supported USB DACs.

use crate::device::DeviceProfile;

pub const SUPPORTED_DEVICES: &[DeviceProfile] = crate::device::walkplay::PROFILES;

pub fn get_supported_device(vendor_id: u16, product_id: u16) -> Option<&'static DeviceProfile> {
    SUPPORTED_DEVICES.iter().find(|device| {
        device.vendor_id == vendor_id && device.product_id.is_none_or(|pid| pid == product_id)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_pid_wins_before_vendor_fallback() {
        let device = get_supported_device(0x3302, 0x43E8).unwrap();
        assert_eq!(device.name, "TRN Black Pearl");
    }

    #[test]
    fn savitech_vendor_fallbacks_match_any_pid() {
        assert_eq!(
            get_supported_device(0x262A, 0x1234).unwrap().name,
            "Fosi Audio DS2 / iBasso DC04 Pro"
        );
    }
}
