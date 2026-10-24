// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! FiiO protocol credits (independent implementation from protocol evidence):
//! - jeromeof/devicePEQ: FiiO packet fixtures and active USER preset slots.
//!   https://github.com/jeromeof/devicePEQ
//! - weekssa/OPRA-EQ-for-UAPP: docs/FIIO_JA11_PROTOCOL_NOTES.md and
//!   domain/kt02h20/FiioJa11Protocol.kt / FiioJa11Timing.kt, for signed
//!   big-endian tenths-dB gain, JA11 Apply/Save ordering and pacing.
//!   https://github.com/weekssa/OPRA-EQ-for-UAPP
//! - Ircama/ja11-config: JA11 Apply after data and Save as the final command.
//!   https://github.com/Ircama/ja11-config
//! - Cyfine/ja11-web-control: JA11 pacing and state-control protocol;
//!   exact state-control source revision is credited in the JA11 codec.
//!   https://github.com/Cyfine/ja11-web-control
//!
//! - FiiO Control Web (https://fiiocontrol.fiio.com/, bundle index-7hb30NUo.js):
//!   SNOWSKY Melody preset ids, command codes and byte layout; a live
//!   Melody capture shows what the hardware accepts (zero sequence/checksum).
//!
//! Sources differ on some fields; only the specific evidence above is used.

use crate::device::packet::{checked_scaled_i16, checked_scaled_u16, Packet};
use crate::device::protocol::{EqProtocol, GainEncoding, Quirks};
use crate::device::timing::WriteTiming;
use crate::eq::filter::DEFAULT_FREQS_10_BAND;
use crate::eq::{Filter, FilterType, PEQData};

pub mod ja11;
pub mod melody;
mod models;
pub mod registry;
pub use models::{JA11, KA17, KA_SERIES, MELODY};
#[cfg(test)]
use models::{JA11_EQ, KA17_EQ, KA_SERIES_EQ, MELODY_EQ};

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
    verify_filter_count: bool,
    user_slot: u8,
    user_slots: &'static [u8],
    /// Grid requested preamps snap to; 0.1 dB except where firmware keeps whole dB.
    preamp_step_db: f64,
    clamp_gain: bool,
    command_interval_ms: Option<u64>,
    sends_filter_count: bool,
    apply_after_write: bool,
    quirks: Quirks,
}

fn default_state(peq: &PEQData) -> bool {
    peq.global_gain == 0.0
        && peq.filters.iter().all(|f| {
            !f.enabled
                || (f.gain == 0.0
                    && !matches!(f.filter_type, FilterType::HighPass | FilterType::LowPass))
        })
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
        4 => FilterType::LowPass,
        5 => FilterType::HighPass,
        _ => FilterType::Peak,
    }
}

fn filter_type_to_fiio(filter_type: FilterType) -> u8 {
    match filter_type {
        FilterType::LowShelf => 1,
        FilterType::HighShelf => 2,
        FilterType::LowPass => 4,
        FilterType::HighPass => 5,
        FilterType::Peak => 0,
    }
}

fn matches_response(data: &[u8], command: u8, payload_len: u8) -> bool {
    let terminator = 7 + payload_len as usize;
    data.len() > terminator
        && data[..2] == [RESPONSE_1, RESPONSE_2]
        // Bytes 2..4 are the firmware's 16-bit response counter, not zeros.
        // sakana2.txt crosses 00 ff -> 01 00 without a USB disconnect.
        && data[4] == command
        && data[5] == payload_len
        // The byte before END is a device checksum (zero in requests).
        && data[terminator] == END
}

pub(crate) fn parse_eq_switch_response(data: &[u8]) -> Option<bool> {
    matches_response(data, 0x1a, 1).then(|| data[6] != 0)
}

pub(crate) fn parse_preset_response(data: &[u8]) -> Option<u8> {
    matches_response(data, 0x16, 1).then(|| data[6])
}

fn parse_filter_response(data: &[u8], filter_count: u8) -> Option<Filter> {
    if !matches_response(data, FILTER_PARAMS, 8)
        || data[6] >= filter_count
        || !matches!(data[13], 0..=2 | 4 | 5)
    {
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
            gain_raw != 0 || matches!(data[13], 4 | 5),
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
            filter_type_to_fiio(if filter.enabled {
                filter.filter_type
            } else {
                FilterType::Peak
            }),
            0,
            END,
        ],
    )
}

