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
