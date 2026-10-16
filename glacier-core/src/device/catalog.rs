// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Static catalog of supported USB DACs.

use crate::device::capabilities::{DeviceCapabilities, DESKTOP_DAC_CAPS};
use crate::device::families::{dawn_pro, fiio, moondrop, walkplay};
use crate::device::profile::{Controls, DacSpec, DeviceProfile};
use crate::device::protocol::Protocol;
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
        protocol: &walkplay::PROTOCOL,
        vendor_id: 0x3302,
        product_id: Some(0x43E6),
        status: "Tested",
        family: "Walkplay Family",
        caps: SAVITECH_10_BAND_CAPS,
        controls: Some(Controls::Walkplay),
        spec: Some(DacSpec {
            name: "EPZ TP35 Pro",
            chip: "Dual CS43198",
            outputs: "3.5 / 4.4mm",
            max_power: Some("262mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: Some("125 dB"),
            thd: Some("0.0004%"),
        }),
    },
    DeviceProfile {
        name: "TRN Black Pearl",
        protocol: &walkplay::PROTOCOL,
        vendor_id: 0x3302,
        product_id: Some(0x43E8),
        status: "Tested",
        family: "Walkplay Family",
        caps: SAVITECH_10_BAND_CAPS,
        controls: Some(Controls::Walkplay),
        spec: Some(DacSpec {
            name: "TRN Black Pearl",
            chip: "Dual CS43131",
            outputs: "3.5 / 4.4mm",
            max_power: Some("250mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: Some("125 dB"),
            thd: Some("0.0005%"),
        }),
    },
    DeviceProfile {
        name: "Audiocular Aura",
        protocol: &walkplay::PROTOCOL,
        vendor_id: 0x3302,
        product_id: None,
        status: "Untested",
        family: "Walkplay Family",
        caps: SAVITECH_10_BAND_CAPS,
        controls: Some(Controls::Walkplay),
        spec: Some(DacSpec {
            name: "Audiocular Aura",
            chip: "Dual CS43198",
            outputs: "3.5 / 4.4mm",
            max_power: Some("262mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: Some("125 dB"),
            thd: None,
        }),
    },
    DeviceProfile {
        name: "JCally JM20 Pro",
        protocol: &walkplay::PROTOCOL,
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
        controls: Some(Controls::Walkplay),
        spec: Some(DacSpec {
            name: "JCally JM20 Pro",
            chip: "CS43131",
            outputs: "3.5mm SE",
            max_power: Some("95mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: None,
            thd: None,
        }),
    },
    DeviceProfile {
        name: "Moondrop Dawn Pro 2",
        protocol: &moondrop::PROTOCOL,
        vendor_id: 0x35D8,
        product_id: Some(0x011D),
        status: "Untested",
        family: "Moondrop",
        caps: MOONDROP_8_BAND_CAPS,
        controls: None,
        spec: Some(DacSpec {
            name: "Moondrop Dawn Pro 2",
            chip: "Dual CS43131",
            outputs: "3.5 / 4.4mm",
            max_power: Some("260mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: Some("131 dB"),
            thd: None,
        }),
    },
    DeviceProfile {
        name: "FiiO JA11",
        protocol: &fiio::JA11,
        vendor_id: 0x2972,
        product_id: Some(0x0102),
        status: "Untested",
        family: "FiiO",
        caps: FIIO_5_BAND_CAPS,
        controls: None,
        spec: Some(DacSpec {
            name: "FiiO JA11",
            chip: "KT02H20 DSP",
            outputs: "3.5mm SE",
            max_power: Some("30mW @ 32Ω"),
            decoding: Some("384k / DSD128"),
            snr: Some("115 dB"),
            thd: None,
        }),
    },
    DeviceProfile {
        name: "FiiO KA15",
        protocol: &fiio::KA_SERIES,
        vendor_id: 0x2972,
        product_id: Some(0x0104),
        status: "Untested",
        family: "FiiO",
        caps: FIIO_10_BAND_CAPS,
        controls: None,
        spec: Some(DacSpec {
            name: "FiiO KA Series",
            chip: "Cirrus / ESS",
            outputs: "3.5 / 4.4mm",
            max_power: None,
            decoding: Some("384k / DSD256"),
            snr: None,
            thd: None,
        }),
    },
    DeviceProfile {
        name: "FiiO KA17",
        protocol: &fiio::KA17,
        vendor_id: 0x2972,
        product_id: Some(0x0093),
        status: "Untested",
        family: "FiiO",
        caps: FIIO_10_BAND_CAPS,
        controls: None,
        spec: Some(DacSpec {
            name: "FiiO KA Series",
            chip: "Cirrus / ESS",
            outputs: "3.5 / 4.4mm",
            max_power: None,
            decoding: Some("384k / DSD256"),
            snr: None,
            thd: None,
        }),
    },
    DeviceProfile {
        name: "Truthear KEYX",
        protocol: &walkplay::PROTOCOL,
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
        controls: Some(Controls::Walkplay),
        spec: Some(DacSpec {
            name: "Truthear KEYX",
            chip: "CM6542 Codec",
            outputs: "3.5mm SE",
            max_power: Some("60mW @ 32Ω"),
            decoding: Some("384k / 32-bit"),
            snr: None,
            thd: None,
        }),
    },
    DeviceProfile {
        name: "Fosi Audio DS2 / iBasso DC04 Pro",
        protocol: &walkplay::PROTOCOL,
        vendor_id: 0x262A,
        product_id: None,
        status: "Untested",
        family: "Walkplay Family",
        caps: SAVITECH_10_BAND_CAPS,
        controls: Some(Controls::Walkplay),
        spec: Some(DacSpec {
            name: "Fosi Audio DS2 / iBasso DC04 Pro",
            chip: "Dual CS43131",
            outputs: "3.5 / 4.4mm",
            max_power: Some("510mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: Some("130 dB"),
            thd: None,
        }),
    },
    DeviceProfile {
        name: "JCally JM20 / Savitech Generic",
        protocol: &walkplay::PROTOCOL,
        vendor_id: 0x0661,
        product_id: None,
        status: "Untested",
        family: "Walkplay Family",
        caps: SAVITECH_10_BAND_CAPS,
        controls: Some(Controls::Walkplay),
        spec: Some(DacSpec {
            name: "JCally JM20 / Savitech Generic",
            chip: "CS43131",
            outputs: "3.5mm SE",
            max_power: Some("95mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: None,
            thd: None,
        }),
    },
    DeviceProfile {
        name: "JCally JM20 Pro / Alt Savitech",
        protocol: &walkplay::PROTOCOL,
        vendor_id: 0x0666,
        product_id: None,
        status: "Untested",
        family: "Walkplay Family",
        caps: SAVITECH_10_BAND_CAPS,
        controls: Some(Controls::Walkplay),
        spec: Some(DacSpec {
            name: "JCally JM20 Pro / Alt Savitech",
            chip: "CS43131",
            outputs: "3.5mm SE",
            max_power: Some("95mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: None,
            thd: None,
        }),
    },
    DeviceProfile {
        name: "Moondrop Dawn Pro",
        protocol: &dawn_pro::PROTOCOL,
        vendor_id: dawn_pro::VENDOR_ID,
        product_id: Some(dawn_pro::PRODUCT_ID),
        status: "Untested",
        family: "Moondrop / Comtrue",
        // No hardware EQ; these caps only shape the offline editor.
        caps: DESKTOP_DAC_CAPS,
        controls: Some(Controls::DawnPro),
        spec: Some(DacSpec {
            name: "Moondrop Dawn Pro",
            chip: "Dual CS43131",
            outputs: "3.5 / 4.4mm",
            max_power: Some("230mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: Some("131 dB"),
            thd: Some("0.00014%"),
        }),
    },
    // Other Comtrue PIDs match for display only: the controls protocol is
    // verified on the original 2FC6:F06A alone.
    DeviceProfile {
        name: "Moondrop Dawn Pro",
        protocol: &dawn_pro::PROTOCOL,
        vendor_id: 0x2FC6,
        product_id: None,
        status: "Untested",
        family: "Moondrop / Comtrue",
        // No hardware EQ; these caps only shape the offline editor.
        caps: DESKTOP_DAC_CAPS,
        controls: None,
        spec: Some(DacSpec {
            name: "Moondrop Dawn Pro",
            chip: "Dual CS43131",
            outputs: "3.5 / 4.4mm",
            max_power: Some("230mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: Some("131 dB"),
            thd: Some("0.00014%"),
        }),
    },
    DeviceProfile {
        name: "JCally JM12",
        protocol: &fiio::JA11,
        vendor_id: 0x31B2,
        product_id: Some(0x0111),
        status: "Untested",
        family: "FiiO",
        caps: FIIO_5_BAND_CAPS,
        controls: None,
        spec: Some(DacSpec {
            name: "JCally JM12",
            chip: "KT02H20",
            outputs: "3.5mm SE",
            max_power: Some("30mW @ 32Ω"),
            decoding: Some("384k / DSD128"),
            snr: None,
            thd: None,
        }),
    },
    DeviceProfile {
        name: "FiiO KA Series",
        protocol: &fiio::KA_SERIES,
        vendor_id: 0x2972,
        product_id: None,
        status: "Untested",
        family: "FiiO",
        caps: FIIO_10_BAND_CAPS,
        controls: None,
        spec: Some(DacSpec {
            name: "FiiO KA Series",
            chip: "Cirrus / ESS",
            outputs: "3.5 / 4.4mm",
            max_power: None,
            decoding: Some("384k / DSD256"),
            snr: None,
            thd: None,
        }),
    },
];

/// Finds a catalog protocol by its `Protocol::id`, ignoring case, spaces,
/// `-` and `_`. Only protocols with a catalog entry resolve.
pub fn protocol_by_name(name: &str) -> Option<&'static Protocol> {
    let key = |name: &str| name.to_lowercase().replace([' ', '-', '_'], "");
    let wanted = key(name);
    SUPPORTED_DEVICES
        .iter()
        .map(|device| device.protocol)
        .find(|protocol| key(protocol.id) == wanted)
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
    use crate::eq::Filter;

    #[test]
    fn official_specs_follow_the_matched_profile() {
        let spec = get_supported_device(0x3302, 0x43e6).unwrap().spec.unwrap();
        assert_eq!(spec.chip, "Dual CS43198");
        assert_eq!(spec.max_power, Some("262mW @ 32Ω"));
        let exact = get_supported_device(0x3302, 0x43c1).unwrap().spec.unwrap();
        assert_eq!(exact.name, "JCally JM20 Pro");
        let fallback = get_supported_device(0x3302, 0xffff).unwrap().spec.unwrap();
        assert_eq!(fallback.name, "Audiocular Aura");
        assert_eq!(
            get_supported_device(0x2972, 0x0102)
                .unwrap()
                .spec
                .unwrap()
                .name,
            "FiiO JA11"
        );
        for device in SUPPORTED_DEVICES {
            if let Some(spec) = device.spec {
                assert!(
                    !spec.name.is_empty() && !spec.chip.is_empty() && !spec.outputs.is_empty(),
                    "{}",
                    device.name
                );
            }
        }
    }

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
        let original = get_supported_device(0x2FC6, 0xF06A).unwrap();
        assert_eq!(original.protocol, &dawn_pro::PROTOCOL);
        assert!(!original.protocol.has_hardware_eq());
        let dawn2 = get_supported_device(0x35D8, 0x011D).unwrap();
        assert_eq!(dawn2.protocol, &moondrop::PROTOCOL);
        assert!(dawn2.protocol.has_hardware_eq());
        assert_eq!(dawn2.caps.num_bands, 8);
        assert_eq!(dawn2.caps.dsp_sample_rate, 96000.0);
    }

    #[test]
    fn every_catalog_protocol_resolves_by_its_name() {
        for device in SUPPORTED_DEVICES {
            let name = device.protocol.id;
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
        for profile in SUPPORTED_DEVICES
            .iter()
            .filter(|profile| profile.protocol == &walkplay::PROTOCOL && profile.status == "Tested")
        {
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
            profile.protocol != &walkplay::PROTOCOL && profile.protocol.has_hardware_eq()
        }) {
            assert_eq!(
                profile.caps.supported_filter_types, LIMITED_FILTER_TYPES,
                "{}",
                profile.name
            );
        }
    }

    /// The contract session/ and wasm.rs rely on, checked for every catalog
    /// profile with hardware EQ, so a new DAC or protocol is covered by
    /// adding its catalog entry.
    #[test]
    fn every_catalog_profile_meets_the_shared_flow_contract() {
        for device in SUPPORTED_DEVICES {
            let Some(protocol) = device.protocol.eq else {
                continue;
            };
            let name = device.name;
            let caps = &device.caps;
            let encoding = protocol.gain_encoding();
            assert!(
                encoding.band_units_per_db > 0.0
                    && encoding.band_readback_per_db > 0.0
                    && encoding.preamp_units_per_db > 0.0
                    && encoding.preamp_step_db > 0.0
                    && encoding.band_step_db.is_none_or(|step| step > 0.0),
                "{name}: gain encoding needs positive scales"
            );

            let mut packets = protocol.init_packets();
            packets.extend(protocol.commit_packets());
            packets.extend(protocol.ram_apply_packets());
            packets.push(protocol.read_global_gain_request());
            let (low, high) = caps.global_gain_range;
            for gain in [low, 0, high] {
                let writes = protocol.write_global_gain_packets(gain.into());
                assert!(!writes.is_empty(), "{name}: no preamp write for {gain} dB");
                packets.extend(writes);
            }
            for index in 0..caps.num_bands as u8 {
                packets.push(protocol.read_filter_request(index, 1));
                for &filter_type in caps.supported_filter_types {
                    // 4 kHz: shelves near 1 kHz already overflow Walkplay's
                    // ±2.0 coefficient range at 96 kHz; the encoder rejects them.
                    let filter = Filter {
                        index,
                        enabled: true,
                        freq: 4000,
                        gain: 1.0,
                        q: 1.0,
                        filter_type,
                    };
                    let writes = protocol
                        .write_filter_packets(index, &filter, caps.dsp_sample_rate, 0.0)
                        .unwrap_or_else(|error| {
                            panic!("{name}: band {index} {filter_type:?}: {error}")
                        });
                    // wasm.rs rejects a band write unless one packet passes this.
                    assert!(
                        writes
                            .iter()
                            .any(|packet| protocol.is_filter_packet_valid(&packet.payload)),
                        "{name}: band {index} {filter_type:?} write is not a valid filter packet"
                    );
                    packets.extend(writes);
                }
            }

            for packet in &packets {
                assert_eq!(packet.report_id, protocol.report_id(), "{name}: {packet:?}");
                let framed = packet.framed();
                assert_eq!(
                    protocol.unframe_packet(&framed),
                    Ok(&framed[1..]),
                    "{name}: {packet:?}"
                );
            }
        }
    }

    #[test]
    fn walkplay_resends_unanswered_reads_and_moondrop_does_not() {
        let resend = |protocol: &Protocol| protocol.eq.unwrap().resend_unanswered_after();
        assert_eq!(resend(&walkplay::PROTOCOL), Some(15));
        assert_eq!(resend(&moondrop::PROTOCOL), None);
    }

    #[test]
    fn only_moondrop_writes_with_set_report() {
        for device in SUPPORTED_DEVICES {
            assert_eq!(
                device.protocol.quirks().set_report_writes,
                device.protocol == &moondrop::PROTOCOL,
                "{}",
                device.name
            );
        }
    }

    #[test]
    fn only_dawn_pro_and_unknown_lack_hardware_eq() {
        assert!(!dawn_pro::PROTOCOL.has_hardware_eq());
        assert!(!crate::device::protocol::UNKNOWN.has_hardware_eq());
        for device in SUPPORTED_DEVICES {
            assert_eq!(
                device.protocol.has_hardware_eq(),
                device.protocol != &dawn_pro::PROTOCOL,
                "{}",
                device.name
            );
        }
    }
}
