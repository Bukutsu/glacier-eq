// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::device::{DeviceCapabilities, DeviceProtocol};
use crate::eq::{Filter, PEQData};

pub struct ProfileCandidate<'a> {
    pub name: &'a str,
    pub data: &'a PEQData,
}

pub fn normalize_for_match(
    mut peq: PEQData,
    caps: &DeviceCapabilities,
    protocol: DeviceProtocol,
) -> PEQData {
    let _ = peq.clamp_to_capabilities(caps);
    // Quantize preamp to each protocol's readback granularity: every protocol
    // reports global gain coarser than we store it, and comparing unquantized
    // values against the pulled state makes push verification and profile
    // matching fail on fractional preamp.
    peq.global_gain = match protocol {
        DeviceProtocol::Walkplay => peq.global_gain.round(),
        DeviceProtocol::Moondrop | DeviceProtocol::FiioJa11 | DeviceProtocol::Fiio => {
            (peq.global_gain * 10.0).round() / 10.0
        }
        // Unrecognized device: leave preamp untouched rather than assuming an
        // integer step (the old Walkplay fallback could mask ~1 dB differences).
        DeviceProtocol::Unknown => peq.global_gain,
    };
    peq
}

fn active_filters(peq: &PEQData) -> Vec<&Filter> {
    // Enabled bands with zero gain are inactive acoustically, and Moondrop/FiiO
    // pulls even report them as disabled (enabled = gain != 0); treat them as
    // inactive on both sides so filter counts line up.
    let mut filters: Vec<&Filter> = peq
        .filters
        .iter()
        .filter(|filter| filter.enabled && filter.gain != 0.0)
        .collect();
    filters.sort_by(|a, b| {
        a.freq
            .cmp(&b.freq)
            .then_with(|| a.filter_type.cmp(&b.filter_type))
            .then_with(|| a.gain.total_cmp(&b.gain))
            .then_with(|| a.q.total_cmp(&b.q))
    });
    filters
}

fn filters_match(a: &Filter, b: &Filter, caps: &DeviceCapabilities) -> bool {
    a.filter_type == b.filter_type
        && (a.freq as i32 - b.freq as i32).abs() <= caps.freq_tolerance
        && (a.gain - b.gain).abs() <= caps.gain_tolerance
        && (a.q - b.q).abs() <= caps.q_tolerance
}

fn peq_matches_profile(
    current: &PEQData,
    profile: &PEQData,
    caps: &DeviceCapabilities,
    protocol: DeviceProtocol,
) -> bool {
    let current = normalize_for_match(current.clone(), caps, protocol);
    let profile = normalize_for_match(profile.clone(), caps, protocol);
    let current_filters = active_filters(&current);
    let profile_filters = active_filters(&profile);

    (current.global_gain - profile.global_gain).abs() <= 0.001
        && current_filters.len() == profile_filters.len()
        && current_filters
            .iter()
            .zip(profile_filters.iter())
            .all(|(a, b)| filters_match(a, b, caps))
}

pub fn matching_profile_name<'a>(
    current: &PEQData,
    profiles: impl IntoIterator<Item = ProfileCandidate<'a>>,
    caps: &DeviceCapabilities,
    protocol: DeviceProtocol,
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
            DeviceProtocol::Walkplay,
        ));
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

        let normalized = normalize_for_match(saved.clone(), &DESKTOP_DAC_CAPS, DeviceProtocol::Moondrop);
        assert_eq!(normalized.global_gain, -3.3);
        assert!(peq_matches_profile(
            &pulled,
            &saved,
            &DESKTOP_DAC_CAPS,
            DeviceProtocol::Moondrop,
        ));
    }
}
