// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Device-bound PEQ validation and normalization.

use super::{get_supported_device, DeviceCapabilities, DeviceProfile, DeviceProtocol, EqProtocol};
use crate::eq::{FilterType, PEQData};

/// Validates and normalizes PEQ data for a device profile before a hardware write.
/// Returns the normalized PEQ together with every capability-clamp warning, so
/// callers can tell the user their values were adjusted instead of the write
/// silently changing the EQ.
pub fn normalize_peq_for_profile(
    peq: PEQData,
    profile: &DeviceProfile,
) -> Result<(PEQData, Vec<String>), String> {
    normalize_peq_for_capabilities(peq, &profile.caps, profile.protocol)
}

/// Selects a registered device profile and normalizes PEQ data for its write path.
/// Stored profiles must remain device-independent and should not use this function.
pub fn normalize_peq_for_device(
    peq: PEQData,
    vendor_id: u16,
    product_id: u16,
) -> Result<(PEQData, Vec<String>), String> {
    let profile = selected_profile(vendor_id, product_id)?;
    normalize_peq_for_profile(peq, profile)
}

/// Applies the same capability and protocol rules used by writes and profile matching.
pub fn normalize_peq_for_capabilities(
    mut peq: PEQData,
    caps: &DeviceCapabilities,
    protocol: DeviceProtocol,
) -> Result<(PEQData, Vec<String>), String> {
    validate_capabilities(caps)?;
    validate_peq(&peq)?;
    // The warnings are the whole point of returning them: discarding them
    // here meant every push altered out-of-range values with no signal.
    let mut warnings = peq.clamp_to_capabilities(caps);
    for (index, filter) in peq.filters.iter_mut().enumerate() {
        filter.index = index as u8;
        if filter.enabled {
            let old_gain = filter.gain;
            let quantized = quantize_band_gain(old_gain, protocol, caps)?;
            if (quantized - old_gain).abs() > 0.0001 {
                warnings.push(format!(
                    "Band {}: Rounded gain from {:.3} dB to {:.3} dB to match protocol precision",
                    index + 1,
                    old_gain,
                    quantized
                ));
            }
            filter.gain = quantized;
        }
    }
    let old_preamp = peq.global_gain;
    peq.global_gain = quantize_preamp(old_preamp, protocol, caps)?;
    if (peq.global_gain - old_preamp).abs() > 0.0001 {
        warnings.push(format!(
            "Rounded preamp from {:.3} dB to {:.3} dB to match protocol precision",
            old_preamp, peq.global_gain
        ));
    }
    validate_peq(&peq)?;
    Ok((peq, warnings))
}

/// Uses the selected protocol's transient-default policy for a pulled device state.
pub fn is_default_peq_for_device(
    peq: &PEQData,
    vendor_id: u16,
    product_id: u16,
) -> Result<bool, String> {
    let profile = selected_profile(vendor_id, product_id)?;
    Ok(profile.protocol.is_default_state(peq))
}

pub fn validate_peq(peq: &PEQData) -> Result<(), String> {
    if !peq.global_gain.is_finite() {
        return Err("Preamp must be finite".into());
    }
    for (index, filter) in peq.filters.iter().enumerate() {
        if !filter.gain.is_finite() || !filter.q.is_finite() || filter.q <= 0.0 {
            return Err(format!("Band {} has invalid gain or Q", index + 1));
        }
    }
    Ok(())
}

pub(crate) fn validate_peq_for_capabilities(
    peq: &PEQData,
    caps: &DeviceCapabilities,
) -> Result<(), String> {
    validate_capabilities(caps)?;
    validate_peq(peq)?;
    let global_tolerance = 0.001;
    if peq.global_gain < caps.global_gain_range.0 as f64 - global_tolerance
        || peq.global_gain > caps.global_gain_range.1 as f64 + global_tolerance
    {
        return Err(format!(
            "Pulled preamp {} dB is outside the device range",
            peq.global_gain
        ));
    }
    for (index, filter) in peq.filters.iter().enumerate() {
        if filter.index as usize >= caps.num_bands
            || !caps.supported_filter_types.contains(&filter.filter_type)
        {
            return Err(format!(
                "Pulled band {} has unsupported metadata",
                index + 1
            ));
        }
        let freq_tolerance = caps.freq_tolerance as f64;
        let gain_tolerance = caps.gain_tolerance.max(0.001);
        let q_tolerance = caps.q_tolerance.max(0.001);
        if (filter.freq as f64) < caps.freq_range.0 as f64 - freq_tolerance
            || (filter.freq as f64) > caps.freq_range.1 as f64 + freq_tolerance
            || filter.gain < caps.band_gain_range.0 - gain_tolerance
            || filter.gain > caps.band_gain_range.1 + gain_tolerance
            || filter.q < caps.q_range.0 - q_tolerance
            || filter.q > caps.q_range.1 + q_tolerance
        {
            return Err(format!(
                "Pulled band {} is outside device capabilities",
                index + 1
            ));
        }
    }
    Ok(())
}

