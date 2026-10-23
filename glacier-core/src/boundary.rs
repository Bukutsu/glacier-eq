// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Plain binding computations and input checks, independent of wasm or JS.
//! Kept host-buildable so numeric-boundary tests run in cargo test --lib.

#[cfg(test)]
use crate::device::capabilities::{DeviceCapabilities, DESKTOP_DAC_CAPS};
use crate::device::{get_supported_device, DeviceProfile, SUPPORTED_DEVICES};
use crate::eq::{Filter, PEQData};

pub(crate) fn response_values(
    peq: &PEQData,
    freqs: &[f32],
    include_preamp: bool,
    dsp_sample_rate: f64,
) -> Vec<f32> {
    let mut response = vec![
        if include_preamp {
            peq.global_gain as f32
        } else {
            0.0
        };
        freqs.len()
    ];
    let factor = std::f64::consts::TAU / dsp_sample_rate;
    let cos_w_arr: Vec<f64> = freqs.iter().map(|&f| (f as f64 * factor).cos()).collect();

    for filter in peq.filters.iter().filter(|filter| filter.enabled) {
        crate::eq::iir_math::accumulate_response_values_cos(
            filter.filter_type,
            filter.freq as f64,
            filter.gain,
            filter.q,
            dsp_sample_rate,
            &cos_w_arr,
            &mut response,
        );
    }
    response
}

/// Returns the aggregate response followed by one response per enabled filter.
/// All responses share one cosine grid and each filter is evaluated once.
pub(crate) fn response_values_and_bands(
    peq: &PEQData,
    freqs: &[f32],
    include_preamp: bool,
    dsp_sample_rate: f64,
) -> Vec<f32> {
    let enabled_filters: Vec<&Filter> =
        peq.filters.iter().filter(|filter| filter.enabled).collect();
    let stride = freqs.len();
    let mut responses = vec![0.0; (enabled_filters.len() + 1) * stride];
    if include_preamp {
        responses[..stride].fill(peq.global_gain as f32);
    }

    let factor = std::f64::consts::TAU / dsp_sample_rate;
    let cos_w_arr: Vec<f64> = freqs.iter().map(|&f| (f as f64 * factor).cos()).collect();

    for (band_index, filter) in enabled_filters.into_iter().enumerate() {
        let band_start = (band_index + 1) * stride;
        let (aggregate, remaining) = responses.split_at_mut(band_start);
        let band_response = &mut remaining[..stride];
        crate::eq::iir_math::accumulate_response_values_cos(
            filter.filter_type,
            filter.freq as f64,
            filter.gain,
            filter.q,
            dsp_sample_rate,
            &cos_w_arr,
            band_response,
        );
        for (total, band) in aggregate.iter_mut().zip(band_response.iter()) {
            *total += *band;
        }
    }
    responses
}

pub(crate) fn supported_profile(
    vendor_id: Option<u16>,
    product_id: Option<u16>,
) -> Option<&'static DeviceProfile> {
    match (vendor_id, product_id) {
        (Some(vid), Some(pid)) => get_supported_device(vid, pid),
        (Some(vid), None) => SUPPORTED_DEVICES.iter().find(|profile| {
            profile.vendor_id == vid
                && profile.product_id.is_none()
                && crate::device::families::fiio::registry::product_names(profile.name).is_empty()
        }),
        _ => None,
    }
}

#[cfg(test)]
pub(crate) fn device_caps_or_desktop(
    vendor_id: Option<u16>,
    product_id: Option<u16>,
) -> DeviceCapabilities {
    supported_profile(vendor_id, product_id)
        .map(|profile| profile.caps.clone())
        .unwrap_or_else(|| DESKTOP_DAC_CAPS.clone())
}

pub(crate) fn validate_dsp_sample_rate(sample_rate: f64) -> Result<(), String> {
    if !sample_rate.is_finite() || !(40_000.0..=768_000.0).contains(&sample_rate) {
        return Err(String::from(
            "DSP sample rate must be between 40000 and 768000 Hz",
        ));
    }
    Ok(())
}

pub(crate) fn validate_filter_numeric(filter: &Filter) -> Result<(), String> {
    if filter.freq == 0 {
        return Err(String::from("Filter frequency must be greater than zero"));
    }
    if !filter.gain.is_finite()
        || !filter.q.is_finite()
        || filter.q <= 0.0
        || !(filter.gain as f32).is_finite()
        || !(filter.q as f32).is_finite()
    {
        return Err(String::from(
            "Filter gain and Q must be finite and representable as f32 with Q greater than zero",
        ));
    }
    Ok(())
}

pub(crate) fn validate_peq_numeric(peq: &PEQData) -> Result<(), String> {
    crate::device::normalization::validate_peq(peq)?;
    if !(peq.global_gain as f32).is_finite() {
        return Err(String::from(
            "Global gain must be representable as a finite f32",
        ));
    }
    for filter in &peq.filters {
        validate_filter_numeric(filter)?;
    }
    Ok(())
}

pub(crate) fn validate_response_freqs(freqs: &[f32]) -> Result<(), String> {
    const MAX_RESPONSE_POINTS: usize = 262_144;
    if freqs.len() > MAX_RESPONSE_POINTS {
        return Err(String::from(
            "Response grid exceeds the maximum of 262144 points",
        ));
    }
    if freqs
        .iter()
        .any(|frequency| !frequency.is_finite() || *frequency <= 0.0)
    {
        return Err(String::from(
            "Response frequencies must be finite and positive",
        ));
    }
    Ok(())
}

pub(crate) fn validate_integer_range(
    value: f64,
    min: f64,
    max: f64,
    name: &str,
) -> Result<i64, String> {
    if !value.is_finite()
        || value.fract() != 0.0
        || value < min
        || value > max
        || value > 9_007_199_254_740_991.0
    {
        return Err(format!("{name} must be an integer between {min} and {max}"));
    }
    Ok(value as i64)
}

pub(crate) fn validate_integer_parameter(value: f64, name: &str) -> Result<usize, String> {
    Ok(validate_integer_range(value, 1.0, usize::MAX as f64, name)? as usize)
}

pub(crate) fn validate_device_id(value: f64, name: &str) -> Result<u16, String> {
    Ok(validate_integer_range(value, 0.0, u16::MAX as f64, name)? as u16)
}

pub(crate) fn validate_optional_device_id(
    value: Option<f64>,
    name: &str,
) -> Result<Option<u16>, String> {
    value.map(|id| validate_device_id(id, name)).transpose()
}

pub(crate) fn validate_finite_response(values: &[f32]) -> Result<(), String> {
    if values.iter().any(|value| !value.is_finite()) {
        return Err(String::from(
            "Response calculation produced a non-finite f32",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