fn write_global_gain_packet(report_id: u8, global_gain: f64) -> Packet {
    // Signed BE tenths of a dB: devicePEQ captures and FiiO Control's JA11
    // codec per weekssa/OPRA-EQ-for-UAPP (-3.9 dB is FF D9).
    let [first, second] = ((global_gain * 10.0).round() as i16).to_be_bytes();
    Packet::new(
        report_id,
        vec![SET_1, SET_2, 0, 0, GLOBAL_GAIN, 2, first, second, 0, END],
    )
}

pub(crate) fn preset_packet(report_id: u8, command: u8, slot: u8) -> Packet {
    Packet::new(
        report_id,
        vec![SET_1, SET_2, 0, 0, command, 1, slot, 0, END],
    )
}

impl EqProtocol for FiioProtocol {
    fn q_step(&self) -> Option<f64> {
        Some(0.01)
    }

    fn gain_encoding(&self) -> GainEncoding {
        // Signed big-endian tenths of a dB. The band encoder rejects values
        // off that grid, so normalization snaps to it first.
        GainEncoding {
            band_units_per_db: 10.0,
            band_step_db: Some(0.1),
            band_readback_per_db: 10.0,
            preamp_step_db: self.preamp_step_db,
        }
    }

    fn write_timing(&self) -> WriteTiming {
        match self.command_interval_ms {
            None => WriteTiming::default(),
            // Cyfine/ja11-web-control PROTOCOL.md and weekssa/OPRA-EQ-for-UAPP
            // FiioJa11Timing.kt: 200 ms commands, 500 ms initial settle.
            Some(ms) => WriteTiming {
                per_filter_ms: ms,
                batch_ms: ms,
                global_gain_ms: ms,
                commit_step_ms: ms,
                flood_delay_ms: ms,
                post_gain_read_ms: ms,
                init_ms: 500,
                packet_gap_ms: ms,
            },
        }
    }

    fn is_default_state(&self, peq: &PEQData) -> bool {
        default_state(peq)
    }

    fn init_packets(&self) -> Vec<Packet> {
        // Pull also runs initialization. Reading a read-only device must not
        // switch its active preset or otherwise change the audible state.
        vec![]
    }

    fn write_target_preset(&self) -> Option<u8> {
        self.verify_filter_count.then_some(self.user_slot)
    }

