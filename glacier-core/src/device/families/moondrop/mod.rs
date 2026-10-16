// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::device::families::walkplay::compute_iir_filter;
use crate::device::packet::{checked_scaled_i16, checked_scaled_u16, Packet};
use crate::device::protocol::{EqProtocol, GainEncoding, Quirks};
use crate::device::timing::WriteTiming;
use crate::eq::filter::DEFAULT_FREQS_10_BAND;
use crate::eq::{Filter, FilterType, PEQData};

// DAWN PRO 2 (35D8:011D), referenced against dawnpro2-studio
// fec08ac5db4835575747849172a7299f6f0d4b7f, firmware 1.5.
const BAND_COUNT: u8 = 8;
const DSP_SAMPLE_RATE: f64 = 96_000.0;
const CUSTOM_EQ_SELECT: u8 = 7;

pub struct MoondropProtocol;

fn command(op: u8, cmd: u8, data: &[u8]) -> Packet {
    let mut payload = vec![op, cmd, data.len() as u8];
    payload.extend_from_slice(data);
    Packet::padded(0x4B, payload, 63)
}

fn enable_all_bands() -> Packet {
    command(0x01, 0x0A, &[0, 0, 0xFF, 0xFF])
}

// DAWN PRO 2 uses shelf slope in the Q field. The shared Walkplay
// coefficient designer interprets shelf Q differently, so retain this device's
// RBJ shelf equations from the pinned reference rather than changing Walkplay.
fn coefficient_bytes(filter: &Filter, gain: f64) -> Result<[u8; 20], String> {
    if filter.filter_type == FilterType::Peak {
        return compute_iir_filter(
            FilterType::Peak,
            filter.freq as f64,
            gain,
            filter.q,
            DSP_SAMPLE_RATE,
        );
    }
    let amp = 10f64.powf(gain / 40.0);
    let omega = 2.0 * std::f64::consts::PI * filter.freq as f64 / DSP_SAMPLE_RATE;
    let c = omega.cos();
    let alpha = omega.sin() / 2.0 * ((amp + 1.0 / amp) * (1.0 / filter.q - 1.0) + 2.0).sqrt();
    let sq = 2.0 * amp.sqrt() * alpha;
    let (b0, b1, b2, a0, a1, a2) = if filter.filter_type == FilterType::LowShelf {
        (
            amp * (amp + 1.0 - (amp - 1.0) * c + sq),
            2.0 * amp * (amp - 1.0 - (amp + 1.0) * c),
            amp * (amp + 1.0 - (amp - 1.0) * c - sq),
            amp + 1.0 + (amp - 1.0) * c + sq,
            -2.0 * (amp - 1.0 + (amp + 1.0) * c),
            amp + 1.0 + (amp - 1.0) * c - sq,
        )
    } else {
        (
            amp * (amp + 1.0 + (amp - 1.0) * c + sq),
            -2.0 * amp * (amp - 1.0 + (amp + 1.0) * c),
            amp * (amp + 1.0 + (amp - 1.0) * c - sq),
            amp + 1.0 - (amp - 1.0) * c + sq,
            2.0 * (amp - 1.0 - (amp + 1.0) * c),
            amp + 1.0 - (amp - 1.0) * c - sq,
        )
    };
    let mut bytes = [0; 20];
    for (index, value) in [b0, b1, b2, a1, a2].into_iter().enumerate() {
        let rounded = (value / a0 * (1u64 << 30) as f64 + 0.5).floor();
        let wire = if index >= 3 { -rounded } else { rounded };
        if !wire.is_finite() || !(i32::MIN as f64..=i32::MAX as f64).contains(&wire) {
            return Err("DAWN PRO 2 shelf coefficient exceeds the signed Q30 fixed-point range; reduce gain or shelf Q".into());
        }
        bytes[index * 4..index * 4 + 4].copy_from_slice(&(wire as i32).to_le_bytes());
    }
    Ok(bytes)
}

impl EqProtocol for MoondropProtocol {
    fn gain_encoding(&self) -> GainEncoding {
        GainEncoding {
            band_units_per_db: 256.0,
            band_step_db: None,
            band_readback_per_db: 10.0,
            preamp_units_per_db: 256.0,
            preamp_step_db: 0.1,
        }
    }

