// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Maps a `DeviceProtocol` to its `EqProtocol` implementation.

use crate::device::families::{fiio, moondrop::MoondropProtocol, walkplay::WalkplayProtocol};
use crate::device::profile::DeviceProtocol;
use crate::device::protocol::{EqProtocol, Quirks};

static WALKPLAY_PROTOCOL: WalkplayProtocol = WalkplayProtocol;
static MOONDROP_PROTOCOL: MoondropProtocol = MoondropProtocol;

impl DeviceProtocol {
    /// The EQ implementation, or `None` for profiles that exist only for
    /// device matching or non-EQ controls. This match is the one place a new
    /// protocol is wired in.
    pub(crate) fn eq_protocol(self) -> Option<&'static dyn EqProtocol> {
        match self {
            DeviceProtocol::Walkplay => Some(&WALKPLAY_PROTOCOL),
            DeviceProtocol::Moondrop => Some(&MOONDROP_PROTOCOL),
            DeviceProtocol::FiioKa17 => Some(&fiio::KA17_PROTOCOL),
            DeviceProtocol::FiioJa11 => Some(&fiio::JA11_PROTOCOL),
            DeviceProtocol::Fiio => Some(&fiio::FIIO_PROTOCOL),
            DeviceProtocol::DawnPro | DeviceProtocol::Unknown => None,
        }
    }

    pub fn has_hardware_eq(self) -> bool {
        self.eq_protocol().is_some()
    }

    /// Default (no quirks) for protocols without hardware EQ.
    pub fn quirks(self) -> Quirks {
        self.eq_protocol()
            .map(|protocol| protocol.quirks())
            .unwrap_or_default()
    }

    /// # Panics
    ///
    /// For protocols without hardware EQ. Callers check `has_hardware_eq()`
    /// before driving EQ.
    pub(crate) fn implementation(&self) -> &'static dyn EqProtocol {
        self.eq_protocol()
            .unwrap_or_else(|| panic!("{} has no hardware EQ implementation", self.name()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::SUPPORTED_DEVICES;
    use crate::eq::Filter;

    /// The contract session/ and wasm.rs rely on, checked for every catalog
    /// profile with hardware EQ, so a new DAC or protocol is covered by
    /// adding its catalog entry.
    #[test]
    fn every_catalog_profile_meets_the_shared_flow_contract() {
        for device in SUPPORTED_DEVICES {
            let Some(protocol) = device.protocol.eq_protocol() else {
                continue;
            };
            let name = device.name;
            let caps = &device.caps;
            let encoding = protocol.gain_encoding();
            assert!(
                encoding.band_units_per_db > 0.0
                    && encoding.band_readback_per_db > 0.0
                    && encoding.preamp_units_per_db > 0.0
                    && encoding.preamp_step_db > 0.0
                    && encoding.band_step_db.is_none_or(|step| step > 0.0),
                "{name}: gain encoding needs positive scales"
            );

            let mut packets = protocol.init_packets();
            packets.extend(protocol.commit_packets());
            packets.extend(protocol.ram_apply_packets());
            packets.push(protocol.read_global_gain_request());
            let (low, high) = caps.global_gain_range;
            for gain in [low, 0, high] {
                let writes = protocol.write_global_gain_packets(gain.into());
                assert!(!writes.is_empty(), "{name}: no preamp write for {gain} dB");
                packets.extend(writes);
            }
            for index in 0..caps.num_bands as u8 {
                packets.push(protocol.read_filter_request(index, 1));
                for &filter_type in caps.supported_filter_types {
                    // 4 kHz: shelves near 1 kHz already overflow Walkplay's
                    // ±2.0 coefficient range at 96 kHz; the encoder rejects them.
                    let filter = Filter {
                        index,
                        enabled: true,
                        freq: 4000,
                        gain: 1.0,
                        q: 1.0,
                        filter_type,
                    };
                    let writes = protocol
                        .write_filter_packets(index, &filter, caps.dsp_sample_rate, 0.0)
                        .unwrap_or_else(|error| {
                            panic!("{name}: band {index} {filter_type:?}: {error}")
                        });
                    // wasm.rs rejects a band write unless one packet passes this.
                    assert!(
                        writes
                            .iter()
                            .any(|packet| protocol.is_filter_packet_valid(&packet.payload)),
                        "{name}: band {index} {filter_type:?} write is not a valid filter packet"
                    );
                    packets.extend(writes);
                }
            }

            for packet in &packets {
                assert_eq!(packet.report_id, protocol.report_id(), "{name}: {packet:?}");
                let framed = packet.framed();
                assert_eq!(
                    protocol.unframe_packet(&framed),
                    Ok(&framed[1..]),
                    "{name}: {packet:?}"
                );
            }
        }
    }

    #[test]
    fn ka17_dispatch_uses_its_model_protocol() {
        let protocol = DeviceProtocol::FiioKa17.implementation();
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

    #[test]
    fn walkplay_resends_unanswered_reads_and_moondrop_does_not() {
        assert_eq!(
            DeviceProtocol::Walkplay
                .implementation()
                .resend_unanswered_after(),
            Some(15)
        );
        assert_eq!(
            DeviceProtocol::Moondrop
                .implementation()
                .resend_unanswered_after(),
            None
        );
    }

    #[test]
    fn only_moondrop_writes_with_set_report() {
        for device in crate::device::SUPPORTED_DEVICES {
            assert_eq!(
                device.protocol.quirks().set_report_writes,
                device.protocol == DeviceProtocol::Moondrop,
                "{}",
                device.name
            );
        }
    }

    #[test]
    fn protocols_without_hardware_eq_have_no_implementation() {
        for protocol in [DeviceProtocol::DawnPro, DeviceProtocol::Unknown] {
            assert!(!protocol.has_hardware_eq());
            assert!(std::panic::catch_unwind(|| protocol.implementation()).is_err());
        }
    }
}
