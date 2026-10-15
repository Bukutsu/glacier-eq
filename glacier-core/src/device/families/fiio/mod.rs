// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::device::packet::{checked_scaled_i16, checked_scaled_u16, Packet};
use crate::device::protocol::EqProtocol;
use crate::device::timing::WriteTiming;
use crate::eq::filter::DEFAULT_FREQS_10_BAND;
use crate::eq::{Filter, FilterType, PEQData};

mod models;
pub use models::{FIIO_PROTOCOL, JA11_PROTOCOL, KA17_PROTOCOL};

const SET_1: u8 = 0xAA;
const SET_2: u8 = 0x0A;
const RESPONSE_1: u8 = 0xBB;
const RESPONSE_2: u8 = 0x0B;
const END: u8 = 0xEE;
const FILTER_PARAMS: u8 = 0x15;
const GLOBAL_GAIN: u8 = 0x17;

#[derive(Clone, Copy)]
pub struct FiioProtocol {
    report_id: u8,
    filter_count: u8,
    user_slot: u8,
    clamp_gain: bool,
    gain_read_optional: bool,
    save_resets_device: bool,
}

fn default_state(peq: &PEQData) -> bool {
    peq.global_gain == 0.0 && peq.filters.iter().all(|f| !f.enabled || f.gain == 0.0)
}

fn read_filter_packet(index: u8, report_id: u8) -> Packet {
    Packet::new(
        report_id,
        vec![0xBB, 0x0B, 0, 0, FILTER_PARAMS, 1, index, 0, END],
    )
}

fn filter_type_from_fiio(code: u8) -> FilterType {
    match code {
        1 => FilterType::LowShelf,
        2 => FilterType::HighShelf,
        _ => FilterType::Peak,
    }
}

fn filter_type_to_fiio(filter_type: FilterType) -> u8 {
    match filter_type {
        FilterType::LowShelf => 1,
        FilterType::HighShelf => 2,
        _ => 0,
    }
}

fn matches_response(data: &[u8], command: u8, payload_len: u8) -> bool {
    let terminator = 7 + payload_len as usize;
    data.len() > terminator
        && data[..3] == [RESPONSE_1, RESPONSE_2, 0]
        // Byte 3 is a response counter on KA15, not a reserved zero byte.
        && data[4] == command
        && data[5] == payload_len
        // The byte before END is a device checksum (zero in requests).
        && data[terminator] == END
}

fn parse_filter_response(data: &[u8], filter_count: u8) -> Option<Filter> {
    if !matches_response(data, FILTER_PARAMS, 8) || data[6] >= filter_count || data[13] > 2 {
        return None;
    }

    let index = data[6];
    let gain_raw = i16::from_be_bytes([data[7], data[8]]);
    let raw_freq = u16::from_be_bytes([data[9], data[10]]);
    let raw_q = u16::from_be_bytes([data[11], data[12]]);
    let q = raw_q as f64 / 100.0;
    let invalid = raw_freq == 0
        || raw_freq == u16::MAX
        || raw_freq > 20000
        || raw_q == u16::MAX
        || !(q > 0.0 && q <= 10.0);
    let (freq, gain, q, filter_type, enabled) = if invalid {
        (
            DEFAULT_FREQS_10_BAND
                .get(index as usize)
                .copied()
                .unwrap_or(1000),
            0.0,
            1.0,
            FilterType::Peak,
            false,
        )
    } else {
        (
            raw_freq,
            gain_raw as f64 / 10.0,
            q,
            filter_type_from_fiio(data[13]),
            gain_raw != 0,
        )
    };

    Some(Filter {
        index,
        enabled,
        freq,
        gain,
        q,
        filter_type,
    })
}