    fn write_timing(&self) -> WriteTiming {
        WriteTiming {
            // The session delays between bands, not between each packet in a
            // band. Keep a conservative 150 ms interval between bands; exact
            // activation/preamp/band pacing needs session-level packet delays.
            per_filter_ms: 150,
            batch_ms: 50,
            global_gain_ms: 50,
            commit_step_ms: 200,
            flood_delay_ms: 50,
            post_gain_read_ms: 50,
            init_ms: 50,
        }
    }

    fn is_default_state(&self, peq: &PEQData) -> bool {
        peq.global_gain == 0.0 && peq.filters.iter().all(|f| !f.enabled || f.gain == 0.0)
    }

    fn init_packets(&self) -> Vec<Packet> {
        vec![]
    }

    fn read_filter_request(&self, index: u8, _nonce: u8) -> Packet {
        command(0x80, 0x09, &[0, index])
    }

    fn matches_filter_response(&self, data: &[u8], index: u8, _nonce: u8) -> bool {
        index < BAND_COUNT
            && data.len() >= 34
            && data[0] == 0x80
            && data[1] == 0x09
            && data[4] == index
    }

    fn is_filter_packet_valid(&self, data: &[u8]) -> bool {
        if data.len() < 34 || data[4] >= BAND_COUNT || !matches!(data[33], 0..=3) {
            return false;
        }
        let raw_freq = u16::from_le_bytes([data[27], data[28]]);
        let raw_q = u16::from_le_bytes([data[29], data[30]]);
        let q = raw_q as f64 / 256.0;
        raw_freq != 0
            && raw_freq != u16::MAX
            && raw_freq <= 20000
            && raw_q != u16::MAX
            && q > 0.0
            && q <= 10.0
    }

    fn is_filter_response_valid(&self, data: &[u8], index: u8, _nonce: u8) -> bool {
        self.matches_filter_response(data, index, _nonce) && self.is_filter_packet_valid(data)
    }

    fn parse_filter_response(&self, data: &[u8]) -> Option<Filter> {
        if data.len() < 34 || data[4] >= BAND_COUNT {
            return None;
        }
        let raw_freq = u16::from_le_bytes([data[27], data[28]]);
        let q_raw = u16::from_le_bytes([data[29], data[30]]);
        let gain_raw = i16::from_le_bytes([data[31], data[32]]);
        let raw_q = q_raw as f64 / 256.0;
        let invalid = !matches!(data[33], 0..=3)
            || raw_freq == 0
            || raw_freq == u16::MAX
            || raw_freq > 20000
            || q_raw == u16::MAX
            || !(raw_q > 0.0 && raw_q <= 10.0);
        let enabled = !invalid && data[33] != 0;
        let (freq, q, gain, filter_type) = if invalid {
            (default_freq(data[4]), 0.75, 0.0, FilterType::Peak)
        } else {
            (
                raw_freq,
                (raw_q * 100.0).round() / 100.0,
                ((gain_raw as f64 / 256.0) * 10.0).round() / 10.0,
                match data[33] {
                    1 => FilterType::LowShelf,
                    3 => FilterType::HighShelf,
                    _ => FilterType::Peak,
                },
            )
        };

        Some(Filter {
            index: data[4],
            enabled,
            freq,
            gain,
            q,
            filter_type,
        })
    }

    fn read_global_gain_request(&self) -> Packet {
        command(0x80, 0x23, &[])
    }

    fn matches_global_gain_response(&self, data: &[u8]) -> bool {
        data.len() >= 5 && data[0] == 0x80 && data[1] == 0x23
    }

    fn parse_global_gain_response(&self, data: &[u8]) -> Option<f64> {
        if !self.matches_global_gain_response(data) {
            return None;
        }
        let raw = i16::from_le_bytes([*data.get(3)?, *data.get(4)?]);
        Some((raw as f64 / 256.0 * 10.0).round() / 10.0)
    }

