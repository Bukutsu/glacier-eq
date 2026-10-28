// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::device::families::walkplay::{compute_iir_filter, decode_q30_biquad};
use crate::device::packet::{checked_scaled_i16, checked_scaled_u16, Packet};
use crate::device::protocol::{EqProtocol, GainEncoding, Protocol, Quirks};
use crate::device::timing::WriteTiming;
use crate::eq::filter::DEFAULT_FREQS_10_BAND;
use crate::eq::iir_math::{compute_biquad_coeffs_for_model, EqResponseModel};
use crate::eq::{Filter, FilterType, PEQData};

// DAWN PRO 2 (35D8:011D), referenced against dawnpro2-studio
// fec08ac5db4835575747849172a7299f6f0d4b7f, firmware 1.5.
const BAND_COUNT: u8 = 8;
const DSP_SAMPLE_RATE: f64 = 96_000.0;
const CUSTOM_EQ_SELECT: u8 = 7;

pub static PROTOCOL: Protocol = Protocol {
    id: "Moondrop",
    eq: Some(&MoondropProtocol),
};

pub struct MoondropProtocol;

fn command(op: u8, cmd: u8, data: &[u8]) -> Packet {
    let mut payload = vec![op, cmd, data.len() as u8];
    payload.extend_from_slice(data);
    Packet::padded(0x4B, payload, 63)
}

fn enable_all_bands() -> Packet {
    command(0x01, 0x0A, &[0, 0, 0xFF, 0xFF])
}

// DAWN PRO 2 uses shelf slope in the Q field. Share that designer with
// response evaluation; keep the device's signed Q30 rounding here.
fn coefficient_bytes(filter: &Filter, gain: f64) -> Result<[u8; 20], String> {
    if filter.filter_type == FilterType::Peak {
        return compute_iir_filter(
            FilterType::Peak,
            filter.freq as f64,
            gain,
            filter.q,
            DSP_SAMPLE_RATE,
        );
    }
    let model = EqResponseModel::MoondropShelfSlope;
    model.validate_parameters(filter.filter_type, gain, filter.q)?;
    let (b0, b1, b2, a0, a1, a2) = compute_biquad_coeffs_for_model(
        filter.filter_type,
        filter.freq as f64,
        gain,
        filter.q,
        DSP_SAMPLE_RATE,
        model,
    );
    let mut bytes = [0; 20];
    for (index, value) in [b0, b1, b2, a1, a2].into_iter().enumerate() {
        let rounded = (value / a0 * (1u64 << 30) as f64 + 0.5).floor();
        let wire = if index >= 3 { -rounded } else { rounded };
        if !wire.is_finite() || !(i32::MIN as f64..=i32::MAX as f64).contains(&wire) {
            return Err("DAWN PRO 2 shelf coefficient exceeds the signed Q30 fixed-point range; reduce gain or shelf Q".into());
        }
        bytes[index * 4..index * 4 + 4].copy_from_slice(&(wire as i32).to_le_bytes());
    }
    Ok(bytes)
}

impl EqProtocol for MoondropProtocol {
    fn realized_biquad(
        &self,
        filter: &Filter,
        sample_rate: f64,
    ) -> Result<(f64, f64, f64, f64, f64, f64), String> {
        if sample_rate != DSP_SAMPLE_RATE {
            return Err("DAWN PRO 2 coefficients require a 96000 Hz DSP rate".into());
        }
        // Disabled bands use a firmware bypass code, not their zero wire coefficients.
        if !filter.enabled {
            return Ok((1.0, 0.0, 0.0, 1.0, 0.0, 0.0));
        }
        self.response_model()
            .validate_parameters(filter.filter_type, filter.gain, filter.q)?;
        Ok(decode_q30_biquad(&coefficient_bytes(filter, filter.gain)?))
    }

    fn realized_preamp(&self, requested: f64) -> f64 {
        // The advertised 0.1 dB grid does not align with the signed Q8 wire grid.
        (requested * 256.0).round() / 256.0
    }

    fn q_step(&self) -> Option<f64> {
        Some(1.0 / 256.0)
    }

    fn response_model(&self) -> EqResponseModel {
        EqResponseModel::MoondropShelfSlope
    }

