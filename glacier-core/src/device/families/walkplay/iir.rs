// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Biquad coefficient quantizing for the Walkplay/Savitech DSP.

use crate::eq::iir_math::compute_biquad_coeffs;
use crate::eq::{Filter, FilterType};

const QUANTIZER_SCALE: f64 = 1_073_741_824.0;

/// Decode the shared signed little-endian Q30 wire format. Feedback terms on
/// the wire are negated; return the usual normalized biquad denominator.
pub(crate) fn decode_q30_biquad(bytes: &[u8; 20]) -> (f64, f64, f64, f64, f64, f64) {
    let mut values = [0.0; 5];
    for (value, chunk) in values.iter_mut().zip(bytes.chunks_exact(4)) {
        *value = i32::from_le_bytes(chunk.try_into().unwrap()) as f64 / QUANTIZER_SCALE;
    }
    (values[0], values[1], values[2], 1.0, -values[3], -values[4])
}

/// Quantizes one normalized coefficient to the device's 2^30 fixed-point
/// format. Fails instead of clamping: coefficients outside ±(2^31 − 1)/2^30
/// cannot be represented by the hardware, and a silently clamped value loads
/// a different filter than the one shown in the editor.
fn quantize_coefficient(v: f64) -> Result<i32, String> {
    let scaled = v * QUANTIZER_SCALE;
    // Symmetric bound so wrapping_neg below can never overflow.
    let limit = i32::MAX as f64;
    let rounded = scaled.round();
    if !rounded.is_finite() || rounded.abs() > limit {
        Err(format!(
            "coefficient {v:.4} exceeds the device fixed-point range of ±2.0"
        ))
    } else {
        Ok(rounded as i32)
    }
}

fn quantizer(d_arr: &[f64; 3], d_arr2: &[f64; 3]) -> Result<[i32; 5], String> {
    let i_arr = [
        quantize_coefficient(d_arr[0])?,
        quantize_coefficient(d_arr[1])?,
        quantize_coefficient(d_arr[2])?,
    ];
    let i_arr2 = [
        quantize_coefficient(d_arr2[0])?,
        quantize_coefficient(d_arr2[1])?,
        quantize_coefficient(d_arr2[2])?,
    ];
    Ok([i_arr2[0], i_arr2[1], i_arr2[2], -i_arr[1], -i_arr[2]])
}

pub fn compute_iir_filter(
    filter_type: FilterType,
    freq: f64,
    gain: f64,
    q: f64,
    dsp_sample_rate: f64,
) -> Result<[u8; 20], String> {
    let mut b_arr = [0u8; 20];
    let f = Filter {
        index: 0,
        enabled: true,
        freq: freq as u16,
        gain,
        q,
        filter_type,
    };
    let (b0, b1, b2, a0, a1, a2) = compute_biquad_coeffs(&f, dsp_sample_rate);

    let quantizer_data = quantizer(&[1.0, a1 / a0, a2 / a0], &[b0 / a0, b1 / a0, b2 / a0])
        .map_err(|error| {
            format!(
                "Cannot encode {:?} filter at {} Hz ({gain:+.1} dB, Q {q}): {error}. \
                 Lower the gain or move Q closer to 1.",
                filter_type, freq as u16
            )
        })?;

    for (i, &value) in quantizer_data.iter().enumerate() {
        let bytes = value.to_le_bytes();
        b_arr[i * 4..i * 4 + 4].copy_from_slice(&bytes);
    }

    Ok(b_arr)
}
