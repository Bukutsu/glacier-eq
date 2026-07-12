// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::device::capabilities::{DeviceCapabilities, DESKTOP_DAC_CAPS};
use crate::device::{
    get_supported_device, DeviceProtocol, EqProtocol, Packet, WalkplayProtocol, SUPPORTED_DEVICES,
};
use crate::eq::{Filter, PEQData};
use crate::profile_match::{matching_profile_name, ProfileCandidate};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize)]
pub struct SupportedDeviceInfoWasm {
    pub name: String,
    pub protocol: String,
    pub vendor_id: u16,
    pub product_id: Option<u16>,
    pub status: String,
    pub num_bands: usize,
    pub supports_ram_apply: bool,
    pub integer_preamp: bool,
}

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

fn response_values(peq: &PEQData, freqs: Vec<f32>, include_preamp: bool) -> Vec<f32> {
    let mut response = vec![
        if include_preamp {
            peq.global_gain as f32
        } else {
            0.0
        };
        freqs.len()
    ];
    for filter in peq.filters.iter().filter(|filter| filter.enabled) {
        crate::eq::iir_math::accumulate_response_values(
            filter.filter_type,
            filter.freq as f64,
            filter.gain,
            filter.q,
            96000.0,
            &freqs,
            &mut response,
        );
    }
    response
}

fn eq_protocol(protocol: &str) -> Result<&'static dyn EqProtocol, JsValue> {
    let protocol = match protocol.to_lowercase().as_str() {
        "walkplay" => DeviceProtocol::Walkplay,
        "moondrop" => DeviceProtocol::Moondrop,
        "fiioja11" => DeviceProtocol::FiioJa11,
        "fiio" => DeviceProtocol::Fiio,
        _ => return Err(JsValue::from_str("Invalid protocol")),
    };
    Ok(protocol.implementation())
}

fn unframe<'a>(protocol: &dyn EqProtocol, data: &'a [u8]) -> Result<&'a [u8], JsValue> {
    protocol.unframe_packet(data).map_err(js_err)
}

fn device_caps_or_desktop(vendor_id: Option<u16>, product_id: Option<u16>) -> DeviceCapabilities {
    if let (Some(vid), Some(pid)) = (vendor_id, product_id) {
        get_supported_device(vid, pid)
            .map(|profile| profile.caps.clone())
            .unwrap_or(DESKTOP_DAC_CAPS)
    } else {
        DESKTOP_DAC_CAPS
    }
}

fn framed_packets(packets: Vec<Packet>) -> Result<JsValue, JsValue> {
    let framed: Vec<Vec<u8>> = packets.iter().map(|pkt| pkt.framed()).collect();
    to_js_value(&framed)
}

fn js_err(error: impl ToString) -> JsValue {
    JsValue::from_str(&error.to_string())
}

fn to_js_value<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(value).map_err(js_err)
}

#[wasm_bindgen]
pub fn list_supported_devices() -> Result<JsValue, JsValue> {
    let list: Vec<SupportedDeviceInfoWasm> = SUPPORTED_DEVICES
        .iter()
        .map(|device| SupportedDeviceInfoWasm {
            name: device.name.to_string(),
            protocol: device.protocol.name().to_string(),
            vendor_id: device.vendor_id,
            product_id: device.product_id,
            status: device.status.to_string(),
            num_bands: device.caps.num_bands,
            supports_ram_apply: device.caps.supports_ram_apply,
            integer_preamp: device.caps.integer_preamp,
        })
        .collect();

    to_js_value(&list)
}

#[wasm_bindgen]
pub fn parse_autoeq(
    text: String,
    vendor_id: Option<u16>,
    product_id: Option<u16>,
) -> Result<JsValue, JsValue> {
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
    Ok(crate::autoeq::peq_to_autoeq(&peq))
}

