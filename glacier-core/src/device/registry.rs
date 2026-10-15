// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Maps a `DeviceProtocol` to its `EqProtocol` implementation.

use crate::device::families::{fiio, moondrop::MoondropProtocol, walkplay::WalkplayProtocol};
use crate::device::packet::Packet;
use crate::device::profile::DeviceProtocol;
use crate::device::protocol::EqProtocol;
use crate::device::timing::WriteTiming;
use crate::eq::{Filter, PEQData};

static WALKPLAY_PROTOCOL: WalkplayProtocol = WalkplayProtocol;
static MOONDROP_PROTOCOL: MoondropProtocol = MoondropProtocol;

impl DeviceProtocol {
    pub(crate) fn implementation(&self) -> &'static dyn EqProtocol {
        match self {
            DeviceProtocol::Walkplay => &WALKPLAY_PROTOCOL,
            DeviceProtocol::Moondrop => &MOONDROP_PROTOCOL,
            DeviceProtocol::FiioKa17 => &fiio::KA17_PROTOCOL,
            DeviceProtocol::FiioJa11 => &fiio::JA11_PROTOCOL,
            DeviceProtocol::Fiio => &fiio::FIIO_PROTOCOL,
            DeviceProtocol::DawnPro | DeviceProtocol::Unknown => {
                // Callers check has_hardware_eq() before driving EQ; these
                // profiles exist for matching and non-EQ controls only.
                panic!("{} has no hardware EQ implementation", self.name())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ka17_dispatch_uses_its_model_protocol() {
        let protocol = DeviceProtocol::FiioKa17;
        assert_eq!(protocol.report_id(), 1);
        assert_eq!(
            protocol.read_global_gain_request().framed(),
            fiio::KA17_PROTOCOL.read_global_gain_request().framed()
        );
        assert_eq!(
            protocol.commit_packets()[0].framed(),
            fiio::KA17_PROTOCOL.commit_packets()[0].framed()
        );
    }
}
