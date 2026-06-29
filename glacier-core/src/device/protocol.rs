// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Walkplay protocol implementation.

use crate::device::profile::DeviceProtocol;
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
    fn name(&self) -> &'static str;
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

impl EqProtocol for DeviceProtocol {
    fn name(&self) -> &'static str {
        match self {
            DeviceProtocol::Walkplay => WalkplayProtocol.name(),
            DeviceProtocol::Moondrop => crate::device::moondrop::MoondropProtocol.name(),
            DeviceProtocol::FiioJa11 => crate::device::fiio::FiioJa11Protocol.name(),
            DeviceProtocol::Fiio => crate::device::fiio::FiioProtocol.name(),
        }
    }

    fn write_timing(&self) -> WriteTiming {
        match self {
            DeviceProtocol::Walkplay => WalkplayProtocol.write_timing(),
            DeviceProtocol::Moondrop => crate::device::moondrop::MoondropProtocol.write_timing(),
            DeviceProtocol::FiioJa11 => crate::device::fiio::FiioJa11Protocol.write_timing(),
            DeviceProtocol::Fiio => crate::device::fiio::FiioProtocol.write_timing(),
        }
    }

    fn is_default_state(&self, peq: &PEQData) -> bool {
        match self {
            DeviceProtocol::Walkplay => WalkplayProtocol.is_default_state(peq),
            DeviceProtocol::Moondrop => {
                crate::device::moondrop::MoondropProtocol.is_default_state(peq)
            }
            DeviceProtocol::FiioJa11 => crate::device::fiio::FiioJa11Protocol.is_default_state(peq),
            DeviceProtocol::Fiio => crate::device::fiio::FiioProtocol.is_default_state(peq),
        }
    }

    fn init_packets(&self) -> Vec<Packet> {
        match self {
            DeviceProtocol::Walkplay => WalkplayProtocol.init_packets(),
            DeviceProtocol::Moondrop => crate::device::moondrop::MoondropProtocol.init_packets(),
            DeviceProtocol::FiioJa11 => crate::device::fiio::FiioJa11Protocol.init_packets(),
            DeviceProtocol::Fiio => crate::device::fiio::FiioProtocol.init_packets(),
        }
    }

    fn read_filter_request(&self, index: u8, nonce: u8) -> Packet {
        match self {
            DeviceProtocol::Walkplay => WalkplayProtocol.read_filter_request(index, nonce),
            DeviceProtocol::Moondrop => {
                crate::device::moondrop::MoondropProtocol.read_filter_request(index, nonce)
            }
            DeviceProtocol::FiioJa11 => {
                crate::device::fiio::FiioJa11Protocol.read_filter_request(index, nonce)
            }
            DeviceProtocol::Fiio => {
                crate::device::fiio::FiioProtocol.read_filter_request(index, nonce)
            }
        }
    }

    fn matches_filter_response(&self, data: &[u8], index: u8, nonce: u8) -> bool {
        match self {
            DeviceProtocol::Walkplay => {
                WalkplayProtocol.matches_filter_response(data, index, nonce)
            }
            DeviceProtocol::Moondrop => crate::device::moondrop::MoondropProtocol
                .matches_filter_response(data, index, nonce),
            DeviceProtocol::FiioJa11 => {
                crate::device::fiio::FiioJa11Protocol.matches_filter_response(data, index, nonce)
            }
            DeviceProtocol::Fiio => {
                crate::device::fiio::FiioProtocol.matches_filter_response(data, index, nonce)
            }
        }
    }

    fn parse_filter_response(&self, data: &[u8]) -> Option<Filter> {
        match self {
            DeviceProtocol::Walkplay => WalkplayProtocol.parse_filter_response(data),
            DeviceProtocol::Moondrop => {
                crate::device::moondrop::MoondropProtocol.parse_filter_response(data)
            }
            DeviceProtocol::FiioJa11 => {
                crate::device::fiio::FiioJa11Protocol.parse_filter_response(data)
            }
            DeviceProtocol::Fiio => crate::device::fiio::FiioProtocol.parse_filter_response(data),
        }
    }

    fn read_global_gain_request(&self) -> Packet {
        match self {
            DeviceProtocol::Walkplay => WalkplayProtocol.read_global_gain_request(),
            DeviceProtocol::Moondrop => {
                crate::device::moondrop::MoondropProtocol.read_global_gain_request()
            }
            DeviceProtocol::FiioJa11 => {
                crate::device::fiio::FiioJa11Protocol.read_global_gain_request()
            }
            DeviceProtocol::Fiio => crate::device::fiio::FiioProtocol.read_global_gain_request(),
        }
    }

    fn matches_global_gain_response(&self, data: &[u8]) -> bool {
        match self {
            DeviceProtocol::Walkplay => WalkplayProtocol.matches_global_gain_response(data),
            DeviceProtocol::Moondrop => {
                crate::device::moondrop::MoondropProtocol.matches_global_gain_response(data)
            }
            DeviceProtocol::FiioJa11 => {
                crate::device::fiio::FiioJa11Protocol.matches_global_gain_response(data)
            }
            DeviceProtocol::Fiio => {
                crate::device::fiio::FiioProtocol.matches_global_gain_response(data)
            }
        }
    }

    fn parse_global_gain_response(&self, data: &[u8]) -> Option<f64> {
        match self {
            DeviceProtocol::Walkplay => WalkplayProtocol.parse_global_gain_response(data),
            DeviceProtocol::Moondrop => {
                crate::device::moondrop::MoondropProtocol.parse_global_gain_response(data)
            }
            DeviceProtocol::FiioJa11 => {
                crate::device::fiio::FiioJa11Protocol.parse_global_gain_response(data)
            }
            DeviceProtocol::Fiio => {
                crate::device::fiio::FiioProtocol.parse_global_gain_response(data)
            }
        }
    }

    fn write_filter_packets(
        &self,
        index: u8,
        filter: &Filter,
        dsp_sample_rate: f64,
    ) -> Result<Vec<Packet>, String> {
        match self {
            DeviceProtocol::Walkplay => {
                WalkplayProtocol.write_filter_packets(index, filter, dsp_sample_rate)
            }
            DeviceProtocol::Moondrop => crate::device::moondrop::MoondropProtocol
                .write_filter_packets(index, filter, dsp_sample_rate),
            DeviceProtocol::FiioJa11 => crate::device::fiio::FiioJa11Protocol.write_filter_packets(
                index,
                filter,
                dsp_sample_rate,
            ),
            DeviceProtocol::Fiio => crate::device::fiio::FiioProtocol.write_filter_packets(
                index,
                filter,
                dsp_sample_rate,
            ),
        }
    }

    fn write_global_gain_packets(&self, global_gain: f64) -> Vec<Packet> {
        match self {
            DeviceProtocol::Walkplay => WalkplayProtocol.write_global_gain_packets(global_gain),
            DeviceProtocol::Moondrop => {
                crate::device::moondrop::MoondropProtocol.write_global_gain_packets(global_gain)
            }
            DeviceProtocol::FiioJa11 => {
                crate::device::fiio::FiioJa11Protocol.write_global_gain_packets(global_gain)
            }
            DeviceProtocol::Fiio => {
                crate::device::fiio::FiioProtocol.write_global_gain_packets(global_gain)
            }
        }
    }

    fn commit_packets(&self) -> Vec<Packet> {
        match self {
            DeviceProtocol::Walkplay => WalkplayProtocol.commit_packets(),
            DeviceProtocol::Moondrop => crate::device::moondrop::MoondropProtocol.commit_packets(),
            DeviceProtocol::FiioJa11 => crate::device::fiio::FiioJa11Protocol.commit_packets(),
            DeviceProtocol::Fiio => crate::device::fiio::FiioProtocol.commit_packets(),
        }
    }

    fn ram_apply_packets(&self) -> Vec<Packet> {
        match self {
            DeviceProtocol::Walkplay => WalkplayProtocol.ram_apply_packets(),
            DeviceProtocol::Moondrop => {
                crate::device::moondrop::MoondropProtocol.ram_apply_packets()
            }
            DeviceProtocol::FiioJa11 => crate::device::fiio::FiioJa11Protocol.ram_apply_packets(),
            DeviceProtocol::Fiio => crate::device::fiio::FiioProtocol.ram_apply_packets(),
        }
    }

    fn report_id(&self) -> u8 {
        match self {
            DeviceProtocol::Walkplay => WalkplayProtocol.report_id(),
            DeviceProtocol::Moondrop => crate::device::moondrop::MoondropProtocol.report_id(),
            DeviceProtocol::FiioJa11 => crate::device::fiio::FiioJa11Protocol.report_id(),
            DeviceProtocol::Fiio => crate::device::fiio::FiioProtocol.report_id(),
        }
    }
}

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

    pub fn build_init_packets() -> Vec<Packet> {
        vec![Packet::new(REPORT_ID, vec![READ, CMD_VERSION, END])]
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

    pub fn build_commit_packets() -> Vec<Packet> {
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
            Packet::new(
                REPORT_ID,
                vec![WRITE, CMD_FLASH_EQ, CONST_FLASH_EQ_LEN, FILTER_SLOT, END],
            ),
        ]
    }

    pub fn build_ram_apply_packets() -> Vec<Packet> {
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
    fn name(&self) -> &'static str {
        "Walkplay"
    }

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
    ) -> Result<Vec<Packet>, String> {
        Ok(vec![Packet::new(
            REPORT_ID,
            Self::build_filter_write_packet(index, filter, dsp_sample_rate),
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