#[wasm_bindgen]
pub fn match_profile_name(
    peq_js: JsValue,
    profiles_js: JsValue,
    vendor_id: Option<u16>,
    product_id: Option<u16>,
) -> Result<Option<String>, JsValue> {
    let peq: PEQData = serde_wasm_bindgen::from_value(peq_js).map_err(js_err)?;
    let profiles: Vec<ProfileCandidateWasm> =
        serde_wasm_bindgen::from_value(profiles_js).map_err(js_err)?;
    let caps = device_caps_or_desktop(vendor_id, product_id);
    let protocol = vendor_id
        .zip(product_id)
        .and_then(|(vid, pid)| get_supported_device(vid, pid).map(|profile| profile.protocol))
        .unwrap_or(DeviceProtocol::Walkplay);

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
    freqs_js: JsValue,
    include_preamp: bool,
) -> Result<JsValue, JsValue> {
    let peq: PEQData = serde_wasm_bindgen::from_value(peq_js).map_err(js_err)?;
    let freqs: Vec<f32> = serde_wasm_bindgen::from_value(freqs_js).map_err(js_err)?;
    to_js_value(&response_values(&peq, freqs, include_preamp))
}

#[wasm_bindgen]
pub fn filter_response_values(filter_js: JsValue, freqs_js: JsValue) -> Result<JsValue, JsValue> {
    let filter: Filter = serde_wasm_bindgen::from_value(filter_js).map_err(js_err)?;
    let peq = PEQData {
        filters: vec![filter],
        global_gain: 0.0,
    };
    let freqs: Vec<f32> = serde_wasm_bindgen::from_value(freqs_js).map_err(js_err)?;
    to_js_value(&response_values(&peq, freqs, false))
}

