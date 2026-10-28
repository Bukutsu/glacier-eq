// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Static catalog of supported USB DACs.

use crate::device::capabilities::{DeviceCapabilities, DESKTOP_DAC_CAPS};
use crate::device::families::{dawn_pro, fiio, moondrop, walkplay};
use crate::device::profile::{Controls, DacSpec, DeviceProfile};
use crate::eq::FilterType;

// Walkplay's PEQ register uses the complete five-value filter enum. Keep the
// generic Walkplay capability broad; individual profiles retain their Tested /
// Untested status until each model has hardware sign-off.
const WALKPLAY_FILTER_TYPES: &[FilterType] = FilterType::ALL;
const LIMITED_FILTER_TYPES: &[FilterType] = &[
    FilterType::Peak,
    FilterType::LowShelf,
    FilterType::HighShelf,
];

const fn savitech_caps(supported_filter_types: &'static [FilterType]) -> DeviceCapabilities {
    DeviceCapabilities {
        num_bands: 10,
        // Editing policy, not a firmware limit: ±16 dB gives AutoEQ more room
        // than the official app's ±12. TP35 Pro RAM gain/coefficient readback
        // confirmed ±16; coefficient representability is checked separately.
        // See docs/device-workflows.md for the hardware probe and its limits.
        global_gain_range: (-16, 16),
        band_gain_range: (-16.0, 16.0),
        freq_range: (20, 20000),
        q_range: (0.1, 10.0),
        supported_filter_types,
        supports_per_band_enable: false,
        // Temp apply (RAM only, no flash save) is one packet for the Walkplay
        // family. The vendor web tools (peq.epzsz.com and peq.szwalkplay.com,
        // whose capture is in devicePEQ) send it on every edit and send the
        // flash save only on Save; devicePEQ drives these vendor IDs with one
        // shared handler. Confirmed on hardware here for the EPZ TP35 Pro only.
        supports_ram_apply: true,
        dsp_sample_rate: 96000.0,
        gain_tolerance: 0.15,
        freq_tolerance: 1,
        q_tolerance: 0.05,
        integer_preamp: true,
    }
}

const SAVITECH_10_BAND_CAPS: DeviceCapabilities = savitech_caps(WALKPLAY_FILTER_TYPES);

const MOONDROP_8_BAND_CAPS: DeviceCapabilities = DeviceCapabilities {
    num_bands: 8,
    global_gain_range: (-128, 0),
    band_gain_range: (-18.0, 12.0),
    freq_range: (20, 20000),
    q_range: (0.1, 10.0),
    supported_filter_types: LIMITED_FILTER_TYPES,
    supports_per_band_enable: false,
    supports_ram_apply: true,
    dsp_sample_rate: 96000.0,
    gain_tolerance: 0.15,
    freq_tolerance: 1,
    q_tolerance: 0.05,
    integer_preamp: false,
};

const FIIO_5_BAND_CAPS: DeviceCapabilities = DeviceCapabilities {
    num_bands: 5,
    global_gain_range: (-12, 12),
    band_gain_range: (-12.0, 12.0),
    freq_range: (20, 20000),
    q_range: (0.1, 10.0),
    supported_filter_types: LIMITED_FILTER_TYPES,
    supports_per_band_enable: false,
    supports_ram_apply: true,
    dsp_sample_rate: 48000.0,
    gain_tolerance: 0.15,
    freq_tolerance: 1,
    q_tolerance: 0.05,
    integer_preamp: false,
};

const FIIO_10_BAND_CAPS: DeviceCapabilities = DeviceCapabilities {
    num_bands: 10,
    global_gain_range: (-12, 12),
    band_gain_range: (-12.0, 12.0),
    freq_range: (20, 20000),
    q_range: (0.1, 10.0),
    supported_filter_types: FilterType::ALL,
    supports_per_band_enable: false,
    supports_ram_apply: false,
    dsp_sample_rate: 48000.0,
    gain_tolerance: 0.15,
    freq_tolerance: 1,
    q_tolerance: 0.05,
    integer_preamp: false,
};

