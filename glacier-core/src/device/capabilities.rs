// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::eq::FilterType;

/// Static capability profile for a device — pure data, no protocol behavior.
///
/// Queried by the UI (to constrain sliders and show/hide controls) and by the
/// push path (to validate payloads before sending them to hardware).
#[derive(Debug, Clone)]
pub struct DeviceCapabilities {
    pub num_bands: usize,
    pub global_gain_range: (i8, i8),
    pub band_gain_range: (f64, f64),
    pub freq_range: (u16, u16),
    pub q_range: (f64, f64),
    pub supported_filter_types: &'static [FilterType],
    pub supports_per_band_enable: bool,
    pub supports_ram_apply: bool,
    pub dsp_sample_rate: f64,
    pub gain_tolerance: f64,
    pub freq_tolerance: i32,
    pub q_tolerance: f64,
    pub integer_preamp: bool,
}

/// JSON-friendly editor capabilities exposed by native and WASM device discovery.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct EditorCapabilities {
    pub num_bands: usize,
    pub global_gain_range: [i8; 2],
    pub band_gain_range: [f64; 2],
    pub freq_range: [u16; 2],
    pub q_range: [f64; 2],
    pub supported_filter_types: Vec<String>,
    pub supports_per_band_enable: bool,
    pub supports_ram_apply: bool,
    pub dsp_sample_rate: f64,
    pub integer_preamp: bool,
}

impl From<&DeviceCapabilities> for EditorCapabilities {
    fn from(caps: &DeviceCapabilities) -> Self {
        Self {
            num_bands: caps.num_bands,
            global_gain_range: caps.global_gain_range.into(),
            band_gain_range: caps.band_gain_range.into(),
            freq_range: caps.freq_range.into(),
            q_range: caps.q_range.into(),
            supported_filter_types: caps
                .supported_filter_types
                .iter()
                .map(|filter_type| filter_type.editor_name().to_string())
                .collect(),
            supports_per_band_enable: caps.supports_per_band_enable,
            supports_ram_apply: caps.supports_ram_apply,
            dsp_sample_rate: caps.dsp_sample_rate,
            integer_preamp: caps.integer_preamp,
        }
    }
}

/// Default capabilities used when no device is connected (generic desktop DAC).
///
/// Supports all 5 filter types with the standard desktop range: 10 bands,
/// ±10 dB band gain, ±6 dB global gain, 20–20000 Hz, Q 0.1–20.0, 96 kHz DSP.
pub const DESKTOP_DAC_CAPS: DeviceCapabilities = DeviceCapabilities {
    num_bands: 10,
    global_gain_range: (-16, 6),
    band_gain_range: (-10.0, 10.0),
    freq_range: (20, 20000),
    q_range: (0.1, 20.0),
    supported_filter_types: FilterType::ALL,
    supports_per_band_enable: true,
    supports_ram_apply: false,
    dsp_sample_rate: 96000.0,
    gain_tolerance: 0.15,
    freq_tolerance: 1,
    q_tolerance: 0.05,
    integer_preamp: false,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editor_capabilities_use_typescript_filter_names() {
        let caps = EditorCapabilities::from(&DESKTOP_DAC_CAPS);
        assert_eq!(
            caps.supported_filter_types,
            ["Peak", "HighShelf", "LowShelf", "HighPass", "LowPass"]
        );
        assert_eq!(caps.global_gain_range, [-16, 6]);
        assert_eq!(caps.q_range, [0.1, 20.0]);
    }
}
