// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

use crate::device::capabilities::{DeviceCapabilities, FilterTypeFlags};
use crate::device::profile::{DeviceProfile, DeviceProtocol};
use crate::eq::iir_math::compute_biquad_coeffs;
use crate::eq::{Filter, FilterType};

// ─── Wire constants ───────────────────────────────────────────────────────────

pub const REPORT_ID: u8 = 0x4B;

pub const CMD_FLASH_EQ: u8 = 0x01;
pub const CMD_GLOBAL_GAIN: u8 = 0x03;
pub const CMD_PEQ_VALUES: u8 = 0x09;
pub const CMD_TEMP_WRITE: u8 = 0x0A;
pub const CMD_VERSION: u8 = 0x0C;

pub const CMD_FILTER_MODE: u8 = 17;
pub const CMD_AMP_MODE: u8 = 29;
pub const CMD_GAIN_MODE: u8 = 25;
pub const CMD_MIC_VOLUME: u8 = 2;
pub const CMD_BALANCE: u8 = 22;
pub const CMD_FACTORY_RESET: u8 = 23;

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

pub(crate) const FILTER_RESPONSE_MIN_LEN: usize = 34;
pub(crate) const GLOBAL_GAIN_RESPONSE_MIN_LEN: usize = 6;

pub const QUANTIZER_SCALE: f64 = 1_073_741_824.0;
pub const BYTE_BIT_SHIFT: i32 = 8;

const SAVITECH_10_BAND_CAPS: DeviceCapabilities = DeviceCapabilities {
    num_bands: 10,
    global_gain_range: (-16, 6),
    band_gain_range: (-10.0, 10.0),
    freq_range: (20, 20000),
    q_range: (0.1, 10.0),
    supported_filter_types: FilterTypeFlags(0b0001_1111),
    supports_per_band_enable: false,
    dsp_sample_rate: 96000.0,
    gain_tolerance: 0.15,
    freq_tolerance: 1,
    q_tolerance: 0.05,
};

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

// ─── Profiles ─────────────────────────────────────────────────────────────────

pub const PROFILES: &[DeviceProfile] = &[
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
        protocol: DeviceProtocol::Walkplay,
        vendor_id: 0x2FC6,
        product_id: Some(0xDF30),
        status: "Untested",
        family: "Walkplay Family",
        caps: DeviceCapabilities {
            num_bands: 8,
            global_gain_range: (-20, 0),
            band_gain_range: (-12.0, 12.0),
            freq_range: (20, 20000),
            q_range: (0.1, 10.0),
            supported_filter_types: FilterTypeFlags(0b0000_0111),
            supports_per_band_enable: false,
            dsp_sample_rate: 48000.0,
            gain_tolerance: 0.1,
            freq_tolerance: 1,
            q_tolerance: 0.05,
        },
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
            freq_range: (20, 20000),
            q_range: (0.1, 10.0),
            supported_filter_types: FilterTypeFlags(0b0000_0111),
            supports_per_band_enable: false,
            dsp_sample_rate: 48000.0,
            gain_tolerance: 0.1,
            freq_tolerance: 1,
            q_tolerance: 0.05,
        },
    },
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::protocol::WalkplayProtocol;
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
        let filter = make_filter(0, 1000, 5.0, 1.0);
        let packet = WalkplayProtocol::build_filter_write_packet(0, &filter, 96000.0);
        assert_eq!(packet[OFFSET_CMD_TYPE], WRITE);
        assert_eq!(packet[OFFSET_CMD], CMD_PEQ_VALUES);
        assert_eq!(packet[OFFSET_INDEX], 0);
        assert_eq!(packet.len(), 37);
    }

    #[test]
    fn build_global_gain_write_packet_structure() {
        let packet = WalkplayProtocol::build_global_gain_write_packet(5);
        assert_eq!(packet[OFFSET_CMD_TYPE], WRITE);
        assert_eq!(packet[OFFSET_CMD], CMD_GLOBAL_GAIN);
        assert_eq!(packet[OFFSET_GAIN_VALUE], 5);
    }

    #[test]
    fn build_global_gain_write_packet_negative() {
        let packet = WalkplayProtocol::build_global_gain_write_packet(-3);
        assert_eq!(packet[OFFSET_GAIN_VALUE] as i8, -3);
    }

    #[test]
    fn build_commit_packets_has_two_steps() {
        let packets = WalkplayProtocol::build_commit_packets();
        assert_eq!(packets.len(), 2);
        assert_eq!(packets[0][1], CMD_TEMP_WRITE);
        assert_eq!(packets[1][1], CMD_FLASH_EQ);
    }

    #[test]
    fn write_timing_uses_500ms_commit_step() {
        let timing = WalkplayProtocol::write_timing();
        assert_eq!(timing.commit_step_ms, 500);
    }

    #[test]
    fn matches_filter_response_accepts_valid_packet() {
        let mut data = vec![0u8; 34];
        data[OFFSET_CMD_TYPE] = READ;
        data[OFFSET_CMD] = CMD_PEQ_VALUES;
        data[OFFSET_NONCE] = 0x42;
        data[OFFSET_INDEX] = 3;
        assert!(WalkplayProtocol::matches_filter_response(&data, 3, 0x42));
    }

    #[test]
    fn matches_filter_response_rejects_wrong_nonce() {
        let mut data = vec![0u8; 34];
        data[OFFSET_CMD_TYPE] = READ;
        data[OFFSET_CMD] = CMD_PEQ_VALUES;
        data[OFFSET_NONCE] = 0x42;
        data[OFFSET_INDEX] = 3;
        assert!(!WalkplayProtocol::matches_filter_response(&data, 3, 0xFF));
    }

    #[test]
    fn matches_filter_response_rejects_short_packet() {
        assert!(!WalkplayProtocol::matches_filter_response(
            &[READ, CMD_PEQ_VALUES],
            0,
            1
        ));
    }

    #[test]
    fn matches_global_gain_response_accepts_valid_packet() {
        let mut data = vec![0u8; 6];
        data[OFFSET_CMD_TYPE] = READ;
        data[OFFSET_CMD] = CMD_GLOBAL_GAIN;
        data[OFFSET_GAIN_VALUE] = 3u8;
        assert!(WalkplayProtocol::matches_global_gain_response(&data, 0));
        assert_eq!(
            WalkplayProtocol::parse_global_gain_response(&data),
            Some(3i8)
        );
    }

    #[test]
    fn parse_filter_response_too_short() {
        assert!(WalkplayProtocol::parse_filter_response(&[0u8; 10]).is_none());
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
