use super::*;
use crate::device::{normalize_peq_for_profile, SUPPORTED_DEVICES};
use crate::eq::iir_math::{compute_biquad_coeffs_for_model, EqResponseModel};

/// Independent complex transfer evaluation, not the safety-grid evaluator.
fn response_at(filters: &[Filter], fs: f64, model: EqResponseModel, f: f64) -> f64 {
    let w = std::f64::consts::TAU * f / fs;
    filters
        .iter()
        .filter(|band| band.enabled)
        .map(|band| {
            let (b0, b1, b2, a0, a1, a2) = compute_biquad_coeffs_for_model(
                band.filter_type,
                band.freq as f64,
                band.gain,
                band.q,
                fs,
                model,
            );
            let real_b = b0 + b1 * w.cos() + b2 * (2.0 * w).cos();
            let imag_b = -b1 * w.sin() - b2 * (2.0 * w).sin();
            let real_a = a0 + a1 * w.cos() + a2 * (2.0 * w).cos();
            let imag_a = -a1 * w.sin() - a2 * (2.0 * w).sin();
            10.0 * ((real_b * real_b + imag_b * imag_b) / (real_a * real_a + imag_a * imag_a))
                .log10()
        })
        .sum()
}

fn band(kind: FilterType, frequency: u16, gain: f64, q: f64) -> Filter {
    Filter {
        index: 0,
        enabled: true,
        freq: frequency,
        gain,
        q,
        filter_type: kind,
    }
}

#[test]
fn integer_preamp_preserves_correction_when_flooring_provides_headroom() {
    let mut caps = crate::device::capabilities::DESKTOP_DAC_CAPS;
    caps.integer_preamp = true;
    let target = AutoEqTarget::capabilities(Some(&caps));
    let fs = caps.dsp_sample_rate;
    let grid = device::SafetyGrid::new(fs);
    for gain in [6.3, 6.6, 9.3] {
        let filters = vec![band(FilterType::Peak, 1000, gain, 1.0)];
        let peq = target.finalize(filters.clone(), fs, &grid).unwrap();
        assert_eq!(peq.filters, filters);
        assert_eq!(peq.global_gain, -gain.ceil());
    }
}

#[test]
fn headroom_includes_dc_nyquist_and_between_grid_peaks() {
    let target = AutoEqTarget::capabilities(None);
    let fs = 96_000.0;
    let grid = device::SafetyGrid::new(fs);
    for filters in [
        vec![band(FilterType::LowShelf, 20, 12.0, 0.7)],
        vec![band(FilterType::HighShelf, 20_000, 12.0, 0.7)],
        vec![band(FilterType::Peak, 1237, 12.0, 100.0)],
    ] {
        let peq = target.finalize(filters, fs, &grid).unwrap();
        for f in [0.0, 1.0, 20.0, 1237.0, 20_000.0, 40_000.0, 48_000.0] {
            let gain =
                response_at(&peq.filters, fs, EqResponseModel::CanonicalQ, f) + peq.global_gain;
            assert!(gain <= 1e-4, "at {f}Hz: {gain} dB");
        }
    }
}

#[test]
fn device_headroom_floor_retains_a_feasible_correction() {
    let mut caps = crate::device::capabilities::DESKTOP_DAC_CAPS;
    caps.global_gain_range = (-2, 0);
    let target = AutoEqTarget::capabilities(Some(&caps));
    let grid = device::SafetyGrid::new(caps.dsp_sample_rate);
    let peq = target
        .finalize(
            vec![band(FilterType::Peak, 1000, 8.0, 1.0)],
            caps.dsp_sample_rate,
            &grid,
        )
        .unwrap();
    assert!(peq.filters[0].gain > 1.9 && peq.filters[0].gain < 2.0);
    assert!(
        response_at(&peq.filters, caps.dsp_sample_rate, target.model(), 1000.0) + peq.global_gain
            <= 0.0
    );
}

