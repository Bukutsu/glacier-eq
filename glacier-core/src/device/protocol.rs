// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! The `EqProtocol` trait every hardware-EQ family implements.

use crate::device::packet::Packet;
use crate::device::timing::WriteTiming;
use crate::eq::{Filter, PEQData};

/// Per-model behavior that changes how the shared read/write/verify flow runs.
#[derive(Clone, Copy, Default)]
pub struct Quirks {
    /// Some firmware never answers the global-gain query (JCally JM12
    /// cross-flashed with JA11 firmware). When true, an unanswered gain read
    /// is reported as unknown instead of failing the whole read, matching
    /// Ircama/ja11-config's best-effort behavior.
    pub gain_read_optional: bool,
    /// The DAC re-enumerates on USB shortly after the save command (JA11, as
    /// devicePEQ's `disconnectOnSave` records). Nothing may be read or written
    /// after the save, so pushes verify the RAM state first and save last.
    pub save_resets_device: bool,
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
    fn quirks(&self) -> Quirks {
        Quirks::default()
    }
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
