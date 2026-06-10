// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

//! Minimal Walkplay-family write path ported from Frost-Tune.
//!
//! The old app uses the same packet sequence for EPZ TP35 Pro, Moondrop Dawn Pro,
//! and Truthear KEYX: write all PEQ bands into volatile memory, write global gain,
//! then send the two-step flash commit sequence.

use glacier_core::eq::iir_math::compute_biquad_coeffs;
use glacier_core::eq::{Filter, FilterType, PEQData};

const DEFAULT_FREQS_10_BAND: [u16; 10] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

pub const REPORT_ID: u8 = 0x4B;

const CMD_FLASH_EQ: u8 = 0x01;
const CMD_GLOBAL_GAIN: u8 = 0x03;
const CMD_PEQ_VALUES: u8 = 0x09;
const CMD_TEMP_WRITE: u8 = 0x0A;
const CMD_VERSION: u8 = 0x0C;

const READ: u8 = 0x80;
const WRITE: u8 = 0x01;
const END: u8 = 0x00;

const CONST_TEMP_WRITE_MAGIC_A: u8 = 0xFF;
const CONST_TEMP_WRITE_MAGIC_B: u8 = 0xFF;
const CONST_PEQ_PAYLOAD_LEN: u8 = 0x18;
const CONST_GLOBAL_GAIN_LEN: u8 = 0x02;
const CONST_TEMP_WRITE_LEN: u8 = 0x04;
const CONST_FLASH_EQ_LEN: u8 = 0x01;

const FILTER_SLOT: u8 = 101;
const QUANTIZER_SCALE: f64 = 1_073_741_824.0;
const BYTE_BIT_SHIFT: i32 = 8;

const OFFSET_CMD_TYPE: usize = 0;
const OFFSET_CMD: usize = 1;
const OFFSET_NONCE: usize = 2;
const OFFSET_INDEX: usize = 4;
const OFFSET_FREQ_L: usize = 27;
const OFFSET_FREQ_H: usize = 28;
const OFFSET_Q_L: usize = 29;
const OFFSET_Q_H: usize = 30;
const OFFSET_GAIN_L: usize = 31;
const OFFSET_GAIN_H: usize = 32;
const OFFSET_FILTER_TYPE: usize = 33;
const OFFSET_GAIN_VALUE: usize = 4;

const FILTER_RESPONSE_MIN_LEN: usize = 34;
const GLOBAL_GAIN_RESPONSE_MIN_LEN: usize = 6;

#[derive(Debug, Clone, Copy)]
pub struct RuntimeCaps {
    pub num_bands: usize,
    pub global_gain_range: (i8, i8),
    pub band_gain_range: (f64, f64),
    pub freq_range: (u16, u16),
    pub q_range: (f64, f64),
    pub supports_low_high_pass: bool,
    pub supports_per_band_enable: bool,
    pub dsp_sample_rate: f64,
}

pub fn runtime_caps(vendor_id: u16, product_id: u16) -> Option<RuntimeCaps> {
    match (vendor_id, product_id) {
        // EPZ TP35 Pro
        (0x3302, 0x43E6) => Some(RuntimeCaps {
            num_bands: 10,
            global_gain_range: (-16, 6),
            band_gain_range: (-10.0, 10.0),
            freq_range: (20, 20000),
            q_range: (0.1, 10.0),
            supports_low_high_pass: true,
            supports_per_band_enable: false,
            dsp_sample_rate: 96000.0,
        }),
        // Moondrop Dawn Pro / Truthear KEYX
        (0x2FC6, 0xDF30) | (0x0D8C, 0x0210) => Some(RuntimeCaps {
            num_bands: 8,
            global_gain_range: (-20, 0),
            band_gain_range: (-12.0, 12.0),
            freq_range: (20, 20000),
            q_range: (0.1, 10.0),
            supports_low_high_pass: false,
            supports_per_band_enable: false,
            dsp_sample_rate: 96000.0,
        }),
        _ => None,
    }
}

pub fn init_packets() -> Vec<Vec<u8>> {
    vec![vec![READ, CMD_VERSION, END]]
}

pub fn filter_read_request(index: u8, nonce: u8) -> Vec<u8> {
    vec![READ, CMD_PEQ_VALUES, nonce, 0x00, index, END]
}

pub fn global_gain_request() -> Vec<u8> {
    vec![READ, CMD_GLOBAL_GAIN, 0x00, END]
}

pub fn commit_packets() -> Vec<Vec<u8>> {
    vec![
        vec![
            WRITE,
            CMD_TEMP_WRITE,
            CONST_TEMP_WRITE_LEN,
            0x00,
            0x00,
            CONST_TEMP_WRITE_MAGIC_A,
            CONST_TEMP_WRITE_MAGIC_B,
            END,
        ],
        vec![WRITE, CMD_FLASH_EQ, CONST_FLASH_EQ_LEN, FILTER_SLOT, END],
    ]
}

