// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Walkplay protocol implementation.

use crate::device::timing::WriteTiming;
use crate::device::walkplay::{
    compute_iir_filter, convert_to_2byte_array, parse_filter_packet, CMD_AMP_MODE, CMD_BALANCE,
    CMD_FACTORY_RESET, CMD_FILTER_MODE, CMD_FLASH_EQ, CMD_GAIN_MODE, CMD_GLOBAL_GAIN,
    CMD_MIC_VOLUME, CMD_PEQ_VALUES, CMD_TEMP_WRITE, CMD_VERSION, CONST_FLASH_EQ_LEN,
    CONST_GLOBAL_GAIN_LEN, CONST_PEQ_PAYLOAD_LEN, CONST_TEMP_WRITE_LEN, CONST_TEMP_WRITE_MAGIC_A,
    CONST_TEMP_WRITE_MAGIC_B, END, FILTER_RESPONSE_MIN_LEN, FILTER_SLOT,
    GLOBAL_GAIN_RESPONSE_MIN_LEN, OFFSET_CMD, OFFSET_CMD_TYPE, OFFSET_GAIN_VALUE, OFFSET_INDEX,
    OFFSET_NONCE, READ, REPORT_ID, WRITE,
};
use crate::eq::{Filter, PEQData};

/// Walkplay protocol — all methods are associated functions, no instance state.
pub struct WalkplayProtocol;

impl WalkplayProtocol {
    pub fn report_id() -> u8 {
        REPORT_ID
    }

    pub fn write_timing() -> WriteTiming {
        WriteTiming {
            commit_step_ms: 500,
            ..WriteTiming::default()
        }
    }

    pub fn is_default_state(peq: &PEQData) -> bool {
        let all_disabled = peq.filters.iter().all(|f| !f.enabled);
        let has_default_gain = peq.global_gain == 0.0;
        let all_default_freq = peq.filters.iter().all(|f| f.freq == 100);
        all_disabled && has_default_gain && all_default_freq
    }

    pub fn build_init_packets() -> Vec<Vec<u8>> {
        vec![vec![READ, CMD_VERSION, END]]
    }

    pub fn build_filter_read_request(index: u8, nonce: u8) -> Vec<u8> {
        vec![READ, CMD_PEQ_VALUES, nonce, 0x00, index, END]
    }

    pub fn matches_filter_response(data: &[u8], index: u8, nonce: u8) -> bool {
        data.len() >= FILTER_RESPONSE_MIN_LEN
            && data[OFFSET_CMD_TYPE] == READ
            && data[OFFSET_CMD] == CMD_PEQ_VALUES
            && data[OFFSET_NONCE] == nonce
            && data[OFFSET_INDEX] == index
    }

    pub fn parse_filter_response(data: &[u8]) -> Option<Filter> {
        parse_filter_packet(data)
    }

    pub fn build_filter_write_packet(index: u8, filter: &Filter, dsp_sample_rate: f64) -> Vec<u8> {
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

    pub fn build_global_gain_request(_nonce: u8) -> Vec<u8> {
        vec![READ, CMD_GLOBAL_GAIN, 0x00, END]
    }

    pub fn matches_global_gain_response(data: &[u8], _nonce: u8) -> bool {
        data.len() >= GLOBAL_GAIN_RESPONSE_MIN_LEN
            && data[OFFSET_CMD_TYPE] == READ
            && data[OFFSET_CMD] == CMD_GLOBAL_GAIN
    }

    pub fn parse_global_gain_response(data: &[u8]) -> Option<i8> {
        if data.len() > OFFSET_GAIN_VALUE {
            Some(data[OFFSET_GAIN_VALUE] as i8)
        } else {
            None
        }
    }

    pub fn build_global_gain_write_packet(gain: i8) -> Vec<u8> {
        vec![
            WRITE,
            CMD_GLOBAL_GAIN,
            CONST_GLOBAL_GAIN_LEN,
            0x00,
            gain as u8,
            END,
        ]
    }

    pub fn build_commit_packets() -> Vec<Vec<u8>> {
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

    pub fn build_utility_read_request(cmd: u8) -> Vec<u8> {
        vec![READ, cmd, END]
    }

    pub fn build_balance_read_request(channel: u8) -> Vec<u8> {
        vec![READ, CMD_BALANCE, 1, channel]
    }

    pub fn build_filter_mode_write_packet(mode: u8) -> Vec<u8> {
        vec![WRITE, CMD_FILTER_MODE, 1, mode]
    }

    pub fn build_amp_mode_write_packet(is_class_ab: bool) -> Vec<u8> {
        vec![WRITE, CMD_AMP_MODE, 1, if is_class_ab { 1 } else { 0 }]
    }

    pub fn build_gain_mode_write_packet(is_high: bool) -> Vec<u8> {
        vec![WRITE, CMD_GAIN_MODE, 1, if is_high { 1 } else { 0 }]
    }

    pub fn build_mic_volume_write_packet(db: i8) -> Vec<u8> {
        vec![WRITE, CMD_MIC_VOLUME, 2, 128, db as u8]
    }

    pub fn build_factory_reset_packet() -> Vec<u8> {
        vec![WRITE, CMD_FACTORY_RESET, 0]
    }

    pub fn build_balance_write_packets(balance: i8) -> Vec<Vec<u8>> {
        if balance <= 0 {
            vec![
                vec![WRITE, CMD_BALANCE, 4, 1, 0, (-balance.abs()) as u8, 0],
                vec![WRITE, CMD_BALANCE, 4, 0, 0, 0, 0],
            ]
        } else {
            vec![
                vec![WRITE, CMD_BALANCE, 4, 1, 0, 0, 0],
                vec![WRITE, CMD_BALANCE, 4, 0, 0, (-balance) as u8, 0],
            ]
        }
    }

    pub fn frame_packet(payload: &[u8]) -> Vec<u8> {
        let mut buf = vec![0u8; 65];
        buf[0] = Self::report_id();
        let len = payload.len().min(64);
        buf[1..1 + len].copy_from_slice(&payload[..len]);
        buf
    }

    pub fn unframe_packet(framed: &[u8]) -> Result<Vec<u8>, String> {
        if framed.is_empty() {
            return Err("Received empty framed packet".to_string());
        }
        let offset = if framed[0] == Self::report_id() { 1 } else { 0 };
        Ok(framed[offset..].to_vec())
    }
}