    fn write_filter_packets(
        &self,
        index: u8,
        filter: &Filter,
        dsp_sample_rate: f64,
        global_gain: f64,
    ) -> Result<Vec<Packet>, String> {
        if index >= BAND_COUNT {
            return Err("DAWN PRO 2 band index must be 0..7".into());
        }
        if dsp_sample_rate != DSP_SAMPLE_RATE {
            return Err("DAWN PRO 2 coefficients require a 96000 Hz DSP rate".into());
        }
        if !(20..=20_000).contains(&filter.freq)
            || !filter.q.is_finite()
            || !(0.1..=10.0).contains(&filter.q)
            || !filter.gain.is_finite()
            || !(-18.0..=12.0).contains(&filter.gain)
            || !matches!(
                filter.filter_type,
                FilterType::Peak | FilterType::LowShelf | FilterType::HighShelf
            )
        {
            return Err("DAWN PRO 2 band parameters are outside device limits".into());
        }
        if !global_gain.is_finite() || !(-128.0..=0.0).contains(&global_gain) {
            return Err("DAWN PRO 2 preamp must be between -128 and 0 dB".into());
        }
        let gain = if filter.enabled { filter.gain } else { 0.0 };
        let gain_wire = checked_scaled_i16(gain, 256.0, "Moondrop band gain")?;
        let q_wire = checked_scaled_u16(filter.q, 256.0, "Moondrop filter Q")?;
        // Disabled is a real device filter code, with zero coefficient bytes.
        let coeffs = if filter.enabled {
            coefficient_bytes(filter, gain)?
        } else {
            [0; 20]
        };
        let mut payload = vec![0; 63];
        payload[0] = 0x01;
        payload[1] = 0x09;
        payload[2] = 33;
        payload[4] = index;
        payload[7..27].copy_from_slice(&coeffs);
        payload[27..29].copy_from_slice(&filter.freq.to_le_bytes());
        payload[29..31].copy_from_slice(&q_wire.to_le_bytes());
        payload[31..33].copy_from_slice(&gain_wire.to_le_bytes());
        payload[33] = if filter.enabled {
            u8::from(filter.filter_type)
        } else {
            0
        };
        payload[35] = CUSTOM_EQ_SELECT;

        let mut packets = Vec::new();
        if index == 0 {
            // init_packets also runs on pulls, so activation belongs only here.
            // The stateless trait cannot compare old/new preamp or restore a
            // temporary mute after I/O failure. Hold finite attenuation instead
            // of the reference's -128 dB mute until the final preamp write.
            // This reduces transient clipping; it cannot guarantee headroom for
            // arbitrary previously loaded or overlapping boosted bands.
            packets.extend(self.write_global_gain_packets(global_gain.min(-18.0)));
            packets.push(command(0x01, 0x0F, &[CUSTOM_EQ_SELECT]));
        }
        packets.push(Packet::new(0x4B, payload));
        // The session writes all eight bands in order. Latch once, after the
        // final band, rather than applying partially written coefficients.
        if index == BAND_COUNT - 1 {
            packets.push(enable_all_bands());
        }
        Ok(packets)
    }

    fn write_global_gain_packets(&self, global_gain: f64) -> Vec<Packet> {
        // PEQData.global_gain is the PEQ preamp (0x23), not DAC offset (0x03).
        let value = (global_gain * 256.0).round() as i16;
        vec![command(0x01, 0x23, &value.to_le_bytes())]
    }

    fn commit_packets(&self) -> Vec<Packet> {
        vec![command(0x01, 0x01, &[]), command(0x01, 0x04, &[])]
    }

    fn ram_apply_packets(&self) -> Vec<Packet> {
        // Band 7 already latches all coefficients; flash saves are commit-only.
        vec![]
    }

    fn quirks(&self) -> Quirks {
        Quirks {
            set_report_writes: true,
            ..Quirks::default()
        }
    }

    fn report_id(&self) -> u8 {
        0x4B
    }
}

