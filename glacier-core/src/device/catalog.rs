// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Static catalog of supported USB DACs.

use crate::device::capabilities::{DeviceCapabilities, DESKTOP_DAC_CAPS};
use crate::device::profile::{DeviceProfile, DeviceProtocol};
use crate::eq::FilterType;

// Walkplay's PEQ register uses the complete five-value filter enum. Keep the
// generic Walkplay capability broad; individual profiles retain their Tested /
// Untested status until each model has hardware sign-off.
const WALKPLAY_FILTER_TYPES: &[FilterType] = FilterType::ALL;
const LIMITED_FILTER_TYPES: &[FilterType] = &[
    FilterType::Peak,
    FilterType::LowShelf,
    FilterType::HighShelf,
];

const fn savitech_caps(supported_filter_types: &'static [FilterType]) -> DeviceCapabilities {
    DeviceCapabilities {
        num_bands: 10,
        global_gain_range: (-16, 6),
        band_gain_range: (-10.0, 10.0),
        freq_range: (20, 20000),
        q_range: (0.1, 10.0),
        supported_filter_types,
        supports_per_band_enable: false,
        supports_ram_apply: false,
        dsp_sample_rate: 96000.0,
        gain_tolerance: 0.15,
        freq_tolerance: 1,
        q_tolerance: 0.05,
        integer_preamp: true,
    }
}

const SAVITECH_10_BAND_CAPS: DeviceCapabilities = savitech_caps(WALKPLAY_FILTER_TYPES);

const MOONDROP_8_BAND_CAPS: DeviceCapabilities = DeviceCapabilities {
    num_bands: 8,
    global_gain_range: (-128, 0),
    band_gain_range: (-18.0, 12.0),
    freq_range: (20, 20000),
    q_range: (0.1, 10.0),
    supported_filter_types: LIMITED_FILTER_TYPES,
    supports_per_band_enable: false,
    supports_ram_apply: true,
    dsp_sample_rate: 96000.0,
    gain_tolerance: 0.15,
    freq_tolerance: 1,
    q_tolerance: 0.05,
    integer_preamp: false,
};

const FIIO_5_BAND_CAPS: DeviceCapabilities = DeviceCapabilities {
    num_bands: 5,
    global_gain_range: (-12, 12),
    band_gain_range: (-12.0, 12.0),
    freq_range: (20, 20000),
    q_range: (0.1, 10.0),
    supported_filter_types: LIMITED_FILTER_TYPES,
    supports_per_band_enable: false,
    supports_ram_apply: true,
    dsp_sample_rate: 48000.0,
    gain_tolerance: 0.15,
    freq_tolerance: 1,
    q_tolerance: 0.05,
    integer_preamp: false,
};

const FIIO_10_BAND_CAPS: DeviceCapabilities = DeviceCapabilities {
    num_bands: 10,
    global_gain_range: (-12, 12),
    band_gain_range: (-12.0, 12.0),
    freq_range: (20, 20000),
    q_range: (0.1, 10.0),
    supported_filter_types: LIMITED_FILTER_TYPES,
    supports_per_band_enable: false,
    supports_ram_apply: false,
    dsp_sample_rate: 48000.0,
    gain_tolerance: 0.15,
    freq_tolerance: 1,
    q_tolerance: 0.05,
    integer_preamp: false,
};

