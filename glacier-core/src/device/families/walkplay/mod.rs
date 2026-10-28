// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Walkplay protocol implementation.

mod controls;
mod iir;
mod packets;

pub use controls::DacUtilityState;
pub use iir::compute_iir_filter;
pub(crate) use iir::decode_q30_biquad;
pub use packets::*;

use crate::device::packet::{checked_scaled_i16, Packet};
use crate::device::protocol::{EqProtocol, GainEncoding, Protocol};
use crate::device::timing::WriteTiming;
use crate::eq::{Filter, PEQData};

pub static PROTOCOL: Protocol = Protocol {
    id: "Walkplay",
    eq: Some(&WalkplayProtocol),
};

/// Walkplay protocol — all methods are associated functions, no instance state.
pub struct WalkplayProtocol;

impl WalkplayProtocol {
    pub fn report_id() -> u8 {
        REPORT_ID
    }

    /// Pacing measured on an EPZ TP35 Pro and compared with the official
    /// WalkPlay web app (capture 2026-10-18): the app sends every report 16 ms
    /// apart, one HID polling interval, and never sleeps between a request
    /// and its answer (replies arrive after 13-16 ms). Writes spaced 4-40 ms
    /// dropped the same ~1% of bands, so the extra delay bought nothing.
    /// The flash commit is the exception: the DAC ignores writes for about
    /// 100 ms and reads for about 200 ms after it.
    pub(crate) fn write_timing() -> WriteTiming {
        WriteTiming {
            commit_step_ms: 200,
            flood_delay_ms: 0,
            post_gain_read_ms: 0,
            per_filter_ms: HID_INTERVAL_MS,
            batch_ms: HID_INTERVAL_MS,
            global_gain_ms: HID_INTERVAL_MS,
            init_ms: 20,
            packet_gap_ms: 0,
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
        // Preserve the two-step sequence validated on EPZ/TRN hardware. The
        // devicePEQ walkplayHidHandler at 0617f382e76629792a5933e6933e4b396a756a93
        // ends with [1, 1, 1, 0], unlike the local/Aura [1, 1, 0] flash frame.
        // Keep the tested local sequence rather than substituting a different
        // reference sequence globally.
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

    // Loads the written bands into the DSP without saving them: the first commit
    // step alone. The official web app's audition path ends here, and only its
    // Save sends the flash write.
    pub(crate) fn build_ram_apply_packets() -> Vec<Packet> {
        Self::build_commit_packets().into_iter().take(1).collect()
    }

    pub fn build_utility_read_request(cmd: u8) -> Vec<u8> {
        vec![READ, cmd, END]
    }

    pub fn build_balance_read_request(channel: u8) -> Vec<u8> {
        vec![READ, CMD_BALANCE, 2, channel]
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

    pub fn build_restore_defaults_packet() -> Vec<u8> {
        vec![WRITE, CMD_RESTORE_DEFAULTS, 0]
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
    fn realized_biquad(
        &self,
        filter: &Filter,
        sample_rate: f64,
    ) -> Result<(f64, f64, f64, f64, f64, f64), String> {
        if !filter.enabled {
            return Ok((1.0, 0.0, 0.0, 1.0, 0.0, 0.0));
        }
        self.response_model()
            .validate_parameters(filter.filter_type, filter.gain, filter.q)?;
        if !sample_rate.is_finite() || sample_rate < 41.0 {
            return Err("DSP sample rate must be finite and at least 41 Hz".into());
        }
        Ok(decode_q30_biquad(&compute_iir_filter(
            filter.filter_type,
            filter.freq as f64,
            filter.gain,
            filter.q,
            sample_rate,
        )?))
    }

    fn q_step(&self) -> Option<f64> {
        Some(1.0 / 256.0)
    }

    fn gain_encoding(&self) -> GainEncoding {
        GainEncoding {
            band_units_per_db: 256.0,
            band_step_db: None,
            band_readback_per_db: 100.0,
            // The preamp is a whole-dB signed byte.
            preamp_step_db: 1.0,
        }
    }

    fn write_timing(&self) -> WriteTiming {
        Self::write_timing()
    }

    fn resend_unanswered_after(&self) -> Option<usize> {
        // TP35 Pro hardware drops about one band/gain request per ten pulls;
        // a resend recovers in one round instead of failing the phase. An
        // answered request takes 13-16 ms, so five 60 ms reads (300 ms) is
        // ample before the request is sent again.
        Some(5)
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
        valid_filter_packet(data)
    }

    fn is_filter_response_valid(&self, data: &[u8], index: u8, nonce: u8) -> bool {
        Self::matches_filter_response(data, index, nonce) && valid_filter_packet(data)
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
