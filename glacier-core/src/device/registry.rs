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
