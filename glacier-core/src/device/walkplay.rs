// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

use crate::device::capabilities::{DeviceCapabilities, FilterTypeFlags};
use crate::device::profile::DeviceProfile;
use crate::device::protocol::DeviceProtocol;
use crate::device::timing::WriteTiming;
use crate::eq::iir_math::compute_biquad_coeffs;
use crate::eq::{Filter, FilterType, PEQData};

// ─── Wire constants ───────────────────────────────────────────────────────────

pub const REPORT_ID: u8 = 0x4B;

pub const CMD_FLASH_EQ: u8 = 0x01;
pub const CMD_GLOBAL_GAIN: u8 = 0x03;
pub const CMD_PEQ_VALUES: u8 = 0x09;
pub const CMD_TEMP_WRITE: u8 = 0x0A;
pub const CMD_VERSION: u8 = 0x0C;

pub const READ: u8 = 0x80;
pub const WRITE: u8 = 0x01;
pub const END: u8 = 0x00;

pub const CONST_TEMP_WRITE_MAGIC_A: u8 = 0xFF;
pub const CONST_TEMP_WRITE_MAGIC_B: u8 = 0xFF;
pub const CONST_PEQ_PAYLOAD_LEN: u8 = 0x18;
pub const CONST_GLOBAL_GAIN_LEN: u8 = 0x02;
pub const CONST_TEMP_WRITE_LEN: u8 = 0x04;
pub const CONST_FLASH_EQ_LEN: u8 = 0x01;

pub const FILTER_SLOT: u8 = 101;

pub const OFFSET_CMD_TYPE: usize = 0;
pub const OFFSET_CMD: usize = 1;
pub const OFFSET_NONCE: usize = 2;
pub const OFFSET_INDEX: usize = 4;
pub const OFFSET_FREQ_L: usize = 27;
pub const OFFSET_FREQ_H: usize = 28;
pub const OFFSET_Q_L: usize = 29;
pub const OFFSET_Q_H: usize = 30;
pub const OFFSET_GAIN_L: usize = 31;
pub const OFFSET_GAIN_H: usize = 32;
pub const OFFSET_FILTER_TYPE: usize = 33;
pub const OFFSET_GAIN_VALUE: usize = 4;

const FILTER_RESPONSE_MIN_LEN: usize = 34;
const GLOBAL_GAIN_RESPONSE_MIN_LEN: usize = 6;

pub const QUANTIZER_SCALE: f64 = 1_073_741_824.0;
pub const BYTE_BIT_SHIFT: i32 = 8;

fn clamp_i32(v: f64) -> i32 {
    if !v.is_finite() {
        return 0;
    }
    v.round().clamp(i32::MIN as f64, i32::MAX as f64) as i32
}

fn quantizer(d_arr: &[f64; 3], d_arr2: &[f64; 3]) -> [i32; 5] {
    let i_arr = [
        clamp_i32(d_arr[0] * QUANTIZER_SCALE),
        clamp_i32(d_arr[1] * QUANTIZER_SCALE),
        clamp_i32(d_arr[2] * QUANTIZER_SCALE),
    ];
    let i_arr2 = [
        clamp_i32(d_arr2[0] * QUANTIZER_SCALE),
        clamp_i32(d_arr2[1] * QUANTIZER_SCALE),
        clamp_i32(d_arr2[2] * QUANTIZER_SCALE),
    ];
    [
        i_arr2[0],
        i_arr2[1],
        i_arr2[2],
        i_arr[1].wrapping_neg(),
        i_arr[2].wrapping_neg(),
    ]
}

pub fn compute_iir_filter(
    filter_type: FilterType,
    freq: f64,
    gain: f64,
    q: f64,
    dsp_sample_rate: f64,
) -> [u8; 20] {
    let mut b_arr = [0u8; 20];
    let f = Filter {
        index: 0,
        enabled: true,
        freq: freq as u16,
        gain,
        q,
        filter_type,
    };
    let (b0, b1, b2, a0, a1, a2) = compute_biquad_coeffs(&f, dsp_sample_rate);

    let quantizer_data = quantizer(&[1.0, a1 / a0, a2 / a0], &[b0 / a0, b1 / a0, b2 / a0]);

    for (i, &value) in quantizer_data.iter().enumerate() {
        b_arr[i * 4] = (value & 0xFF) as u8;
        b_arr[i * 4 + 1] = ((value >> BYTE_BIT_SHIFT) & 0xFF) as u8;
        b_arr[i * 4 + 2] = ((value >> (BYTE_BIT_SHIFT * 2)) & 0xFF) as u8;
        b_arr[i * 4 + 3] = ((value >> (BYTE_BIT_SHIFT * 3)) & 0xFF) as u8;
    }

    b_arr
}

