// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Walkplay protocol implementation.

use crate::device::profile::DeviceProtocol;
use crate::device::timing::WriteTiming;
use crate::device::walkplay::{
    compute_iir_filter, convert_to_2byte_array, parse_filter_packet,
    CMD_AMP_MODE, CMD_BALANCE, CMD_FACTORY_RESET, CMD_FILTER_MODE, CMD_FLASH_EQ, CMD_GAIN_MODE,
    CMD_GLOBAL_GAIN, CMD_MIC_VOLUME, CMD_PEQ_VALUES, CMD_TEMP_WRITE, CMD_VERSION,
    CONST_GLOBAL_GAIN_LEN, CONST_PEQ_PAYLOAD_LEN, CONST_TEMP_WRITE_LEN, CONST_TEMP_WRITE_MAGIC_A,
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
    pub(crate) fn implementation(&self) -> &'static dyn EqProtocol {
        match self {
            DeviceProtocol::Walkplay => &WALKPLAY_PROTOCOL,
            DeviceProtocol::Moondrop => &MOONDROP_PROTOCOL,
            DeviceProtocol::FiioJa11 => &crate::device::fiio::JA11_PROTOCOL,
            DeviceProtocol::Fiio => &crate::device::fiio::FIIO_PROTOCOL,
        }
    }
}

impl EqProtocol for DeviceProtocol {
    fn write_timing(&self) -> WriteTiming {
        self.implementation().write_timing()
    }

    fn is_default_state(&self, peq: &PEQData) -> bool {
        self.implementation().is_default_state(peq)
    }

    fn init_packets(&self) -> Vec<Packet> {
        self.implementation().init_packets()
    }

    fn read_filter_request(&self, index: u8, nonce: u8) -> Packet {
        self.implementation().read_filter_request(index, nonce)
    }

    fn matches_filter_response(&self, data: &[u8], index: u8, nonce: u8) -> bool {
        self.implementation()
            .matches_filter_response(data, index, nonce)
    }

    fn parse_filter_response(&self, data: &[u8]) -> Option<Filter> {
        self.implementation().parse_filter_response(data)
    }

    fn read_global_gain_request(&self) -> Packet {
        self.implementation().read_global_gain_request()
    }

    fn matches_global_gain_response(&self, data: &[u8]) -> bool {
        self.implementation().matches_global_gain_response(data)
    }

    fn parse_global_gain_response(&self, data: &[u8]) -> Option<f64> {
        self.implementation().parse_global_gain_response(data)
    }

    fn write_filter_packets(
        &self,
        index: u8,
        filter: &Filter,
        dsp_sample_rate: f64,
        global_gain: f64,
    ) -> Result<Vec<Packet>, String> {
        self.implementation()
            .write_filter_packets(index, filter, dsp_sample_rate, global_gain)
    }

    fn write_global_gain_packets(&self, global_gain: f64) -> Vec<Packet> {
        self.implementation().write_global_gain_packets(global_gain)
    }

    fn commit_packets(&self) -> Vec<Packet> {
        self.implementation().commit_packets()
    }

    fn ram_apply_packets(&self) -> Vec<Packet> {
        self.implementation().ram_apply_packets()
    }

    fn report_id(&self) -> u8 {
        self.implementation().report_id()
    }
}

/// Walkplay protocol — all methods are associated functions, no instance state.
pub struct WalkplayProtocol;

impl WalkplayProtocol {
    pub fn report_id() -> u8 {
        REPORT_ID
    }

    pub(crate) fn write_timing() -> WriteTiming {
        WriteTiming {
            commit_step_ms: 500,
            flood_delay_ms: 35,
            post_gain_read_ms: 50,
            ..WriteTiming::default()
        }
    }

    pub(crate) fn is_default_state(peq: &PEQData) -> bool {
        let all_disabled = peq.filters.iter().all(|f| !f.enabled);
        let has_default_gain = peq.global_gain == 0.0;
        let all_zero_gain = peq.filters.iter().all(|f| f.gain == 0.0);
        all_disabled && has_default_gain && all_zero_gain
    }

    pub(crate) fn build_init_packets() -> Vec<Packet> {
        vec![Packet::new(REPORT_ID, vec![READ, CMD_VERSION, END])]
    }

    pub(crate) fn build_filter_read_request(index: u8, nonce: u8) -> Vec<u8> {
        vec![READ, CMD_PEQ_VALUES, nonce, 0x00, index, END]
    }

    pub(crate) fn matches_filter_response(data: &[u8], index: u8, nonce: u8) -> bool {
        data.len() >= FILTER_RESPONSE_MIN_LEN
            && data[OFFSET_CMD_TYPE] == READ
            && data[OFFSET_CMD] == CMD_PEQ_VALUES
            && data[OFFSET_NONCE] == nonce
            && data[OFFSET_INDEX] == index
    }

    pub(crate) fn parse_filter_response(data: &[u8]) -> Option<Filter> {
        parse_filter_packet(data)
    }