pub fn global_gain_write_packet(gain: i8) -> Vec<u8> {
    vec![
        WRITE,
        CMD_GLOBAL_GAIN,
        CONST_GLOBAL_GAIN_LEN,
        0x00,
        gain as u8,
        END,
    ]
}

pub fn frame_packet(payload: &[u8]) -> Vec<u8> {
    let mut buf = vec![0u8; 65];
    buf[0] = REPORT_ID;
    let len = payload.len().min(64);
    buf[1..1 + len].copy_from_slice(&payload[..len]);
    buf
}

pub fn unframe_packet(framed: &[u8]) -> &[u8] {
    if framed.first().copied() == Some(REPORT_ID) {
        &framed[1..]
    } else {
        framed
    }
}

pub fn matches_filter_response(data: &[u8], index: u8, nonce: u8) -> bool {
    data.len() >= FILTER_RESPONSE_MIN_LEN
        && data[OFFSET_CMD_TYPE] == READ
        && data[OFFSET_CMD] == CMD_PEQ_VALUES
        && data[OFFSET_NONCE] == nonce
        && data[OFFSET_INDEX] == index
}

pub fn parse_filter_response(data: &[u8]) -> Option<Filter> {
    if data.len() < FILTER_RESPONSE_MIN_LEN {
        return None;
    }

    let filter_index = data[OFFSET_INDEX];
    let freq = (data[OFFSET_FREQ_L] as u16) | ((data[OFFSET_FREQ_H] as u16) << BYTE_BIT_SHIFT);
    let q_raw = (data[OFFSET_Q_L] as u16) | ((data[OFFSET_Q_H] as u16) << BYTE_BIT_SHIFT);
    let gain_raw = (data[OFFSET_GAIN_L] as u16) | ((data[OFFSET_GAIN_H] as u16) << BYTE_BIT_SHIFT);

    let gain_i16 = if gain_raw > 32767 {
        (gain_raw as i32 - 65536) as i16
    } else {
        gain_raw as i16
    };

    let q = (((q_raw as f64) / 256.0 * 100.0).round() / 100.0).max(0.01);
    let gain = ((gain_i16 as f64) / 256.0 * 100.0).round() / 100.0;
    let filter_type = FilterType::from(data[OFFSET_FILTER_TYPE]);
    let enabled = !(freq == 0 && gain_i16 == 0);

    Some(Filter {
        index: filter_index,
        enabled,
        freq,
        gain,
        q,
        filter_type,
    })
}

pub fn matches_global_gain_response(data: &[u8]) -> bool {
    data.len() >= GLOBAL_GAIN_RESPONSE_MIN_LEN
        && data[OFFSET_CMD_TYPE] == READ
        && data[OFFSET_CMD] == CMD_GLOBAL_GAIN
}

pub fn parse_global_gain_response(data: &[u8]) -> Option<i8> {
    (data.len() > OFFSET_GAIN_VALUE).then_some(data[OFFSET_GAIN_VALUE] as i8)
}

pub fn is_default_state(peq: &PEQData) -> bool {
    let all_disabled = peq.filters.iter().all(|f| !f.enabled);
    let has_default_gain = peq.global_gain == 0;
    let all_default_freq = peq.filters.iter().all(|f| f.freq == 100);
    all_disabled && has_default_gain && all_default_freq
}

pub fn normalize_for_push(mut peq: PEQData, caps: RuntimeCaps) -> PEQData {
    if peq.filters.len() > caps.num_bands {
        peq.filters.truncate(caps.num_bands);
    }

    while peq.filters.len() < caps.num_bands {
        let index = peq.filters.len();
        peq.filters.push(Filter {
            index: index as u8,
            enabled: false,
            filter_type: FilterType::Peak,
            freq: DEFAULT_FREQS_10_BAND.get(index).copied().unwrap_or(1000),
            gain: 0.0,
            q: 1.0,
        });
    }

    peq.global_gain = peq
        .global_gain
        .clamp(caps.global_gain_range.0, caps.global_gain_range.1);

    for (index, filter) in peq.filters.iter_mut().enumerate() {
        filter.index = index as u8;
        filter.freq = filter.freq.clamp(caps.freq_range.0, caps.freq_range.1);
        filter.gain = filter
            .gain
            .clamp(caps.band_gain_range.0, caps.band_gain_range.1);
        filter.q = filter.q.clamp(caps.q_range.0, caps.q_range.1);

        if !caps.supports_low_high_pass
            && matches!(
                filter.filter_type,
                FilterType::HighPass | FilterType::LowPass
            )
        {
            filter.filter_type = FilterType::Peak;
        }

        if !caps.supports_per_band_enable && !filter.enabled {
            // Walkplay devices do not expose a true per-band enable flag. Frost-Tune
            // represents disabled bands as zero-gain filters before writing.
            filter.gain = 0.0;
        }
    }

    peq
}

