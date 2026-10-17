// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Walkplay wire constants and filter-packet parsing.

use crate::eq::filter::DEFAULT_FREQS_10_BAND;
use crate::eq::{Filter, FilterType};

// ─── Wire constants ───────────────────────────────────────────────────────────

pub const REPORT_ID: u8 = 0x4B;

pub const CMD_FLASH_EQ: u8 = 0x01;
pub const CMD_GLOBAL_GAIN: u8 = 0x03;
pub const CMD_PEQ_VALUES: u8 = 0x09;
pub const CMD_TEMP_WRITE: u8 = 0x0A;
pub const CMD_VERSION: u8 = 0x0C;

pub const CMD_FILTER_MODE: u8 = 17;
pub const CMD_AMP_MODE: u8 = 29;
pub const CMD_GAIN_MODE: u8 = 25;
pub const CMD_MIC_VOLUME: u8 = 2;
pub const CMD_BALANCE: u8 = 22;
/// `01 17 00`: restores the filter, amp mode and balance to the DAC's defaults
/// and reloads the stored EQ. The official app sends it in every reset and commit.
pub const CMD_RESTORE_DEFAULTS: u8 = 23;

/// The DAC's HID polling interval. The official WalkPlay app paces every report by it.
pub const HID_INTERVAL_MS: u64 = 16;

pub const READ: u8 = 0x80;
pub const WRITE: u8 = 0x01;
pub const END: u8 = 0x00;

pub const CONST_TEMP_WRITE_MAGIC_A: u8 = 0xFF;
pub const CONST_TEMP_WRITE_MAGIC_B: u8 = 0xFF;
pub const CONST_PEQ_PAYLOAD_LEN: u8 = 0x18;
pub const CONST_GLOBAL_GAIN_LEN: u8 = 0x02;
pub const CONST_TEMP_WRITE_LEN: u8 = 0x04;
pub const OFFSET_CMD_TYPE: usize = 0;
pub const OFFSET_CMD: usize = 1;
pub const OFFSET_NONCE: usize = 2;
pub const OFFSET_INDEX: usize = 4;
const OFFSET_FREQ_L: usize = 27;
const OFFSET_FREQ_H: usize = 28;
const OFFSET_Q_L: usize = 29;
const OFFSET_Q_H: usize = 30;
const OFFSET_GAIN_L: usize = 31;
const OFFSET_GAIN_H: usize = 32;
pub(super) const OFFSET_FILTER_TYPE: usize = 33;
pub const OFFSET_GAIN_VALUE: usize = 4;

pub(crate) const FILTER_RESPONSE_MIN_LEN: usize = 34;
pub(crate) const GLOBAL_GAIN_RESPONSE_MIN_LEN: usize = 6;

pub fn convert_to_2byte_array(value: i32) -> [u8; 2] {
    let bytes = value.to_le_bytes();
    [bytes[0], bytes[1]]
}

pub(crate) fn valid_filter_packet(packet: &[u8]) -> bool {
    if packet.len() < FILTER_RESPONSE_MIN_LEN {
        return false;
    }
    let raw_freq = u16::from_le_bytes([packet[OFFSET_FREQ_L], packet[OFFSET_FREQ_H]]);
    let raw_q = u16::from_le_bytes([packet[OFFSET_Q_L], packet[OFFSET_Q_H]]);
    let q = raw_q as f64 / 256.0;
    raw_freq != 0
        && raw_freq != u16::MAX
        && raw_freq <= 24000
        && raw_q != u16::MAX
        && q > 0.0
        && q <= 100.0
        && matches!(packet[OFFSET_FILTER_TYPE], 1..=5)
}

pub fn parse_filter_packet(packet: &[u8]) -> Option<Filter> {
    if packet.len() < FILTER_RESPONSE_MIN_LEN {
        return None;
    }

    let filter_index = packet[OFFSET_INDEX];
    let raw_freq = u16::from_le_bytes([packet[OFFSET_FREQ_L], packet[OFFSET_FREQ_H]]);
    let raw_q = u16::from_le_bytes([packet[OFFSET_Q_L], packet[OFFSET_Q_H]]);
    let raw_gain = i16::from_le_bytes([packet[OFFSET_GAIN_L], packet[OFFSET_GAIN_H]]);
    let q = raw_q as f64 / 256.0;

    // WalkPlay can return erased/uninitialized PEQ slots as zeroes or 0xffff.
    // Do not let those values enter the next push or verification cycle.
    let invalid = !valid_filter_packet(packet);
    let (freq, q, gain, filter_type) = if invalid {
        (
            DEFAULT_FREQS_10_BAND
                .get(filter_index as usize)
                .copied()
                .unwrap_or(1000),
            0.75,
            0.0,
            FilterType::Peak,
        )
    } else {
        (
            raw_freq,
            (q * 100.0).round() / 100.0,
            ((raw_gain as f64) / 256.0 * 100.0).round() / 100.0,
            FilterType::from(packet[OFFSET_FILTER_TYPE]),
        )
    };

    Some(Filter {
        index: filter_index,
        enabled: true,
        freq,
        gain,
        q,
        filter_type,
    })
}
