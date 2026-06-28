// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::eq::FilterType;

/// Bitmask of filter types a device supports. Used by the UI to hide unsupported
/// filter type buttons and by the push path to reject invalid payloads early.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FilterTypeFlags(pub u16);

impl FilterTypeFlags {
    pub const PEAK: Self = Self(0b0000_0001);
    pub const LOW_SHELF: Self = Self(0b0000_0010);
    pub const HIGH_SHELF: Self = Self(0b0000_0100);
    pub const LOW_PASS: Self = Self(0b0000_1000);
    pub const HIGH_PASS: Self = Self(0b0001_0000);

    pub fn contains(self, other: Self) -> bool {
        (self.0 & other.0) == other.0
    }

    pub fn supports(self, ft: FilterType) -> bool {
        match ft {
            FilterType::Peak => self.contains(Self::PEAK),
            FilterType::LowShelf => self.contains(Self::LOW_SHELF),
            FilterType::HighShelf => self.contains(Self::HIGH_SHELF),
            FilterType::LowPass => self.contains(Self::LOW_PASS),
            FilterType::HighPass => self.contains(Self::HIGH_PASS),
        }
    }
}

impl std::ops::BitOr for FilterTypeFlags {
    type Output = Self;
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

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
    pub supported_filter_types: FilterTypeFlags,
    pub supports_per_band_enable: bool,
    pub supports_ram_apply: bool,
    pub dsp_sample_rate: f64,
    pub gain_tolerance: f64,
    pub freq_tolerance: i32,
    pub q_tolerance: f64,
}

impl Default for DeviceCapabilities {
    fn default() -> Self {
        DESKTOP_DAC_CAPS
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
    supported_filter_types: FilterTypeFlags(0b0001_1111),
    supports_per_band_enable: true,
    supports_ram_apply: false,
    dsp_sample_rate: 96000.0,
    gain_tolerance: 0.15,
    freq_tolerance: 1,
    q_tolerance: 0.05,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_type_flags_contains() {
        let flags = FilterTypeFlags::PEAK | FilterTypeFlags::LOW_SHELF;
        assert!(flags.contains(FilterTypeFlags::PEAK));
        assert!(flags.contains(FilterTypeFlags::LOW_SHELF));
        assert!(!flags.contains(FilterTypeFlags::HIGH_SHELF));
    }

    #[test]
    fn filter_type_flags_supports_filter_type() {
        let flags = FilterTypeFlags::PEAK | FilterTypeFlags::HIGH_SHELF;
        assert!(flags.supports(FilterType::Peak));
        assert!(flags.supports(FilterType::HighShelf));
        assert!(!flags.supports(FilterType::LowShelf));
        assert!(!flags.supports(FilterType::LowPass));
    }
}
