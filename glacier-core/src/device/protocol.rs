// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Walkplay protocol implementation.

use crate::device::profile::DeviceProtocol;
use crate::device::timing::WriteTiming;
use crate::device::walkplay::{
    compute_iir_filter, convert_to_2byte_array, parse_filter_packet, CMD_AMP_MODE, CMD_BALANCE,
    CMD_FACTORY_RESET, CMD_FILTER_MODE, CMD_FLASH_EQ, CMD_GAIN_MODE, CMD_GLOBAL_GAIN,
    CMD_MIC_VOLUME, CMD_PEQ_VALUES, CMD_TEMP_WRITE, CMD_VERSION, CONST_GLOBAL_GAIN_LEN,
    CONST_PEQ_PAYLOAD_LEN, CONST_TEMP_WRITE_LEN, CONST_TEMP_WRITE_MAGIC_A,
    CONST_TEMP_WRITE_MAGIC_B, END, FILTER_RESPONSE_MIN_LEN, GLOBAL_GAIN_RESPONSE_MIN_LEN,
    OFFSET_CMD, OFFSET_CMD_TYPE, OFFSET_GAIN_VALUE, OFFSET_INDEX, OFFSET_NONCE, READ, REPORT_ID,
    WRITE,
};
use crate::eq::{Filter, PEQData};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Packet {
    pub report_id: u8,
    pub payload: Vec<u8>,
    pub pad_to: Option<usize>,
}

impl Packet {
    pub fn new(report_id: u8, payload: Vec<u8>) -> Self {
        Self {
            report_id,
            payload,
            pad_to: None,
        }
    }

    pub fn padded(report_id: u8, payload: Vec<u8>, pad_to: usize) -> Self {
        Self {
            report_id,
            payload,
            pad_to: Some(pad_to),
        }
    }

    pub fn framed(&self) -> Vec<u8> {
        let payload_len = self.pad_to.unwrap_or(self.payload.len());
        let mut buf = Vec::with_capacity(payload_len + 1);
        buf.push(self.report_id);
        buf.extend_from_slice(&self.payload);
        buf.resize(payload_len + 1, 0);
        buf
    }
}

pub trait EqProtocol {
    fn write_timing(&self) -> WriteTiming;
    fn is_default_state(&self, peq: &PEQData) -> bool;
    fn init_packets(&self) -> Vec<Packet>;
    fn read_filter_request(&self, index: u8, nonce: u8) -> Packet;
    fn matches_filter_response(&self, data: &[u8], index: u8, nonce: u8) -> bool;
    fn parse_filter_response(&self, data: &[u8]) -> Option<Filter>;
    fn read_global_gain_request(&self) -> Packet;
    fn matches_global_gain_response(&self, data: &[u8]) -> bool;
    fn parse_global_gain_response(&self, data: &[u8]) -> Option<f64>;
    fn write_filter_packets(
        &self,
        index: u8,
        filter: &Filter,
        dsp_sample_rate: f64,
        global_gain: f64,
    ) -> Result<Vec<Packet>, String>;
    fn write_global_gain_packets(&self, global_gain: f64) -> Vec<Packet>;
    fn commit_packets(&self) -> Vec<Packet>;
    fn ram_apply_packets(&self) -> Vec<Packet>;

    fn unframe_packet<'a>(&self, framed: &'a [u8]) -> Result<&'a [u8], String> {
        if framed.is_empty() {
            return Err("Received empty framed packet".to_string());
        }
        Ok(if framed[0] == self.report_id() {
            &framed[1..]
        } else {
            framed
        })
    }

    fn report_id(&self) -> u8;
}

static WALKPLAY_PROTOCOL: WalkplayProtocol = WalkplayProtocol;
static MOONDROP_PROTOCOL: crate::device::moondrop::MoondropProtocol =
    crate::device::moondrop::MoondropProtocol;

