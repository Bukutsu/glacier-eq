// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only
use super::*;
use crate::device::get_supported_device;

struct ReadCapture {
    filters: &'static [&'static [u8]],
    gain: &'static [u8],
}
const QX13_READ: ReadCapture = include!("../../../../tests/fixtures/fiio/qx13_read.rs");
const OAK_READ: ReadCapture = include!("../../../../tests/fixtures/fiio/oak_nano_read.rs");

#[test]
fn new_codecs_read_external_qx13_and_oak_nano_capture_bytes() {
    for (pid, capture, first_freq) in [(0x0128, &QX13_READ, 32), (0x4016, &OAK_READ, 64)] {
        let profile = get_supported_device(0x2972, pid).unwrap();
        let eq = profile.protocol.eq.unwrap();
        assert_eq!(capture.filters.len(), profile.caps.num_bands);
        for (i, packet) in capture.filters.iter().enumerate() {
            assert!(eq.matches_filter_response(packet, i as u8, 0));
            assert!(eq.is_filter_packet_valid(packet));
            let filter = eq.parse_filter_response(packet).unwrap();
            assert_eq!(filter.index, i as u8);
            if i == 0 {
                assert_eq!(filter.freq, first_freq);
            }
            let mut unsupported = packet.to_vec();
            for kind in [3, 6, 7, 255] {
                unsupported[13] = kind;
                assert!(!eq.is_filter_packet_valid(&unsupported));
                assert!(eq.parse_filter_response(&unsupported).is_none());
            }
        }
        let raw = i16::from_be_bytes([capture.gain[6], capture.gain[7]]);
        assert_eq!(
            eq.parse_global_gain_response(capture.gain),
            Some(f64::from(raw) / 10.0)
        );
    }
}

#[test]
fn pass_filters_at_zero_db_stay_active_and_disabled_pass_filters_are_neutral() {
    let eq = registry::QX13.eq.unwrap();
    for (kind, wire) in [(FilterType::HighPass, 5), (FilterType::LowPass, 4)] {
        let mut filter = Filter {
            index: 0,
            enabled: true,
            filter_type: kind,
            freq: 1000,
            gain: 0.0,
            q: 0.71,
        };
        let packets = eq.write_filter_packets(0, &filter, 48000.0, 0.0).unwrap();
        let mut data = packets.last().unwrap().payload.clone();
        assert_eq!(data[13], wire);
        data[0] = 0xbb;
        data[1] = 0x0b;
        let actual = eq.parse_filter_response(&data).unwrap();
        assert_eq!(actual.filter_type, kind);
        assert!(actual.enabled);
        assert!(!eq.is_default_state(&PEQData {
            global_gain: 0.0,
            filters: vec![actual]
        }));
        filter.enabled = false;
        let packets = eq.write_filter_packets(0, &filter, 48000.0, 0.0).unwrap();
        assert_eq!(packets.last().unwrap().payload[13], 0);
    }
}