    fn gain_encoding(&self) -> GainEncoding {
        GainEncoding {
            band_units_per_db: 256.0,
            band_step_db: None,
            band_readback_per_db: 10.0,
            preamp_step_db: 0.1,
        }
    }

    fn write_timing(&self) -> WriteTiming {
        WriteTiming {
            // The session delays between bands, not between each packet in a
            // band. Keep a conservative 150 ms interval between bands; exact
            // activation/preamp/band pacing needs session-level packet delays.
            per_filter_ms: 150,
            batch_ms: 50,
            global_gain_ms: 50,
            commit_step_ms: 200,
            flood_delay_ms: 50,
            post_gain_read_ms: 50,
            init_ms: 50,
            packet_gap_ms: 0,
        }
    }

    fn is_default_state(&self, peq: &PEQData) -> bool {
        peq.global_gain == 0.0 && peq.filters.iter().all(|f| !f.enabled || f.gain == 0.0)
    }

    fn init_packets(&self) -> Vec<Packet> {
        vec![]
    }

    fn read_filter_request(&self, index: u8, _nonce: u8) -> Packet {
        command(0x80, 0x09, &[0, index])
    }

    fn matches_filter_response(&self, data: &[u8], index: u8, _nonce: u8) -> bool {
        index < BAND_COUNT
            && data.len() >= 34
            && data[0] == 0x80
            && data[1] == 0x09
            && data[4] == index
    }

    fn is_filter_packet_valid(&self, data: &[u8]) -> bool {
        if data.len() < 34 || data[4] >= BAND_COUNT || !matches!(data[33], 0..=3) {
            return false;
        }
        let raw_freq = u16::from_le_bytes([data[27], data[28]]);
        let raw_q = u16::from_le_bytes([data[29], data[30]]);
        let q = raw_q as f64 / 256.0;
        raw_freq != 0
            && raw_freq != u16::MAX
            && raw_freq <= 20000
            && raw_q != u16::MAX
            && q > 0.0
            && q <= 10.0
    }

    fn is_filter_response_valid(&self, data: &[u8], index: u8, _nonce: u8) -> bool {
        self.matches_filter_response(data, index, _nonce) && self.is_filter_packet_valid(data)
    }

    fn parse_filter_response(&self, data: &[u8]) -> Option<Filter> {
        if data.len() < 34 || data[4] >= BAND_COUNT {
            return None;
        }
        let raw_freq = u16::from_le_bytes([data[27], data[28]]);
        let q_raw = u16::from_le_bytes([data[29], data[30]]);
        let gain_raw = i16::from_le_bytes([data[31], data[32]]);
        let raw_q = q_raw as f64 / 256.0;
        let invalid = !matches!(data[33], 0..=3)
            || raw_freq == 0
            || raw_freq == u16::MAX
            || raw_freq > 20000
            || q_raw == u16::MAX
            || !(raw_q > 0.0 && raw_q <= 10.0);
        let enabled = !invalid && data[33] != 0;
        let (freq, q, gain, filter_type) = if invalid {
            (default_freq(data[4]), 0.75, 0.0, FilterType::Peak)
        } else {
            (
                raw_freq,
                (raw_q * 100.0).round() / 100.0,
                ((gain_raw as f64 / 256.0) * 10.0).round() / 10.0,
                match data[33] {
                    1 => FilterType::LowShelf,
                    3 => FilterType::HighShelf,
                    _ => FilterType::Peak,
                },
            )
        };

        Some(Filter {
            index: data[4],
            enabled,
            freq,
            gain,
            q,
            filter_type,
        })
    }

    fn read_global_gain_request(&self) -> Packet {
        command(0x80, 0x23, &[])
    }

    fn matches_global_gain_response(&self, data: &[u8]) -> bool {
        data.len() >= 5 && data[0] == 0x80 && data[1] == 0x23
    }

    fn parse_global_gain_response(&self, data: &[u8]) -> Option<f64> {
        if !self.matches_global_gain_response(data) {
            return None;
        }
        let raw = i16::from_le_bytes([*data.get(3)?, *data.get(4)?]);
        Some((raw as f64 / 256.0 * 10.0).round() / 10.0)
    }