impl DeviceProtocol {
    pub fn implementation(&self) -> &'static dyn EqProtocol {
        match self {
            DeviceProtocol::Walkplay => &WALKPLAY_PROTOCOL,
            DeviceProtocol::Moondrop => &MOONDROP_PROTOCOL,
            DeviceProtocol::FiioJa11 => &crate::device::fiio::JA11_PROTOCOL,
            DeviceProtocol::Fiio => &crate::device::fiio::FIIO_PROTOCOL,
        }
    }
}

/// Walkplay protocol — all methods are associated functions, no instance state.
pub struct WalkplayProtocol;

impl WalkplayProtocol {
    pub fn report_id() -> u8 {
        REPORT_ID
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
}

impl EqProtocol for WalkplayProtocol {
    fn write_timing(&self) -> WriteTiming {
        WriteTiming {
            commit_step_ms: 500,
            flood_delay_ms: 35,
            post_gain_read_ms: 50,
            ..WriteTiming::default()
        }
    }

    fn is_default_state(&self, peq: &PEQData) -> bool {
        peq.global_gain == 0.0
            && peq.filters.iter().all(|filter| !filter.enabled)
            && peq.filters.iter().all(|filter| filter.gain == 0.0)
    }

    fn init_packets(&self) -> Vec<Packet> {
        vec![Packet::new(REPORT_ID, vec![READ, CMD_VERSION, END])]
    }

    fn read_filter_request(&self, index: u8, nonce: u8) -> Packet {
        Packet::new(
            REPORT_ID,
            vec![READ, CMD_PEQ_VALUES, nonce, 0x00, index, END],
        )
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

    fn read_global_gain_request(&self) -> Packet {
        Packet::new(REPORT_ID, vec![READ, CMD_GLOBAL_GAIN, 0x00, END])
    }

    fn matches_global_gain_response(&self, data: &[u8]) -> bool {
        data.len() >= GLOBAL_GAIN_RESPONSE_MIN_LEN
            && data[OFFSET_CMD_TYPE] == READ
            && data[OFFSET_CMD] == CMD_GLOBAL_GAIN
    }

    fn parse_global_gain_response(&self, data: &[u8]) -> Option<f64> {
        data.get(OFFSET_GAIN_VALUE)
            .map(|gain| f64::from(*gain as i8))
    }

    fn write_filter_packets(
        &self,
        index: u8,
        filter: &Filter,
        dsp_sample_rate: f64,
        global_gain: f64,
    ) -> Result<Vec<Packet>, String> {
        let b_arr = compute_iir_filter(
            filter.filter_type,
            filter.freq as f64,
            filter.gain,
            filter.q,
            dsp_sample_rate,
        );
        let mut payload = Vec::with_capacity(36);
        payload.extend_from_slice(&[
            WRITE,
            CMD_PEQ_VALUES,
            CONST_PEQ_PAYLOAD_LEN,
            0x00,
            index,
            0x00,
            0x00,
        ]);
        payload.extend_from_slice(&b_arr);
        payload.extend_from_slice(&convert_to_2byte_array(filter.freq as i32));
        payload.extend_from_slice(&convert_to_2byte_array((filter.q * 256.0).round() as i32));
        payload.extend_from_slice(&convert_to_2byte_array((filter.gain * 256.0).round() as i32));
        payload.extend_from_slice(&[
            filter.filter_type.into(),
            (global_gain.round() as i8) as u8,
            END,
        ]);
        Ok(vec![Packet::new(REPORT_ID, payload)])
    }

    fn write_global_gain_packets(&self, global_gain: f64) -> Vec<Packet> {
        vec![Packet::new(
            REPORT_ID,
            vec![
                WRITE,
                CMD_GLOBAL_GAIN,
                CONST_GLOBAL_GAIN_LEN,
                0x00,
                global_gain.round() as i8 as u8,
                END,
            ],
        )]
    }

    fn commit_packets(&self) -> Vec<Packet> {
        vec![
            Packet::new(
                REPORT_ID,
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
            ),
            Packet::new(REPORT_ID, vec![WRITE, CMD_FLASH_EQ, END]),
        ]
    }

    fn ram_apply_packets(&self) -> Vec<Packet> {
        self.commit_packets()
    }

    fn report_id(&self) -> u8 {
        REPORT_ID
    }
}
