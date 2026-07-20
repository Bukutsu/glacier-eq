// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::eq::constants::ISO_FREQUENCIES;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum FilterType {
    #[serde(rename = "LSQ", alias = "LSC", alias = "LowShelf", alias = "Low Shelf")]
    LowShelf = 1,
    #[serde(rename = "PK", alias = "Peak")]
    Peak = 2,
    #[serde(
        rename = "HSQ",
        alias = "HSC",
        alias = "HighShelf",
        alias = "High Shelf"
    )]
    HighShelf = 3,
    #[serde(rename = "HP", alias = "HighPass", alias = "High Pass")]
    HighPass = 4,
    #[serde(rename = "LP", alias = "LowPass", alias = "Low Pass")]
    LowPass = 5,
}

impl FilterType {
    /// All supported filter types in UI display order.
    pub const ALL: &[FilterType] = &[
        FilterType::Peak,
        FilterType::HighShelf,
        FilterType::LowShelf,
        FilterType::HighPass,
        FilterType::LowPass,
    ];

    pub const fn editor_name(self) -> &'static str {
        match self {
            Self::Peak => "Peak",
            Self::LowShelf => "LowShelf",
            Self::HighShelf => "HighShelf",
            Self::HighPass => "HighPass",
            Self::LowPass => "LowPass",
        }
    }
}

impl From<u8> for FilterType {
    fn from(value: u8) -> Self {
        match value {
            1 => FilterType::LowShelf,
            2 => FilterType::Peak,
            3 => FilterType::HighShelf,
            4 => FilterType::HighPass,
            5 => FilterType::LowPass,
            _ => {
                log::warn!(
                    "Unknown FilterType byte {:#04x} in device response — defaulting to Peak. \
                     Your device likely uses a different filter-type encoding; see CONTRIBUTING_DEVICES.md.",
                    value
                );
                FilterType::Peak
            }
        }
    }
}

