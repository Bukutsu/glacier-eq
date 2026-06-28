// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Static registry of supported USB DACs.

use crate::device::DeviceInfo;

pub type SupportedDevice = crate::device::profile::DeviceProfile;
pub const SUPPORTED_DEVICES: &[SupportedDevice] = crate::device::walkplay::PROFILES;

fn pid_matches(configured: Option<u16>, actual: u16) -> bool {
    configured.is_none_or(|pid| pid == actual)
}

pub fn get_device_profile(
    vendor_id: u16,
    product_id: u16,
) -> Option<&'static crate::device::profile::DeviceProfile> {
    crate::device::walkplay::PROFILES
        .iter()
        .find(|p| p.vendor_id == vendor_id && pid_matches(p.product_id, product_id))
}

pub fn get_supported_device(vendor_id: u16, product_id: u16) -> Option<&'static SupportedDevice> {
    SUPPORTED_DEVICES
        .iter()
        .find(|device| device.vendor_id == vendor_id && pid_matches(device.product_id, product_id))
}

pub fn is_supported_device(info: &DeviceInfo) -> bool {
    get_supported_device(info.vendor_id, info.product_id).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_pid_wins_before_vendor_fallback() {
        let device = get_supported_device(0x3302, 0x43E8).unwrap();
        assert_eq!(device.name, "TRN Black Pearl");

        let profile = get_device_profile(0x3302, 0x43E8).unwrap();
        assert_eq!(profile.name, "TRN Black Pearl");
    }

    #[test]
    fn savitech_vendor_fallbacks_match_any_pid() {
        assert_eq!(
            get_supported_device(0x262A, 0x1234).unwrap().name,
            "Fosi Audio DS2 / iBasso DC04 Pro"
        );
        assert_eq!(
            get_device_profile(0x0661, 0x9999).unwrap().name,
            "JCally JM20 / Savitech Generic"
        );
    }
}
