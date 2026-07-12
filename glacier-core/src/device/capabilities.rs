// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::eq::FilterType;

pub const PEAK_SHELF_FILTER_TYPES: &[FilterType] = &[
    FilterType::Peak,
    FilterType::LowShelf,
    FilterType::HighShelf,
];

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
};
