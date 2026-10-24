// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use super::FiioProtocol;
use crate::device::protocol::{Protocol, Quirks};

// Slots are the active USER presets recorded in devicePEQ's 2026-05-03 captures.
pub(super) const JA11_EQ: FiioProtocol = FiioProtocol {
    report_id: 2,
    filter_count: 5,
    verify_filter_count: false,
    user_slot: 3,
    user_slots: &[],
    preamp_step_db: 0.1,
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
// KA15's three custom EQ banks use the IDs below. The model's three User EQs
// are documented by FiiO; IDs are cross-checked against devicePEQ
// (jeromeof/devicePEQ 0617f382) and Contour (Chronosauros/contour 81cd09db):
// https://www.fiio.com/newsinfo/957512.html
// https://github.com/jeromeof/devicePEQ
// https://github.com/Chronosauros/contour
pub(super) const KA_SERIES_EQ: FiioProtocol = FiioProtocol {
    report_id: 7,
    filter_count: 10,
    verify_filter_count: false,
    user_slot: 9,
    user_slots: &[7, 8, 9],
    preamp_step_db: 0.1,
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
    verify_filter_count: false,
    user_slot: 4,
    // FiiO Control's KA17 menu exposes USER1/2/3 at IDs 4/8/9.
    // Source credit: devicePEQ (jeromeof/devicePEQ) 0617f382 and
    // Contour (Chronosauros/contour) 81cd09db; official PEQ guide:
    // https://fiio-file.fiio.net/70%E4%B8%8A%E4%BC%A0%E7%9A%84%E6%96%87%E4%BB%B6/PEQ%20Settings%20Instructions%20for%20FiiO%20Portable%20DAC%26AMP.pdf
    user_slots: &[4, 8, 9],
    preamp_step_db: 0.1,
    clamp_gain: false,
    command_interval_ms: None,
    sends_filter_count: true,
    apply_after_write: false,
    quirks: Quirks {
        save_resets_device: false,
        set_report_writes: false,
    },
};

// SNOWSKY Melody (2972:0126). Official FiiO Control Web (fiiocontrol.fiio.com)
// lists USER1..3 as presets 160..162 and never writes the
// band count. Its global gain rounds toward zero to whole dB on the wire
// (captured: -9.9 dB written, -9.0 read back), so the preamp grid is 1 dB.
pub(super) const MELODY_EQ: FiioProtocol = FiioProtocol {
    report_id: 7,
    filter_count: 10,
    verify_filter_count: false,
    user_slot: 160,
    user_slots: &[160, 161, 162],
    preamp_step_db: 1.0,
    clamp_gain: false,
    command_interval_ms: None,
    sends_filter_count: false,
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

pub static MELODY: Protocol = Protocol {
    id: "SNOWSKY Melody",
    eq: Some(&MELODY_EQ),
};