    fn user_eq_slots(&self) -> &'static [u8] {
        self.user_slots
    }

    fn read_filter_count_request(&self) -> Option<Packet> {
        self.verify_filter_count
            .then(|| Packet::new(self.report_id, vec![0xbb, 0x0b, 0, 0, 0x18, 0, 0, END]))
    }
    fn parse_filter_count_response(&self, data: &[u8]) -> Option<usize> {
        matches_response(data, 0x18, 1).then(|| data[6] as usize)
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
            || !matches!(data[13], 0..=2 | 4 | 5)
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

    fn quirks(&self) -> Quirks {
        self.quirks
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
            if self.sends_filter_count {
                packets.push(preset_packet(self.report_id, 0x18, self.filter_count));
            }
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
        let mut packets = vec![write_global_gain_packet(self.report_id, gain)];
        if self.apply_after_write {
            packets.push(preset_packet(self.report_id, 0x18, 1));
        }
        packets
    }

    fn commit_packets(&self) -> Vec<Packet> {
        // Persistence is 0x19 on all three models. JA11 uses 0x18 = 1 Apply
        // after preamp, never a count before bands (FiiO Control / Ircama).
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
mod registry_tests;

#[cfg(test)]
pub(crate) mod sakana2 {
    include!("../../../../tests/fixtures/fiio/melody_sakana2.rs");
}

#[cfg(test)]
pub(crate) mod sakana3 {
    include!("../../../../tests/fixtures/fiio/melody_sakana3.rs");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_canonical_model_and_writable_q_grid() {
        for protocol in [JA11_EQ, KA17_EQ, KA_SERIES_EQ] {
            assert_eq!(
                protocol.response_model(),
                crate::eq::iir_math::EqResponseModel::CanonicalQ
            );
            assert_eq!(protocol.q_step(), Some(0.01));
        }
    }

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
            (JA11_EQ, &JA11_CAPTURE),
            (KA_SERIES_EQ, &KA15_CAPTURE),
            (KA17_EQ, &KA17_CAPTURE),
        ]
    }

    #[test]
    fn model_protocols_wrap_their_model_constants() {
        for (protocol, id, report_id) in [
            (&JA11, "FiiO JA11", 2),
            (&KA_SERIES, "FiiO", 7),
            (&KA17, "FiiO KA17", 1),
        ] {
            assert_eq!(protocol.id, id);
            assert_eq!(protocol.eq.unwrap().report_id(), report_id, "{id}");
        }
    }

    #[test]
    fn only_ja11_has_quirks() {
        let quirks = JA11_EQ.quirks();
        assert!(quirks.save_resets_device);
        for protocol in [KA_SERIES_EQ, KA17_EQ] {
            let quirks = protocol.quirks();
            assert!(!quirks.save_resets_device);
        }
        // The frame web.ts must send last on JA11 (report ID 2).
        assert_eq!(
            JA11_EQ.commit_packets()[0].framed(),
            [2, 0xAA, 0x0A, 0x00, 0x00, 0x19, 0x01, 0x03, 0x00, 0xEE]
        );
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
            KA17_EQ.parse_global_gain_response(KA17_CAPTURE.gain),
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
            if protocol.sends_filter_count {
                assert_eq!(writes[1].payload, capture.count_write);
            }
            assert!(protocol.is_filter_packet_valid(&writes.last().unwrap().payload));
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
            for offset in [0, 1, 4, 5, 15] {
                let mut invalid = filter.to_vec();
                invalid[offset] ^= 0xFF;
                assert!(!protocol.matches_filter_response(&invalid, 0, 0));
                assert_eq!(protocol.parse_filter_response(&invalid), None);
            }
            for offset in [0, 1, 4, 5, 9] {
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
        assert!(JA11_EQ.matches_filter_response(&data, 3, 0));
        assert!(!JA11_EQ.is_filter_response_valid(&data, 3, 0));
        let filter = JA11_EQ.parse_filter_response(&data).unwrap();
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
            &JA11_EQ.write_global_gain_packets(-1.0)[0].payload[6..8],
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

    // Frames below were captured from a SNOWSKY Melody (2972:0126) by Glacier's
    // WebHID diagnostics. The leading report ID 7 is stripped; replies end at END.
    fn hex(frame: &str) -> Vec<u8> {
        frame
            .split_whitespace()
            .map(|byte| u8::from_str_radix(byte, 16).unwrap())
            .collect()
    }

    const MELODY_READS: [(&str, u16, f64, f64, u8); 10] = [
        (
            "bb 0b 00 11 15 08 00 00 30 00 25 00 3c 01 b6 ee",
            37,
            4.8,
            0.60,
            1,
        ),
        (
            "bb 0b 00 12 15 08 01 ff fc 00 69 00 be 00 65 ee",
            105,
            -0.4,
            1.90,
            0,
        ),
        (
            "bb 0b 00 13 15 08 02 ff eb 00 c8 00 50 00 24 ee",
            200,
            -2.1,
            0.80,
            0,
        ),
        (
            "bb 0b 00 14 15 08 03 00 0b 02 aa 00 78 00 f2 ee",
            682,
            1.1,
            1.20,
            0,
        ),
        (
            "bb 0b 00 15 15 08 04 ff e3 07 3b 00 5a 00 95 ee",
            1851,
            -2.9,
            0.90,
            0,
        ),
        (
            "bb 0b 00 16 15 08 05 ff f5 08 83 00 b4 00 12 ee",
            2179,
            -1.1,
            1.80,
            0,
        ),
        (
            "bb 0b 00 17 15 08 06 00 24 0d 29 00 c8 00 6c ee",
            3369,
            3.6,
            2.00,
            0,
        ),
        (
            "bb 0b 00 18 15 08 07 ff f5 13 40 01 c5 00 c2 ee",
            4928,
            -1.1,
            4.53,
            0,
        ),
        (
            "bb 0b 00 19 15 08 08 00 35 17 d6 00 64 00 02 ee",
            6102,
            5.3,
            1.00,
            0,
        ),
        (
            "bb 0b 00 1a 15 08 09 ff e1 25 3e 00 3c 02 d6 ee",
            9534,
            -3.1,
            0.60,
            2,
        ),
    ];

    #[test]
    fn melody_accepts_live_replies_across_the_16_bit_counter_rollover() {
        for (data, index, freq) in [
            (sakana2::FILTER_BEFORE, 3, 250),
            (sakana2::FILTER_AFTER, 6, 2000),
        ] {
            assert!(MELODY_EQ.matches_filter_response(data, index, 0));
            assert_eq!(MELODY_EQ.parse_filter_response(data).unwrap().freq, freq);
        }
        assert_eq!(
            MELODY_EQ.parse_global_gain_response(sakana2::GAIN),
            Some(0.0)
        );
        // Both bytes belong to firmware, not the request's correlation nonce.
        for (protocol, capture) in captures() {
            for counter in [0x00ff_u16, 0x0100, 0x1234, 0xffff, 0x0000] {
                let mut gain = capture.gain.to_vec();
                gain[2..4].copy_from_slice(&counter.to_be_bytes());
                assert_eq!(
                    protocol.parse_global_gain_response(&gain),
                    Some(capture.expected_gain)
                );
            }
        }
    }

    #[test]
    fn melody_reads_match_live_capture() {
        for (index, (frame, freq, gain, q, kind)) in MELODY_READS.iter().enumerate() {
            let data = hex(frame);
            assert!(
                MELODY_EQ.is_filter_response_valid(&data, index as u8, 0),
                "{index}"
            );
            let filter = MELODY_EQ.parse_filter_response(&data).unwrap();
            assert_eq!(
                (filter.freq, filter.gain, filter.q, filter.filter_type),
                (*freq, *gain, *q, filter_type_from_fiio(*kind)),
                "{index}"
            );
        }
        let gain = hex("bb 0b 00 10 17 02 00 00 ba ee");
        assert_eq!(MELODY_EQ.parse_global_gain_response(&gain), Some(0.0));
    }

    #[test]
    fn melody_writes_reproduce_live_capture_frames() {
        // Band writes sent by Glacier to the Melody (tenths dB, centi-Q).
        let writes = [
            "aa 0a 00 00 15 08 00 00 0d 00 14 00 2a 00 00 ee",
            "aa 0a 00 00 15 08 03 ff f2 01 dd 00 7d 01 00 ee",
            "aa 0a 00 00 15 08 07 00 09 1f a2 01 2c 02 00 ee",
            "aa 0a 00 00 15 08 09 ff bb 33 5b 00 a0 00 00 ee",
        ];
        for frame in writes {
            let data = hex(frame);
            assert!(MELODY_EQ.is_filter_packet_valid(&data));
            let filter = Filter {
                index: data[6],
                enabled: true,
                freq: u16::from_be_bytes([data[9], data[10]]),
                gain: i16::from_be_bytes([data[7], data[8]]) as f64 / 10.0,
                q: u16::from_be_bytes([data[11], data[12]]) as f64 / 100.0,
                filter_type: filter_type_from_fiio(data[13]),
            };
            let packet = MELODY_EQ
                .write_filter_packets(filter.index, &filter, 48000.0, 0.0)
                .unwrap()
                .pop()
                .unwrap();
            assert_eq!(packet.report_id, 7);
            assert_eq!(packet.payload, data);
        }
    }

    #[test]
    fn melody_uses_official_user_slot_and_whole_db_preamp() {
        // FiiO Control Web: USER1 = 160 (0xA0); select, write bands, save.
        let filter = Filter::enabled(0, true);
        let first = MELODY_EQ
            .write_filter_packets(0, &filter, 48000.0, 0.0)
            .unwrap();
        assert_eq!(first.len(), 2, "no band-count write before the first band");
        assert_eq!(first[0].payload, hex("aa 0a 00 00 16 01 a0 00 ee"));
        assert_eq!(
            MELODY_EQ.commit_packets()[0].payload,
            hex("aa 0a 00 00 19 01 a0 00 ee")
        );
        assert_eq!(
            MELODY_EQ.write_global_gain_packets(-10.0)[0].payload,
            hex("aa 0a 00 00 17 02 ff 9c 00 ee")
        );
        // The Melody read -9.9 dB back as -9.0 dB, so the grid is whole dB.
        assert_eq!(MELODY_EQ.gain_encoding().preamp_step_db, 1.0);
        assert_eq!(MELODY.id, "SNOWSKY Melody");
        assert!(!MELODY_EQ.quirks().save_resets_device);
    }
}
