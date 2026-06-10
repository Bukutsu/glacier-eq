// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

//! `DeviceProtocol` trait — the only interface a new device implementation must satisfy.
//!
//! See `CONTRIBUTING_DEVICES.md` for a step-by-step guide and annotated skeleton.

use crate::device::timing::{ReadTiming, WriteTiming};
use crate::eq::{Filter, PEQData};

/// Hardware-specific packet building and response matching for a USB DAC.
///
/// Each supported device has exactly one struct implementing this trait, living in
/// `src/hardware/devices/<vendor>/`. The hardware layer (`hid.rs`, `packet_builder.rs`)
/// calls these methods and knows nothing about any specific wire format.
///
/// ## Contract
///
/// * `data` parameters passed to `matches_*` and `parse_*` are **offset-adjusted** —
///   the HID report-ID prefix byte has already been stripped when `buf[0] == report_id()`.
/// * `matches_*` must return `false` rather than panic on short or malformed packets.
/// * `parse_*` returning `None` is treated as a transient read failure and may be retried.
pub trait DeviceProtocol: Send + Sync {
    /// USB HID report ID byte prepended to every outgoing write buffer.
    fn report_id(&self) -> u8;

    /// Device-specific read timing. Defaults are conservative and safe for most devices.
    fn read_timing(&self) -> ReadTiming {
        ReadTiming::default()
    }

    /// Device-specific write timing.
    fn write_timing(&self) -> WriteTiming {
        WriteTiming::default()
    }

    // ── Session init ─────────────────────────────────────────────────────────

    /// Ordered packets to send once at the start of every read or write operation
    /// (typically a version ping to wake the device and flush stale USB frames).
    /// Defaults to an empty sequence — override if the device needs init packets.
    fn build_init_packets(&self) -> Vec<Vec<u8>> {
        Vec::new()
    }

    // ── Filter read ──────────────────────────────────────────────────────────

    /// Packet payload asking the device to send back filter at `index`.
    /// `nonce` must appear in the response so the caller can correlate request → reply.
    fn build_filter_read_request(&self, index: u8, nonce: u8) -> Vec<u8>;

    /// Return `true` if `data` is the device's response to a filter read for `index` /
    /// `nonce`. Called for every incoming packet; must be cheap and non-panicking.
    fn matches_filter_response(&self, data: &[u8], index: u8, nonce: u8) -> bool;

    /// Extract a `Filter` from a matched filter response packet.
    /// `data` is the same slice that passed `matches_filter_response`.
    fn parse_filter_response(&self, data: &[u8]) -> Option<Filter>;

    /// Return `true` if the parsed `PEQData` represents the hardware's uninitialized
    /// or empty state, which often necessitates a retry during connection wake-up.
    /// Defaults to `false` for devices that don't have a distinct known "empty" state.
    fn is_default_state(&self, _peq: &PEQData) -> bool {
        false
    }

    // ── Filter write ─────────────────────────────────────────────────────────

    /// Packet payload to write `filter` into band slot `index` in the device's
    /// volatile memory (not yet persisted to flash).
    fn build_filter_write_packet(
        &self,
        index: u8,
        filter: &Filter,
        dsp_sample_rate: f64,
    ) -> Vec<u8>;

    // ── Global gain read ─────────────────────────────────────────────────────

    /// Packet payload asking the device to send back its global gain value.
    fn build_global_gain_request(&self, nonce: u8) -> Vec<u8>;

    /// Return `true` if `data` is the device's response to a global gain read.
    fn matches_global_gain_response(&self, data: &[u8], nonce: u8) -> bool;

    /// Extract the global gain in dB from a matched global gain response packet.
    fn parse_global_gain_response(&self, data: &[u8]) -> Option<i8>;

    // ── Global gain write ────────────────────────────────────────────────────

    /// Packet payload to write `gain` dB as the device's global preamp value.
    fn build_global_gain_write_packet(&self, gain: i8) -> Vec<u8>;

    // ── Commit ───────────────────────────────────────────────────────────────

    /// Ordered sequence of packets that persist the current volatile EQ state to
    /// the device's flash memory. Each `Vec<u8>` is one HID report payload.
    /// `packet_builder::commit_changes` sends them with `WriteTiming::commit_step_ms`
    /// delay between each. Defaults to an empty sequence — override if the device
    /// needs commit packets.
    fn build_commit_packets(&self) -> Vec<Vec<u8>> {
        Vec::new()
    }

    // ── Recovery ─────────────────────────────────────────────────────────────

    /// Ordered sequence of packets that reset the device to a "Safe" state (flat EQ,
    /// zero gain). Used for recovery when a normal transaction fails catastrophically.
    ///
    /// The default implementation builds a sequence that writes flat filters for all
    /// supported bands and sets global gain to 0.
    fn build_reset_packets(&self, num_bands: usize, dsp_sample_rate: f64) -> Vec<Vec<u8>> {
        let mut packets = Vec::with_capacity(num_bands + 1);
        for i in 0..num_bands {
            let filter = Filter::enabled(i as u8, false);
            packets.push(self.build_filter_write_packet(i as u8, &filter, dsp_sample_rate));
        }
        packets.push(self.build_global_gain_write_packet(0));
        packets
    }

    /// Instantiate a packet framer for this protocol's transport.
    fn framer(&self) -> Box<dyn crate::device::io::PacketFramer> {
        Box::new(crate::device::io::HidPacketFramer::new(self.report_id()))
    }
}