pub(crate) fn validate_capabilities(caps: &DeviceCapabilities) -> Result<(), String> {
    if caps.num_bands == 0 {
        return Err("Device must support at least one band".into());
    }
    if caps.global_gain_range.0 > caps.global_gain_range.1 {
        return Err("Device global gain range is invalid".into());
    }
    if !caps.band_gain_range.0.is_finite()
        || !caps.band_gain_range.1.is_finite()
        || caps.band_gain_range.0 > caps.band_gain_range.1
    {
        return Err("Device band gain range must be finite and ordered".into());
    }
    if caps.freq_range.0 == 0 || caps.freq_range.0 > caps.freq_range.1 {
        return Err("Device frequency range must be positive and ordered".into());
    }
    if caps
        .supported_filter_types
        .iter()
        .any(|filter_type| matches!(filter_type, FilterType::LowShelf | FilterType::HighShelf))
    {
        let shelf_low = caps.freq_range.0.max(40);
        let shelf_high = caps.freq_range.1.min(10_000);
        if shelf_low > shelf_high {
            return Err("Device frequency range has no feasible shelf center".into());
        }
    }
    if !caps.q_range.0.is_finite()
        || !caps.q_range.1.is_finite()
        || caps.q_range.0 <= 0.0
        || caps.q_range.0 > caps.q_range.1
    {
        return Err("Device Q range must be positive, finite, and ordered".into());
    }
    if !caps.dsp_sample_rate.is_finite() || caps.dsp_sample_rate <= 0.0 {
        return Err("Device sample rate must be positive and finite".into());
    }
    Ok(())
}

fn selected_profile(vendor_id: u16, product_id: u16) -> Result<&'static DeviceProfile, String> {
    get_supported_device(vendor_id, product_id)
        .ok_or_else(|| format!("No profile registered for {vendor_id:04X}:{product_id:04X}"))
}

fn quantize_band_gain(
    gain: f64,
    protocol: DeviceProtocol,
    caps: &DeviceCapabilities,
) -> Result<f64, String> {
    match protocol {
        // FiiO encodes band gain in 0.1 dB units. Select a representable value
        // inside the declared capability envelope rather than quantizing first
        // and accidentally exceeding the cap.
        DeviceProtocol::FiioJa11 | DeviceProtocol::Fiio => {
            quantize_step_within(gain, 0.1, caps.band_gain_range, "band gain")
        }
        DeviceProtocol::Moondrop | DeviceProtocol::Walkplay | DeviceProtocol::Unknown => Ok(gain),
    }
}

fn quantize_preamp(
    global_gain: f64,
    protocol: DeviceProtocol,
    caps: &DeviceCapabilities,
) -> Result<f64, String> {
    let step = match protocol {
        DeviceProtocol::Walkplay => 1.0,
        DeviceProtocol::Moondrop | DeviceProtocol::FiioJa11 | DeviceProtocol::Fiio => 0.1,
        DeviceProtocol::Unknown => return Ok(global_gain),
    };
    quantize_step_within(
        global_gain,
        step,
        (
            caps.global_gain_range.0 as f64,
            caps.global_gain_range.1 as f64,
        ),
        "preamp gain",
    )
}