#[wasm_bindgen]
pub fn snap_freq_to_iso(freq: u16) -> u16 {
    crate::eq::snap_freq_to_iso(freq)
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn run_autoeq(
    measurement_points_js: JsValue,
    target_points_js: JsValue,
    n_bands: usize,
    steps: usize,
    smooth_type: String,
    fs: f32,
    vendor_id: Option<u16>,
    product_id: Option<u16>,
) -> Result<JsValue, JsValue> {
    let measurement_points: Vec<(f64, f64)> =
        serde_wasm_bindgen::from_value(measurement_points_js).map_err(js_err)?;
    let target_points: Vec<(f64, f64)> =
        serde_wasm_bindgen::from_value(target_points_js).map_err(js_err)?;

    let mut peq = crate::autoeq::run_autoeq(
        &measurement_points,
        &target_points,
        n_bands,
        steps,
        &smooth_type,
        fs,
    )
    .map_err(js_err)?;

    let warnings = peq.clamp_to_capabilities(&device_caps_or_desktop(vendor_id, product_id));

    let result = AutoEqRunResultWasm { peq, warnings };
    to_js_value(&result)
}

#[wasm_bindgen]
pub fn build_init_packets(protocol: String) -> Result<JsValue, JsValue> {
    let p = eq_protocol(&protocol)?;
    framed_packets(p.init_packets())
}

#[wasm_bindgen]
pub fn build_read_filter_request(
    protocol: String,
    index: u8,
    nonce: u8,
) -> Result<Vec<u8>, JsValue> {
    let p = eq_protocol(&protocol)?;
    Ok(p.read_filter_request(index, nonce).framed())
}

#[wasm_bindgen]
pub fn matches_filter_response(
    protocol: String,
    data: Vec<u8>,
    index: u8,
    nonce: u8,
) -> Result<bool, JsValue> {
    let p = eq_protocol(&protocol)?;
    let unframed = unframe(p, &data)?;
    Ok(p.matches_filter_response(unframed, index, nonce))
}

#[wasm_bindgen]
pub fn parse_filter_response(protocol: String, data: Vec<u8>) -> Result<JsValue, JsValue> {
    let p = eq_protocol(&protocol)?;
    let unframed = unframe(p, &data)?;
    let filter = p
        .parse_filter_response(unframed)
        .ok_or_else(|| JsValue::from_str("Parse failed"))?;
    to_js_value(&filter)
}

#[wasm_bindgen]
pub fn build_read_global_gain_request(protocol: String) -> Result<Vec<u8>, JsValue> {
    let p = eq_protocol(&protocol)?;
    Ok(p.read_global_gain_request().framed())
}

#[wasm_bindgen]
pub fn matches_global_gain_response(protocol: String, data: Vec<u8>) -> Result<bool, JsValue> {
    let p = eq_protocol(&protocol)?;
    let unframed = unframe(p, &data)?;
    Ok(p.matches_global_gain_response(unframed))
}

#[wasm_bindgen]
pub fn parse_global_gain_response(protocol: String, data: Vec<u8>) -> Result<f64, JsValue> {
    let p = eq_protocol(&protocol)?;
    let unframed = unframe(p, &data)?;
    p.parse_global_gain_response(unframed)
        .ok_or_else(|| JsValue::from_str("Parse failed"))
}

#[wasm_bindgen]
pub fn build_write_filter_packets(
    protocol: String,
    index: u8,
    filter_js: JsValue,
    dsp_sample_rate: f64,
    global_gain: f64,
) -> Result<JsValue, JsValue> {
    let p = eq_protocol(&protocol)?;
    let filter: Filter = serde_wasm_bindgen::from_value(filter_js).map_err(js_err)?;
    let packets = p
        .write_filter_packets(index, &filter, dsp_sample_rate, global_gain)
        .map_err(|err| JsValue::from_str(&err))?;
    framed_packets(packets)
}

#[wasm_bindgen]
pub fn build_write_global_gain_packets(
    protocol: String,
    global_gain: f64,
) -> Result<JsValue, JsValue> {
    let p = eq_protocol(&protocol)?;
    framed_packets(p.write_global_gain_packets(global_gain))
}

#[wasm_bindgen]
pub fn build_commit_packets(protocol: String) -> Result<JsValue, JsValue> {
    let p = eq_protocol(&protocol)?;
    framed_packets(p.commit_packets())
}

#[wasm_bindgen]
pub fn build_ram_apply_packets(protocol: String) -> Result<JsValue, JsValue> {
    let p = eq_protocol(&protocol)?;
    framed_packets(p.ram_apply_packets())
}

// ─── Walkplay specific utility command packet builders ───────────────────────────

#[wasm_bindgen]
pub fn build_filter_mode_write_packet(mode: String) -> Result<Vec<u8>, JsValue> {
    let r = match mode.as_str() {
        "FAST-LL" => 1,
        "FAST-PC" => 2,
        "Slow-LL" => 3,
        "Slow-PC" => 4,
        "NON-OS" => 5,
        _ => return Err(JsValue::from_str("Invalid filter mode")),
    };
    let payload = WalkplayProtocol::build_filter_mode_write_packet(r);
    Ok(Packet::new(WalkplayProtocol::report_id(), payload).framed())
}

#[wasm_bindgen]
pub fn build_amp_mode_write_packet(is_class_ab: bool) -> Vec<u8> {
    let payload = WalkplayProtocol::build_amp_mode_write_packet(is_class_ab);
    Packet::new(WalkplayProtocol::report_id(), payload).framed()
}

#[wasm_bindgen]
pub fn build_gain_mode_write_packet(is_high: bool) -> Vec<u8> {
    let payload = WalkplayProtocol::build_gain_mode_write_packet(is_high);
    Packet::new(WalkplayProtocol::report_id(), payload).framed()
}

#[wasm_bindgen]
pub fn build_balance_write_packets(balance: i8) -> Result<JsValue, JsValue> {
    let payloads = WalkplayProtocol::build_balance_write_packets(balance);
    let packets: Vec<Vec<u8>> = payloads
        .into_iter()
        .map(|payload| Packet::new(WalkplayProtocol::report_id(), payload).framed())
        .collect();
    to_js_value(&packets)
}

#[wasm_bindgen]
pub fn build_mic_volume_write_packet(db: i8) -> Vec<u8> {
    let payload = WalkplayProtocol::build_mic_volume_write_packet(db);
    Packet::new(WalkplayProtocol::report_id(), payload).framed()
}

#[wasm_bindgen]
pub fn build_factory_reset_packet() -> Vec<u8> {
    let payload = WalkplayProtocol::build_factory_reset_packet();
    Packet::new(WalkplayProtocol::report_id(), payload).framed()
}

#[wasm_bindgen]
pub fn build_flash_eq_packet() -> Vec<u8> {
    let payload = vec![
        crate::device::walkplay::WRITE,
        crate::device::walkplay::CMD_FLASH_EQ,
        0,
    ];
    Packet::new(WalkplayProtocol::report_id(), payload).framed()
}

#[wasm_bindgen]
pub fn get_write_timing(protocol: String) -> Result<JsValue, JsValue> {
    let p = eq_protocol(&protocol)?;
    let timing = p.write_timing();

    to_js_value(&timing)
}
