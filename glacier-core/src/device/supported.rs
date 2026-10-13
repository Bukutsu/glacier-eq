// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Static registry of supported USB DACs.

use crate::device::DeviceProfile;

pub const SUPPORTED_DEVICES: &[DeviceProfile] = crate::device::walkplay::PROFILES;

pub fn get_supported_device(vendor_id: u16, product_id: u16) -> Option<&'static DeviceProfile> {
    // Neither a vendor ID nor a bridge chipset establishes the EQ protocol.
    // Unknown product IDs must never inherit another model's flash commands.
    SUPPORTED_DEVICES
        .iter()
        .find(|device| device.vendor_id == vendor_id && device.product_id == Some(product_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_only_exact_registered_models() {
        assert_eq!(
            get_supported_device(0x3302, 0x43E8).unwrap().name,
            "TRN Black Pearl"
        );
        assert_eq!(
            get_supported_device(0x3302, 0x43C1).unwrap().name,
            "JCally JM20 Pro"
        );
        assert_eq!(
            get_supported_device(0x3302, 0x43C9).unwrap().name,
            "Audiocular Aura"
        );
        assert_eq!(
            get_supported_device(0x2972, 0x0093)
                .unwrap()
                .protocol
                .name(),
            "FiiO KA17"
        );
        for (vid, pid) in [
            (0x2FC6, 0xF06A), // original Dawn Pro, not Dawn Pro 2 PEQ
            (0x262A, 0x1234), // shared Savitech VID is not PEQ evidence
            (0x0661, 0x1234), // standard JM20 is not JM20 Pro
            (0x0666, 0x1234),
            (0x2972, 0xFFFF), // not every FiiO uses the same reports
            (0x3302, 0xFFFF),
            (0x31B2, 0x0111), // JM12's protocol is disputed
        ] {
            assert!(
                get_supported_device(vid, pid).is_none(),
                "{vid:04X}:{pid:04X}"
            );
        }
        assert!(SUPPORTED_DEVICES
            .iter()
            .all(|profile| profile.product_id.is_some()));
    }

    #[test]
    fn source_backed_capabilities_do_not_inherit_vendor_defaults() {
        let dawn = get_supported_device(0x35D8, 0x011D).unwrap();
        assert_eq!(dawn.caps.num_bands, 8);
        assert_eq!(dawn.caps.dsp_sample_rate, 96000.0);
        assert_eq!(dawn.caps.global_gain_range, (-128, 0));
        let jcally = get_supported_device(0x3302, 0x43C1).unwrap();
        assert_eq!(jcally.caps.num_bands, 8);
        assert!(!jcally
            .caps
            .supported_filter_types
            .contains(&crate::eq::FilterType::HighShelf));
    }

    #[test]
    fn reference_backed_models_allow_writes_and_controls() {
        for profile in SUPPORTED_DEVICES {
            assert!(profile.ensure_writable().is_ok(), "{}", profile.name);
            assert!(
                profile.ensure_mic_gain_writable().is_ok(),
                "{}",
                profile.name
            );
            assert!(profile.write_block_reason.is_none());
            assert!(profile.mic_gain_block_reason.is_none());
        }
    }
}