fn quantize_step_within(
    value: f64,
    step: f64,
    range: (f64, f64),
    label: &str,
) -> Result<f64, String> {
    let first = (range.0 / step).ceil() as i64;
    let last = (range.1 / step).floor() as i64;
    if first > last {
        return Err(format!(
            "Device {label} range {:.3}..{:.3} dB cannot represent the protocol step",
            range.0, range.1
        ));
    }
    let nearest = (value / step).round() as i64;
    let raw_selected = nearest.clamp(first, last) as f64 * step;
    let selected = if step < 1.0 {
        (raw_selected * 10.0).round() / 10.0
    } else {
        raw_selected.round()
    };
    if selected < range.0 - 0.0001 || selected > range.1 + 0.0001 {
        return Err(format!(
            "Device {label} cannot represent the requested value"
        ));
    }
    Ok(selected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eq::{Filter, FilterType};

    fn filter() -> Filter {
        Filter {
            index: 9,
            enabled: true,
            freq: 10,
            gain: 20.0,
            q: 20.0,
            filter_type: FilterType::HighPass,
        }
    }

    #[test]
    fn selected_device_normalization_clamps_and_canonicalizes_filters() {
        let mut disabled = filter();
        disabled.enabled = false;
        let (normalized, warnings) = normalize_peq_for_device(
            PEQData {
                filters: vec![filter(), disabled],
                global_gain: 20.0,
            },
            0x2972,
            0x0102,
        )
        .unwrap();

        assert_eq!(normalized.global_gain, 12.0);
        assert_eq!(normalized.filters.len(), 5);
        assert_eq!(normalized.filters[0].index, 0);
        assert_eq!(normalized.filters[0].freq, 20);
        assert_eq!(normalized.filters[0].gain, 12.0);
        assert_eq!(normalized.filters[0].q, 10.0);
        assert_eq!(normalized.filters[0].filter_type, FilterType::Peak);
        assert_eq!(normalized.filters[1].gain, 0.0);
        assert_eq!(normalized.filters[4].index, 4);
        // Every value above that got altered must be reported: the old code
        // dropped these warnings at `let _ = clamp_to_capabilities`, so a
        // push silently rewrote the user's EQ.
        assert!(
            !warnings.is_empty(),
            "clamping must produce warnings for the caller to surface"
        );
        assert!(
            warnings.iter().any(|warning| warning.contains("preamp")),
            "the 20.0 dB preamp clamp must be among {warnings:?}"
        );
    }

    #[test]
    fn tenth_db_protocol_rounds_half_steps_like_device_writes() {
        let (normalized, _warnings) = normalize_peq_for_device(
            PEQData {
                filters: vec![],
                global_gain: 0.05,
            },
            0x2972,
            0x0102,
        )
        .unwrap();

        assert_eq!(normalized.global_gain, 0.1);
    }

    #[test]
    fn device_band_gain_quantization_is_reported() {
        let peq = PEQData {
            filters: vec![Filter {
                index: 0,
                enabled: true,
                freq: 1000,
                gain: 0.04,
                q: 1.0,
                filter_type: FilterType::Peak,
            }],
            global_gain: 0.0,
        };
        let (normalized, warnings) = normalize_peq_for_device(peq, 0x2972, 0x0102).unwrap();
        assert_eq!(normalized.filters[0].gain, 0.0);
        assert!(warnings
            .iter()
            .any(|warning| warning.contains("protocol precision")));
    }

    #[test]
    fn protocol_quantization_stays_inside_a_narrow_capability_range() {
        let mut caps = get_supported_device(0x2972, 0x0102).unwrap().caps.clone();
        caps.band_gain_range = (0.0, 0.06);
        let (normalized, warnings) = normalize_peq_for_capabilities(
            PEQData {
                filters: vec![Filter {
                    index: 0,
                    enabled: true,
                    freq: 1000,
                    gain: 0.06,
                    q: 1.0,
                    filter_type: FilterType::Peak,
                }],
                global_gain: 0.0,
            },
            &caps,
            DeviceProtocol::FiioJa11,
        )
        .unwrap();
        assert_eq!(normalized.filters[0].gain, 0.0);
        assert!(warnings
            .iter()
            .any(|warning| warning.contains("protocol precision")));
    }

    #[test]
    fn shelf_capabilities_without_a_feasible_center_are_rejected() {
        let mut caps = get_supported_device(0x2972, 0x0102).unwrap().caps.clone();
        caps.freq_range = (20, 20);
        let error = normalize_peq_for_capabilities(
            PEQData {
                filters: vec![Filter {
                    index: 0,
                    enabled: true,
                    freq: 20,
                    gain: 0.0,
                    q: 1.0,
                    filter_type: FilterType::Peak,
                }],
                global_gain: 0.0,
            },
            &caps,
            DeviceProtocol::FiioJa11,
        )
        .unwrap_err();
        assert!(error.contains("shelf center"), "{error}");
    }

    #[test]
    fn normalization_rejects_non_finite_and_non_positive_values() {
        for peq in [
            PEQData {
                filters: vec![],
                global_gain: f64::NAN,
            },
            PEQData {
                filters: vec![Filter {
                    gain: f64::INFINITY,
                    ..filter()
                }],
                global_gain: 0.0,
            },
            PEQData {
                filters: vec![Filter { q: 0.0, ..filter() }],
                global_gain: 0.0,
            },
        ] {
            assert!(normalize_peq_for_device(peq, 0x2972, 0x0102).is_err());
        }
    }

    #[test]
    fn normalization_rejects_invalid_capability_ranges() {
        let peq = PEQData {
            filters: vec![filter()],
            global_gain: 0.0,
        };
        let mut caps = crate::device::capabilities::DESKTOP_DAC_CAPS;
        caps.q_range = (3.0, 0.5);
        assert!(
            normalize_peq_for_capabilities(peq.clone(), &caps, DeviceProtocol::Unknown).is_err()
        );

        caps.q_range = (0.5, 3.0);
        caps.freq_range = (20_000, 20);
        assert!(normalize_peq_for_capabilities(peq, &caps, DeviceProtocol::Unknown).is_err());
    }

    #[test]
    fn pulled_state_validation_rejects_out_of_capability_values() {
        let caps = crate::device::capabilities::DESKTOP_DAC_CAPS;
        let mut filter = filter();
        filter.gain = 100.0;
        let peq = PEQData {
            filters: vec![filter],
            global_gain: 0.0,
        };
        assert!(validate_peq_for_capabilities(&peq, &caps).is_err());
    }

    #[test]
    fn default_predicate_uses_selected_protocol_policy() {
        let peq = PEQData {
            filters: vec![Filter {
                gain: 0.0,
                filter_type: FilterType::Peak,
                ..filter()
            }],
            global_gain: 0.0,
        };

        assert!(is_default_peq_for_device(&peq, 0x3302, 0x43e8).unwrap());
    }
}
