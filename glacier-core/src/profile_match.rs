// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::device::{normalize_peq_for_capabilities, DeviceCapabilities, Protocol};
use crate::eq::{Filter, PEQData};

pub struct ProfileCandidate<'a> {
    pub name: &'a str,
    pub data: &'a PEQData,
}

/// The band gain a readback would report after writing `gain`.
fn quantized_band_gain(gain: f64, protocol: &Protocol) -> f64 {
    let Some(protocol) = protocol.eq else {
        return gain;
    };
    let encoding = protocol.gain_encoding();
    let wire = (gain * encoding.band_units_per_db).round() / encoding.band_units_per_db;
    (wire * encoding.band_readback_per_db).round() / encoding.band_readback_per_db
}

fn active_filters<'a>(
    peq: &'a PEQData,
    caps: &DeviceCapabilities,
    protocol: &Protocol,
) -> Vec<&'a Filter> {
    peq.filters
        .iter()
        .filter(|filter| {
            let pass_filter = matches!(
                filter.filter_type,
                crate::eq::FilterType::HighPass | crate::eq::FilterType::LowPass
            ) && caps.supported_filter_types.contains(&filter.filter_type);
            filter.enabled && (pass_filter || quantized_band_gain(filter.gain, protocol) != 0.0)
        })
        .collect()
}

fn filters_match(a: &Filter, b: &Filter, caps: &DeviceCapabilities) -> bool {
    a.filter_type == b.filter_type
        && (a.freq as i32 - b.freq as i32).abs() <= caps.freq_tolerance
        && (a.gain - b.gain).abs() <= caps.gain_tolerance
        && (a.q - b.q).abs() <= caps.q_tolerance
}

// Find an assignment rather than pairing sorted bands: tolerance allows
// matching bands to change relative order, and a greedy choice can block a
// later band that has only one candidate.
fn match_band(
    band: usize,
    profiles: &[&Filter],
    current: &[&Filter],
    assigned: &mut [Option<usize>],
    seen: &mut [bool],
    caps: &DeviceCapabilities,
) -> bool {
    for (index, candidate) in profiles.iter().enumerate() {
        if seen[index] || !filters_match(current[band], candidate, caps) {
            continue;
        }
        seen[index] = true;
        if assigned[index]
            .is_none_or(|previous| match_band(previous, profiles, current, assigned, seen, caps))
        {
            assigned[index] = Some(band);
            return true;
        }
    }
    false
}

fn peq_matches_profile(
    current: &PEQData,
    profile: &PEQData,
    caps: &DeviceCapabilities,
    protocol: &Protocol,
) -> bool {
    let Ok((current, _warnings)) = normalize_peq_for_capabilities(current.clone(), caps, protocol)
    else {
        return false;
    };
    let Ok((profile, _warnings)) = normalize_peq_for_capabilities(profile.clone(), caps, protocol)
    else {
        return false;
    };
    let current_filters = active_filters(&current, caps, protocol);
    let profile_filters = active_filters(&profile, caps, protocol);

    if (current.global_gain - profile.global_gain).abs() > 0.001
        || current_filters.len() != profile_filters.len()
    {
        return false;
    }
    let mut assigned = vec![None; profile_filters.len()];
    (0..current_filters.len()).all(|band| {
        let mut seen = vec![false; profile_filters.len()];
        match_band(
            band,
            &profile_filters,
            &current_filters,
            &mut assigned,
            &mut seen,
            caps,
        )
    })
}