fn default_freq(index: u8) -> u16 {
    DEFAULT_FREQS_10_BAND
        .get(index as usize)
        .copied()
        .unwrap_or(1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Reference fixtures are complete 64-byte frames generated from the pinned
    // dawnpro2-studio fec08ac5db4835575747849172a7299f6f0d4b7f:
    // src/dawnpro2/device/protocol.py and src/dawnpro2/core/eq.py.
    // tests/test_protocol.py independently asserts the official tool offsets
    // and peak coefficient hex. These are reference bytes, not hardware captures.
    // DawnPro-GUI-windows 3e6884c837a1428f0c0066361cd57cd3fc11665c
    // src/Moondrop.Core/Protocol/DawnPro2Protocol.cs instead uses zero length
    // headers and a per-band latch; prefer the newer explicit protocol tests.
    macro_rules! fixture {
        ($name:literal) => {
            include_bytes!(concat!(
                "../../../../tests/fixtures/moondrop/",
                $name,
                ".bin"
            ))
        };
    }

    fn reference_filter() -> Filter {
        Filter {
            index: 2,
            enabled: true,
            freq: 1000,
            gain: 3.0,
            q: 1.0,
            filter_type: FilterType::Peak,
        }
    }

    #[test]
    fn band_frames_match_reference_coefficients_and_official_offsets() {
        let cases: [(FilterType, &[u8; 64]); 3] = [
            (FilterType::Peak, fixture!("peak_1000_3_1_band_2")),
            (FilterType::LowShelf, fixture!("low_shelf_1000_3_1_band_2")),
            (
                FilterType::HighShelf,
                fixture!("high_shelf_1000_minus3_1_band_2"),
            ),
        ];
        for (filter_type, expected) in cases {
            let mut filter = reference_filter();
            filter.filter_type = filter_type;
            if filter_type == FilterType::HighShelf {
                filter.gain = -3.0;
            }
            let packets = MoondropProtocol
                .write_filter_packets(2, &filter, DSP_SAMPLE_RATE, -3.5)
                .unwrap();
            assert_eq!(packets.len(), 1);
            assert_eq!(packets[0].framed().as_slice(), expected);
        }
    }

    #[test]
    fn commands_match_reference_frames_and_keep_preamp_separate_from_dac_offset() {
        let protocol = MoondropProtocol;
        assert_eq!(
            protocol.read_filter_request(5, 0).framed().as_slice(),
            fixture!("read_band_5")
        );
        assert_eq!(
            protocol.read_global_gain_request().framed().as_slice(),
            fixture!("read_preamp")
        );
        assert_eq!(
            protocol.write_global_gain_packets(-3.5)[0]
                .framed()
                .as_slice(),
            fixture!("preamp_minus_3_5")
        );
        assert_eq!(
            enable_all_bands().framed().as_slice(),
            fixture!("enable_all_bands")
        );
        let saves = protocol.commit_packets();
        assert_eq!(saves.len(), 2);
        assert_eq!(saves[0].framed().as_slice(), fixture!("save_eq"));
        assert_eq!(saves[1].framed().as_slice(), fixture!("save_offsets"));
        assert!(protocol.ram_apply_packets().is_empty());
        assert_eq!(
            protocol.parse_global_gain_response(&[0x80, 0x23, 2, 0x80, 0xFC]),
            Some(-3.5)
        );
        assert_eq!(
            protocol.parse_global_gain_response(&[0x80, 0x03, 2, 0x80, 0xFC]),
            None
        );
    }

    #[test]
    fn pulls_do_not_activate_eq_and_full_writes_activate_once_then_latch_once() {
        let protocol = MoondropProtocol;
        assert!(protocol.init_packets().is_empty());
        let mut all = Vec::new();
        for index in 0..BAND_COUNT {
            all.extend(
                protocol
                    .write_filter_packets(index, &reference_filter(), DSP_SAMPLE_RATE, -3.5)
                    .unwrap(),
            );
        }
        assert_eq!(all.len(), 11);
        assert_eq!(all[0].payload, vec![0x01, 0x23, 2, 0, 0xEE]); // -18 dB, never an automatic mute
        assert_eq!(all[1].framed().as_slice(), fixture!("select_custom"));
        assert_eq!(all[10].framed().as_slice(), fixture!("enable_all_bands"));
        assert_eq!(all.iter().filter(|p| p.payload[1] == 0x0F).count(), 1);
        assert_eq!(all.iter().filter(|p| p.payload[1] == 0x0A).count(), 1);
        for (index, band) in all[2..10].iter().enumerate() {
            assert_eq!(band.payload[4], index as u8);
            assert_eq!(band.payload[35], CUSTOM_EQ_SELECT);
        }
        // An already lower requested preamp must never be raised for the hold.
        let first = protocol
            .write_filter_packets(0, &reference_filter(), DSP_SAMPLE_RATE, -30.0)
            .unwrap();
        assert_eq!(
            first[0].payload,
            protocol.write_global_gain_packets(-30.0)[0].payload
        );
    }

    #[test]
    fn disabled_band_matches_reference_and_zero_gain_does_not_disable_active_bands() {
        let mut filter = reference_filter();
        filter.enabled = false;
        filter.gain = 6.0;
        let packet = MoondropProtocol
            .write_filter_packets(2, &filter, DSP_SAMPLE_RATE, 0.0)
            .unwrap()
            .remove(0);
        assert_eq!(
            packet.framed().as_slice(),
            fixture!("disabled_1000_0_1_band_2")
        );
        assert!(
            !MoondropProtocol
                .parse_filter_response(&packet.payload)
                .unwrap()
                .enabled
        );
        let mut data = fixture!("peak_1000_3_1_band_2")[1..].to_vec();
        data[31..33].fill(0);
        assert!(
            MoondropProtocol
                .parse_filter_response(&data)
                .unwrap()
                .enabled
        );
    }

    #[test]
    fn rejects_unrepresentable_or_nonfinite_shelf_coefficients() {
        let mut filter = reference_filter();
        filter.filter_type = FilterType::HighShelf;
        assert!(MoondropProtocol
            .write_filter_packets(0, &filter, DSP_SAMPLE_RATE, 0.0)
            .unwrap_err()
            .contains("fixed-point range"));
        filter.filter_type = FilterType::LowShelf;
        filter.gain = 12.0;
        filter.q = 10.0; // shelf slope produces a negative square-root argument
        assert!(MoondropProtocol
            .write_filter_packets(0, &filter, DSP_SAMPLE_RATE, 0.0)
            .is_err());
    }

    #[test]
    fn rejects_wrong_band_count_rate_and_invalid_parameters_before_building_activation() {
        let protocol = MoondropProtocol;
        let mut filter = reference_filter();
        assert!(protocol
            .write_filter_packets(8, &filter, DSP_SAMPLE_RATE, 0.0)
            .is_err());
        assert!(protocol
            .write_filter_packets(0, &filter, 48_000.0, 0.0)
            .is_err());
        assert!(protocol
            .write_filter_packets(0, &filter, DSP_SAMPLE_RATE, 1.0)
            .is_err());
        assert!(protocol
            .write_filter_packets(0, &filter, DSP_SAMPLE_RATE, f64::NAN)
            .is_err());
        filter.q = 0.0;
        assert!(protocol
            .write_filter_packets(0, &filter, DSP_SAMPLE_RATE, 0.0)
            .is_err());
        let mut data = fixture!("peak_1000_3_1_band_2")[1..].to_vec();
        data[0] = 0x80;
        data[4] = 8;
        assert!(!protocol.is_filter_response_valid(&data, 8, 0));
    }

    #[test]
    fn all_eq_commands_include_report_id_and_63_byte_payload() {
        // Issue #46: transport selection must not be confused with missing
        // padding. Both reads and writes already supply a full 64-byte report.
        let protocol = MoondropProtocol;
        let filter = Filter {
            index: 0,
            enabled: true,
            freq: 1000,
            gain: 1.5,
            q: 0.75,
            filter_type: FilterType::Peak,
        };
        let mut packets = vec![
            (
                protocol.read_filter_request(0, 0),
                vec![0x80, 0x09, 2, 0x00, 0],
            ),
            (protocol.read_global_gain_request(), vec![0x80, 0x23, 0]),
        ];
        packets.extend(
            protocol
                .write_filter_packets(0, &filter, 96000.0, 0.0)
                .unwrap()
                .into_iter()
                .map(|packet| {
                    let prefix = packet.payload.clone();
                    (packet, prefix)
                }),
        );
        packets.push((
            protocol.write_global_gain_packets(-1.5).remove(0),
            vec![0x01, 0x23, 2, 0x80, 0xFE],
        ));
        packets.extend(protocol.commit_packets().into_iter().map(|packet| {
            let prefix = packet.payload.clone();
            (packet, prefix)
        }));
        packets.push((enable_all_bands(), vec![0x01, 0x0A, 4, 0, 0, 0xFF, 0xFF]));

        for (packet, prefix) in packets {
            let frame = packet.framed();
            assert_eq!(frame.len(), 64);
            assert_eq!(frame[0], 0x4B);
            assert_eq!(&frame[1..1 + prefix.len()], prefix);
            assert!(frame[1 + prefix.len()..].iter().all(|byte| *byte == 0));
        }
    }

    #[test]
    fn parses_filter_response() {
        let mut data = vec![0u8; 63];
        data[0] = 0x80;
        data[1] = 0x09;
        data[4] = 2;
        data[27..29].copy_from_slice(&1000u16.to_le_bytes());
        data[29..31].copy_from_slice(&256u16.to_le_bytes());
        data[31..33].copy_from_slice(&(-384i16).to_le_bytes());
        data[33] = 3;

        let filter = MoondropProtocol.parse_filter_response(&data).unwrap();

        assert_eq!(filter.index, 2);
        assert_eq!(filter.freq, 1000);
        assert_eq!(filter.gain, -1.5);
        assert_eq!(filter.q, 1.0);
        assert_eq!(filter.filter_type, FilterType::HighShelf);
    }

    #[test]
    fn filter_response_validity_accepts_peak_wire_code() {
        let mut data = vec![0u8; 63];
        data[0] = 0x80;
        data[1] = 0x09;
        data[4] = 0;
        data[27..29].copy_from_slice(&1000u16.to_le_bytes());
        data[29..31].copy_from_slice(&256u16.to_le_bytes());
        data[31..33].copy_from_slice(&0i16.to_le_bytes());
        data[33] = 2;
        assert!(MoondropProtocol.is_filter_response_valid(&data, 0, 0));
    }

    #[test]
    fn parses_invalid_filter_response_as_safe_default() {
        let mut data = vec![0u8; 63];
        data[0] = 0x80;
        data[1] = 0x09;
        data[4] = 2;
        data[27..29].copy_from_slice(&u16::MAX.to_le_bytes());
        data[29..31].copy_from_slice(&u16::MAX.to_le_bytes());
        data[31..33].copy_from_slice(&256i16.to_le_bytes());
        data[33] = 3;

        let filter = MoondropProtocol.parse_filter_response(&data).unwrap();

        assert_eq!(filter.index, 2);
        assert_eq!(filter.freq, 125);
        assert_eq!(filter.gain, 0.0);
        assert_eq!(filter.q, 0.75);
        assert_eq!(filter.filter_type, FilterType::Peak);
        assert!(!filter.enabled);
    }

    #[test]
    fn global_gain_parser_rejects_unmatched_frames() {
        assert_eq!(MoondropProtocol.parse_global_gain_response(&[0u8; 5]), None);
    }

    #[test]
    fn disabled_filter_writes_disabled_code_and_zero_coefficients() {
        let filter = Filter {
            index: 0,
            enabled: false,
            freq: 1000,
            gain: 6.0,
            q: 1.0,
            filter_type: FilterType::Peak,
        };

        let packet = MoondropProtocol
            .write_filter_packets(1, &filter, 96000.0, 0.0)
            .unwrap()
            .remove(0);

        assert_eq!(packet.payload[7..27], [0; 20]);
        assert_eq!(packet.payload[33], 0);
        assert_eq!(
            i16::from_le_bytes([packet.payload[31], packet.payload[32]]),
            0
        );
    }

    #[test]
    fn last_band_writes_filter_and_all_band_latch() {
        let filter = Filter {
            index: 0,
            enabled: true,
            freq: 1000,
            gain: 1.5,
            q: 0.75,
            filter_type: FilterType::Peak,
        };

        let packets = MoondropProtocol
            .write_filter_packets(7, &filter, 96000.0, 0.0)
            .unwrap();

        assert_eq!(packets.len(), 2);
        assert_eq!(packets[0].report_id, 0x4B);
        assert_eq!(packets[0].payload[1], 0x09);
        assert_eq!(packets[0].payload[33], 2);
        assert_eq!(packets[1].payload[1], 0x0A);
        assert_eq!(&packets[1].payload, &[0x01, 0x0A, 4, 0, 0, 0xFF, 0xFF]);
    }
}
