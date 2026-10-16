// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Walkplay protocol implementation.

mod controls;
mod iir;
mod packets;

pub use controls::DacUtilityState;
pub use iir::compute_iir_filter;
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

    #[test]
    fn build_filter_write_packet_structure() {
        let filter = make_filter(0, 1000, 5.0, 1.0);
        let packet =
            WalkplayProtocol::build_filter_write_packet(0, &filter, 96000.0, -3.0).unwrap();
        assert_eq!(packet[OFFSET_CMD_TYPE], WRITE);
        assert_eq!(packet[OFFSET_CMD], CMD_PEQ_VALUES);
        assert_eq!(packet[OFFSET_INDEX], 0);
        assert_eq!(packet.len(), 36);
        // byte 34 carries the global gain as an unsigned byte
        assert_eq!(packet[34], (-3i8) as u8);
        // byte 35 is the terminating 0x00
        assert_eq!(packet[35], 0x00);
    }

    #[test]
    fn unrepresentable_coefficient_fails_loudly() {
        // In-caps parameters whose peak coefficient b0/a0 ≈ 3.13 cannot fit the
        // device's ±2.0 fixed-point format; encoding must fail, not clamp.
        let filter = make_filter(0, 12000, 12.0, 0.1);
        let error = WalkplayProtocol::build_filter_write_packet(0, &filter, 48000.0, 0.0)
            .expect_err("out-of-range coefficients must be rejected");
        assert!(
            error.contains("fixed-point range"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn disabled_band_keeps_metadata_and_zeros_gain() {
        let mut filter = make_filter(2, 1000, 5.0, 1.0);
        filter.enabled = false;
        let packet = WalkplayProtocol::build_filter_write_packet(2, &filter, 96000.0, 0.0).unwrap();

        assert_eq!(u16::from_le_bytes([packet[27], packet[28]]), 1000);
        assert_eq!(u16::from_le_bytes([packet[29], packet[30]]), 256);
        assert_eq!(i16::from_le_bytes([packet[31], packet[32]]), 0);
    }

    #[test]
    fn disabled_pass_filters_use_identity_encoding() {
        for filter_type in [FilterType::HighPass, FilterType::LowPass] {
            let mut filter = make_filter(0, 1000, 5.0, 1.0);
            filter.filter_type = filter_type;
            filter.enabled = false;
            let packet =
                WalkplayProtocol::build_filter_write_packet(0, &filter, 96000.0, 0.0).unwrap();
            let identity = compute_iir_filter(FilterType::Peak, 1000.0, 0.0, 1.0, 96000.0).unwrap();
            assert_eq!(packet[33], u8::from(FilterType::Peak));
            assert_eq!(&packet[7..27], &identity);
        }
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
        assert_eq!(packets[0].payload[1], CMD_TEMP_WRITE);
        assert_eq!(packets[1].payload[1], CMD_FLASH_EQ);
    }

    #[test]
    fn build_ram_apply_packets_matches_temp_apply_sequence() {
        let packets = WalkplayProtocol::build_ram_apply_packets();
        assert_eq!(
            packets[0].payload,
            vec![
                WRITE,
                CMD_TEMP_WRITE,
                CONST_TEMP_WRITE_LEN,
                0,
                0,
                255,
                255,
                END
            ]
        );
        assert_eq!(packets[1].payload, vec![WRITE, CMD_FLASH_EQ, END]);
    }

    #[test]
    fn write_timing_uses_validated_pacing() {
        // Validated against EPZ TP35 Pro hardware: full push verifies via
        // readback compare, pulls are byte-identical across repeats.
        let timing = WalkplayProtocol::write_timing();
        assert_eq!(timing.commit_step_ms, 200);
        assert_eq!(timing.flood_delay_ms, 15);
        assert_eq!(timing.post_gain_read_ms, 20);
        assert_eq!(timing.per_filter_ms, 40);
        assert_eq!(timing.batch_ms, 50);
        assert_eq!(timing.global_gain_ms, 20);
        assert_eq!(timing.init_ms, 20);
    }

    #[test]
    fn walkplay_resends_unanswered_reads() {
        assert_eq!(WalkplayProtocol.resend_unanswered_after(), Some(15));
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
    fn filter_response_validity_rejects_unknown_filter_type() {
        let mut data = vec![0u8; 34];
        data[OFFSET_CMD_TYPE] = READ;
        data[OFFSET_CMD] = CMD_PEQ_VALUES;
        data[OFFSET_NONCE] = 0x42;
        data[OFFSET_INDEX] = 0;
        data[27..29].copy_from_slice(&1000u16.to_le_bytes());
        data[29..31].copy_from_slice(&256u16.to_le_bytes());
        data[31..33].copy_from_slice(&0i16.to_le_bytes());
        data[OFFSET_FILTER_TYPE] = 0xff;
        assert!(!WalkplayProtocol.is_filter_response_valid(&data, 0, 0x42));
        data[OFFSET_FILTER_TYPE] = 2;
        assert!(WalkplayProtocol.is_filter_response_valid(&data, 0, 0x42));
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
    fn parse_invalid_filter_packet_restores_defaults() {
        let mut data = vec![0u8; FILTER_RESPONSE_MIN_LEN];
        data[OFFSET_INDEX] = 3;

        let filter = parse_filter_packet(&data).expect("invalid slots still produce a safe filter");
        assert_eq!(filter.index, 3);
        assert_eq!(filter.freq, 250);
        assert_eq!(filter.q, 0.75);
        assert_eq!(filter.gain, 0.0);
        assert_eq!(filter.filter_type, FilterType::Peak);
        assert!(filter.enabled);
    }

    #[test]
    fn parse_sentinel_filter_packet_restores_defaults() {
        let mut data = vec![0u8; FILTER_RESPONSE_MIN_LEN];
        data[OFFSET_INDEX] = 5;
        data[27..29].copy_from_slice(&u16::MAX.to_le_bytes());
        data[29..31].copy_from_slice(&u16::MAX.to_le_bytes());

        let filter =
            parse_filter_packet(&data).expect("sentinel slots still produce a safe filter");
        assert_eq!(filter.freq, 1000);
        assert_eq!(filter.q, 0.75);
        assert_eq!(filter.gain, 0.0);
        assert_eq!(filter.filter_type, FilterType::Peak);
    }

    #[test]
    fn compute_iir_filter_produces_20_bytes() {
        assert_eq!(
            compute_iir_filter(FilterType::Peak, 1000.0, 5.0, 1.0, 96000.0)
                .unwrap()
                .len(),
            20
        );
    }

    #[test]
    fn compute_iir_filter_lowpass_highpass_valid() {
        let lp_arr = compute_iir_filter(FilterType::LowPass, 1000.0, 0.0, 0.707, 96000.0).unwrap();
        assert_eq!(lp_arr.len(), 20);
        let hp_arr = compute_iir_filter(FilterType::HighPass, 1000.0, 0.0, 0.707, 96000.0).unwrap();
        assert_eq!(hp_arr.len(), 20);
    }

    #[test]
    fn parse_filter_packet_too_short() {
        assert!(parse_filter_packet(&[0u8; 10]).is_none());
    }
}
