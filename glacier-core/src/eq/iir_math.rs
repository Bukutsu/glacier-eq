// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Canonical biquad coefficient computation shared by USB packet building and graph rendering.

use crate::eq::{Filter, FilterType};
use std::f64::consts::TAU;

/// Meaning of the Q field in the device's coefficient designer.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
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
fn biquad_mag_squared_coeffs(
    (b0, b1, b2, a0, a1, a2): (f64, f64, f64, f64, f64, f64),
) -> (f64, f64, f64, f64, f64, f64) {
    // Multiply H(z)'s numerator and denominator by z: each becomes
    // (c0 + c2) cos(w) + c1 + i (c0 - c2) sin(w).
    // Keep real/imaginary terms instead of expanding a cancelling quadratic.
    (b0 + b2, b1, b0 - b2, a0 + a2, a1, a0 - a2)
}

#[inline]
fn eval_biquad_mag_squared_db(
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eq::{Filter, FilterType};

    fn assert_finite_coeffs(f: &Filter, sample_rate: f64) {
        let (b0, b1, b2, a0, a1, a2) = compute_biquad_coeffs(f, sample_rate);
        assert!(
            a0 != 0.0,
            "a0 must not be zero. This would cause division by zero."
        );
        let coeffs = [b0, b1, b2, a0, a1, a2];
        for &c in &coeffs {
            assert!(c.is_finite(), "all coefficients must be finite");
        }
    }

    const FILTER_TYPES: [FilterType; 5] = [
        FilterType::Peak,
        FilterType::LowShelf,
        FilterType::HighShelf,
        FilterType::HighPass,
        FilterType::LowPass,
    ];

    #[test]
    fn standard_wrappers_match_canonical_model() {
        let sr = 96000.0;
        let freqs = [20.0, 100.0, 1000.0, 10000.0, 20000.0];
        let cos_w: Vec<f64> = freqs.iter().map(|&f| (f as f64 * TAU / sr).cos()).collect();
        for filter_type in FILTER_TYPES {
            let filter = Filter {
                index: 0,
                enabled: true,
                filter_type,
                freq: 1000,
                gain: 6.0,
                q: 0.75,
            };
            assert_eq!(
                compute_biquad_coeffs(&filter, sr),
                compute_biquad_coeffs_for_model(
                    filter_type,
                    1000.0,
                    6.0,
                    0.75,
                    sr,
                    EqResponseModel::CanonicalQ
                ),
            );
            let mut from_freqs = [1.0; 5];
            let mut from_cos = from_freqs;
            let mut from_model = from_freqs;
            accumulate_response_values(filter_type, 1000.0, 6.0, 0.75, sr, &freqs, &mut from_freqs);
            accumulate_response_values_cos(
                filter_type,
                1000.0,
                6.0,
                0.75,
                sr,
                &cos_w,
                &mut from_cos,
            );
            accumulate_response_values_cos_for_model(
                filter_type,
                1000.0,
                6.0,
                0.75,
                sr,
                EqResponseModel::CanonicalQ,
                &cos_w,
                &mut from_model,
            )
            .unwrap();
            assert_eq!(from_cos, from_model);
            for (a, b) in from_freqs.into_iter().zip(from_model) {
                assert!((a - b).abs() < 1e-5);
            }
        }
    }

    #[test]
    fn slope_validation_rejects_invalid_candidates_without_changing_response() {
        let model = EqResponseModel::MoondropShelfSlope;
        for filter_type in [FilterType::LowShelf, FilterType::HighShelf] {
            for q in [0.0, -1.0, f64::NAN, 10.0] {
                let error = model.validate_parameters(filter_type, 12.0, q).unwrap_err();
                assert!(error.contains("slope"));
                let coeffs =
                    compute_biquad_coeffs_for_model(filter_type, 1000.0, 12.0, q, 96000.0, model);
                assert!(coeffs.0.is_nan());
                let mut response = [7.0; 2];
                assert!(accumulate_response_values_cos_for_model(
                    filter_type,
                    1000.0,
                    12.0,
                    q,
                    96000.0,
                    model,
                    &[1.0, 0.9],
                    &mut response,
                )
                .is_err());
                assert_eq!(response, [7.0; 2]);
            }
        }
        // A slope above one is not automatically invalid; the gain matters.
        assert!(model
            .validate_parameters(FilterType::LowShelf, 3.0, 1.5)
            .is_ok());
        assert!(model
            .validate_parameters(FilterType::Peak, 12.0, 10.0)
            .is_ok());
        assert!(EqResponseModel::CanonicalQ
            .validate_parameters(FilterType::LowShelf, 12.0, 10.0)
            .is_ok());
    }

    #[test]
    fn model_response_matches_complex_evaluation_including_low_frequency_high_q() {
        let sr = 192000.0;
        let freqs = [1.0, 20.0, 21.0, 100.0, 1000.0, 20000.0, 90000.0];
        let cos_w: Vec<f64> = freqs.iter().map(|&f| (f * TAU / sr).cos()).collect();
        for model in [
            EqResponseModel::CanonicalQ,
            EqResponseModel::MoondropShelfSlope,
        ] {
            for filter_type in FILTER_TYPES {
                let q = if model == EqResponseModel::MoondropShelfSlope
                    && matches!(filter_type, FilterType::LowShelf | FilterType::HighShelf)
                {
                    0.75
                } else {
                    10.0
                };
                let (b0, b1, b2, a0, a1, a2) =
                    compute_biquad_coeffs_for_model(filter_type, 20.0, 12.0, q, sr, model);
                let mut response = [0.0; 7];
                accumulate_response_values_cos_for_model(
                    filter_type,
                    20.0,
                    12.0,
                    q,
                    sr,
                    model,
                    &cos_w,
                    &mut response,
                )
                .unwrap();
                for (&freq, &actual) in freqs.iter().zip(&response) {
                    // Direct complex polynomial, independent of the cosine-only evaluator.
                    let w = freq * TAU / sr;
                    let real_b = b0 + b1 * w.cos() + b2 * (2.0 * w).cos();
                    let imag_b = -b1 * w.sin() - b2 * (2.0 * w).sin();
                    let real_a = a0 + a1 * w.cos() + a2 * (2.0 * w).cos();
                    let imag_a = -a1 * w.sin() - a2 * (2.0 * w).sin();
                    let expected = 10.0
                        * ((real_b * real_b + imag_b * imag_b)
                            / (real_a * real_a + imag_a * imag_a))
                            .log10();
                    assert!(
                        (actual as f64 - expected).abs() < 2e-4,
                        "{model:?} {filter_type:?} at {freq} Hz: {actual} != {expected}"
                    );
                }
            }
        }
    }

    #[test]
    fn standard_parameter_sanitization_is_preserved() {
        let mut response = [4.0];
        accumulate_response_values_cos(
            FilterType::Peak,
            1000.0,
            6.0,
            1.0,
            f64::NAN,
            &[1.0],
            &mut response,
        );
        assert_eq!(response, [4.0]);
        for sr in [0.0, f64::NAN, 40.0] {
            let filter = Filter {
                index: 0,
                enabled: true,
                filter_type: FilterType::Peak,
                freq: 1000,
                gain: 6.0,
                q: 1.0,
            };
            assert_eq!(
                compute_biquad_coeffs(&filter, sr),
                (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
            );
        }
        assert_eq!(
            compute_biquad_coeffs_for(FilterType::Peak, 1000.0, 6.0, -1.0, 96000.0),
            compute_biquad_coeffs_for(FilterType::Peak, 1000.0, 6.0, 0.01, 96000.0),
        );
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
    fn highpass_transmission_zero_at_dc_attenuates() {
        let coeffs = biquad_mag_squared_coeffs(compute_biquad_coeffs_for(
            FilterType::HighPass,
            1000.0,
            0.0,
            0.707,
            48000.0,
        ));
        // At DC (0 Hz), cos(0) = 1.0
        let db = eval_biquad_mag_squared_db(coeffs, 1.0);
        assert!(
            db <= -100.0,
            "HighPass at DC must deeply attenuate, got {db} dB"
        );
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
            // Extreme gain must not overflow f64
            (FilterType::Peak, 1000, 10000.0, 1.0, 96000.0),
            (FilterType::LowShelf, 1000, -10000.0, 1.0, 96000.0),
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
