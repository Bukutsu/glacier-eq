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

pub(crate) fn checked_scaled_i16(value: f64, scale: f64, label: &str) -> Result<i16, String> {
    if !value.is_finite() {
        return Err(format!("{label} must be finite"));
    }
    let scaled = (value * scale).round();
    if !scaled.is_finite() || !(-32768.0..=32767.0).contains(&scaled) {
        return Err(format!("{label} is outside the protocol wire range"));
    }
    Ok(scaled as i16)
}

pub(crate) fn checked_scaled_u16(value: f64, scale: f64, label: &str) -> Result<u16, String> {
    if !value.is_finite() {
        return Err(format!("{label} must be finite"));
    }
    let scaled = (value * scale).round();
    if !scaled.is_finite() || !(0.0..=65535.0).contains(&scaled) {
        return Err(format!("{label} is outside the protocol wire range"));
    }
    Ok(scaled as u16)
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

    /// Builds the HID report: report ID byte followed by the payload,
    /// zero-padded to the declared report length.
    ///
    /// # Panics
    ///
    /// If the payload exceeds `pad_to`. That is a caller contract violation
    /// (all current packet builders use fixed sizes); failing loudly beats
    /// sending a truncated frame to the device.
    pub fn framed(&self) -> Vec<u8> {
        let payload_len = self.pad_to.unwrap_or(self.payload.len());
        assert!(
            self.payload.len() <= payload_len,
            "payload of {} bytes does not fit padded frame of {payload_len} bytes",
            self.payload.len()
        );
        let mut buf = Vec::with_capacity(payload_len + 1);
        buf.push(self.report_id);
        buf.extend_from_slice(&self.payload);
        buf.resize(payload_len + 1, 0);
        buf
    }
}

pub trait EqProtocol {
    fn write_timing(&self) -> WriteTiming;
    /// Re-send an unanswered read request after this many attempts instead of
    /// only re-reading. `None` preserves send-once behavior. A dropped request
    /// recovers after one round instead of burning the full attempt budget and
    /// failing the phase.
    fn resend_unanswered_after(&self) -> Option<usize> {
        None
    }
    fn is_default_state(&self, peq: &PEQData) -> bool;
    fn init_packets(&self) -> Vec<Packet>;
    fn read_filter_request(&self, index: u8, nonce: u8) -> Packet;
    fn matches_filter_response(&self, data: &[u8], index: u8, nonce: u8) -> bool;
    /// Checks payload validity independently of command/index/nonce correlation.
    /// Parsers may still return a sanitized placeholder for legacy callers, but
    /// public WASM/parser boundaries use this to reject the frame instead.
    fn is_filter_packet_valid(&self, data: &[u8]) -> bool {
        self.parse_filter_response(data).is_some()
    }
    fn is_filter_response_valid(&self, data: &[u8], index: u8, nonce: u8) -> bool {
        self.matches_filter_response(data, index, nonce) && self.is_filter_packet_valid(data)
    }
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
        if framed[0] != self.report_id() {
            return Err(format!(
                "Unexpected HID report ID 0x{:02X}; expected 0x{:02X}",
                framed[0],
                self.report_id()
            ));
        }
        Ok(&framed[1..])
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
            DeviceProtocol::Unknown => {
                // Only real device profiles drive hardware; Unknown exists solely
                // as a matching fallback.
                panic!("Unknown protocol has no device implementation")
            }
        }
    }
}

impl EqProtocol for DeviceProtocol {
    fn write_timing(&self) -> WriteTiming {
        self.implementation().write_timing()
    }

    fn resend_unanswered_after(&self) -> Option<usize> {
        self.implementation().resend_unanswered_after()
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

    fn is_filter_packet_valid(&self, data: &[u8]) -> bool {
        self.implementation().is_filter_packet_valid(data)
    }

    fn is_filter_response_valid(&self, data: &[u8], index: u8, nonce: u8) -> bool {
        self.implementation()
            .is_filter_response_valid(data, index, nonce)
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
            commit_step_ms: 200,
            flood_delay_ms: 15,
            post_gain_read_ms: 20,
            per_filter_ms: 40,
            batch_ms: 50,
            global_gain_ms: 20,
            init_ms: 20,
        }
    }