fn write_filter_packet(report_id: u8, index: u8, filter: &Filter) -> Packet {
    let gain = if filter.enabled {
        (filter.gain * 10.0).round() as i16
    } else {
        0
    };
    let [gain_h, gain_l] = gain.to_be_bytes();
    let [freq_h, freq_l] = filter.freq.to_be_bytes();
    let q = (filter.q * 100.0).round() as u16;
    let [q_h, q_l] = q.to_be_bytes();
    Packet::new(
        report_id,
        vec![
            SET_1,
            SET_2,
            0,
            0,
            FILTER_PARAMS,
            8,
            index,
            gain_h,
            gain_l,
            freq_h,
            freq_l,
            q_h,
            q_l,
            filter_type_to_fiio(filter.filter_type),
            0,
            END,
        ],
    )
}

fn write_global_gain_packet(report_id: u8, global_gain: f64) -> Packet {
    // devicePEQ's captured general format is signed BE tenths of a dB.
    // JA11 negative preamp writes still require independent hardware verification.
    let [first, second] = ((global_gain * 10.0).round() as i16).to_be_bytes();
    Packet::new(
        report_id,
        vec![SET_1, SET_2, 0, 0, GLOBAL_GAIN, 2, first, second, 0, END],
    )
}

fn preset_packet(report_id: u8, command: u8, slot: u8) -> Packet {
    Packet::new(
        report_id,
        vec![SET_1, SET_2, 0, 0, command, 1, slot, 0, END],
    )
}

impl EqProtocol for FiioProtocol {
    fn write_timing(&self) -> WriteTiming {
        WriteTiming::default()
    }

    fn is_default_state(&self, peq: &PEQData) -> bool {
        default_state(peq)
    }

    fn init_packets(&self) -> Vec<Packet> {
        // Pull also runs initialization. Reading a read-only device must not
        // switch its active preset or otherwise change the audible state.
        vec![]
    }

    fn read_filter_request(&self, index: u8, _nonce: u8) -> Packet {
        read_filter_packet(index, self.report_id)
    }

    fn matches_filter_response(&self, data: &[u8], index: u8, _nonce: u8) -> bool {
        index < self.filter_count && matches_response(data, FILTER_PARAMS, 8) && data[6] == index
    }

    fn is_filter_packet_valid(&self, data: &[u8]) -> bool {
        let write = data.len() >= 16
            && data[..4] == [SET_1, SET_2, 0, 0]
            && data[4] == FILTER_PARAMS
            && data[5] == 8
            && data[15] == END;
        if !(matches_response(data, FILTER_PARAMS, 8) || write)
            || data[6] >= self.filter_count
            || data[13] > 2
        {
            return false;
        }
        let raw_freq = u16::from_be_bytes([data[9], data[10]]);
        let raw_q = u16::from_be_bytes([data[11], data[12]]);
        let q = raw_q as f64 / 100.0;
        raw_freq != 0
            && raw_freq != u16::MAX
            && raw_freq <= 20000
            && raw_q != u16::MAX
            && q > 0.0
            && q <= 10.0
    }

    fn is_filter_response_valid(&self, data: &[u8], index: u8, nonce: u8) -> bool {
        self.matches_filter_response(data, index, nonce) && self.is_filter_packet_valid(data)
    }

    fn parse_filter_response(&self, data: &[u8]) -> Option<Filter> {
        parse_filter_response(data, self.filter_count)
    }

    fn gain_read_optional(&self) -> bool {
        self.gain_read_optional
    }

    fn save_resets_device(&self) -> bool {
        self.save_resets_device
    }

    fn read_global_gain_request(&self) -> Packet {
        Packet::new(
            self.report_id,
            vec![0xBB, 0x0B, 0, 0, GLOBAL_GAIN, 0, 0, END],
        )
    }

    fn matches_global_gain_response(&self, data: &[u8]) -> bool {
        matches_response(data, GLOBAL_GAIN, 2)
    }

    fn parse_global_gain_response(&self, data: &[u8]) -> Option<f64> {
        if !self.matches_global_gain_response(data) {
            return None;
        }
        let bytes = [*data.get(6)?, *data.get(7)?];
        Some(i16::from_be_bytes(bytes) as f64 / 10.0)
    }

