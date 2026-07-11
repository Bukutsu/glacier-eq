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
    // Clamp the frequency to at most 49% of the sample rate to prevent Nyquist boundary collapse
    let max_safe_freq = 0.49 * dsp_sample_rate;
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

/// Evaluate a biquad using its stable complex frequency response.
pub fn response_values(filter: &Filter, freqs: &[f64], dsp_sample_rate: f64) -> Vec<f32> {
    let coeffs = compute_biquad_coeffs(filter, dsp_sample_rate);
    freqs
        .iter()
        .map(|freq| response_db(coeffs, *freq, dsp_sample_rate))
        .collect()
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
    let coeffs = compute_biquad_coeffs_for(filter_type, frequency, gain, q, dsp_sample_rate);
    for (freq, value) in freqs.iter().zip(response.iter_mut()) {
        *value += response_db(coeffs, *freq as f64, dsp_sample_rate);
    }
}

fn response_db(
    (b0, b1, b2, a0, a1, a2): (f64, f64, f64, f64, f64, f64),
    freq: f64,
    dsp_sample_rate: f64,
) -> f32 {
    let omega = freq * TAU / dsp_sample_rate;
    let (sin_w, cos_w) = omega.sin_cos();
    let sin_2w = 2.0 * sin_w * cos_w;
    let cos_2w = 2.0 * cos_w * cos_w - 1.0;

    let b_real = b0 + b1 * cos_w + b2 * cos_2w;
    let b_imag = -(b1 * sin_w + b2 * sin_2w);
    let a_real = a0 + a1 * cos_w + a2 * cos_2w;
    let a_imag = -(a1 * sin_w + a2 * sin_2w);
    let numerator = b_real * b_real + b_imag * b_imag;
    let denominator = a_real * a_real + a_imag * a_imag;

    if numerator > 0.0 && denominator > 0.0 {
        (10.0 * (numerator / denominator).log10()) as f32
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eq::{Filter, FilterType};

    #[test]
    fn peak_filter_coefficients_are_reasonable() {
        let filter = Filter {
            index: 0,
            enabled: true,
            filter_type: FilterType::Peak,
            freq: 1000,
            gain: 5.0,
            q: 1.0,
        };
        let (b0, b1, b2, a0, a1, a2) = compute_biquad_coeffs(&filter, 96000.0);
        assert!(
            a0 != 0.0,
            "a0 must not be zero — would cause division by zero"
        );
        assert!(
            b0.is_finite() && b1.is_finite() && b2.is_finite(),
            "b coefficients must be finite"
        );
        assert!(
            a0.is_finite() && a1.is_finite() && a2.is_finite(),
            "a coefficients must be finite"
        );
    }

    #[test]
    fn low_shelf_coefficients_are_finite() {
        let filter = Filter {
            index: 0,
            enabled: true,
            filter_type: FilterType::LowShelf,
            freq: 200,
            gain: 3.0,
            q: 0.7,
        };
        let coeffs = compute_biquad_coeffs(&filter, 96000.0);
        for &c in &[coeffs.0, coeffs.1, coeffs.2, coeffs.3, coeffs.4, coeffs.5] {
            assert!(c.is_finite(), "coefficient {} must be finite", c);
        }
        assert!(coeffs.3 != 0.0, "a0 must not be zero");
    }

    #[test]
    fn high_shelf_coefficients_are_finite() {
        let filter = Filter {
            index: 0,
            enabled: true,
            filter_type: FilterType::HighShelf,
            freq: 5000,
            gain: -2.0,
            q: 0.7,
        };
        let coeffs = compute_biquad_coeffs(&filter, 96000.0);
        for &c in &[coeffs.0, coeffs.1, coeffs.2, coeffs.3, coeffs.4, coeffs.5] {
            assert!(c.is_finite());
        }
        assert!(coeffs.3 != 0.0);
    }

    #[test]
    fn high_pass_coefficients_are_reasonable() {
        let filter = Filter {
            index: 0,
            enabled: true,
            filter_type: FilterType::HighPass,
            freq: 80,
            gain: 0.0,
            q: 0.707,
        };
        let coeffs = compute_biquad_coeffs(&filter, 96000.0);
        for &c in &[coeffs.0, coeffs.1, coeffs.2, coeffs.3, coeffs.4, coeffs.5] {
            assert!(c.is_finite());
        }
        assert!(coeffs.3 != 0.0);
    }

    #[test]
    fn low_pass_coefficients_are_reasonable() {
        let filter = Filter {
            index: 0,
            enabled: true,
            filter_type: FilterType::LowPass,
            freq: 12000,
            gain: 0.0,
            q: 0.707,
        };
        let coeffs = compute_biquad_coeffs(&filter, 96000.0);
        for &c in &[coeffs.0, coeffs.1, coeffs.2, coeffs.3, coeffs.4, coeffs.5] {
            assert!(c.is_finite());
        }
        assert!(coeffs.3 != 0.0);
    }

    #[test]
    fn test_low_shelf_high_q_stability() {
        // High Q with max gain under old formula would trigger negative square roots (NaN)
        let filter = Filter {
            index: 0,
            enabled: true,
            filter_type: FilterType::LowShelf,
            freq: 100,
            gain: 10.0,
            q: 10.0,
        };
        let coeffs = compute_biquad_coeffs(&filter, 96000.0);
        for &c in &[coeffs.0, coeffs.1, coeffs.2, coeffs.3, coeffs.4, coeffs.5] {
            assert!(
                c.is_finite(),
                "coefficient {} must be finite for high-Q shelf",
                c
            );
        }
        assert!(coeffs.3 != 0.0);
    }

    #[test]
    fn test_nyquist_frequency_clamping() {
        // Frequency above Nyquist (23kHz for 44.1kHz sample rate)
        let filter = Filter {
            index: 0,
            enabled: true,
            filter_type: FilterType::Peak,
            freq: 23000,
            gain: 5.0,
            q: 1.0,
        };
        let coeffs = compute_biquad_coeffs(&filter, 44100.0);
        for &c in &[coeffs.0, coeffs.1, coeffs.2, coeffs.3, coeffs.4, coeffs.5] {
            assert!(
                c.is_finite(),
                "coefficient {} must be finite near/above Nyquist",
                c
            );
        }
        assert!(coeffs.3 != 0.0);
    }

    #[test]
    fn response_stays_finite_for_high_q_peak() {
        let filter = Filter {
            index: 0,
            enabled: true,
            filter_type: FilterType::Peak,
            freq: 1000,
            gain: 10.0,
            q: 20.0,
        };
        let response = response_values(&filter, &[999.0, 1000.0, 1001.0], 96000.0);
        assert!(response.iter().all(|value| value.is_finite()));
        assert!(response[1] > 9.0);
    }
}
