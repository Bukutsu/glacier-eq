// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Device-bound PEQ validation and normalization.

use super::{get_supported_device, DeviceCapabilities, DeviceProfile, DeviceProtocol, EqProtocol};
use crate::eq::PEQData;

/// Validates and normalizes PEQ data for a device profile before a hardware write.
pub fn normalize_peq_for_profile(peq: PEQData, profile: &DeviceProfile) -> Result<PEQData, String> {
    normalize_peq_for_capabilities(peq, &profile.caps, profile.protocol)
}

/// Selects a registered device profile and normalizes PEQ data for its write path.
/// Stored profiles must remain device-independent and should not use this function.
pub fn normalize_peq_for_device(
    peq: PEQData,
    vendor_id: u16,
    product_id: u16,
) -> Result<PEQData, String> {
    let profile = selected_profile(vendor_id, product_id)?;
    normalize_peq_for_profile(peq, profile)
}

/// Applies the same capability and protocol rules used by writes and profile matching.
pub fn normalize_peq_for_capabilities(
    mut peq: PEQData,
    caps: &DeviceCapabilities,
    protocol: DeviceProtocol,
) -> Result<PEQData, String> {
    validate_peq(&peq)?;
    let _ = peq.clamp_to_capabilities(caps);
    for (index, filter) in peq.filters.iter_mut().enumerate() {
        filter.index = index as u8;
    }
    peq.global_gain = quantize_preamp(peq.global_gain, protocol);
    validate_peq(&peq)?;
    Ok(peq)
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

fn selected_profile(vendor_id: u16, product_id: u16) -> Result<&'static DeviceProfile, String> {
    get_supported_device(vendor_id, product_id)
        .ok_or_else(|| format!("No profile registered for {vendor_id:04X}:{product_id:04X}"))
}

fn quantize_preamp(global_gain: f64, protocol: DeviceProtocol) -> f64 {
    match protocol {
        DeviceProtocol::Walkplay => global_gain.round(),
        DeviceProtocol::Moondrop | DeviceProtocol::FiioJa11 | DeviceProtocol::Fiio => {
            (global_gain * 10.0).round() / 10.0
        }
        DeviceProtocol::Unknown => global_gain,
    }
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
        let normalized = normalize_peq_for_device(
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
    }

    #[test]
    fn tenth_db_protocol_rounds_half_steps_like_device_writes() {
        let normalized = normalize_peq_for_device(
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
    fn default_predicate_uses_selected_protocol_policy() {
        let peq = PEQData {
            filters: vec![Filter {
                gain: 0.0,
                ..filter()
            }],
            global_gain: 0.0,
        };

        assert!(is_default_peq_for_device(&peq, 0x3302, 0x43e8).unwrap());
    }
}
