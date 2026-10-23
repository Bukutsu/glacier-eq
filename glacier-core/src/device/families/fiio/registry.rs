// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Model-specific USB HID routes from FiiO Control Web, index-7hb30NUo.js,
//! checked 2026-10-23: mne (transport), Ov (report), $R (presets), pv (gain),
//! Ff/q8e (EQ commands), KBe (pacing). No serial model uses these routes.
//! Known bank sizes follow devicePEQ 0617f382 and Contour 81cd09db.
//! Uncaptured/newer models are enabled only for the nominal ten-band layout.
//! A mandatory read-only count check rejects other layouts before EQ writes.
//! New models are source-reviewed, NOT tested in Glacier on hardware.
//! FiiO's current USB HID save is 0x19 (Rk); devicePEQ's older BTR17 0x21
//! differs. Firmware returning incompatible replies is not treated as success.

use super::FiioProtocol;
use crate::device::protocol::{Protocol, Quirks};

const fn hid(count: u8, slot: u8, interval: u64) -> FiioProtocol {
    FiioProtocol {
        report_id: 7,
        filter_count: count,
        verify_filter_count: true,
        user_slot: slot,
        preamp_step_db: 0.1,
        clamp_gain: false,
        command_interval_ms: Some(interval),
        sends_filter_count: false,
        apply_after_write: false,
        quirks: Quirks {
            save_resets_device: false,
            set_report_writes: false,
        },
    }
}

pub static BTR13: Protocol = Protocol {
    id: "FIIO BTR13",
    eq: Some(&hid(10, 7, 100)),
};

pub static BTR15: Protocol = Protocol {
    id: "FIIO BTR15",
    eq: Some(&hid(10, 7, 1000)),
};

pub static BTR17: Protocol = Protocol {
    id: "FIIO BTR17",
    eq: Some(&hid(10, 160, 100)),
};

pub static BTR19: Protocol = Protocol {
    id: "FIIO BTR19",
    eq: Some(&hid(10, 160, 1000)),
};

pub static BTR25: Protocol = Protocol {
    id: "FIIO BTR25",
    eq: Some(&hid(10, 160, 1000)),
};

pub static QX13: Protocol = Protocol {
    id: "FIIO QX13",
    eq: Some(&hid(10, 160, 200)),
};

pub static QX11: Protocol = Protocol {
    id: "FIIO QX11",
    eq: Some(&hid(10, 160, 100)),
};

pub static FX17: Protocol = Protocol {
    id: "FIIO FX17",
    eq: Some(&hid(10, 160, 100)),
};

pub static FX25: Protocol = Protocol {
    id: "FIIO FX25",
    eq: Some(&hid(10, 160, 100)),
};

pub static FP3: Protocol = Protocol {
    id: "FIIO FP3",
    eq: Some(&hid(10, 160, 100)),
};

pub static LS_TC2: Protocol = Protocol {
    id: "FIIO LS-TC2",
    eq: Some(&hid(5, 160, 100)),
};

pub static JIEZI: Protocol = Protocol {
    id: "JadeAudio JIEZI",
    eq: Some(&hid(5, 160, 100)),
};

pub static TRUSTBLU: Protocol = Protocol {
    id: "JadeAudio Trustblu",
    eq: Some(&hid(10, 160, 100)),
};

pub static K13_R2R: Protocol = Protocol {
    id: "FIIO K13 R2R",
    eq: Some(&hid(10, 160, 300)),
};

pub static K13: Protocol = Protocol {
    id: "FIIO K13",
    eq: Some(&hid(10, 160, 200)),
};

pub static BR15_R2R: Protocol = Protocol {
    id: "FIIO BR15 R2R",
    eq: Some(&hid(10, 160, 200)),
};

pub static TINY_A: Protocol = Protocol {
    id: "SNOWSKY TINY A",
    eq: Some(&hid(10, 160, 100)),
};

pub static TINY_B: Protocol = Protocol {
    id: "SNOWSKY TINY B",
    eq: Some(&hid(5, 160, 100)),
};

pub static RETRO_NANO: Protocol = Protocol {
    id: "RETRO NANO",
    eq: Some(&hid(10, 160, 100)),
};

pub static OAK_NANO: Protocol = Protocol {
    id: "OAK NANO",
    eq: Some(&hid(8, 160, 100)),
};