    fn write_filter_packets(
        &self,
        index: u8,
        filter: &Filter,
        dsp_sample_rate: f64,
        global_gain: f64,
    ) -> Result<Vec<Packet>, String> {
        if index >= BAND_COUNT {
            return Err("DAWN PRO 2 band index must be 0..7".into());
        }
        if dsp_sample_rate != DSP_SAMPLE_RATE {
            return Err("DAWN PRO 2 coefficients require a 96000 Hz DSP rate".into());
        }
        if !(20..=20_000).contains(&filter.freq)
            || !filter.q.is_finite()
            || !(0.1..=10.0).contains(&filter.q)
            || !filter.gain.is_finite()
            || !(-18.0..=12.0).contains(&filter.gain)
            || !matches!(
                filter.filter_type,
                FilterType::Peak | FilterType::LowShelf | FilterType::HighShelf
            )
        {
            return Err("DAWN PRO 2 band parameters are outside device limits".into());
        }
        if !global_gain.is_finite() || !(-128.0..=0.0).contains(&global_gain) {
            return Err("DAWN PRO 2 preamp must be between -128 and 0 dB".into());
        }
        let gain = if filter.enabled { filter.gain } else { 0.0 };
        let gain_wire = checked_scaled_i16(gain, 256.0, "Moondrop band gain")?;
        let q_wire = checked_scaled_u16(filter.q, 256.0, "Moondrop filter Q")?;
        // Disabled is a real device filter code, with zero coefficient bytes.
        let coeffs = if filter.enabled {
            coefficient_bytes(filter, gain)?
        } else {
            [0; 20]
        };
        let mut payload = vec![0; 63];
        payload[0] = 0x01;
        payload[1] = 0x09;
        payload[2] = 33;
        payload[4] = index;
        payload[7..27].copy_from_slice(&coeffs);
        payload[27..29].copy_from_slice(&filter.freq.to_le_bytes());
        payload[29..31].copy_from_slice(&q_wire.to_le_bytes());
        payload[31..33].copy_from_slice(&gain_wire.to_le_bytes());
        payload[33] = if filter.enabled {
            u8::from(filter.filter_type)
        } else {
            0
        };
        payload[35] = CUSTOM_EQ_SELECT;

        let mut packets = Vec::new();
        if index == 0 {
            // init_packets also runs on pulls, so activation belongs only here.
            // The stateless trait cannot compare old/new preamp or restore a
            // temporary mute after I/O failure. Hold finite attenuation instead
            // of the reference's -128 dB mute until the final preamp write.
            // This reduces transient clipping; it cannot guarantee headroom for
            // arbitrary previously loaded or overlapping boosted bands.
            packets.extend(self.write_global_gain_packets(global_gain.min(-18.0)));
            packets.push(command(0x01, 0x0F, &[CUSTOM_EQ_SELECT]));
        }
        packets.push(Packet::new(0x4B, payload));
        // The session writes all eight bands in order. Latch once, after the
        // final band, rather than applying partially written coefficients.
        if index == BAND_COUNT - 1 {
            packets.push(enable_all_bands());
        }
        Ok(packets)
    }

    fn write_global_gain_packets(&self, global_gain: f64) -> Vec<Packet> {
        // PEQData.global_gain is the PEQ preamp (0x23), not DAC offset (0x03).
        let value = (global_gain * 256.0).round() as i16;
        vec![command(0x01, 0x23, &value.to_le_bytes())]
    }

    fn commit_packets(&self) -> Vec<Packet> {
        vec![command(0x01, 0x01, &[]), command(0x01, 0x04, &[])]
    }

    fn ram_apply_packets(&self) -> Vec<Packet> {
        // Band 7 already latches all coefficients; flash saves are commit-only.
        vec![]
    }

    fn quirks(&self) -> Quirks {
        Quirks {
            set_report_writes: true,
            ..Quirks::default()
        }
    }

    fn report_id(&self) -> u8 {
        0x4B
    }
}

fn default_freq(index: u8) -> u16 {
    DEFAULT_FREQS_10_BAND
        .get(index as usize)
        .copied()
        .unwrap_or(1000)
}