    pub(crate) fn is_default_state(peq: &PEQData) -> bool {
        // Walkplay pull responses do not represent per-band enable state: every
        // parsed filter is enabled. A transient reset response is observable as
        // a flat filter set and zero preamp instead; an active pass filter is
        // not flat even when its gain metadata is zero.
        peq.global_gain == 0.0
            && peq.filters.iter().all(|filter| {
                filter.gain == 0.0
                    && !matches!(
                        filter.filter_type,
                        crate::eq::FilterType::HighPass | crate::eq::FilterType::LowPass
                    )
            })
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
    ) -> Result<Vec<u8>, String> {
        // Savitech has no per-band enable field. A zero-gain peak is the
        // identity representation; retaining HP/LP here would leave an active
        // pass filter in the DSP even though its UI band is disabled.
        let freq = filter.freq;
        let gain = if filter.enabled { filter.gain } else { 0.0 };
        let gain_wire = checked_scaled_i16(gain, 256.0, "Filter gain")?;
        let q_wire = checked_scaled_i16(filter.q, 256.0, "Filter Q")?;
        let filter_type = if !filter.enabled
            && matches!(
                filter.filter_type,
                crate::eq::FilterType::HighPass | crate::eq::FilterType::LowPass
            ) {
            crate::eq::FilterType::Peak
        } else {
            filter.filter_type
        };
        let b_arr = compute_iir_filter(filter_type, freq as f64, gain, filter.q, dsp_sample_rate)?;
        let filter_type_byte: u8 = filter_type.into();
        // Global gain is embedded as an unsigned byte in every filter packet,
        // matching the Walkplay/Savitech wire format (byte 34 of the payload).
        let global_wire = global_gain.round();
        if !global_wire.is_finite() || !(-128.0..=127.0).contains(&global_wire) {
            return Err("Global gain is outside the Walkplay wire range".into());
        }
        let gain_byte = (global_wire as i8) as u8;

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
        packet.extend_from_slice(&convert_to_2byte_array(q_wire as i32));
        packet.extend_from_slice(&convert_to_2byte_array(gain_wire as i32));
        packet.extend_from_slice(&[filter_type_byte, gain_byte, 0x00]);

        Ok(packet)
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
        if Self::matches_global_gain_response(data, 0) {
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

    fn resend_unanswered_after(&self) -> Option<usize> {
        // TP35 Pro hardware drops about one band/gain request per ten pulls;
        // a resend recovers in one round instead of failing the phase.
        Some(15)
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

    fn is_filter_packet_valid(&self, data: &[u8]) -> bool {
        crate::device::walkplay::valid_filter_packet(data)
    }

    fn is_filter_response_valid(&self, data: &[u8], index: u8, nonce: u8) -> bool {
        Self::matches_filter_response(data, index, nonce)
            && crate::device::walkplay::valid_filter_packet(data)
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
            Self::build_filter_write_packet(index, filter, dsp_sample_rate, global_gain)?,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn walkplay_unframing_rejects_unexpected_report_ids() {
        assert!(WalkplayProtocol
            .unframe_packet(&[0x80, READ, CMD_GLOBAL_GAIN, 7])
            .is_err());
        assert_eq!(
            WalkplayProtocol
                .unframe_packet(&[REPORT_ID, READ, CMD_GLOBAL_GAIN, 7])
                .unwrap(),
            &[READ, CMD_GLOBAL_GAIN, 7]
        );
    }

    #[test]
    fn walkplay_global_gain_parser_requires_a_complete_matching_frame() {
        assert_eq!(
            WalkplayProtocol::parse_global_gain_response(&[0, 0, 0, 0, 7]),
            None
        );
        let mut wrong_header = vec![0u8; 6];
        wrong_header[OFFSET_CMD_TYPE] = READ;
        wrong_header[OFFSET_CMD] = CMD_GLOBAL_GAIN + 1;
        wrong_header[OFFSET_GAIN_VALUE] = 7;
        assert_eq!(
            WalkplayProtocol::parse_global_gain_response(&wrong_header),
            None
        );
    }

    #[test]
    fn walkplay_default_state_uses_representable_pulled_fields() {
        let mut filter = Filter::enabled(0, true);
        filter.gain = 0.0;
        let flat = PEQData {
            filters: vec![filter.clone()],
            global_gain: 0.0,
        };
        assert!(WalkplayProtocol::is_default_state(&flat));

        let mut boosted = flat.clone();
        boosted.filters[0].gain = 0.01;
        assert!(!WalkplayProtocol::is_default_state(&boosted));

        let mut preamped = flat.clone();
        preamped.global_gain = -1.0;
        assert!(!WalkplayProtocol::is_default_state(&preamped));

        for filter_type in [
            crate::eq::FilterType::HighPass,
            crate::eq::FilterType::LowPass,
        ] {
            let mut pass = flat.clone();
            pass.filters[0].filter_type = filter_type;
            assert!(!WalkplayProtocol::is_default_state(&pass));
        }
    }
}
