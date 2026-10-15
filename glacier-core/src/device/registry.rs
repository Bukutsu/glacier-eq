// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Maps a `DeviceProtocol` to its `EqProtocol` implementation.

use crate::device::families::{fiio, moondrop::MoondropProtocol, walkplay::WalkplayProtocol};
use crate::device::profile::DeviceProtocol;
use crate::device::protocol::EqProtocol;

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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn protocols_without_hardware_eq_have_no_implementation() {
        for protocol in [DeviceProtocol::DawnPro, DeviceProtocol::Unknown] {
            assert!(!protocol.has_hardware_eq());
            assert!(std::panic::catch_unwind(|| protocol.implementation()).is_err());
        }
    }
}