    pub(crate) fn build_filter_write_packet(
        index: u8,
        filter: &Filter,
        dsp_sample_rate: f64,
        global_gain: f64,
    ) -> Vec<u8> {
        // Savitech has no per-band enable field. WalkPlay bypasses a band by
        // writing zero gain while keeping its frequency/Q/type metadata intact.
        let freq = filter.freq;
        let gain = if filter.enabled { filter.gain } else { 0.0 };
        let b_arr = compute_iir_filter(
            filter.filter_type,
            freq as f64,
            gain,
            filter.q,
            dsp_sample_rate,
        );
        let filter_type_byte: u8 = filter.filter_type.into();
        // Global gain is embedded as an unsigned byte in every filter packet,
        // matching the Walkplay/Savitech wire format (byte 34 of the payload).
        let gain_byte = (global_gain.round() as i8) as u8;

        let mut packet = Vec::with_capacity(36);
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
        packet.extend_from_slice(&convert_to_2byte_array(freq as i32));
        packet.extend_from_slice(&convert_to_2byte_array((filter.q * 256.0).round() as i32));
        packet.extend_from_slice(&convert_to_2byte_array((gain * 256.0).round() as i32));
        packet.extend_from_slice(&[filter_type_byte, gain_byte, 0x00]);

        packet
    }

    pub(crate) fn build_global_gain_request(_nonce: u8) -> Vec<u8> {
        vec![READ, CMD_GLOBAL_GAIN, 0x00, END]
    }

    pub(crate) fn matches_global_gain_response(data: &[u8], _nonce: u8) -> bool {
        data.len() >= GLOBAL_GAIN_RESPONSE_MIN_LEN
            && data[OFFSET_CMD_TYPE] == READ
            && data[OFFSET_CMD] == CMD_GLOBAL_GAIN
    }

    pub(crate) fn parse_global_gain_response(data: &[u8]) -> Option<i8> {
        if data.len() > OFFSET_GAIN_VALUE {
            Some(data[OFFSET_GAIN_VALUE] as i8)
        } else {
            None
        }
    }

    pub(crate) fn build_global_gain_write_packet(gain: i8) -> Vec<u8> {
        vec![
            WRITE,
            CMD_GLOBAL_GAIN,
            CONST_GLOBAL_GAIN_LEN,
            0x00,
            gain as u8,
            END,
        ]
    }

    pub(crate) fn build_commit_packets() -> Vec<Packet> {
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

    pub(crate) fn build_ram_apply_packets() -> Vec<Packet> {
        Self::build_commit_packets()
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
        let b = (balance as i32).clamp(-15, 15);
        if b <= 0 {
            vec![
                vec![WRITE, CMD_BALANCE, 4, 1, 0, (-b.abs()) as u8, 0],
                vec![WRITE, CMD_BALANCE, 4, 0, 0, 0, 0],
            ]
        } else {
            vec![
                vec![WRITE, CMD_BALANCE, 4, 1, 0, 0, 0],
                vec![WRITE, CMD_BALANCE, 4, 0, 0, (-b) as u8, 0],
            ]
        }
    }
}

impl EqProtocol for WalkplayProtocol {
    fn write_timing(&self) -> WriteTiming {
        Self::write_timing()
    }

    fn is_default_state(&self, peq: &PEQData) -> bool {
        Self::is_default_state(peq)
    }

    fn init_packets(&self) -> Vec<Packet> {
        Self::build_init_packets()
    }

    fn read_filter_request(&self, index: u8, nonce: u8) -> Packet {
        Packet::new(REPORT_ID, Self::build_filter_read_request(index, nonce))
    }

    fn matches_filter_response(&self, data: &[u8], index: u8, nonce: u8) -> bool {
        Self::matches_filter_response(data, index, nonce)
    }

    fn parse_filter_response(&self, data: &[u8]) -> Option<Filter> {
        Self::parse_filter_response(data)
    }

    fn read_global_gain_request(&self) -> Packet {
        Packet::new(REPORT_ID, Self::build_global_gain_request(0))
    }

    fn matches_global_gain_response(&self, data: &[u8]) -> bool {
        Self::matches_global_gain_response(data, 0)
    }

    fn parse_global_gain_response(&self, data: &[u8]) -> Option<f64> {
        Self::parse_global_gain_response(data).map(f64::from)
    }

    fn write_filter_packets(
        &self,
        index: u8,
        filter: &Filter,
        dsp_sample_rate: f64,
        global_gain: f64,
    ) -> Result<Vec<Packet>, String> {
        Ok(vec![Packet::new(
            REPORT_ID,
            Self::build_filter_write_packet(index, filter, dsp_sample_rate, global_gain),
        )])
    }

    fn write_global_gain_packets(&self, global_gain: f64) -> Vec<Packet> {
        vec![Packet::new(
            REPORT_ID,
            Self::build_global_gain_write_packet(global_gain.round() as i8),
        )]
    }

    fn commit_packets(&self) -> Vec<Packet> {
        Self::build_commit_packets()
    }

    fn ram_apply_packets(&self) -> Vec<Packet> {
        Self::build_ram_apply_packets()
    }

    fn report_id(&self) -> u8 {
        REPORT_ID
    }
}