#[test]
fn every_catalog_dac_produces_encodable_quantized_non_clipping_non_flat_eq() {
    let measurement = [
        (20.0, 4.0),
        (80.0, 6.0),
        (250.0, -2.0),
        (1000.0, -4.0),
        (4000.0, 3.0),
        (10_000.0, 5.0),
        (20_000.0, 1.0),
    ];
    let desired = [(20.0, 0.0), (20_000.0, 0.0)];
    for profile in SUPPORTED_DEVICES
        .iter()
        .filter(|p| p.protocol.has_hardware_eq())
    {
        let target = AutoEqTarget::device(&profile.caps, profile.protocol);
        let fs = profile.caps.dsp_sample_rate;
        let n = 5.min(profile.caps.num_bands);
        let peq = run_autoeq_with_target(&measurement, &desired, n, 80, "none", fs as f32, target)
            .unwrap_or_else(|error| panic!("{}: {error}", profile.name));
        assert_eq!(peq.filters.len(), n);
        assert!(
            peq.filters.iter().any(|f| f.gain.abs() > 0.1),
            "{}: neutral correction",
            profile.name
        );
        // A push may pad unused bands, but must not change any active parameter
        // or round the preamp upward after the headroom check.
        let (normalized, _) = normalize_peq_for_profile(peq.clone(), profile).unwrap();
        assert!(
            (normalized.global_gain - peq.global_gain).abs() < 1e-9,
            "{} preamp",
            profile.name
        );
        for (before, after) in peq.filters.iter().zip(&normalized.filters) {
            assert!(
                (before.gain - after.gain).abs() < 1e-9,
                "{} gain",
                profile.name
            );
            assert_eq!(before.freq, after.freq);
            assert!((before.q - after.q).abs() < 1e-9, "{} Q", profile.name);
            profile
                .protocol
                .eq
                .unwrap()
                .write_filter_packets(before.index, before, fs, peq.global_gain)
                .unwrap_or_else(|e| panic!("{} band {}: {e}", profile.name, before.index));
        }
        for i in 0..4096 {
            let f = fs * 0.5 * i as f64 / 4095.0;
            let gain = response_at(&peq.filters, fs, target.model(), f) + peq.global_gain;
            assert!(gain <= 1e-4, "{} at {f}Hz: {gain}dB", profile.name);
        }
    }
}

fn packet_biquad(
    profile: &crate::device::DeviceProfile,
    filter: &Filter,
    preamp: f64,
) -> (f64, f64, f64, f64, f64, f64) {
    let packets = profile
        .protocol
        .eq
        .unwrap()
        .write_filter_packets(filter.index, filter, profile.caps.dsp_sample_rate, preamp)
        .unwrap();
    let packet = packets
        .iter()
        .find(|p| p.payload.len() == 36 || (p.payload.len() == 63 && p.payload[1] == 0x09))
        .unwrap();
    let values: Vec<f64> = packet.payload[7..27]
        .as_chunks::<4>()
        .0
        .iter()
        .map(|bytes| i32::from_le_bytes(*bytes) as f64 / 1_073_741_824.0)
        .collect();
    (values[0], values[1], values[2], 1.0, -values[3], -values[4])
}

fn packet_response_at(
    profile: &crate::device::DeviceProfile,
    peq: &PEQData,
    frequency: f64,
) -> f64 {
    let fs = profile.caps.dsp_sample_rate;
    let mut preamp = peq.global_gain;
    if profile.protocol.id == "Moondrop" {
        let packets = profile
            .protocol
            .eq
            .unwrap()
            .write_global_gain_packets(preamp);
        let payload = &packets
            .iter()
            .find(|p| p.payload[1] == 0x23)
            .unwrap()
            .payload;
        preamp = i16::from_le_bytes([payload[3], payload[4]]) as f64 / 256.0;
    }
    let w = std::f64::consts::TAU * frequency / fs;
    preamp
        + peq
            .filters
            .iter()
            .map(|band| {
                let (b0, b1, b2, a0, a1, a2) = packet_biquad(profile, band, peq.global_gain);
                let real_b = b0 + b1 * w.cos() + b2 * (2.0 * w).cos();
                let imag_b = -b1 * w.sin() - b2 * (2.0 * w).sin();
                let real_a = a0 + a1 * w.cos() + a2 * (2.0 * w).cos();
                let imag_a = -a1 * w.sin() - a2 * (2.0 * w).sin();
                10.0 * ((real_b * real_b + imag_b * imag_b) / (real_a * real_a + imag_a * imag_a))
                    .log10()
            })
            .sum::<f64>()
}