impl From<FilterType> for u8 {
    fn from(ft: FilterType) -> Self {
        ft as u8
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Filter {
    pub index: u8,
    pub enabled: bool,
    pub freq: u16,
    pub gain: f64,
    pub q: f64,
    #[serde(rename = "type", alias = "filter_type")]
    pub filter_type: FilterType,
}

pub(crate) const DEFAULT_FREQS_10_BAND: [u16; 10] =
    [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

impl Filter {
    pub fn enabled(index: u8, enabled: bool) -> Self {
        let freq = DEFAULT_FREQS_10_BAND
            .get(index as usize)
            .copied()
            .unwrap_or(1000);
        Filter {
            index,
            enabled,
            freq,
            gain: 0.0,
            q: 1.0,
            filter_type: FilterType::Peak,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct PEQData {
    pub filters: Vec<Filter>,
    #[serde(rename = "globalGain", alias = "global_gain")]
    pub global_gain: f64,
}

use crate::device::capabilities::DeviceCapabilities;

impl PEQData {
    /// Clamps the EQ data to fit within the given device capabilities.
    pub fn clamp_to_capabilities(&mut self, caps: &DeviceCapabilities) -> Vec<String> {
        let mut warnings = Vec::new();

        if self.global_gain < caps.global_gain_range.0 as f64
            || self.global_gain > caps.global_gain_range.1 as f64
        {
            let old_gain = self.global_gain;
            self.global_gain = self.global_gain.clamp(
                caps.global_gain_range.0 as f64,
                caps.global_gain_range.1 as f64,
            );
            warnings.push(format!(
                "Clamped preamp gain from {:.1} dB to {:.1} dB",
                old_gain, self.global_gain
            ));
        }

        if caps.integer_preamp && (self.global_gain - self.global_gain.round()).abs() > 1e-9 {
            let old_gain = self.global_gain;
            self.global_gain = self.global_gain.round();
            warnings.push(format!(
                "Rounded preamp gain from {:.2} dB to {:.0} dB to match device integer preamp capability",
                old_gain, self.global_gain
            ));
        }

        // Truncate if there are more filters than supported bands
        if self.filters.len() > caps.num_bands {
            let excess = self.filters.len() - caps.num_bands;
            self.filters.truncate(caps.num_bands);
            warnings.push(format!(
                "Truncated {} band(s) (device supports max {})",
                excess, caps.num_bands
            ));
        }

        // Pad with disabled filters if there are fewer filters than supported bands
        while self.filters.len() < caps.num_bands {
            self.filters
                .push(Filter::enabled(self.filters.len() as u8, false));
        }

        for (i, filter) in self.filters.iter_mut().enumerate() {
            let band_num = i + 1;

            // Only warn on clamping for enabled filters, or if it is disabled but has non-zero gain
            let should_check_clamp =
                filter.enabled || filter.freq != 0 || filter.gain.abs() > 0.001;

            if should_check_clamp {
                let old_freq = filter.freq;
                let old_gain = filter.gain;
                let old_q = filter.q;

                filter.gain = filter
                    .gain
                    .clamp(caps.band_gain_range.0, caps.band_gain_range.1);
                filter.q = filter.q.clamp(caps.q_range.0, caps.q_range.1);
                filter.freq = filter.freq.clamp(caps.freq_range.0, caps.freq_range.1);

                if filter.freq != old_freq {
                    warnings.push(format!(
                        "Band {}: Clamped frequency from {} Hz to {} Hz",
                        band_num, old_freq, filter.freq
                    ));
                }
                if (filter.gain - old_gain).abs() > 0.001 {
                    warnings.push(format!(
                        "Band {}: Clamped gain from {:.1} dB to {:.1} dB",
                        band_num, old_gain, filter.gain
                    ));
                }
                if (filter.q - old_q).abs() > 0.001 {
                    warnings.push(format!(
                        "Band {}: Clamped Q from {:.2} to {:.2}",
                        band_num, old_q, filter.q
                    ));
                }
            } else {
                filter.gain = filter
                    .gain
                    .clamp(caps.band_gain_range.0, caps.band_gain_range.1);
                filter.q = filter.q.clamp(caps.q_range.0, caps.q_range.1);
                filter.freq = filter.freq.clamp(caps.freq_range.0, caps.freq_range.1);
            }

            if !caps.supported_filter_types.contains(&filter.filter_type) {
                let old_type = filter.filter_type;
                filter.filter_type = FilterType::Peak; // Fallback
                if filter.enabled {
                    warnings.push(format!(
                        "Band {}: Converted filter type from {:?} to Peak (unsupported by device)",
                        band_num, old_type
                    ));
                }
            }

            if !caps.supports_per_band_enable {
                // If per-band enable is not supported, effectively disable by zeroing gain
                if !filter.enabled && filter.gain.abs() > 0.001 {
                    filter.gain = 0.0;
                    warnings.push(format!(
                        "Band {}: Set disabled band gain to 0 dB (device lacks per-band disable support)",
                        band_num
                    ));
                }
            }
        }

        warnings
    }
}

pub fn snap_freq_to_iso(freq: u16) -> u16 {
    let idx = ISO_FREQUENCIES.partition_point(|&f| f < freq);
    if idx == 0 {
        ISO_FREQUENCIES[0]
    } else if idx >= ISO_FREQUENCIES.len() {
        ISO_FREQUENCIES[ISO_FREQUENCIES.len() - 1]
    } else {
        let left = ISO_FREQUENCIES[idx - 1];
        let right = ISO_FREQUENCIES[idx];
        if (freq - left) <= (right - freq) {
            left
        } else {
            right
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::capabilities::DESKTOP_DAC_CAPS;

    #[test]
    fn test_clamp_to_capabilities_rounds_preamp() {
        let mut peq = PEQData {
            filters: vec![],
            global_gain: -3.52,
        };
        let mut caps = DESKTOP_DAC_CAPS.clone();
        caps.integer_preamp = true;

        let warnings = peq.clamp_to_capabilities(&caps);
        assert_eq!(peq.global_gain, -4.0);
        assert!(warnings.iter().any(|w| w.contains("Rounded preamp gain")));
    }
}