    fn write_filter_packets(
        &self,
        index: u8,
        filter: &Filter,
        _dsp_sample_rate: f64,
        _global_gain: f64,
    ) -> Result<Vec<Packet>, String> {
        if index >= self.filter_count || filter.index != index {
            return Err("Invalid FiiO filter index".into());
        }
        let gain = if filter.enabled { filter.gain } else { 0.0 };
        checked_scaled_i16(gain, 10.0, "FiiO band gain")?;
        checked_scaled_u16(filter.q, 100.0, "FiiO filter Q")?;
        if filter.enabled {
            let quantized = (filter.gain * 10.0).round() / 10.0;
            if (quantized - filter.gain).abs() > 1e-9 {
                return Err(format!(
                    "Band gain {:.3} dB is not representable at FiiO's 0.1 dB precision",
                    filter.gain
                ));
            }
        }
        let mut packets = Vec::new();
        if index == 0 {
            packets.push(preset_packet(self.report_id, 0x16, self.user_slot));
            packets.push(preset_packet(self.report_id, 0x18, self.filter_count));
        }
        packets.push(write_filter_packet(self.report_id, index, filter));
        Ok(packets)
    }

    fn write_global_gain_packets(&self, global_gain: f64) -> Vec<Packet> {
        let gain = if self.clamp_gain {
            global_gain.clamp(-12.0, 12.0)
        } else {
            global_gain
        };
        vec![write_global_gain_packet(self.report_id, gain)]
    }

    fn commit_packets(&self) -> Vec<Packet> {
        // 0x18 sets the filter count; persistence is 0x19 on all three models.
        vec![preset_packet(self.report_id, 0x19, self.user_slot)]
    }

    fn ram_apply_packets(&self) -> Vec<Packet> {
        // Filter writes take effect immediately; the save packet would persist
        // the change, which RAM apply must avoid.
        vec![]
    }

    fn report_id(&self) -> u8 {
        self.report_id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Capture {
        report_id: u8,
        filters: &'static [&'static [u8]],
        expected_filters: &'static [(u16, f64, f64, u8)],
        gain: &'static [u8],
        expected_gain: f64,
        preset: &'static [u8],
        count: &'static [u8],
        gain_write: &'static [u8],
        count_write: &'static [u8],
        save: &'static [u8],
    }

    const JA11_CAPTURE: Capture = include!("../../../../tests/fixtures/fiio/ja11.rs");
    const KA15_CAPTURE: Capture = include!("../../../../tests/fixtures/fiio/ka15.rs");
    const KA17_CAPTURE: Capture = include!("../../../../tests/fixtures/fiio/ka17.rs");