pub fn matching_profile_name<'a>(
    current: &PEQData,
    profiles: impl IntoIterator<Item = ProfileCandidate<'a>>,
    caps: &DeviceCapabilities,
    protocol: &Protocol,
) -> Option<String> {
    profiles
        .into_iter()
        .find(|profile| peq_matches_profile(current, profile.data, caps, protocol))
        .map(|profile| profile.name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::capabilities::DESKTOP_DAC_CAPS;
    use crate::device::families::{fiio, moondrop, walkplay};
    use crate::eq::Filter;

    #[test]
    fn matches_saved_profile_with_device_quantization() {
        let mut current_filter = Filter::enabled(0, true);
        current_filter.freq = 164;
        current_filter.gain = -1.29;
        current_filter.q = 1.02;

        let mut saved_filter = current_filter.clone();
        saved_filter.q = 1.01;

        let current = PEQData {
            filters: vec![current_filter],
            global_gain: -6.0,
        };
        let saved = PEQData {
            filters: vec![saved_filter],
            global_gain: -5.5,
        };

        assert!(peq_matches_profile(
            &current,
            &saved,
            &DESKTOP_DAC_CAPS,
            &walkplay::PROTOCOL,
        ));
    }

    #[test]
    fn matches_bands_when_frequency_order_crosses() {
        let mut a = Filter::enabled(0, true);
        a.freq = 1000;
        a.gain = 1.0;
        let mut b = a.clone();
        b.freq = 1001;
        b.gain = 2.0;
        let current = PEQData {
            filters: vec![a.clone(), b.clone()],
            global_gain: 0.0,
        };
        a.freq = 1001;
        b.freq = 1000;
        let mut saved = PEQData {
            filters: vec![a, b],
            global_gain: 0.0,
        };
        assert!(peq_matches_profile(
            &current,
            &saved,
            &DESKTOP_DAC_CAPS,
            &crate::device::UNKNOWN
        ));
        saved.filters[1].gain = 4.0;
        assert!(!peq_matches_profile(
            &current,
            &saved,
            &DESKTOP_DAC_CAPS,
            &crate::device::UNKNOWN
        ));
    }

    #[test]
    fn reassigns_ambiguous_bands_instead_of_greedy_matching() {
        let mut a = Filter::enabled(0, true);
        a.freq = 1001;
        a.gain = 1.0;
        let mut b = a.clone();
        b.freq = 1000;
        let current = PEQData {
            filters: vec![a.clone(), b.clone()],
            global_gain: 0.0,
        };
        a.freq = 1000;
        b.freq = 1002;
        let saved = PEQData {
            filters: vec![a, b],
            global_gain: 0.0,
        };
        assert!(peq_matches_profile(
            &current,
            &saved,
            &DESKTOP_DAC_CAPS,
            &crate::device::UNKNOWN
        ));
    }

    #[test]
    fn substep_band_gains_match_inactive_device_readback() {
        for (protocol, gain) in [
            (&moondrop::PROTOCOL, 0.04),
            (&fiio::JA11, 0.04),
            (&fiio::KA_SERIES, 0.04),
            (&walkplay::PROTOCOL, 0.004),
        ] {
            let mut filter = Filter::enabled(0, true);
            filter.gain = gain;
            let saved = PEQData {
                filters: vec![filter],
                global_gain: 0.0,
            };
            let pulled = PEQData::default();
            assert!(
                peq_matches_profile(&pulled, &saved, &DESKTOP_DAC_CAPS, protocol),
                "{protocol:?} should classify {gain} dB as inactive"
            );
        }
    }

    #[test]
    fn enabled_pass_filters_remain_active_at_zero_gain() {
        for filter_type in [crate::FilterType::HighPass, crate::FilterType::LowPass] {
            let mut filter = Filter::enabled(0, true);
            filter.filter_type = filter_type;
            let saved = PEQData {
                filters: vec![filter],
                global_gain: 0.0,
            };
            assert!(!peq_matches_profile(
                &PEQData::default(),
                &saved,
                &DESKTOP_DAC_CAPS,
                &crate::device::UNKNOWN,
            ));
        }
    }

    #[test]
    fn moondrop_quantization_matches_pulled_preamp() {
        let saved = PEQData {
            filters: vec![],
            global_gain: -3.33,
        };
        // The device stores 0.1 dB steps, so pulling -3.33 reads back -3.3.
        let pulled = PEQData {
            filters: vec![],
            global_gain: -3.3,
        };

        let (normalized, _warnings) =
            normalize_peq_for_capabilities(saved.clone(), &DESKTOP_DAC_CAPS, &moondrop::PROTOCOL)
                .unwrap();
        assert_eq!(normalized.global_gain, -3.3);
        assert!(peq_matches_profile(
            &pulled,
            &saved,
            &DESKTOP_DAC_CAPS,
            &moondrop::PROTOCOL,
        ));
    }
}
