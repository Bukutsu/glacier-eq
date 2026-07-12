// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::device::protocol::{EqProtocol, Packet};
use crate::device::walkplay::compute_iir_filter;
use crate::eq::filter::DEFAULT_FREQS_10_BAND;
use crate::eq::{Filter, FilterType};

pub struct MoondropProtocol;

impl EqProtocol for MoondropProtocol {
    fn read_filter_request(&self, index: u8, _nonce: u8) -> Packet {
        Packet::padded(0x4B, vec![0x80, 0x09, 0x18, 0x00, index], 63)
    }

    fn matches_filter_response(&self, data: &[u8], index: u8, _nonce: u8) -> bool {
        data.len() >= 34 && data[0] == 0x80 && data[1] == 0x09 && data[4] == index
    }

    fn parse_filter_response(&self, data: &[u8]) -> Option<Filter> {
        if data.len() < 34 {
            return None;
        }
        let mut freq = u16::from_le_bytes([data[27], data[28]]);
        let q_raw = u16::from_le_bytes([data[29], data[30]]);
        let gain_raw = i16::from_le_bytes([data[31], data[32]]);
        let mut q = ((q_raw as f64 / 256.0) * 100.0).round() / 100.0;
        let mut gain = ((gain_raw as f64 / 256.0) * 10.0).round() / 10.0;
        let mut filter_type = match data[33] {
            1 => FilterType::LowShelf,
            3 => FilterType::HighShelf,
            _ => FilterType::Peak,
        };

        if freq == 0 || q <= 0.0 {
            freq = default_freq(data[4]);
            q = 0.75;
            gain = 0.0;
            filter_type = FilterType::Peak;
        }

        Some(Filter {
            index: data[4],
            enabled: true,
            freq,
            gain,
            q,
            filter_type,
        })
    }

    fn read_global_gain_request(&self) -> Packet {
        Packet::padded(0x4B, vec![0x80, 0x23], 63)
    }

    fn matches_global_gain_response(&self, data: &[u8]) -> bool {
        data.len() >= 5 && data[0] == 0x80 && data[1] == 0x23
    }

    fn parse_global_gain_response(&self, data: &[u8]) -> Option<f64> {
        let raw = i16::from_le_bytes([*data.get(3)?, *data.get(4)?]);
        Some((raw as f64 / 256.0 * 10.0).round() / 10.0)
    }

    fn write_filter_packets(
        &self,
        index: u8,
        filter: &Filter,
        dsp_sample_rate: f64,
        _global_gain: f64,
    ) -> Result<Vec<Packet>, String> {
        let gain = if filter.enabled { filter.gain } else { 0.0 };
        let coeffs = compute_iir_filter(
            filter.filter_type,
            filter.freq as f64,
            gain,
            filter.q,
            dsp_sample_rate,
        );
        let mut payload = vec![0; 63];
        payload[0] = 0x01;
        payload[1] = 0x09;
        payload[2] = 0x18;
        payload[4] = index;
        payload[7..27].copy_from_slice(&coeffs);
        payload[27..29].copy_from_slice(&filter.freq.to_le_bytes());
        payload[29..31].copy_from_slice(&((filter.q * 256.0).round() as u16).to_le_bytes());
        payload[31..33].copy_from_slice(&((gain * 256.0).round() as i16).to_le_bytes());
        payload[33] = filter_type_code(filter.filter_type);

        let mut trigger = vec![0; 63];
        trigger[0] = 0x01;
        trigger[1] = 0x0A;
        trigger[2] = index;
        trigger[4] = 0xFF;
        trigger[5] = 0xFF;
        trigger[6] = 0xFF;

        Ok(vec![Packet::new(0x4B, payload), Packet::new(0x4B, trigger)])
    }

    fn write_global_gain_packets(&self, global_gain: f64) -> Vec<Packet> {
        let value = (global_gain * 256.0).round() as i16;
        let [lo, hi] = value.to_le_bytes();
        let mut payload = vec![0x01, 0x23, 0x00, lo, hi];
        payload.resize(63, 0);
        vec![Packet::new(0x4B, payload)]
    }

    fn commit_packets(&self) -> Vec<Packet> {
        vec![Packet::padded(0x4B, vec![0x01, 0x01], 63)]
    }

    fn ram_apply_packets(&self) -> Vec<Packet> {
        // Aura applies Moondrop RAM per band via UPDATE_EQ_COEFF; SAVE_FLASH is commit-only.
        vec![]
    }

    fn report_id(&self) -> u8 {
        0x4B
    }
}

fn filter_type_code(filter_type: FilterType) -> u8 {
    match filter_type {
        FilterType::LowShelf => 1,
        FilterType::HighShelf => 3,
        _ => 2,
    }
}

fn default_freq(index: u8) -> u16 {
    DEFAULT_FREQS_10_BAND
        .get(index as usize)
        .copied()
        .unwrap_or(1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_filter_response() {
        let mut data = vec![0u8; 63];
        data[0] = 0x80;
        data[1] = 0x09;
        data[4] = 2;
        data[27..29].copy_from_slice(&1000u16.to_le_bytes());
        data[29..31].copy_from_slice(&256u16.to_le_bytes());
        data[31..33].copy_from_slice(&(-384i16).to_le_bytes());
        data[33] = 3;

        let filter = MoondropProtocol.parse_filter_response(&data).unwrap();

        assert_eq!(filter.index, 2);
        assert_eq!(filter.freq, 1000);
        assert_eq!(filter.gain, -1.5);
        assert_eq!(filter.q, 1.0);
        assert_eq!(filter.filter_type, FilterType::HighShelf);
    }

    #[test]
    fn writes_filter_and_trigger_packets() {
        let filter = Filter {
            index: 0,
            enabled: true,
            freq: 1000,
            gain: 1.5,
            q: 0.75,
            filter_type: FilterType::Peak,
        };

        let packets = MoondropProtocol
            .write_filter_packets(0, &filter, 48000.0, 0.0)
            .unwrap();

        assert_eq!(packets.len(), 2);
        assert_eq!(packets[0].report_id, 0x4B);
        assert_eq!(packets[0].payload[1], 0x09);
        assert_eq!(packets[0].payload[33], 2);
        assert_eq!(packets[1].payload[1], 0x0A);
        assert_eq!(&packets[1].payload[4..7], &[0xFF, 0xFF, 0xFF]);
    }
}