pub fn convert_to_2byte_array(value: i32) -> [u8; 2] {
    [
        (value & 0xFF) as u8,
        ((value >> BYTE_BIT_SHIFT) & 0xFF) as u8,
    ]
}

pub fn parse_filter_packet(packet: &[u8]) -> Option<Filter> {
    if packet.len() < FILTER_RESPONSE_MIN_LEN {
        return None;
    }

    let filter_index = packet[OFFSET_INDEX];
    let freq = (packet[OFFSET_FREQ_L] as u16) | ((packet[OFFSET_FREQ_H] as u16) << BYTE_BIT_SHIFT);
    let q_raw = (packet[OFFSET_Q_L] as u16) | ((packet[OFFSET_Q_H] as u16) << BYTE_BIT_SHIFT);
    let gain_raw =
        (packet[OFFSET_GAIN_L] as u16) | ((packet[OFFSET_GAIN_H] as u16) << BYTE_BIT_SHIFT);

    let gain_from_device = if gain_raw > 32767 {
        (gain_raw as i32 - 65536) as i16
    } else {
        gain_raw as i16
    };

    let q = (((q_raw as f64) / 256.0 * 100.0).round() / 100.0).max(0.01);
    let gain = ((gain_from_device as f64) / 256.0 * 100.0).round() / 100.0;
    let filter_type = FilterType::from(packet[OFFSET_FILTER_TYPE]);
    let enabled = !(freq == 0 && gain_from_device == 0);

    Some(Filter {
        index: filter_index,
        enabled,
        freq,
        gain,
        q,
        filter_type,
    })
}

// ─── Protocol implementation ─────────────────────────────────────────────────

pub struct WalkplayProtocol;

impl DeviceProtocol for WalkplayProtocol {
    fn report_id(&self) -> u8 {
        REPORT_ID
    }

    fn write_timing(&self) -> WriteTiming {
        WriteTiming {
            commit_step_ms: 500,
            ..WriteTiming::default()
        }
    }

    fn is_default_state(&self, peq: &PEQData) -> bool {
        let all_disabled = peq.filters.iter().all(|f| !f.enabled);
        let has_default_gain = peq.global_gain == 0.0;
        let all_default_freq = peq.filters.iter().all(|f| f.freq == 100);
        all_disabled && has_default_gain && all_default_freq
    }

    fn build_init_packets(&self) -> Vec<Vec<u8>> {
        vec![vec![READ, CMD_VERSION, END]]
    }

    fn build_filter_read_request(&self, index: u8, nonce: u8) -> Vec<u8> {
        vec![READ, CMD_PEQ_VALUES, nonce, 0x00, index, END]
    }

    fn matches_filter_response(&self, data: &[u8], index: u8, nonce: u8) -> bool {
        data.len() >= FILTER_RESPONSE_MIN_LEN
            && data[OFFSET_CMD_TYPE] == READ
            && data[OFFSET_CMD] == CMD_PEQ_VALUES
            && data[OFFSET_NONCE] == nonce
            && data[OFFSET_INDEX] == index
    }

    fn parse_filter_response(&self, data: &[u8]) -> Option<Filter> {
        parse_filter_packet(data)
    }