// Official FiiO Control Web allows -24..+12 dB for SNOWSKY Melody bands and
// preamp. Bands stop at -18 dB, the floor of Glacier's profile storage envelope.
// The preamp is whole dB on the wire (the firmware drops the fraction).
const MELODY_CAPS: DeviceCapabilities = DeviceCapabilities {
    // Hardware-test builds only. Unset this environment variable for releases.
    supports_ram_apply: option_env!("GLACIER_EXPERIMENTAL_MELODY_LIVE").is_some(),
    global_gain_range: (-24, 12),
    band_gain_range: (-18.0, 12.0),
    integer_preamp: true,
    ..FIIO_10_BAND_CAPS
};

// Source-reviewed HID profiles: fixed bank sizes are checked before any write.
// Display specs are omitted unless verified separately from protocol behavior.
const fn fiio_caps(bands: usize, min_gain: i8, pass_filters: bool) -> DeviceCapabilities {
    DeviceCapabilities {
        num_bands: bands,
        global_gain_range: (min_gain, 12),
        band_gain_range: (
            if min_gain < -18 {
                -18.0
            } else {
                min_gain as f64
            },
            12.0,
        ),
        supported_filter_types: if pass_filters {
            FilterType::ALL
        } else {
            LIMITED_FILTER_TYPES
        },
        supports_ram_apply: false,
        ..FIIO_10_BAND_CAPS
    }
}

const MAGE_CAPS: DeviceCapabilities = DeviceCapabilities {
    supported_filter_types: &[
        FilterType::Peak,
        FilterType::LowShelf,
        FilterType::HighPass,
        FilterType::LowPass,
    ],
    ..fiio_caps(10, -24, true)
};

const fn fiio_hid_profile(
    name: &'static str,
    protocol: &'static crate::device::Protocol,
    vendor_id: u16,
    product_id: Option<u16>,
    caps: DeviceCapabilities,
    controls: Option<Controls>,
) -> DeviceProfile {
    DeviceProfile {
        name,
        protocol,
        vendor_id,
        product_id,
        status: "Untested",
        family: "FiiO",
        caps,
        controls,
        spec: None,
    }
}