pub const SUPPORTED_DEVICES: &[DeviceProfile] = &[
    DeviceProfile {
        name: "EPZ TP35 Pro",
        protocol: DeviceProtocol::Walkplay,
        vendor_id: 0x3302,
        product_id: Some(0x43E6),
        status: "Tested",
        family: "Walkplay Family",
        caps: SAVITECH_10_BAND_CAPS,
    },
    DeviceProfile {
        name: "TRN Black Pearl",
        protocol: DeviceProtocol::Walkplay,
        vendor_id: 0x3302,
        product_id: Some(0x43E8),
        status: "Tested",
        family: "Walkplay Family",
        caps: SAVITECH_10_BAND_CAPS,
    },
    DeviceProfile {
        name: "Audiocular Aura",
        protocol: DeviceProtocol::Walkplay,
        vendor_id: 0x3302,
        product_id: None,
        status: "Untested",
        family: "Walkplay Family",
        caps: SAVITECH_10_BAND_CAPS,
    },
    DeviceProfile {
        name: "JCally JM20 Pro",
        protocol: DeviceProtocol::Walkplay,
        vendor_id: 0x3302,
        product_id: Some(0x43C1),
        status: "Untested",
        family: "Walkplay Family",
        caps: DeviceCapabilities {
            num_bands: 8,
            supported_filter_types: &[
                FilterType::Peak,
                FilterType::LowShelf,
                FilterType::LowPass,
                FilterType::HighPass,
            ],
            ..SAVITECH_10_BAND_CAPS
        },
    },
    DeviceProfile {
        name: "Moondrop Dawn Pro 2",
        protocol: DeviceProtocol::Moondrop,
        vendor_id: 0x35D8,
        product_id: Some(0x011D),
        status: "Untested",
        family: "Moondrop",
        caps: MOONDROP_8_BAND_CAPS,
    },
    DeviceProfile {
        name: "FiiO JA11",
        protocol: DeviceProtocol::FiioJa11,
        vendor_id: 0x2972,
        product_id: Some(0x0102),
        status: "Untested",
        family: "FiiO",
        caps: FIIO_5_BAND_CAPS,
    },
    DeviceProfile {
        name: "FiiO KA15",
        protocol: DeviceProtocol::Fiio,
        vendor_id: 0x2972,
        product_id: Some(0x0104),
        status: "Untested",
        family: "FiiO",
        caps: FIIO_10_BAND_CAPS,
    },
    DeviceProfile {
        name: "FiiO KA17",
        protocol: DeviceProtocol::FiioKa17,
        vendor_id: 0x2972,
        product_id: Some(0x0093),
        status: "Untested",
        family: "FiiO",
        caps: FIIO_10_BAND_CAPS,
    },
    DeviceProfile {
        name: "Truthear KEYX",
        protocol: DeviceProtocol::Walkplay,
        vendor_id: 0x0D8C,
        product_id: Some(0x0210),
        status: "Untested",
        family: "Walkplay Family",
        caps: DeviceCapabilities {
            num_bands: 8,
            global_gain_range: (-20, 0),
            band_gain_range: (-12.0, 12.0),
            supports_ram_apply: false,
            dsp_sample_rate: 48000.0,
            gain_tolerance: 0.1,
            ..SAVITECH_10_BAND_CAPS
        },
    },
    DeviceProfile {
        name: "Fosi Audio DS2 / iBasso DC04 Pro",
        protocol: DeviceProtocol::Walkplay,
        vendor_id: 0x262A,
        product_id: None,
        status: "Untested",
        family: "Walkplay Family",
        caps: SAVITECH_10_BAND_CAPS,
    },
    DeviceProfile {
        name: "JCally JM20 / Savitech Generic",
        protocol: DeviceProtocol::Walkplay,
        vendor_id: 0x0661,
        product_id: None,
        status: "Untested",
        family: "Walkplay Family",
        caps: SAVITECH_10_BAND_CAPS,
    },
    DeviceProfile {
        name: "JCally JM20 Pro / Alt Savitech",
        protocol: DeviceProtocol::Walkplay,
        vendor_id: 0x0666,
        product_id: None,
        status: "Untested",
        family: "Walkplay Family",
        caps: SAVITECH_10_BAND_CAPS,
    },
    DeviceProfile {
        name: "Moondrop Dawn Pro",
        protocol: DeviceProtocol::DawnPro,
        vendor_id: 0x2FC6,
        product_id: None,
        status: "Untested",
        family: "Moondrop / Comtrue",
        // No hardware EQ; these caps only shape the offline editor.
        caps: DESKTOP_DAC_CAPS,
    },
    DeviceProfile {
        name: "JCally JM12",
        protocol: DeviceProtocol::FiioJa11,
        vendor_id: 0x31B2,
        product_id: Some(0x0111),
        status: "Untested",
        family: "FiiO",
        caps: FIIO_5_BAND_CAPS,
    },
    DeviceProfile {
        name: "FiiO KA Series",
        protocol: DeviceProtocol::Fiio,
        vendor_id: 0x2972,
        product_id: None,
        status: "Untested",
        family: "FiiO",
        caps: FIIO_10_BAND_CAPS,
    },
];

/// Finds a catalog protocol by its `DeviceProtocol::name()`, ignoring case,
/// spaces, `-` and `_`. Only protocols with a catalog entry resolve.
pub fn protocol_by_name(name: &str) -> Option<DeviceProtocol> {
    let key = |name: &str| name.to_lowercase().replace([' ', '-', '_'], "");
    let wanted = key(name);
    SUPPORTED_DEVICES
        .iter()
        .map(|device| device.protocol)
        .find(|protocol| key(protocol.name()) == wanted)
}

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
    fn original_dawn_pro_is_controls_only_and_dawn_pro_2_keeps_peq() {
        use crate::device::DeviceProtocol;
        let original = get_supported_device(0x2FC6, 0xF06A).unwrap();
        assert_eq!(original.protocol, DeviceProtocol::DawnPro);
        assert!(!original.protocol.has_hardware_eq());
        let dawn2 = get_supported_device(0x35D8, 0x011D).unwrap();
        assert_eq!(dawn2.protocol, DeviceProtocol::Moondrop);
        assert!(dawn2.protocol.has_hardware_eq());
        assert_eq!(dawn2.caps.num_bands, 8);
        assert_eq!(dawn2.caps.dsp_sample_rate, 96000.0);
    }

    #[test]
    fn every_catalog_protocol_resolves_by_its_name() {
        for device in SUPPORTED_DEVICES {
            let name = device.protocol.name();
            assert_eq!(protocol_by_name(name), Some(device.protocol), "{name}");
            assert_eq!(
                protocol_by_name(&name.to_uppercase().replace(' ', "_")),
                Some(device.protocol),
                "{name}"
            );
        }
        assert_eq!(protocol_by_name("Unknown"), None);
    }

    #[test]
    fn catalog_entries_do_not_shadow_each_other() {
        for (i, a) in SUPPORTED_DEVICES.iter().enumerate() {
            for b in &SUPPORTED_DEVICES[i + 1..] {
                assert_ne!(a.name, b.name, "duplicate profile name");
                assert!(
                    a.vendor_id != b.vendor_id || a.product_id != b.product_id,
                    "{} and {} claim the same VID/PID match",
                    a.name,
                    b.name
                );
            }
        }
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

    #[test]
    fn tested_walkplay_profiles_advertise_all_filter_types() {
        for profile in SUPPORTED_DEVICES.iter().filter(|profile| {
            profile.protocol == DeviceProtocol::Walkplay && profile.status == "Tested"
        }) {
            assert_eq!(
                profile.caps.supported_filter_types,
                FilterType::ALL,
                "{}",
                profile.name
            );
        }
    }

    #[test]
    fn non_walkplay_eq_profiles_keep_the_limited_filter_set() {
        for profile in SUPPORTED_DEVICES.iter().filter(|profile| {
            profile.protocol != DeviceProtocol::Walkplay && profile.protocol.has_hardware_eq()
        }) {
            assert_eq!(
                profile.caps.supported_filter_types, LIMITED_FILTER_TYPES,
                "{}",
                profile.name
            );
        }
    }
}
