// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Canonical biquad coefficient computation shared by USB packet building and graph rendering.

use crate::eq::{Filter, FilterType};
use std::f64::consts::TAU;

/// Meaning of the Q field in the device's coefficient designer.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum EqResponseModel {
    /// RBJ Q-factor for peaks, shelves and pass filters.
    #[default]
    CanonicalQ,
    /// DAWN PRO 2 uses RBJ shelf slope S for shelves; other filters use Q.
    MoondropShelfSlope,
}

impl EqResponseModel {
    /// Validate gain and Q/slope before designing a candidate. Device bounds
    /// and fixed-point coefficient representability are separate constraints.
    pub fn validate_parameters(
        self,
        filter_type: FilterType,
        gain: f64,
        q: f64,
    ) -> Result<(), &'static str> {
        if !gain.is_finite() || !q.is_finite() || q <= 0.0 {
            return Err("Filter gain must be finite and Q/shelf slope must be finite and positive");
        }
        if self == Self::MoondropShelfSlope
            && matches!(filter_type, FilterType::LowShelf | FilterType::HighShelf)
        {
            let amp = 10_f64.powf(gain / 40.0);
            let radicand = (amp + 1.0 / amp) * (1.0 / q - 1.0) + 2.0;
            if !radicand.is_finite() || radicand <= 0.0 {
                return Err(
                    "Moondrop shelf slope is too large for this gain; reduce shelf Q/slope",
                );
            }
        }
        Ok(())
    }
}

/// Returns `(b0, b1, b2, a0, a1, a2)` for the given filter parameters.
/// `FilterType::AllPass` (if ever added) would be an identity: `(1.0, 0.0, 0.0, 1.0, 0.0, 0.0)`.
pub fn compute_biquad_coeffs(
    filter: &Filter,
    dsp_sample_rate: f64,
) -> (f64, f64, f64, f64, f64, f64) {
    compute_biquad_coeffs_for(
        filter.filter_type,
        filter.freq as f64,
        filter.gain,
        filter.q,
        dsp_sample_rate,
    )
}

fn compute_biquad_coeffs_for(
    filter_type: FilterType,
    frequency: f64,
    gain: f64,
    q: f64,
    dsp_sample_rate: f64,
) -> (f64, f64, f64, f64, f64, f64) {
    compute_biquad_coeffs_for_model(
        filter_type,
        frequency,
        gain,
        q,
        dsp_sample_rate,
        EqResponseModel::CanonicalQ,
    )
}

/// Model-aware designer, retaining the canonical helper's parameter clamps.
/// Invalid Moondrop shelf slopes yield NaNs, never an identity filter; use
/// `EqResponseModel::validate_parameters` for an actionable error first.
pub(crate) fn compute_biquad_coeffs_for_model(
    filter_type: FilterType,
    frequency: f64,
    gain: f64,
    q: f64,
    dsp_sample_rate: f64,
    model: EqResponseModel,
) -> (f64, f64, f64, f64, f64, f64) {
    let slope_shelf = model == EqResponseModel::MoondropShelfSlope
        && matches!(filter_type, FilterType::LowShelf | FilterType::HighShelf);
    if slope_shelf && model.validate_parameters(filter_type, gain, q).is_err() {
        return (f64::NAN, f64::NAN, f64::NAN, f64::NAN, f64::NAN, f64::NAN);
    }
    if !dsp_sample_rate.is_finite()
        || dsp_sample_rate < 41.0
        || !frequency.is_finite()
        || !gain.is_finite()
        || !q.is_finite()
    {
        return (1.0, 0.0, 0.0, 1.0, 0.0, 0.0);
    }
    let q = if slope_shelf { q } else { q.clamp(0.01, 100.0) };
    // Clamp the frequency to at most 49% of the sample rate to prevent Nyquist boundary collapse
    let max_safe_freq = (0.49 * dsp_sample_rate).max(20.0);
    let freq = frequency.clamp(20.0, max_safe_freq);
    let gain = gain.clamp(-150.0, 150.0);
    let a_val = 10_f64.powf(gain / 40.0);
    let omega = (freq * TAU) / dsp_sample_rate;
    let sin_w = omega.sin();
    let cos_w = omega.cos();

    let alpha = if slope_shelf {
        sin_w / 2.0 * ((a_val + 1.0 / a_val) * (1.0 / q - 1.0) + 2.0).sqrt()
    } else {
        sin_w / (2.0 * q)
    };

    match filter_type {
        FilterType::Peak => (
            1.0 + alpha * a_val,
            -2.0 * cos_w,
            1.0 - alpha * a_val,
            1.0 + alpha / a_val,
            -2.0 * cos_w,
            1.0 - alpha / a_val,
        ),
        FilterType::LowShelf => {
            let a_minus_1 = a_val - 1.0;
            let a_plus_1 = a_val + 1.0;
            let sqrt_a_alpha = 2.0 * a_val.sqrt() * alpha;
            (
                a_val * (a_plus_1 - a_minus_1 * cos_w + sqrt_a_alpha),
                2.0 * a_val * (a_minus_1 - a_plus_1 * cos_w),
                a_val * (a_plus_1 - a_minus_1 * cos_w - sqrt_a_alpha),
                a_plus_1 + a_minus_1 * cos_w + sqrt_a_alpha,
                -2.0 * (a_minus_1 + a_plus_1 * cos_w),
                a_plus_1 + a_minus_1 * cos_w - sqrt_a_alpha,
            )
        }
        FilterType::HighShelf => {
            let a_minus_1 = a_val - 1.0;
            let a_plus_1 = a_val + 1.0;
            let sqrt_a_alpha = 2.0 * a_val.sqrt() * alpha;
            (
                a_val * (a_plus_1 + a_minus_1 * cos_w + sqrt_a_alpha),
                -2.0 * a_val * (a_minus_1 + a_plus_1 * cos_w),
                a_val * (a_plus_1 + a_minus_1 * cos_w - sqrt_a_alpha),
                a_plus_1 - a_minus_1 * cos_w + sqrt_a_alpha,
                2.0 * (a_minus_1 - a_plus_1 * cos_w),
                a_plus_1 - a_minus_1 * cos_w - sqrt_a_alpha,
            )
        }
        FilterType::HighPass => (
            (1.0 + cos_w) / 2.0,
            -(1.0 + cos_w),
            (1.0 + cos_w) / 2.0,
            1.0 + alpha,
            -2.0 * cos_w,
            1.0 - alpha,
        ),
        FilterType::LowPass => (
            (1.0 - cos_w) / 2.0,
            1.0 - cos_w,
            (1.0 - cos_w) / 2.0,
            1.0 + alpha,
            -2.0 * cos_w,
            1.0 - alpha,
        ),
    }
}