pub const SUPPORTED_DEVICES: &[DeviceProfile] = &[
    fiio_hid_profile(
        "FIIO BTR13",
        &fiio::registry::BTR13,
        0x2972,
        None,
        fiio_caps(10, -12, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO BTR13",
        &fiio::registry::BTR13,
        0xa12,
        None,
        fiio_caps(10, -12, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO BTR15",
        &fiio::registry::BTR15,
        0x2972,
        None,
        fiio_caps(10, -12, false),
        None,
    ),
    fiio_hid_profile(
        "FIIO BTR15",
        &fiio::registry::BTR15,
        0xa12,
        None,
        fiio_caps(10, -12, false),
        None,
    ),
    fiio_hid_profile(
        "FIIO BTR17",
        &fiio::registry::BTR17,
        0x2972,
        Some(0x88),
        fiio_caps(10, -24, false),
        None,
    ),
    fiio_hid_profile(
        "FIIO BTR17",
        &fiio::registry::BTR17,
        0xa12,
        None,
        fiio_caps(10, -24, false),
        None,
    ),
    fiio_hid_profile(
        "FIIO BTR19",
        &fiio::registry::BTR19,
        0x2972,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO BTR19",
        &fiio::registry::BTR19,
        0xa12,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO BTR25",
        &fiio::registry::BTR25,
        0x2972,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO BTR25",
        &fiio::registry::BTR25,
        0xa12,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO QX13",
        &fiio::registry::QX13,
        0x2972,
        Some(0x128),
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO QX13",
        &fiio::registry::QX13,
        0xa12,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO QX11",
        &fiio::registry::QX11,
        0x2972,
        Some(0x130),
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO QX11",
        &fiio::registry::QX11,
        0xa12,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO FX17",
        &fiio::registry::FX17,
        0x2972,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO FX17",
        &fiio::registry::FX17,
        0xa12,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO FX25",
        &fiio::registry::FX25,
        0x2972,
        None,
        fiio_caps(10, -12, false),
        None,
    ),
    fiio_hid_profile(
        "FIIO FX25",
        &fiio::registry::FX25,
        0xa12,
        None,
        fiio_caps(10, -12, false),
        None,
    ),
    fiio_hid_profile(
        "FIIO FP3",
        &fiio::registry::FP3,
        0x2972,
        None,
        fiio_caps(10, -24, false),
        None,
    ),
    fiio_hid_profile(
        "FIIO FP3",
        &fiio::registry::FP3,
        0xa12,
        None,
        fiio_caps(10, -24, false),
        None,
    ),
    fiio_hid_profile(
        "FIIO LS-TC2",
        &fiio::registry::LS_TC2,
        0x2972,
        None,
        fiio_caps(5, -12, false),
        None,
    ),
    fiio_hid_profile(
        "FIIO LS-TC2",
        &fiio::registry::LS_TC2,
        0xa12,
        None,
        fiio_caps(5, -12, false),
        None,
    ),
    fiio_hid_profile(
        "JadeAudio JIEZI",
        &fiio::registry::JIEZI,
        0x2972,
        None,
        fiio_caps(5, -12, true),
        None,
    ),
    fiio_hid_profile(
        "JadeAudio JIEZI",
        &fiio::registry::JIEZI,
        0xa12,
        None,
        fiio_caps(5, -12, true),
        None,
    ),
    fiio_hid_profile(
        "JadeAudio Trustblu",
        &fiio::registry::TRUSTBLU,
        0x2972,
        None,
        fiio_caps(10, -12, true),
        None,
    ),
    fiio_hid_profile(
        "JadeAudio Trustblu",
        &fiio::registry::TRUSTBLU,
        0xa12,
        None,
        fiio_caps(10, -12, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO K13 R2R",
        &fiio::registry::K13_R2R,
        0x2972,
        Some(0x120),
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO K13 R2R",
        &fiio::registry::K13_R2R,
        0xa12,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO K13",
        &fiio::registry::K13,
        0x2972,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO K13",
        &fiio::registry::K13,
        0xa12,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO BR15 R2R",
        &fiio::registry::BR15_R2R,
        0x2972,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO BR15 R2R",
        &fiio::registry::BR15_R2R,
        0xa12,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "SNOWSKY TINY A",
        &fiio::registry::TINY_A,
        0x2972,
        Some(0x147),
        fiio_caps(10, -12, true),
        Some(Controls::Melody),
    ),
    fiio_hid_profile(
        "SNOWSKY TINY A",
        &fiio::registry::TINY_A,
        0xa12,
        None,
        fiio_caps(10, -12, true),
        Some(Controls::Melody),
    ),
    fiio_hid_profile(
        "SNOWSKY TINY B",
        &fiio::registry::TINY_B,
        0x2972,
        None,
        fiio_caps(5, -12, true),
        None,
    ),
    fiio_hid_profile(
        "SNOWSKY TINY B",
        &fiio::registry::TINY_B,
        0xa12,
        None,
        fiio_caps(5, -12, true),
        None,
    ),
    fiio_hid_profile(
        "RETRO NANO",
        &fiio::registry::RETRO_NANO,
        0x2972,
        None,
        fiio_caps(10, -12, true),
        None,
    ),
    fiio_hid_profile(
        "RETRO NANO",
        &fiio::registry::RETRO_NANO,
        0xa12,
        None,
        fiio_caps(10, -12, true),
        None,
    ),
    fiio_hid_profile(
        "OAK NANO",
        &fiio::registry::OAK_NANO,
        0x2972,
        Some(0x4016),
        fiio_caps(8, -24, false),
        None,
    ),
    fiio_hid_profile(
        "OAK NANO",
        &fiio::registry::OAK_NANO,
        0xa12,
        None,
        fiio_caps(8, -24, false),
        None,
    ),
    fiio_hid_profile(
        "FIIO FG3",
        &fiio::registry::FG3,
        0x2972,
        None,
        fiio_caps(10, -12, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO FG3",
        &fiio::registry::FG3,
        0xa12,
        None,
        fiio_caps(10, -12, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO JD1 GAMING",
        &fiio::registry::JD1_GAMING,
        0x2972,
        None,
        fiio_caps(10, -12, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO JD1 GAMING",
        &fiio::registry::JD1_GAMING,
        0xa12,
        None,
        fiio_caps(10, -12, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO KG13",
        &fiio::registry::KG13,
        0x2972,
        None,
        fiio_caps(10, -12, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO KG13",
        &fiio::registry::KG13,
        0xa12,
        None,
        fiio_caps(10, -12, true),
        None,
    ),
    fiio_hid_profile(
        "JadeAudio JK13",
        &fiio::registry::JK13,
        0x2972,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "JadeAudio JK13",
        &fiio::registry::JK13,
        0xa12,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO WARMER NANO",
        &fiio::registry::WARMER_NANO,
        0x2972,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO WARMER NANO",
        &fiio::registry::WARMER_NANO,
        0xa12,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO GAME ENGINE",
        &fiio::registry::GAME_ENGINE,
        0x2972,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO GAME ENGINE",
        &fiio::registry::GAME_ENGINE,
        0xa12,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "SNOWSKY MAGE",
        &fiio::registry::MAGE,
        0x2972,
        None,
        MAGE_CAPS,
        None,
    ),
    fiio_hid_profile(
        "SNOWSKY MAGE",
        &fiio::registry::MAGE,
        0xa12,
        None,
        MAGE_CAPS,
        None,
    ),
    fiio_hid_profile(
        "FIIO BT11",
        &fiio::registry::BT11,
        0x2972,
        Some(0x4032),
        fiio_caps(10, -12, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO BT11",
        &fiio::registry::BT11,
        0xa12,
        None,
        fiio_caps(10, -12, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO Air Link",
        &fiio::registry::AIR_LINK,
        0x2972,
        Some(0x4033),
        fiio_caps(10, -12, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO Air Link",
        &fiio::registry::AIR_LINK,
        0xa12,
        None,
        fiio_caps(10, -12, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO AIR AMP",
        &fiio::registry::AIR_AMP,
        0x2972,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    fiio_hid_profile(
        "FIIO AIR AMP",
        &fiio::registry::AIR_AMP,
        0xa12,
        None,
        fiio_caps(10, -24, true),
        None,
    ),
    DeviceProfile {
        name: "EPZ TP35 Pro",
        protocol: &walkplay::PROTOCOL,
        vendor_id: 0x3302,
        product_id: Some(0x43E6),
        // User reconfirmed basic read/write on shared-session build 133a829.
        // Reconnect persistence and utility controls were not part of that confirmation.
        status: "Tested",
        family: "Walkplay Family",
        caps: SAVITECH_10_BAND_CAPS,
        controls: Some(Controls::Walkplay),
        spec: Some(DacSpec {
            name: "EPZ TP35 Pro",
            chip: "Dual CS43198",
            outputs: "3.5 / 4.4mm",
            max_power: Some("262mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: Some("125 dB"),
            thd: Some("0.0004%"),
        }),
    },
    DeviceProfile {
        name: "TRN Black Pearl",
        protocol: &walkplay::PROTOCOL,
        vendor_id: 0x3302,
        product_id: Some(0x43E8),
        status: "Tested",
        family: "Walkplay Family",
        caps: SAVITECH_10_BAND_CAPS,
        controls: Some(Controls::Walkplay),
        spec: Some(DacSpec {
            name: "TRN Black Pearl",
            chip: "Dual CS43131",
            outputs: "3.5 / 4.4mm",
            max_power: Some("250mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: Some("125 dB"),
            thd: Some("0.0005%"),
        }),
    },
    DeviceProfile {
        name: "Audiocular Aura",
        protocol: &walkplay::PROTOCOL,
        vendor_id: 0x3302,
        product_id: None,
        status: "Untested",
        family: "Walkplay Family",
        caps: SAVITECH_10_BAND_CAPS,
        controls: Some(Controls::Walkplay),
        spec: Some(DacSpec {
            name: "Audiocular Aura",
            chip: "Dual CS43198",
            outputs: "3.5 / 4.4mm",
            max_power: Some("262mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: Some("125 dB"),
            thd: None,
        }),
    },
    DeviceProfile {
        name: "JCally JM20 Pro",
        protocol: &walkplay::PROTOCOL,
        vendor_id: 0x3302,
        product_id: Some(0x43C1),
        status: "Untested",
        family: "Walkplay Family",
        caps: DeviceCapabilities {
            num_bands: 8,
            supported_filter_types: &[
                FilterType::Peak,
                FilterType::LowShelf,
                FilterType::LowPass,
                FilterType::HighPass,
            ],
            ..SAVITECH_10_BAND_CAPS
        },
        controls: Some(Controls::Walkplay),
        spec: Some(DacSpec {
            name: "JCally JM20 Pro",
            chip: "CS43131",
            outputs: "3.5mm SE",
            max_power: Some("95mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: None,
            thd: None,
        }),
    },
    DeviceProfile {
        name: "Moondrop Dawn Pro 2",
        protocol: &moondrop::PROTOCOL,
        vendor_id: 0x35D8,
        product_id: Some(0x011D),
        status: "Untested",
        family: "Moondrop",
        caps: MOONDROP_8_BAND_CAPS,
        controls: None,
        spec: Some(DacSpec {
            name: "Moondrop Dawn Pro 2",
            chip: "Dual CS43131",
            outputs: "3.5 / 4.4mm",
            max_power: Some("260mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: Some("131 dB"),
            thd: None,
        }),
    },
    DeviceProfile {
        name: "FiiO JA11",
        protocol: &fiio::JA11,
        vendor_id: 0x2972,
        product_id: Some(0x0102),
        status: "Tested",
        family: "FiiO",
        caps: FIIO_5_BAND_CAPS,
        controls: Some(Controls::Ja11),
        spec: Some(DacSpec {
            name: "FiiO JA11",
            chip: "KT02H20 DSP",
            outputs: "3.5mm SE",
            max_power: Some("30mW @ 32Ω"),
            decoding: Some("384k / DSD128"),
            snr: Some("115 dB"),
            thd: None,
        }),
    },
    // UAC 1.0 mode, same HID protocol (Cyfine/ja11-web-control).
    DeviceProfile {
        name: "FiiO JA11",
        protocol: &fiio::JA11,
        vendor_id: 0x2972,
        product_id: Some(0x0101),
        status: "Tested",
        family: "FiiO",
        caps: FIIO_5_BAND_CAPS,
        controls: Some(Controls::Ja11),
        spec: Some(DacSpec {
            name: "FiiO JA11",
            chip: "KT02H20 DSP",
            outputs: "3.5mm SE",
            max_power: Some("30mW @ 32Ω"),
            decoding: Some("384k / DSD128"),
            snr: Some("115 dB"),
            thd: None,
        }),
    },
    DeviceProfile {
        name: "FiiO KA15",
        protocol: &fiio::KA_SERIES,
        vendor_id: 0x2972,
        product_id: Some(0x0104),
        status: "Untested",
        family: "FiiO",
        caps: FIIO_10_BAND_CAPS,
        controls: None,
        spec: Some(DacSpec {
            name: "FiiO KA Series",
            chip: "Cirrus / ESS",
            outputs: "3.5 / 4.4mm",
            max_power: None,
            decoding: Some("384k / DSD256"),
            snr: None,
            thd: None,
        }),
    },
    DeviceProfile {
        name: "SNOWSKY Melody",
        protocol: &fiio::MELODY,
        vendor_id: 0x2972,
        product_id: Some(0x0126),
        // The user confirmed the standard persistent EQ workflow on hardware.
        // Experimental RAM-only live apply still needs separate validation.
        status: "Tested",
        family: "FiiO",
        caps: MELODY_CAPS,
        controls: Some(Controls::Melody),
        spec: Some(DacSpec {
            name: "SNOWSKY Melody",
            chip: "CS43131",
            outputs: "3.5 / 4.4mm",
            max_power: Some("250mW @ 32Ω (4.4mm)"),
            decoding: Some("384k / DSD256"),
            snr: Some("127 dB (4.4mm)"),
            thd: Some("0.0003% (4.4mm)"),
        }),
    },
    DeviceProfile {
        name: "FiiO KA17",
        protocol: &fiio::KA17,
        vendor_id: 0x2972,
        product_id: Some(0x0093),
        status: "Untested",
        family: "FiiO",
        caps: FIIO_10_BAND_CAPS,
        controls: None,
        spec: Some(DacSpec {
            name: "FiiO KA Series",
            chip: "Cirrus / ESS",
            outputs: "3.5 / 4.4mm",
            max_power: None,
            decoding: Some("384k / DSD256"),
            snr: None,
            thd: None,
        }),
    },
    DeviceProfile {
        name: "Truthear KEYX",
        protocol: &walkplay::PROTOCOL,
        vendor_id: 0x0D8C,
        product_id: Some(0x0210),
        status: "Untested",
        family: "Walkplay Family",
        caps: DeviceCapabilities {
            num_bands: 8,
            global_gain_range: (-20, 0),
            band_gain_range: (-12.0, 12.0),
            dsp_sample_rate: 48000.0,
            gain_tolerance: 0.1,
            ..SAVITECH_10_BAND_CAPS
        },
        controls: Some(Controls::Walkplay),
        spec: Some(DacSpec {
            name: "Truthear KEYX",
            chip: "CM6542 Codec",
            outputs: "3.5mm SE",
            max_power: Some("60mW @ 32Ω"),
            decoding: Some("384k / 32-bit"),
            snr: None,
            thd: None,
        }),
    },
    DeviceProfile {
        name: "Fosi Audio DS2 / iBasso DC04 Pro",
        protocol: &walkplay::PROTOCOL,
        vendor_id: 0x262A,
        product_id: None,
        status: "Untested",
        family: "Walkplay Family",
        // Vendor 262A is in neither devicePEQ's Walkplay vendor list nor the
        // vendor web tools, so nothing confirms it takes the temp apply.
        caps: DeviceCapabilities {
            supports_ram_apply: false,
            ..SAVITECH_10_BAND_CAPS
        },
        controls: Some(Controls::Walkplay),
        spec: Some(DacSpec {
            name: "Fosi Audio DS2 / iBasso DC04 Pro",
            chip: "Dual CS43131",
            outputs: "3.5 / 4.4mm",
            max_power: Some("510mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: Some("130 dB"),
            thd: None,
        }),
    },
    DeviceProfile {
        name: "JCally JM20 / Savitech Generic",
        protocol: &walkplay::PROTOCOL,
        vendor_id: 0x0661,
        product_id: None,
        status: "Untested",
        family: "Walkplay Family",
        caps: SAVITECH_10_BAND_CAPS,
        controls: Some(Controls::Walkplay),
        spec: Some(DacSpec {
            name: "JCally JM20 / Savitech Generic",
            chip: "CS43131",
            outputs: "3.5mm SE",
            max_power: Some("95mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: None,
            thd: None,
        }),
    },
    DeviceProfile {
        name: "JCally JM20 Pro / Alt Savitech",
        protocol: &walkplay::PROTOCOL,
        vendor_id: 0x0666,
        product_id: None,
        status: "Untested",
        family: "Walkplay Family",
        caps: SAVITECH_10_BAND_CAPS,
        controls: Some(Controls::Walkplay),
        spec: Some(DacSpec {
            name: "JCally JM20 Pro / Alt Savitech",
            chip: "CS43131",
            outputs: "3.5mm SE",
            max_power: Some("95mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: None,
            thd: None,
        }),
    },
    DeviceProfile {
        name: "Moondrop Dawn Pro",
        protocol: &dawn_pro::PROTOCOL,
        vendor_id: dawn_pro::VENDOR_ID,
        product_id: Some(dawn_pro::PRODUCT_ID),
        status: "Untested",
        family: "Moondrop / Comtrue",
        // No hardware EQ; these caps only shape the offline editor.
        caps: DESKTOP_DAC_CAPS,
        controls: Some(Controls::DawnPro),
        spec: Some(DacSpec {
            name: "Moondrop Dawn Pro",
            chip: "Dual CS43131",
            outputs: "3.5 / 4.4mm",
            max_power: Some("230mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: Some("131 dB"),
            thd: Some("0.00014%"),
        }),
    },
    // Other Comtrue PIDs match for display only: the controls protocol is
    // verified on the original 2FC6:F06A alone.
    DeviceProfile {
        name: "Moondrop Dawn Pro",
        protocol: &dawn_pro::PROTOCOL,
        vendor_id: 0x2FC6,
        product_id: None,
        status: "Untested",
        family: "Moondrop / Comtrue",
        // No hardware EQ; these caps only shape the offline editor.
        caps: DESKTOP_DAC_CAPS,
        controls: None,
        spec: Some(DacSpec {
            name: "Moondrop Dawn Pro",
            chip: "Dual CS43131",
            outputs: "3.5 / 4.4mm",
            max_power: Some("230mW @ 32Ω"),
            decoding: Some("384k / DSD256"),
            snr: Some("131 dB"),
            thd: Some("0.00014%"),
        }),
    },
    DeviceProfile {
        name: "JCally JM12",
        protocol: &fiio::JA11,
        vendor_id: 0x31B2,
        product_id: Some(0x0111),
        status: "Untested",
        family: "FiiO",
        caps: FIIO_5_BAND_CAPS,
        controls: None,
        spec: Some(DacSpec {
            name: "JCally JM12",
            chip: "KT02H20",
            outputs: "3.5mm SE",
            max_power: Some("30mW @ 32Ω"),
            decoding: Some("384k / DSD128"),
            snr: None,
            thd: None,
        }),
    },
];

pub fn get_supported_device(vendor_id: u16, product_id: u16) -> Option<&'static DeviceProfile> {
    // Exact PID matches win over vendor fallbacks regardless of slice order,
    // so a future fallback entry cannot shadow an exact profile.
    SUPPORTED_DEVICES
        .iter()
        .find(|device| device.vendor_id == vendor_id && device.product_id == Some(product_id))
        .or_else(|| {
            SUPPORTED_DEVICES.iter().find(|device| {
                device.vendor_id == vendor_id
                    && device.product_id.is_none()
                    && fiio::registry::product_names(device.name).is_empty()
            })
        })
}

/// Match an enumerated device, including an exact USB product-name route when
/// a vendor's public tool does not publish its PID. Never use a vendor-only
/// FiiO fallback or a substring match.
pub fn get_supported_device_with_name(
    vendor_id: u16,
    product_id: u16,
    product_name: Option<&str>,
) -> Option<&'static DeviceProfile> {
    let exact = SUPPORTED_DEVICES
        .iter()
        .find(|p| p.vendor_id == vendor_id && p.product_id == Some(product_id));
    exact
        .or_else(|| {
            product_name.and_then(|name| {
                SUPPORTED_DEVICES.iter().find(|p| {
                    p.vendor_id == vendor_id
                        && fiio::registry::mode_matches(p.name, product_id)
                        && fiio::registry::product_names(p.name)
                            .iter()
                            .any(|candidate| candidate.eq_ignore_ascii_case(name.trim()))
                })
            })
        })
        .or_else(|| get_supported_device(vendor_id, product_id))
}
