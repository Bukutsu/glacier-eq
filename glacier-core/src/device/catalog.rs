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
        global_gain_range: (-16, 6),
        band_gain_range: (-10.0, 10.0),
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
    supported_filter_types: LIMITED_FILTER_TYPES,
    supports_per_band_enable: false,
    supports_ram_apply: false,
    dsp_sample_rate: 48000.0,
    gain_tolerance: 0.15,
    freq_tolerance: 1,
    q_tolerance: 0.05,
    integer_preamp: false,
};

pub const SUPPORTED_DEVICES: &[DeviceProfile] = &[
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
        status: "Untested",
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
        status: "Untested",
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
    DeviceProfile {
        name: "FiiO KA Series",
        protocol: &fiio::KA_SERIES,
        vendor_id: 0x2972,
        product_id: None,
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
];

pub fn get_supported_device(vendor_id: u16, product_id: u16) -> Option<&'static DeviceProfile> {
    // Exact PID matches win over vendor fallbacks regardless of slice order,
    // so a future fallback entry cannot shadow an exact profile.
    SUPPORTED_DEVICES
        .iter()
        .find(|device| device.vendor_id == vendor_id && device.product_id == Some(product_id))
        .or_else(|| {
            SUPPORTED_DEVICES
                .iter()
                .find(|device| device.vendor_id == vendor_id && device.product_id.is_none())
        })
}

#[cfg(test)]
mod tests;
