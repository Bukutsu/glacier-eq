// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::device::protocol::{EqProtocol, Packet};
use crate::eq::{Filter, FilterType};

const SET_1: u8 = 0xAA;
const SET_2: u8 = 0x0A;
const END: u8 = 0xEE;
const FILTER_PARAMS: u8 = 0x15;
const GLOBAL_GAIN: u8 = 0x17;

#[derive(Clone, Copy)]
enum Endian {
    Little,
    Big,
}

#[derive(Clone, Copy)]
pub struct FiioProtocol {
    report_id: u8,
    gain_scale: f64,
    endian: Endian,
    save_command: u8,
    clamp_gain: bool,
}

pub const JA11_PROTOCOL: FiioProtocol = FiioProtocol {
    report_id: 2,
    gain_scale: 2560.0,
    endian: Endian::Little,
    save_command: 0x18,
    clamp_gain: true,
};

pub const FIIO_PROTOCOL: FiioProtocol = FiioProtocol {
    report_id: 7,
    gain_scale: 10.0,
    endian: Endian::Big,
    save_command: 0x19,
    clamp_gain: false,
};

fn unsupported_read_filter(index: u8, report_id: u8) -> Packet {
    Packet::new(
        report_id,
        vec![0xBB, 0x0B, 0, 0, FILTER_PARAMS, 1, index, END],
    )
}

fn filter_type_from_fiio(code: u8) -> FilterType {
    match code {
        1 => FilterType::LowShelf,
        2 => FilterType::HighShelf,
        _ => FilterType::Peak,
    }
}

fn filter_type_to_fiio(filter_type: FilterType) -> u8 {
    match filter_type {
        FilterType::LowShelf => 1,
        FilterType::HighShelf => 2,
        _ => 0,
    }
}

fn parse_filter_response(data: &[u8]) -> Option<Filter> {
    if data.len() < 14 {
        return None;
    }

    let gain_raw = i16::from_be_bytes([data[7], data[8]]);
    let freq = u16::from_be_bytes([data[9], data[10]]);
    let q_raw = u16::from_be_bytes([data[11], data[12]]);

    Some(Filter {
        index: data[6],
        enabled: true,
        freq,
        gain: ((gain_raw as f64 / 10.0) * 10.0).round() / 10.0,
        q: ((q_raw as f64 / 100.0) * 100.0).round() / 100.0,
        filter_type: filter_type_from_fiio(data[13]),
    })
}

fn write_filter_packet(report_id: u8, index: u8, filter: &Filter) -> Packet {
    let gain = (filter.gain * 10.0).round() as i16;
    let freq = filter.freq;
    let q = (filter.q * 100.0).round() as u16;
    Packet::new(
        report_id,
        vec![
            SET_1,
            SET_2,
            0,
            0,
            FILTER_PARAMS,
            8,
            index,
            (gain >> 8) as u8,
            gain as u8,
            (freq >> 8) as u8,
            freq as u8,
            (q >> 8) as u8,
            q as u8,
            filter_type_to_fiio(filter.filter_type),
            0,
            END,
        ],
    )
}

fn write_global_gain_packet(report_id: u8, global_gain: f64, scale: f64, endian: Endian) -> Packet {
    let value = (global_gain * scale).round() as i16;
    let [first, second] = match endian {
        Endian::Little => value.to_le_bytes(),
        Endian::Big => value.to_be_bytes(),
    };
    Packet::new(
        report_id,
        vec![SET_1, SET_2, 0, 0, GLOBAL_GAIN, 2, first, second, 0, END],
    )
}

fn save_packet(report_id: u8, command: u8) -> Packet {
    Packet::new(report_id, vec![SET_1, SET_2, 0, 0, command, 1, 1, 0, END])
}

impl EqProtocol for FiioProtocol {
    fn read_filter_request(&self, index: u8, _nonce: u8) -> Packet {
        unsupported_read_filter(index, self.report_id)
    }

    fn matches_filter_response(&self, data: &[u8], index: u8, _nonce: u8) -> bool {
        data.len() >= 14 && data[4] == FILTER_PARAMS && data[6] == index
    }

    fn parse_filter_response(&self, data: &[u8]) -> Option<Filter> {
        parse_filter_response(data)
    }

    fn read_global_gain_request(&self) -> Packet {
        Packet::new(
            self.report_id,
            vec![0xBB, 0x0B, 0, 0, GLOBAL_GAIN, 0, 0, END],
        )
    }

    fn matches_global_gain_response(&self, data: &[u8]) -> bool {
        data.len() >= 8 && data[4] == GLOBAL_GAIN
    }

    fn parse_global_gain_response(&self, data: &[u8]) -> Option<f64> {
        let bytes = [*data.get(6)?, *data.get(7)?];
        let raw = match self.endian {
            Endian::Little => i16::from_le_bytes(bytes),
            Endian::Big => i16::from_be_bytes(bytes),
        };
        Some((raw as f64 / self.gain_scale * 10.0).round() / 10.0)
    }

    fn write_filter_packets(
        &self,
        index: u8,
        filter: &Filter,
        _dsp_sample_rate: f64,
        _global_gain: f64,
    ) -> Result<Vec<Packet>, String> {
        Ok(vec![write_filter_packet(self.report_id, index, filter)])
    }

    fn write_global_gain_packets(&self, global_gain: f64) -> Vec<Packet> {
        let gain = if self.clamp_gain {
            global_gain.clamp(-12.0, 12.0)
        } else {
            global_gain
        };
        vec![write_global_gain_packet(
            self.report_id,
            gain,
            self.gain_scale,
            self.endian,
        )]
    }

    fn commit_packets(&self) -> Vec<Packet> {
        vec![save_packet(self.report_id, self.save_command)]
    }

    fn report_id(&self) -> u8 {
        self.report_id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ja11_parses_filter_response() {
        let data = [
            0xCC,
            0x0C,
            0,
            0,
            FILTER_PARAMS,
            8,
            3,
            0xFF,
            0xF1,
            0x03,
            0xE8,
            0x00,
            0x64,
            1,
        ];

        let filter = JA11_PROTOCOL.parse_filter_response(&data).unwrap();

        assert_eq!(filter.index, 3);
        assert_eq!(filter.gain, -1.5);
        assert_eq!(filter.freq, 1000);
        assert_eq!(filter.q, 1.0);
        assert_eq!(filter.filter_type, FilterType::LowShelf);
    }

    #[test]
    fn ja11_writes_global_gain_little_endian() {
        let packet = JA11_PROTOCOL.write_global_gain_packets(1.0).remove(0);

        assert_eq!(packet.report_id, 2);
        assert_eq!(packet.payload[4], GLOBAL_GAIN);
        assert_eq!(&packet.payload[6..8], &2560i16.to_le_bytes());
    }

    #[test]
    fn fiio_writes_global_gain_big_endian() {
        let packet = FIIO_PROTOCOL.write_global_gain_packets(1.0).remove(0);

        assert_eq!(packet.report_id, 7);
        assert_eq!(packet.payload[4], GLOBAL_GAIN);
        assert_eq!(&packet.payload[6..8], &10i16.to_be_bytes());
    }
}