    fn captures() -> [(FiioProtocol, &'static Capture); 3] {
        [
            (JA11_PROTOCOL, &JA11_CAPTURE),
            (FIIO_PROTOCOL, &KA15_CAPTURE),
            (KA17_PROTOCOL, &KA17_CAPTURE),
        ]
    }

    #[test]
    fn parses_recorded_model_replies() {
        for (protocol, capture) in captures() {
            assert_eq!(protocol.report_id(), capture.report_id);
            for (index, (data, expected)) in capture
                .filters
                .iter()
                .zip(capture.expected_filters)
                .enumerate()
            {
                assert!(protocol.is_filter_response_valid(data, index as u8, 0));
                let filter = protocol.parse_filter_response(data).unwrap();
                assert_eq!(filter.index, index as u8);
                assert_eq!(filter.freq, expected.0);
                assert_eq!(filter.gain, expected.1);
                assert_eq!(filter.q, expected.2);
                assert_eq!(filter.filter_type, filter_type_from_fiio(expected.3));
                assert_eq!(filter.enabled, expected.1 != 0.0);
            }
            assert!(protocol.matches_global_gain_response(capture.gain));
            assert_eq!(
                protocol.parse_global_gain_response(capture.gain),
                Some(capture.expected_gain)
            );
        }
        assert_eq!(KA15_CAPTURE.filters[0][3], 0x43);
        assert_eq!(
            KA17_PROTOCOL.parse_global_gain_response(KA17_CAPTURE.gain),
            Some(-0.4)
        );
    }

    #[test]
    fn model_init_and_save_use_captured_user_slots() {
        for (protocol, capture) in captures() {
            assert!(matches_response(capture.preset, 0x16, 1));
            assert!(matches_response(capture.count, 0x18, 1));
            assert_eq!(capture.count[6], protocol.filter_count);
            assert_eq!(capture.count_write[4], 0x18);
            assert_eq!(capture.count_write[6], protocol.filter_count);
            assert!(protocol.init_packets().is_empty());
            let filter = Filter {
                index: 0,
                enabled: true,
                freq: 1000,
                gain: 0.0,
                q: 1.0,
                filter_type: FilterType::Peak,
            };
            let writes = protocol
                .write_filter_packets(0, &filter, 48000.0, 0.0)
                .unwrap();
            assert_eq!(writes[0].report_id, capture.report_id);
            assert_eq!(writes[0].payload[4], 0x16);
            assert_eq!(writes[0].payload[6], capture.preset[6]);
            assert_eq!(writes[1].payload, capture.count_write);
            assert!(protocol.is_filter_packet_valid(&writes[2].payload));
            let commit = protocol.commit_packets();
            assert_eq!(commit.len(), 1);
            assert_eq!(commit[0].report_id, capture.report_id);
            assert_eq!(commit[0].payload, capture.save);
            assert_eq!(commit[0].payload[6], capture.preset[6]);
            assert!(protocol.ram_apply_packets().is_empty());
        }
    }

    #[test]
    fn read_requests_include_checksum_placeholder() {
        for (protocol, _) in captures() {
            let packet = protocol.read_filter_request(3, 0);
            assert_eq!(packet.report_id, protocol.report_id());
            assert_eq!(packet.payload, [0xBB, 0x0B, 0, 0, 0x15, 1, 3, 0, END]);
            assert_eq!(
                protocol.read_global_gain_request().payload,
                [0xBB, 0x0B, 0, 0, GLOBAL_GAIN, 0, 0, END]
            );
        }
    }

    #[test]
    fn read_matchers_reject_write_echoes_and_other_commands() {
        for (protocol, capture) in captures() {
            let filter = Filter::enabled(3, true);
            let filter_echo = write_filter_packet(protocol.report_id(), 3, &filter).payload;
            assert!(!protocol.matches_filter_response(&filter_echo, 3, 0));
            assert_eq!(protocol.parse_filter_response(&filter_echo), None);
            assert!(!protocol.matches_global_gain_response(capture.gain_write));
            assert_eq!(
                protocol.parse_global_gain_response(capture.gain_write),
                None
            );
            for other in [capture.preset, capture.count, capture.gain] {
                assert!(!protocol.matches_filter_response(other, 0, 0));
                assert_eq!(protocol.parse_filter_response(other), None);
            }
            for other in [capture.preset, capture.count, capture.filters[0]] {
                assert!(!protocol.matches_global_gain_response(other));
                assert_eq!(protocol.parse_global_gain_response(other), None);
            }
        }
    }

    #[test]
    fn read_matchers_require_complete_response_frames() {
        for (protocol, capture) in captures() {
            let filter = capture.filters[0];
            for length in 0..16 {
                assert!(!protocol.matches_filter_response(&filter[..length], 0, 0));
                assert_eq!(protocol.parse_filter_response(&filter[..length]), None);
            }
            for length in 0..10 {
                assert!(!protocol.matches_global_gain_response(&capture.gain[..length]));
                assert_eq!(
                    protocol.parse_global_gain_response(&capture.gain[..length]),
                    None
                );
            }
            assert!(protocol.matches_filter_response(&filter[..16], 0, 0));
            assert!(protocol.matches_global_gain_response(&capture.gain[..10]));
            assert!(!protocol.matches_filter_response(filter, 1, 0));
            for offset in [0, 1, 2, 4, 5, 15] {
                let mut invalid = filter.to_vec();
                invalid[offset] ^= 0xFF;
                assert!(!protocol.matches_filter_response(&invalid, 0, 0));
                assert_eq!(protocol.parse_filter_response(&invalid), None);
            }
            for offset in [0, 1, 2, 4, 5, 9] {
                let mut invalid = capture.gain.to_vec();
                invalid[offset] ^= 0xFF;
                assert!(!protocol.matches_global_gain_response(&invalid));
                assert_eq!(protocol.parse_global_gain_response(&invalid), None);
            }
            let mut invalid_index = filter.to_vec();
            invalid_index[6] = protocol.filter_count;
            assert!(!protocol.matches_filter_response(&invalid_index, protocol.filter_count, 0));
            assert_eq!(protocol.parse_filter_response(&invalid_index), None);
            let mut invalid_type = filter.to_vec();
            invalid_type[13] = 0xFF;
            assert!(!protocol.is_filter_packet_valid(&invalid_type));
            assert_eq!(protocol.parse_filter_response(&invalid_type), None);
        }
    }

    #[test]
    fn parses_invalid_filter_parameters_as_safe_default() {
        // Retain legacy sanitization only for a structurally valid, correlated reply.
        let mut data = JA11_CAPTURE.filters[3].to_vec();
        data[9..11].copy_from_slice(&u16::MAX.to_be_bytes());
        data[11..13].copy_from_slice(&u16::MAX.to_be_bytes());
        assert!(JA11_PROTOCOL.matches_filter_response(&data, 3, 0));
        assert!(!JA11_PROTOCOL.is_filter_response_valid(&data, 3, 0));
        let filter = JA11_PROTOCOL.parse_filter_response(&data).unwrap();
        assert_eq!(filter.index, 3);
        assert_eq!(filter.freq, 250);
        assert_eq!(filter.gain, 0.0);
        assert_eq!(filter.q, 1.0);
        assert_eq!(filter.filter_type, FilterType::Peak);
        assert!(!filter.enabled);
    }

    #[test]
    fn writes_captured_positive_global_gain_and_signed_negative_tenths() {
        for (protocol, capture) in captures() {
            let gain =
                i16::from_be_bytes([capture.gain_write[6], capture.gain_write[7]]) as f64 / 10.0;
            let packet = protocol.write_global_gain_packets(gain).remove(0);
            assert_eq!(packet.report_id, capture.report_id);
            assert_eq!(packet.payload, capture.gain_write);
            for gain in [-12.0, -1.5, -0.4, -0.1, 0.0, 1.0, 12.0] {
                let packet = protocol.write_global_gain_packets(gain).remove(0);
                assert_eq!(&packet.payload[6..8], &((gain * 10.0) as i16).to_be_bytes());
                let mut reply = capture.gain.to_vec();
                reply[6..8].copy_from_slice(&packet.payload[6..8]);
                assert_eq!(protocol.parse_global_gain_response(&reply), Some(gain));
            }
        }
        // Explicitly distinguish signed BE*10 from the old JA11 LE*2560 encoding.
        assert_eq!(
            &JA11_PROTOCOL.write_global_gain_packets(-1.0)[0].payload[6..8],
            &[0xFF, 0xF6]
        );
    }

    #[test]
    fn writes_reject_invalid_band_indices() {
        for (protocol, _) in captures() {
            let filter = Filter::enabled(0, true);
            assert!(protocol
                .write_filter_packets(1, &filter, 48000.0, 0.0)
                .is_err());
            let filter = Filter::enabled(protocol.filter_count, true);
            assert!(protocol
                .write_filter_packets(protocol.filter_count, &filter, 48000.0, 0.0)
                .is_err());
        }
    }
}