pub static FG3: Protocol = Protocol {
    id: "FIIO FG3",
    eq: Some(&hid(10, 160, 100)),
};

pub static JD1_GAMING: Protocol = Protocol {
    id: "FIIO JD1 GAMING",
    eq: Some(&hid(10, 160, 100)),
};

pub static KG13: Protocol = Protocol {
    id: "FIIO KG13",
    eq: Some(&hid(10, 160, 100)),
};

pub static JK13: Protocol = Protocol {
    id: "JadeAudio JK13",
    eq: Some(&hid(10, 160, 100)),
};

pub static WARMER_NANO: Protocol = Protocol {
    id: "FIIO WARMER NANO",
    eq: Some(&hid(10, 160, 100)),
};

pub static GAME_ENGINE: Protocol = Protocol {
    id: "FIIO GAME ENGINE",
    eq: Some(&hid(10, 160, 100)),
};

pub static MAGE: Protocol = Protocol {
    id: "SNOWSKY MAGE",
    eq: Some(&hid(10, 160, 100)),
};

pub static BT11: Protocol = Protocol {
    id: "FIIO BT11",
    eq: Some(&hid(10, 160, 300)),
};

pub static AIR_LINK: Protocol = Protocol {
    id: "FIIO Air Link",
    eq: Some(&hid(10, 160, 300)),
};

pub static AIR_AMP: Protocol = Protocol {
    id: "FIIO AIR AMP",
    eq: Some(&hid(10, 160, 200)),
};

// No substring/fuzzy matching: e.g. KA1, KA5 and KA13 do not become KA15.
pub fn product_names(name: &str) -> &'static [&'static str] {
    match name {
        "FIIO BTR13" => &["FIIO BTR13"],
        "FIIO BTR15" => &["FIIO BTR15"],
        "FIIO BTR17" => &["FIIO BTR17", "BTR17"],
        "FIIO BTR19" => &["FIIO BTR19"],
        "FIIO BTR25" => &["FIIO BTR25"],
        "FIIO QX13" => &["FIIO QX13"],
        "FIIO QX11" => &["FIIO QX11"],
        "FIIO FX17" => &["FIIO FX17"],
        "FIIO FX25" => &["FIIO FX25"],
        "FIIO FP3" => &["FIIO FP3"],
        "FIIO LS-TC2" => &["FIIO LS-TC2", "FIIO DSP Audio"],
        "JadeAudio JIEZI" => &["JadeAudio JIEZI"],
        "JadeAudio Trustblu" => &["JadeAudio Trustblu"],
        "FIIO K13 R2R" => &["FIIO K13 R2R"],
        "FIIO K13" => &["FIIO K13"],
        "FIIO BR15 R2R" => &["FIIO BR15 R2R"],
        "SNOWSKY TINY A" => &["SNOWSKY TINY A"],
        "SNOWSKY TINY B" => &["SNOWSKY TINY B"],
        "RETRO NANO" => &["RETRO NANO"],
        "OAK NANO" => &["OAK NANO", "FIIO OAK NANO", "Oak Nano"],
        "FIIO FG3" => &["FIIO FG3"],
        "FIIO JD1 GAMING" => &["FIIO JD1 GAMING"],
        "FIIO KG13" => &["FIIO KG13"],
        "JadeAudio JK13" => &["JadeAudio JK13"],
        "FIIO WARMER NANO" => &["FIIO WARMER NANO"],
        "FIIO GAME ENGINE" => &["FIIO GAME ENGINE"],
        "SNOWSKY MAGE" => &["SNOWSKY MAGE"],
        "FIIO BT11" => &["FIIO BT11"],
        "FIIO Air Link" => &["FIIO Air Link"],
        "FIIO AIR AMP" => &["FIIO AIR AMP"],
        _ => &[],
    }
}

/// BT11/Air Link have transport/firmware modes with different contracts.
/// Only their explicit "tengtai" PIDs from the official app are enabled.
pub fn mode_matches(name: &str, pid: u16) -> bool {
    match name {
        "FIIO QX11" => pid == 0x0130,
        "FIIO BT11" => pid == 0x4032,
        "FIIO Air Link" => pid == 0x4033,
        _ => true,
    }
}
