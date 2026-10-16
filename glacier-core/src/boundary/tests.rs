// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use super::*;

#[test]
fn no_device_autoeq_uses_editor_capabilities() {
    for ids in [(None, None), (Some(0x1234), Some(0x5678))] {
        let caps = device_caps_or_desktop(ids.0, ids.1);
        assert_eq!(caps.num_bands, DESKTOP_DAC_CAPS.num_bands);
        assert_eq!(caps.global_gain_range, DESKTOP_DAC_CAPS.global_gain_range);
        assert_eq!(caps.band_gain_range, DESKTOP_DAC_CAPS.band_gain_range);
    }
    assert_eq!(
        supported_profile(Some(0x2972), Some(0x0102)).unwrap().name,
        "FiiO JA11"
    );
    assert_eq!(
        supported_profile(Some(0x2972), None).unwrap().name,
        "FiiO KA Series"
    );
    assert!(supported_profile(None, Some(0x0102)).is_none());
}

#[test]
fn binding_integers_reject_coercion_overflow_and_nonfinite_values() {
    for value in [1.5, f64::NAN, f64::INFINITY, -1.0, 0.0, 1e30] {
        assert!(validate_integer_parameter(value, "steps").is_err());
    }
    assert_eq!(validate_integer_parameter(1.0, "steps").unwrap(), 1);
    assert_eq!(validate_device_id(65535.0, "VID").unwrap(), u16::MAX);
    assert!(validate_device_id(65536.0, "VID").is_err());
    assert!(validate_device_id(1.1, "VID").is_err());
    assert_eq!(validate_optional_device_id(None, "PID").unwrap(), None);
    assert_eq!(
        validate_optional_device_id(Some(0.0), "PID").unwrap(),
        Some(0)
    );
}

#[test]
fn response_boundary_rejects_invalid_and_unbounded_inputs() {
    for rate in [f64::NAN, f64::INFINITY, 0.0, 39999.0, 768001.0] {
        assert!(validate_dsp_sample_rate(rate).is_err());
    }
    assert!(validate_dsp_sample_rate(96000.0).is_ok());
    for freqs in [
        vec![0.0],
        vec![f32::NAN],
        vec![f32::INFINITY],
        vec![1.0; 262145],
    ] {
        assert!(validate_response_freqs(&freqs).is_err());
    }
    assert!(validate_response_freqs(&[20.0, 20000.0]).is_ok());
    assert!(validate_finite_response(&[f32::NAN]).is_err());
    assert!(validate_finite_response(&[0.0]).is_ok());
    let mut filter = Filter::enabled(0, true);
    filter.q = 0.0;
    assert!(validate_filter_numeric(&filter).is_err());
    filter.q = 1.0;
    filter.freq = 0;
    assert!(validate_filter_numeric(&filter).is_err());
    filter.freq = 1000;
    filter.gain = f64::MAX;
    assert!(validate_filter_numeric(&filter).is_err());
    filter.gain = 1.0;
    assert!(validate_filter_numeric(&filter).is_ok());
    let mut peq = PEQData {
        filters: vec![filter],
        global_gain: f64::MAX,
    };
    assert!(validate_peq_numeric(&peq).is_err());
    peq.global_gain = -2.0;
    assert!(validate_peq_numeric(&peq).is_ok());
}

#[test]
fn aggregate_and_band_responses_use_the_same_enabled_filters() {
    let freqs = [20.0, 100.0, 1000.0, 20000.0];
    let mut filter = Filter::enabled(0, true);
    filter.gain = 3.0;
    let mut disabled = filter.clone();
    disabled.enabled = false;
    disabled.gain = -10.0;
    let peq = PEQData {
        filters: vec![filter, disabled],
        global_gain: -2.0,
    };
    for preamp in [false, true] {
        let aggregate = response_values(&peq, &freqs, preamp, 96000.0);
        let combined = response_values_and_bands(&peq, &freqs, preamp, 96000.0);
        assert_eq!(&combined[..freqs.len()], &aggregate);
        assert_eq!(combined.len(), 2 * freqs.len());
        for (&total, &band) in aggregate.iter().zip(&combined[freqs.len()..]) {
            assert!((total - band - if preamp { -2.0 } else { 0.0 }).abs() < 1e-5);
        }
    }
}
