// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use crate::device::Protocol;
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
fn protocol_ids_are_unique_and_controls_are_explicit() {
    for a in SUPPORTED_DEVICES {
        assert!(!a.protocol.id.is_empty(), "{}", a.name);
        if a.controls == Some(Controls::Walkplay) {
            assert!(
                a.protocol.has_hardware_eq(),
                "Walkplay utilities use the EQ report framing"
            );
        }
        for b in SUPPORTED_DEVICES {
            if a.protocol.id == b.protocol.id {
                assert!(
                    std::ptr::eq(a.protocol, b.protocol),
                    "duplicate protocol ID {}",
                    a.protocol.id
                );
            }
        }
    }
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
        [
            &moondrop::PROTOCOL,
            &fiio::JA11,
            &fiio::KA_SERIES,
            &fiio::KA17,
        ]
        .contains(&profile.protocol)
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
        crate::device::normalization::validate_capabilities(caps)
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        let encoding = protocol.gain_encoding();
        assert!(
            encoding.band_units_per_db > 0.0
                && encoding.band_readback_per_db > 0.0
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
        for index in 0..caps.num_bands {
            let index = u8::try_from(index).unwrap();
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
fn existing_family_transport_quirks() {
    assert!(moondrop::PROTOCOL.quirks().set_report_writes);
    for protocol in [
        &walkplay::PROTOCOL,
        &fiio::JA11,
        &fiio::KA_SERIES,
        &fiio::KA17,
    ] {
        assert!(!protocol.quirks().set_report_writes);
    }
    assert!(!dawn_pro::PROTOCOL.has_hardware_eq());
    assert!(!crate::device::UNKNOWN.has_hardware_eq());
}