/// Accumulate the same stable response without allocating, for AutoEQ's hot loop.
pub fn accumulate_response_values(
    filter_type: FilterType,
    frequency: f64,
    gain: f64,
    q: f64,
    dsp_sample_rate: f64,
    freqs: &[f32],
    response: &mut [f32],
) {
    // Reject non-finite and non-positive rates.
    if !dsp_sample_rate.is_finite() || dsp_sample_rate <= 0.0 {
        return;
    }
    let factor = TAU / dsp_sample_rate;
    let coeffs = compute_biquad_coeffs_for(filter_type, frequency, gain, q, dsp_sample_rate);
    let mag_coeffs = biquad_mag_squared_coeffs(coeffs);

    for (freq, value) in freqs.iter().zip(response.iter_mut()) {
        let cos_w = (*freq as f64 * factor).cos();
        *value += eval_biquad_mag_squared_db(mag_coeffs, cos_w);
    }
}

pub fn accumulate_response_values_cos(
    filter_type: FilterType,
    frequency: f64,
    gain: f64,
    q: f64,
    dsp_sample_rate: f64,
    cos_w_arr: &[f64],
    response: &mut [f32],
) {
    // Preserve the legacy no-op for invalid rates.
    let _ = accumulate_response_values_cos_for_model(
        filter_type,
        frequency,
        gain,
        q,
        dsp_sample_rate,
        EqResponseModel::CanonicalQ,
        cos_w_arr,
        response,
    );
}

/// Accumulate a device-model response using precomputed cosines. Validate
/// slope shelves before touching the output so invalid candidates cannot look
/// like flat filters. Canonical parameter sanitization remains unchanged.
#[allow(clippy::too_many_arguments)]
pub fn accumulate_response_values_cos_for_model(
    filter_type: FilterType,
    frequency: f64,
    gain: f64,
    q: f64,
    dsp_sample_rate: f64,
    model: EqResponseModel,
    cos_w_arr: &[f64],
    response: &mut [f32],
) -> Result<(), &'static str> {
    if model == EqResponseModel::MoondropShelfSlope
        && matches!(filter_type, FilterType::LowShelf | FilterType::HighShelf)
    {
        model.validate_parameters(filter_type, gain, q)?;
    }
    if !dsp_sample_rate.is_finite() || dsp_sample_rate <= 0.0 {
        return Err("DSP sample rate must be finite and positive");
    }
    let coeffs =
        compute_biquad_coeffs_for_model(filter_type, frequency, gain, q, dsp_sample_rate, model);
    let mag_coeffs = biquad_mag_squared_coeffs(coeffs);
    for (&cos_w, value) in cos_w_arr.iter().zip(response.iter_mut()) {
        *value += eval_biquad_mag_squared_db(mag_coeffs, cos_w);
    }
    Ok(())
}

#[inline]
pub(crate) fn biquad_mag_squared_coeffs(
    (b0, b1, b2, a0, a1, a2): (f64, f64, f64, f64, f64, f64),
) -> (f64, f64, f64, f64, f64, f64) {
    // Multiply H(z)'s numerator and denominator by z: each becomes
    // (c0 + c2) cos(w) + c1 + i (c0 - c2) sin(w).
    // Keep real/imaginary terms instead of expanding a cancelling quadratic.
    (b0 + b2, b1, b0 - b2, a0 + a2, a1, a0 - a2)
}

#[inline]
pub(crate) fn eval_biquad_mag_squared_db(
    (sum_b, b1, diff_b, sum_a, a1, diff_a): (f64, f64, f64, f64, f64, f64),
    cos_w: f64,
) -> f32 {
    let sin_squared = (1.0 - cos_w) * (1.0 + cos_w);
    let real_b = sum_b * cos_w + b1;
    let real_a = sum_a * cos_w + a1;
    let num = real_b * real_b + diff_b * diff_b * sin_squared;
    let den = real_a * real_a + diff_a * diff_a * sin_squared;

    if num > 0.0 && den > 0.0 {
        (10.0 * (num / den).log10()) as f32
    } else if num <= 0.0 && den > 0.0 {
        -150.0
    } else {
        0.0
    }
}