    fn build_filter_write_packet(
        &self,
        index: u8,
        filter: &Filter,
        dsp_sample_rate: f64,
    ) -> Vec<u8> {
        let b_arr = compute_iir_filter(
            filter.filter_type,
            filter.freq as f64,
            filter.gain,
            filter.q,
            dsp_sample_rate,
        );
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

    fn build_global_gain_request(&self, _nonce: u8) -> Vec<u8> {
        vec![READ, CMD_GLOBAL_GAIN, 0x00, END]
    }

    fn matches_global_gain_response(&self, data: &[u8], _nonce: u8) -> bool {
        data.len() >= GLOBAL_GAIN_RESPONSE_MIN_LEN
            && data[OFFSET_CMD_TYPE] == READ
            && data[OFFSET_CMD] == CMD_GLOBAL_GAIN
    }

    fn parse_global_gain_response(&self, data: &[u8]) -> Option<i8> {
        if data.len() > OFFSET_GAIN_VALUE {
            Some(data[OFFSET_GAIN_VALUE] as i8)
        } else {
            None
        }
    }

    fn build_global_gain_write_packet(&self, gain: i8) -> Vec<u8> {
        vec![
            WRITE,
            CMD_GLOBAL_GAIN,
            CONST_GLOBAL_GAIN_LEN,
            0x00,
            gain as u8,
            END,
        ]
    }

    fn build_commit_packets(&self) -> Vec<Vec<u8>> {
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
}

// ─── Profiles implementation ──────────────────────────────────────────────────

pub struct TP35ProProfile;

impl DeviceProfile for TP35ProProfile {
    fn name(&self) -> &'static str {
        "EPZ TP35 Pro"
    }

    fn vendor_id(&self) -> u16 {
        0x3302
    }

    fn product_id(&self) -> u16 {
        0x43E6
    }

    fn capabilities(&self) -> DeviceCapabilities {
        DeviceCapabilities {
            num_bands: 10,
            global_gain_range: (-16, 6),
            band_gain_range: (-10.0, 10.0),
            freq_range: (20, 20000),
            q_range: (0.1, 10.0),
            supported_filter_types: FilterTypeFlags::PEAK
                | FilterTypeFlags::LOW_SHELF
                | FilterTypeFlags::HIGH_SHELF
                | FilterTypeFlags::LOW_PASS
                | FilterTypeFlags::HIGH_PASS,
            supports_per_band_enable: false,
            dsp_sample_rate: 96000.0,
            gain_tolerance: 0.15,
            freq_tolerance: 1,
            q_tolerance: 0.05,
        }
    }

    fn protocol(&self) -> Box<dyn DeviceProtocol> {
        Box::new(WalkplayProtocol)
    }
}

pub struct DawnProProfile;

impl DeviceProfile for DawnProProfile {
    fn name(&self) -> &'static str {
        "Moondrop Dawn Pro"
    }

    fn vendor_id(&self) -> u16 {
        0x2FC6
    }

    fn product_id(&self) -> u16 {
        0xDF30
    }

    fn capabilities(&self) -> DeviceCapabilities {
        DeviceCapabilities {
            num_bands: 8,
            global_gain_range: (-20, 0),
            band_gain_range: (-12.0, 12.0),
            freq_range: (20, 20000),
            q_range: (0.1, 10.0),
            supported_filter_types: FilterTypeFlags::PEAK
                | FilterTypeFlags::LOW_SHELF
                | FilterTypeFlags::HIGH_SHELF,
            supports_per_band_enable: false,
            dsp_sample_rate: 96000.0,
            gain_tolerance: 0.1,
            freq_tolerance: 1,
            q_tolerance: 0.05,
        }
    }

    fn protocol(&self) -> Box<dyn DeviceProtocol> {
        Box::new(WalkplayProtocol)
    }
}

pub struct TruthearKeyxProfile;

