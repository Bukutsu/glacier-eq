// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Static registry of supported USB DACs.

use crate::device::DeviceProfile;

pub const SUPPORTED_DEVICES: &[DeviceProfile] = crate::device::walkplay::PROFILES;

pub fn get_supported_device(vendor_id: u16, product_id: u16) -> Option<&'static DeviceProfile> {
    // Exact PID matches win over vendor fallbacks regardless of slice order,
    // so a future fallback entry cannot shadow an exact profile.
    SUPPORTED_DEVICES
        .iter()
        .find(|device| device.vendor_id == vendor_id && device.product_id == Some(product_id))
        .or_else(|| {
            SUPPORTED_DEVICES
                .iter()
                .find(|device| device.vendor_id == vendor_id && device.product_id.is_none())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_preserves_preexisting_device_matching() {
        for (vid, pid, name) in [
            (0x2FC6, 0xF06A, "Moondrop Dawn Pro"),
            (0x262A, 0x1234, "Fosi Audio DS2 / iBasso DC04 Pro"),
            (0x0661, 0x1234, "JCally JM20 / Savitech Generic"),
            (0x0666, 0x1234, "JCally JM20 Pro / Alt Savitech"),
            (0x31B2, 0x0111, "JCally JM12"),
            (0x2972, 0xFFFF, "FiiO KA Series"),
            (0x3302, 0xFFFF, "Audiocular Aura"),
        ] {
            assert_eq!(get_supported_device(vid, pid).unwrap().name, name);
        }
        assert_eq!(
            get_supported_device(0x2972, 0x0093).unwrap().name,
            "FiiO KA17"
        );
        assert_eq!(
            get_supported_device(0x3302, 0x43C1).unwrap().name,
            "JCally JM20 Pro"
        );
    }

    #[test]
    fn original_dawn_pro_keeps_its_preexisting_protocol_and_capabilities() {
        use crate::device::{DeviceProtocol, EqProtocol};
        let original = get_supported_device(0x2FC6, 0xF06A).unwrap();
        assert_eq!(original.protocol, DeviceProtocol::MoondropLegacy);
        assert_eq!(original.caps.num_bands, 10);
        assert_eq!(original.caps.dsp_sample_rate, 48000.0);
        let read = original.protocol.read_filter_request(9, 0).framed();
        assert_eq!(read.len(), 64);
        assert_eq!(&read[..6], &[0x4B, 0x80, 0x09, 0x18, 0, 9]);
        let filter = crate::eq::Filter::enabled(9, false);
        assert!(original
            .protocol
            .write_filter_packets(9, &filter, 48000.0, 0.0)
            .is_ok());
        let dawn2 = get_supported_device(0x35D8, 0x011D).unwrap();
        assert_eq!(dawn2.protocol, DeviceProtocol::Moondrop);
        assert_eq!(dawn2.caps.num_bands, 8);
        assert_eq!(dawn2.caps.dsp_sample_rate, 96000.0);
    }

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