pub fn filter_write_packet(index: u8, filter: &Filter, dsp_sample_rate: f64) -> Vec<u8> {
    let b_arr = compute_iir_filter(filter, dsp_sample_rate);
    let filter_type_byte: u8 = filter.filter_type.into();

    let mut packet = Vec::with_capacity(37);
    packet.extend_from_slice(&[
        WRITE,
        CMD_PEQ_VALUES,
        CONST_PEQ_PAYLOAD_LEN,
        0x00,
        index,
        0x00,
        0x00,
    ]);
    packet.extend_from_slice(&b_arr);
    packet.extend_from_slice(&convert_to_2byte_array(filter.freq as i32));
    packet.extend_from_slice(&convert_to_2byte_array((filter.q * 256.0).round() as i32));
    packet.extend_from_slice(&convert_to_2byte_array((filter.gain * 256.0).round() as i32));
    packet.extend_from_slice(&[filter_type_byte, 0x00, FILTER_SLOT, END]);

    packet
}

fn compute_iir_filter(filter: &Filter, dsp_sample_rate: f64) -> [u8; 20] {
    let (b0, b1, b2, a0, a1, a2) = compute_biquad_coeffs(filter, dsp_sample_rate);
    let quantized = quantizer(&[1.0, a1 / a0, a2 / a0], &[b0 / a0, b1 / a0, b2 / a0]);

    let mut bytes = [0u8; 20];
    for (i, &value) in quantized.iter().enumerate() {
        bytes[i * 4] = (value & 0xFF) as u8;
        bytes[i * 4 + 1] = ((value >> BYTE_BIT_SHIFT) & 0xFF) as u8;
        bytes[i * 4 + 2] = ((value >> (BYTE_BIT_SHIFT * 2)) & 0xFF) as u8;
        bytes[i * 4 + 3] = ((value >> (BYTE_BIT_SHIFT * 3)) & 0xFF) as u8;
    }
    bytes
}

fn quantizer(a: &[f64; 3], b: &[f64; 3]) -> [i32; 5] {
    let a_i = [
        clamp_i32(a[0] * QUANTIZER_SCALE),
        clamp_i32(a[1] * QUANTIZER_SCALE),
        clamp_i32(a[2] * QUANTIZER_SCALE),
    ];
    let b_i = [
        clamp_i32(b[0] * QUANTIZER_SCALE),
        clamp_i32(b[1] * QUANTIZER_SCALE),
        clamp_i32(b[2] * QUANTIZER_SCALE),
    ];
    [
        b_i[0],
        b_i[1],
        b_i[2],
        a_i[1].wrapping_neg(),
        a_i[2].wrapping_neg(),
    ]
}

fn clamp_i32(v: f64) -> i32 {
    if !v.is_finite() {
        return 0;
    }
    v.round().clamp(i32::MIN as f64, i32::MAX as f64) as i32
}

fn convert_to_2byte_array(value: i32) -> [u8; 2] {
    [
        (value & 0xFF) as u8,
        ((value >> BYTE_BIT_SHIFT) & 0xFF) as u8,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_packet_matches_frost_tune_shape() {
        let filter = Filter {
            index: 0,
            enabled: true,
            filter_type: FilterType::Peak,
            freq: 1000,
            gain: 5.0,
            q: 1.0,
        };
        let packet = filter_write_packet(0, &filter, 96000.0);
        assert_eq!(packet.len(), 37);
        assert_eq!(packet[0], WRITE);
        assert_eq!(packet[1], CMD_PEQ_VALUES);
        assert_eq!(packet[4], 0);
        assert_eq!(packet[35], FILTER_SLOT);
    }

    #[test]
    fn frame_is_hid_report_size() {
        let frame = frame_packet(&[1, 2, 3]);
        assert_eq!(frame.len(), 65);
        assert_eq!(frame[0], REPORT_ID);
        assert_eq!(&frame[1..4], &[1, 2, 3]);
    }

    #[test]
    fn parse_filter_response_accepts_valid_shape() {
        let mut data = vec![0u8; FILTER_RESPONSE_MIN_LEN];
        data[OFFSET_CMD_TYPE] = READ;
        data[OFFSET_CMD] = CMD_PEQ_VALUES;
        data[OFFSET_NONCE] = 7;
        data[OFFSET_INDEX] = 2;
        data[OFFSET_FREQ_L] = 0xE8;
        data[OFFSET_FREQ_H] = 0x03;
        data[OFFSET_Q_L] = 0x00;
        data[OFFSET_Q_H] = 0x01;
        data[OFFSET_GAIN_L] = 0x00;
        data[OFFSET_GAIN_H] = 0x02;
        data[OFFSET_FILTER_TYPE] = FilterType::Peak as u8;
        assert!(matches_filter_response(&data, 2, 7));
        let filter = parse_filter_response(&data).unwrap();
        assert_eq!(filter.index, 2);
        assert_eq!(filter.freq, 1000);
        assert_eq!(filter.q, 1.0);
        assert_eq!(filter.gain, 2.0);
    }
}