impl DeviceProfile for TruthearKeyxProfile {
    fn name(&self) -> &'static str {
        "Truthear KEYX"
    }

    fn vendor_id(&self) -> u16 {
        0x0D8C
    }

    fn product_id(&self) -> u16 {
        0x0210
    }

    fn capabilities(&self) -> DeviceCapabilities {
        DeviceCapabilities {
            num_bands: 8,
            global_gain_range: (-20, 0),
            band_gain_range: (-12.0, 12.0),
            freq_range: (20, 20000),
            q_range: (0.1, 10.0),
            supported_filter_types: FilterTypeFlags::PEAK
                | FilterTypeFlags::LOW_SHELF
                | FilterTypeFlags::HIGH_SHELF,
            supports_per_band_enable: false,
            dsp_sample_rate: 96000.0,
            gain_tolerance: 0.1,
            freq_tolerance: 1,
            q_tolerance: 0.05,
        }
    }

    fn protocol(&self) -> Box<dyn DeviceProtocol> {
        Box::new(WalkplayProtocol)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eq::FilterType;

    fn make_filter(index: u8, freq: u16, gain: f64, q: f64) -> Filter {
        Filter {
            index,
            enabled: true,
            filter_type: FilterType::Peak,
            freq,
            gain,
            q,
        }
    }

    #[test]
    fn build_filter_write_packet_structure() {
        let proto = WalkplayProtocol;
        let filter = make_filter(0, 1000, 5.0, 1.0);
        let packet = proto.build_filter_write_packet(0, &filter, 96000.0);
        assert_eq!(packet[OFFSET_CMD_TYPE], WRITE);
        assert_eq!(packet[OFFSET_CMD], CMD_PEQ_VALUES);
        assert_eq!(packet[OFFSET_INDEX], 0);
        assert_eq!(packet.len(), 37);
    }

    #[test]
    fn build_global_gain_write_packet_structure() {
        let proto = WalkplayProtocol;
        let packet = proto.build_global_gain_write_packet(5);
        assert_eq!(packet[OFFSET_CMD_TYPE], WRITE);
        assert_eq!(packet[OFFSET_CMD], CMD_GLOBAL_GAIN);
        assert_eq!(packet[OFFSET_GAIN_VALUE], 5);
    }

    #[test]
    fn build_global_gain_write_packet_negative() {
        let proto = WalkplayProtocol;
        let packet = proto.build_global_gain_write_packet(-3);
        assert_eq!(packet[OFFSET_GAIN_VALUE] as i8, -3);
    }

    #[test]
    fn build_commit_packets_has_two_steps() {
        let proto = WalkplayProtocol;
        let packets = proto.build_commit_packets();
        assert_eq!(packets.len(), 2);
        assert_eq!(packets[0][1], CMD_TEMP_WRITE);
        assert_eq!(packets[1][1], CMD_FLASH_EQ);
    }

    #[test]
    fn write_timing_uses_500ms_commit_step() {
        let proto = WalkplayProtocol;
        let timing = proto.write_timing();
        assert_eq!(timing.commit_step_ms, 500);
    }

    #[test]
    fn matches_filter_response_accepts_valid_packet() {
        let proto = WalkplayProtocol;
        let mut data = vec![0u8; 34];
        data[OFFSET_CMD_TYPE] = READ;
        data[OFFSET_CMD] = CMD_PEQ_VALUES;
        data[OFFSET_NONCE] = 0x42;
        data[OFFSET_INDEX] = 3;
        assert!(proto.matches_filter_response(&data, 3, 0x42));
    }

    #[test]
    fn matches_filter_response_rejects_wrong_nonce() {
        let proto = WalkplayProtocol;
        let mut data = vec![0u8; 34];
        data[OFFSET_CMD_TYPE] = READ;
        data[OFFSET_CMD] = CMD_PEQ_VALUES;
        data[OFFSET_NONCE] = 0x42;
        data[OFFSET_INDEX] = 3;
        assert!(!proto.matches_filter_response(&data, 3, 0xFF));
    }

    #[test]
    fn matches_filter_response_rejects_short_packet() {
        let proto = WalkplayProtocol;
        assert!(!proto.matches_filter_response(&[READ, CMD_PEQ_VALUES], 0, 1));
    }

    #[test]
    fn matches_global_gain_response_accepts_valid_packet() {
        let proto = WalkplayProtocol;
        let mut data = vec![0u8; 6];
        data[OFFSET_CMD_TYPE] = READ;
        data[OFFSET_CMD] = CMD_GLOBAL_GAIN;
        data[OFFSET_GAIN_VALUE] = 3u8;
        assert!(proto.matches_global_gain_response(&data, 0));
        assert_eq!(proto.parse_global_gain_response(&data), Some(3i8));
    }

    #[test]
    fn parse_filter_response_too_short() {
        let proto = WalkplayProtocol;
        assert!(proto.parse_filter_response(&[0u8; 10]).is_none());
    }

    #[test]
    fn compute_iir_filter_produces_20_bytes() {
        assert_eq!(
            compute_iir_filter(FilterType::Peak, 1000.0, 5.0, 1.0, 96000.0).len(),
            20
        );
    }

    #[test]
    fn compute_iir_filter_lowpass_highpass_valid() {
        let lp_arr = compute_iir_filter(FilterType::LowPass, 1000.0, 0.0, 0.707, 96000.0);
        assert_eq!(lp_arr.len(), 20);
        let hp_arr = compute_iir_filter(FilterType::HighPass, 1000.0, 0.0, 0.707, 96000.0);
        assert_eq!(hp_arr.len(), 20);
    }

    #[test]
    fn parse_filter_packet_too_short() {
        assert!(parse_filter_packet(&[0u8; 10]).is_none());
    }
}
