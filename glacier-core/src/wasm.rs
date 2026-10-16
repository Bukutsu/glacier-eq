// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! JavaScript serialization and thin wrappers around host-tested core logic.

use crate::boundary::*;
use crate::device::{SupportedDeviceInfo, SUPPORTED_DEVICES, UNKNOWN};
use crate::eq::{Filter, PEQData};
use crate::profile_match::{matching_profile_name, ProfileCandidate};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
mod device;
pub use device::device_operation;

#[derive(Serialize, Deserialize)]
pub struct AutoEqParseResultWasm {
    pub peq: PEQData,
    pub headphone_name: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct AutoEqRunResultWasm {
    pub peq: PEQData,
    pub warnings: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ProfileCandidateWasm {
    pub name: String,
    pub data: PEQData,
}

fn js_err(error: impl ToString) -> JsValue {
    JsValue::from_str(&error.to_string())
}

fn to_js_value<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(js_err)
}

#[wasm_bindgen]
pub fn list_supported_devices() -> Result<JsValue, JsValue> {
    let list: Vec<SupportedDeviceInfo> = SUPPORTED_DEVICES
        .iter()
        .map(SupportedDeviceInfo::from)
        .collect();

    to_js_value(&list)
}

/// Normalization outcome for the web backend: the rewritten PEQ plus any
/// capability-clamp warnings the user must see after a push.
#[derive(serde::Serialize)]
struct NormalizedPeq {
    peq: PEQData,
    warnings: Vec<String>,
}

#[wasm_bindgen]
pub fn normalize_peq_for_device(
    peq_js: JsValue,
    vendor_id: f64,
    product_id: f64,
) -> Result<JsValue, JsValue> {
    let vendor_id = validate_device_id(vendor_id, "vendor_id")?;
    let product_id = validate_device_id(product_id, "product_id")?;
    let peq: PEQData = serde_wasm_bindgen::from_value(peq_js).map_err(js_err)?;
    let (peq, warnings) =
        crate::device::normalize_peq_for_device(peq, vendor_id, product_id).map_err(js_err)?;
    // The warnings ride alongside the normalized PEQ: the web UI surfaces
    // them after a push instead of silently altering the user's values.
    to_js_value(&NormalizedPeq { peq, warnings })
}

#[wasm_bindgen]
pub fn is_default_peq_for_device(
    peq_js: JsValue,
    vendor_id: f64,
    product_id: f64,
) -> Result<bool, JsValue> {
    let vendor_id = validate_device_id(vendor_id, "vendor_id")?;
    let product_id = validate_device_id(product_id, "product_id")?;
    let peq: PEQData = serde_wasm_bindgen::from_value(peq_js).map_err(js_err)?;
    validate_peq_numeric(&peq)?;
    crate::device::is_default_peq_for_device(&peq, vendor_id, product_id).map_err(js_err)
}

#[wasm_bindgen]
pub fn parse_autoeq(
    text: String,
    vendor_id: Option<f64>,
    product_id: Option<f64>,
) -> Result<JsValue, JsValue> {
    let vendor_id = validate_optional_device_id(vendor_id, "vendor_id")?;
    let product_id = validate_optional_device_id(product_id, "product_id")?;
    let (mut peq, headphone_name, mut warnings) =
        crate::autoeq::parse_autoeq_text(&text).map_err(js_err)?;

    let mut clamp_warnings =
        peq.clamp_to_capabilities(&device_caps_or_desktop(vendor_id, product_id));
    warnings.append(&mut clamp_warnings);

    let result = AutoEqParseResultWasm {
        peq,
        headphone_name,
        warnings,
    };

    to_js_value(&result)
}

#[wasm_bindgen]
pub fn peq_to_autoeq(peq_js: JsValue) -> Result<String, JsValue> {
    let peq: PEQData = serde_wasm_bindgen::from_value(peq_js).map_err(js_err)?;
    let normalized = crate::profiles::normalize_for_storage(&peq).map_err(js_err)?;
    Ok(crate::autoeq::peq_to_autoeq(&normalized))
}

#[wasm_bindgen]
pub fn match_profile_name(
    peq_js: JsValue,
    profiles_js: JsValue,
    vendor_id: Option<f64>,
    product_id: Option<f64>,
) -> Result<Option<String>, JsValue> {
    let vendor_id = validate_optional_device_id(vendor_id, "vendor_id")?;
    let product_id = validate_optional_device_id(product_id, "product_id")?;
    let peq: PEQData = serde_wasm_bindgen::from_value(peq_js).map_err(js_err)?;
    let profiles: Vec<ProfileCandidateWasm> =
        serde_wasm_bindgen::from_value(profiles_js).map_err(js_err)?;
    let caps = device_caps_or_desktop(vendor_id, product_id);
    let protocol = supported_profile(vendor_id, product_id)
        .map(|profile| profile.protocol)
        .unwrap_or(&UNKNOWN);

    Ok(matching_profile_name(
        &peq,
        profiles.iter().map(|profile| ProfileCandidate {
            name: &profile.name,
            data: &profile.data,
        }),
        &caps,
        protocol,
    ))
}

#[wasm_bindgen]
pub fn peq_response_values(
    peq_js: JsValue,
    freqs: &[f32],
    include_preamp: bool,
    dsp_sample_rate: f64,
) -> Result<Vec<f32>, JsValue> {
    let peq: PEQData = serde_wasm_bindgen::from_value(peq_js).map_err(js_err)?;
    validate_peq_numeric(&peq)?;
    validate_response_freqs(freqs)?;
    validate_dsp_sample_rate(dsp_sample_rate)?;
    let response = response_values(&peq, freqs, include_preamp, dsp_sample_rate);
    validate_finite_response(&response)?;
    Ok(response)
}

#[wasm_bindgen]
pub fn peq_response_and_band_values(
    peq_js: JsValue,
    freqs: &[f32],
    include_preamp: bool,
    dsp_sample_rate: f64,
) -> Result<Vec<f32>, JsValue> {
    let peq: PEQData = serde_wasm_bindgen::from_value(peq_js).map_err(js_err)?;
    validate_peq_numeric(&peq)?;
    validate_response_freqs(freqs)?;
    validate_dsp_sample_rate(dsp_sample_rate)?;
    let response = response_values_and_bands(&peq, freqs, include_preamp, dsp_sample_rate);
    validate_finite_response(&response)?;
    Ok(response)
}

#[wasm_bindgen]
pub fn filter_response_values(
    filter_js: JsValue,
    freqs: &[f32],
    dsp_sample_rate: f64,
) -> Result<Vec<f32>, JsValue> {
    let filter: Filter = serde_wasm_bindgen::from_value(filter_js).map_err(js_err)?;
    validate_filter_numeric(&filter)?;
    validate_response_freqs(freqs)?;
    validate_dsp_sample_rate(dsp_sample_rate)?;
    let peq = PEQData {
        filters: vec![filter],
        global_gain: 0.0,
    };
    let response = response_values(&peq, freqs, false, dsp_sample_rate);
    validate_finite_response(&response)?;
    Ok(response)
}

#[wasm_bindgen]
pub fn snap_freq_to_iso(freq: f64) -> Result<u16, JsValue> {
    let freq = validate_integer_range(freq, 0.0, 65_535.0, "frequency")?;
    Ok(crate::eq::snap_freq_to_iso(freq as u16))
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn run_autoeq(
    measurement_points_js: JsValue,
    target_points_js: JsValue,
    n_bands: f64,
    steps: f64,
    smooth_type: String,
    fs: f32,
    vendor_id: Option<f64>,
    product_id: Option<f64>,
) -> Result<JsValue, JsValue> {
    let measurement_points: Vec<(f64, f64)> =
        serde_wasm_bindgen::from_value(measurement_points_js).map_err(js_err)?;
    let target_points: Vec<(f64, f64)> =
        serde_wasm_bindgen::from_value(target_points_js).map_err(js_err)?;
    let n_bands = validate_integer_parameter(n_bands, "n_bands")?;
    let steps = validate_integer_parameter(steps, "steps")?;
    let vendor_id = validate_optional_device_id(vendor_id, "vendor_id")?;
    let product_id = validate_optional_device_id(product_id, "product_id")?;

    let caps = device_caps_or_desktop(vendor_id, product_id);
    let mut peq = crate::autoeq::run_autoeq(
        &measurement_points,
        &target_points,
        n_bands,
        steps,
        &smooth_type,
        fs,
        Some(&caps),
    )
    .map_err(js_err)?;

    let warnings = peq.clamp_to_capabilities(&caps);

    let result = AutoEqRunResultWasm { peq, warnings };
    to_js_value(&result)
}