#[test]
fn headroom_uses_q30_coefficients_and_q8_preamp_from_actual_packets() {
    let profile = crate::device::get_supported_device(0x35d8, 0x011d).unwrap();
    let target = AutoEqTarget::device(&profile.caps, profile.protocol);
    let fs = profile.caps.dsp_sample_rate;
    let grid = device::SafetyGrid::new(fs);
    // Ideal coefficients allowed -6.1 dB, but actual Q30/Q8 encoding clipped
    // at DC. Preserve the complete band and choose enough wire attenuation.
    let original = band(FilterType::LowShelf, 20, 6.09765625, 0.5);
    let peq = target.finalize(vec![original.clone()], fs, &grid).unwrap();
    assert_eq!(peq.filters, vec![original]);
    assert!(peq.global_gain < -6.1);
    for frequency in [0.0, 0.1, 1.0, 20.0, 1000.0, 48_000.0] {
        assert!(packet_response_at(profile, &peq, frequency) <= 0.0);
    }
    // A fractional preamp that rounds upward on Q8 must also stay safe.
    let original = band(FilterType::Peak, 1000, 3.8984375, 1.0);
    let peq = target.finalize(vec![original], fs, &grid).unwrap();
    assert!(packet_response_at(profile, &peq, 1000.0) <= 0.0);
}

#[test]
fn walkplay_headroom_uses_quantized_coefficients() {
    let profile = crate::device::get_supported_device(0x3302, 0x43e6).unwrap();
    let target = AutoEqTarget::device(&profile.caps, profile.protocol);
    let fs = profile.caps.dsp_sample_rate;
    let peq = target
        .finalize(
            vec![band(FilterType::Peak, 20, 5.953125, 3.0)],
            fs,
            &device::SafetyGrid::new(fs),
        )
        .unwrap();
    for frequency in [0.0, 1.0, 19.99, 20.0, 20.01, 100.0, fs * 0.5] {
        assert!(packet_response_at(profile, &peq, frequency) <= 1e-6);
    }
}

#[test]
fn peak_layout_remains_available_when_slope_shelves_have_no_feasible_bounds() {
    let profile = crate::device::get_supported_device(0x35d8, 0x011d).unwrap();
    let mut caps = profile.caps.clone();
    caps.q_range = (2.0, 3.0);
    let target = AutoEqTarget::device(&caps, profile.protocol);
    let measurement = [(20.0, 0.0), (20_000.0, 0.0)];
    let desired = [(20.0, 0.0), (1000.0, 4.0), (20_000.0, 0.0)];
    let peq =
        run_autoeq_with_target(&measurement, &desired, 6, 20, "none", 96_000.0, target).unwrap();
    assert!(peq
        .filters
        .iter()
        .all(|f| f.filter_type == FilterType::Peak));
}

#[test]
fn slope_dac_and_canonical_dac_optimize_their_own_shelf_models() {
    let profile = crate::device::get_supported_device(0x35d8, 0x011d).unwrap();
    let target = AutoEqTarget::device(&profile.caps, profile.protocol);
    assert_eq!(target.model(), EqResponseModel::MoondropShelfSlope);
    let measurement = [(20.0, 0.0), (20_000.0, 0.0)];
    let desired = [
        (20.0, 6.0),
        (60.0, 5.0),
        (150.0, 2.0),
        (500.0, 0.0),
        (20_000.0, 0.0),
    ];
    let peq =
        run_autoeq_with_target(&measurement, &desired, 3, 80, "none", 96_000.0, target).unwrap();
    for filter in peq
        .filters
        .iter()
        .filter(|f| f.filter_type != FilterType::Peak)
    {
        assert!(filter.q <= 1.0);
        target
            .model()
            .validate_parameters(filter.filter_type, filter.gain, filter.q)
            .unwrap();
    }
}
