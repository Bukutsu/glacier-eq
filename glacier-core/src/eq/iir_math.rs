// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Canonical biquad coefficient computation shared by USB packet building and graph rendering.

use crate::eq::{Filter, FilterType};
use std::f64::consts::TAU;

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
    if !dsp_sample_rate.is_finite()
        || dsp_sample_rate < 41.0
        || !frequency.is_finite()
        || !gain.is_finite()
        || !q.is_finite()
    {
        return (1.0, 0.0, 0.0, 1.0, 0.0, 0.0);
    }
    let q = q.clamp(0.01, 100.0);
    // Clamp the frequency to at most 49% of the sample rate to prevent Nyquist boundary collapse
    let max_safe_freq = (0.49 * dsp_sample_rate).max(20.0);
    let freq = frequency.clamp(20.0, max_safe_freq);
    let a_val = 10_f64.powf(gain / 40.0);
    let omega = (freq * TAU) / dsp_sample_rate;
    let sin_w = omega.sin();
    let cos_w = omega.cos();

    // Use standard Q-factor for all filter types, matching PEQdB.
    let alpha = sin_w / (2.0 * q);

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
    // Reject non-finite and non-positive rates.
    if !dsp_sample_rate.is_finite() || dsp_sample_rate <= 0.0 {
        return;
    }
    let coeffs = compute_biquad_coeffs_for(filter_type, frequency, gain, q, dsp_sample_rate);
    let mag_coeffs = biquad_mag_squared_coeffs(coeffs);

    for (&cos_w, value) in cos_w_arr.iter().zip(response.iter_mut()) {
        *value += eval_biquad_mag_squared_db(mag_coeffs, cos_w);
    }
}

#[inline]
fn biquad_mag_squared_coeffs(
    (b0, b1, b2, a0, a1, a2): (f64, f64, f64, f64, f64, f64),
) -> (f64, f64, f64, f64, f64, f64) {
    let c0_b = (b0 - b2) * (b0 - b2) + b1 * b1;
    let c1_b = 2.0 * b1 * (b0 + b2);
    let c2_b = 4.0 * b0 * b2;

    let c0_a = (a0 - a2) * (a0 - a2) + a1 * a1;
    let c1_a = 2.0 * a1 * (a0 + a2);
    let c2_a = 4.0 * a0 * a2;

    (c0_b, c1_b, c2_b, c0_a, c1_a, c2_a)
}

#[inline]
fn eval_biquad_mag_squared_db(
    (c0_b, c1_b, c2_b, c0_a, c1_a, c2_a): (f64, f64, f64, f64, f64, f64),
    cos_w: f64,
) -> f32 {
    let num = c0_b + cos_w * (c1_b + c2_b * cos_w);
    let den = c0_a + cos_w * (c1_a + c2_a * cos_w);

    if num > 0.0 && den > 0.0 {
        (10.0 * (num / den).log10()) as f32
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eq::{Filter, FilterType};

    fn assert_finite_coeffs(f: &Filter, sample_rate: f64) {
        let (b0, b1, b2, a0, a1, a2) = compute_biquad_coeffs(f, sample_rate);
        assert!(
            a0 != 0.0,
            "a0 must not be zero — would cause division by zero"
        );
        let coeffs = [b0, b1, b2, a0, a1, a2];
        for &c in &coeffs {
            assert!(c.is_finite(), "all coefficients must be finite");
        }
    }

    #[test]
    fn accumulate_response_matches_cos_precomputed() {
        let freqs: Vec<f32> = vec![20.0, 100.0, 1000.0, 10000.0, 20000.0];
        let sr = 96000.0;
        let factor = TAU / sr;
        let cos_w_arr: Vec<f64> = freqs.iter().map(|&f| (f as f64 * factor).cos()).collect();

        let mut res1 = vec![0.0f32; freqs.len()];
        let mut res2 = vec![0.0f32; freqs.len()];

        accumulate_response_values(FilterType::Peak, 1000.0, 6.0, 1.414, sr, &freqs, &mut res1);
        accumulate_response_values_cos(
            FilterType::Peak,
            1000.0,
            6.0,
            1.414,
            sr,
            &cos_w_arr,
            &mut res2,
        );

        for (v1, v2) in res1.iter().zip(res2.iter()) {
            assert!((v1 - v2).abs() < 1e-6);
        }
        // At center frequency (1000Hz), gain should be approximately 6 dB
        assert!((res1[2] - 6.0).abs() < 0.1);
    }

    #[test]
    fn all_filter_types_produce_finite_coefficients() {
        let cases: &[(FilterType, u16, f64, f64, f64)] = &[
            (FilterType::Peak, 1000, 5.0, 1.0, 96000.0),
            (FilterType::LowShelf, 200, 3.0, 0.7, 96000.0),
            (FilterType::HighShelf, 5000, -2.0, 0.7, 96000.0),
            (FilterType::HighPass, 80, 0.0, 0.707, 96000.0),
            (FilterType::LowPass, 12000, 0.0, 0.707, 96000.0),
            // High Q with max gain — old formula would produce NaN
            (FilterType::LowShelf, 100, 10.0, 10.0, 96000.0),
            // Frequency above Nyquist for 44.1kHz
            (FilterType::Peak, 23000, 5.0, 1.0, 44100.0),
        ];
        for &(filter_type, freq, gain, q, sr) in cases {
            let f = Filter {
                index: 0,
                enabled: true,
                filter_type,
                freq,
                gain,
                q,
            };
            assert_finite_coeffs(&f, sr);
        }
    }
}
