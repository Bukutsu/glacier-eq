// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use super::FiioProtocol;
use crate::device::protocol::{Protocol, Quirks};

// Slots are the active USER presets recorded in devicePEQ's 2026-05-03 captures.
pub(super) const JA11_EQ: FiioProtocol = FiioProtocol {
    report_id: 2,
    filter_count: 5,
    user_slot: 3,
    clamp_gain: true,
    command_interval_ms: Some(200),
    // 0x18 = 5 before bands caused a stuck-read state on JM12/JA11 firmware.
    // FiiO Control (weekssa/OPRA-EQ-for-UAPP) and Ircama/ja11-config instead
    // send 0x18 = 1 after bands and preamp, then save last.
    sends_filter_count: false,
    apply_after_write: true,
    quirks: Quirks {
        save_resets_device: true,
        set_report_writes: false,
    },
};

// The generic "FiiO" protocol represents KA15 and the KA-series fallback.
pub(super) const KA_SERIES_EQ: FiioProtocol = FiioProtocol {
    report_id: 7,
    filter_count: 10,
    user_slot: 9,
    clamp_gain: false,
    command_interval_ms: None,
    sends_filter_count: true,
    apply_after_write: false,
    quirks: Quirks {
        save_resets_device: false,
        set_report_writes: false,
    },
};

pub(super) const KA17_EQ: FiioProtocol = FiioProtocol {
    report_id: 1,
    filter_count: 10,
    user_slot: 4,
    clamp_gain: false,
    command_interval_ms: None,
    sends_filter_count: true,
    apply_after_write: false,
    quirks: Quirks {
        save_resets_device: false,
        set_report_writes: false,
    },
};

pub static JA11: Protocol = Protocol {
    id: "FiiO JA11",
    eq: Some(&JA11_EQ),
};

pub static KA_SERIES: Protocol = Protocol {
    id: "FiiO",
    eq: Some(&KA_SERIES_EQ),
};

pub static KA17: Protocol = Protocol {
    id: "FiiO KA17",
    eq: Some(&KA17_EQ),
};
