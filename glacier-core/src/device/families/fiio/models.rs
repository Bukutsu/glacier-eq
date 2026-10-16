// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use super::FiioProtocol;
use crate::device::protocol::Quirks;

// Slots are the active USER presets recorded in devicePEQ's 2026-05-03 captures.
pub const JA11_PROTOCOL: FiioProtocol = FiioProtocol {
    report_id: 2,
    filter_count: 5,
    user_slot: 3,
    clamp_gain: true,
    quirks: Quirks {
        gain_read_optional: true,
        save_resets_device: true,
        set_report_writes: false,
    },
};

// The existing generic FiiO profile represents KA15.
pub const FIIO_PROTOCOL: FiioProtocol = FiioProtocol {
    report_id: 7,
    filter_count: 10,
    user_slot: 9,
    clamp_gain: false,
    quirks: Quirks {
        gain_read_optional: false,
        save_resets_device: false,
        set_report_writes: false,
    },
};

pub const KA17_PROTOCOL: FiioProtocol = FiioProtocol {
    report_id: 1,
    filter_count: 10,
    user_slot: 4,
    clamp_gain: false,
    quirks: Quirks {
        gain_read_optional: false,
        save_resets_device: false,
        set_report_writes: false,
    },
};
