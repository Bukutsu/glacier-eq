// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::device::capabilities::{DeviceCapabilities, EditorCapabilities, DESKTOP_DAC_CAPS};
use crate::device::{
    get_supported_device, DeviceProfile, DeviceProtocol, EqProtocol, Packet, WalkplayProtocol,
    SUPPORTED_DEVICES,
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
    pub family: String,
    #[serde(flatten)]
    pub capabilities: EditorCapabilities,
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

fn response_values(
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
fn response_values_and_bands(
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

fn eq_protocol(protocol: &str) -> Result<&'static dyn EqProtocol, JsValue> {
    let normalized = protocol.to_lowercase().replace([' ', '-', '_'], "");
    match normalized.as_str() {
        "walkplay" => Ok(&WalkplayProtocol),
        "moondrop" => Ok(&crate::device::moondrop::MoondropProtocol),
        "fiioja11" => Ok(&crate::device::fiio::JA11_PROTOCOL),
        "fiio" => Ok(&crate::device::fiio::FIIO_PROTOCOL),
        _ => Err(JsValue::from_str("Invalid protocol")),
    }
}

fn unframe<'a>(protocol: &dyn EqProtocol, data: &'a [u8]) -> Result<&'a [u8], JsValue> {
    protocol.unframe_packet(data).map_err(js_err)
}

fn supported_profile(
    vendor_id: Option<u16>,
    product_id: Option<u16>,
) -> Option<&'static DeviceProfile> {
    match (vendor_id, product_id) {
        (Some(vid), Some(pid)) => get_supported_device(vid, pid),
        (Some(vid), None) => SUPPORTED_DEVICES
            .iter()
            .find(|profile| profile.vendor_id == vid && profile.product_id.is_none()),
        _ => None,
    }
}

fn device_caps_or_desktop(vendor_id: Option<u16>, product_id: Option<u16>) -> DeviceCapabilities {
    supported_profile(vendor_id, product_id)
        .map(|profile| profile.caps.clone())
        .unwrap_or_else(|| DESKTOP_DAC_CAPS.clone())
}

fn framed_packets(packets: Vec<Packet>) -> Result<JsValue, JsValue> {
    let framed: Vec<Vec<u8>> = packets.iter().map(|pkt| pkt.framed()).collect();
    to_js_value(&framed)
}

fn validate_dsp_sample_rate(sample_rate: f64) -> Result<(), JsValue> {
    if !sample_rate.is_finite() || !(40_000.0..=768_000.0).contains(&sample_rate) {
        return Err(JsValue::from_str(
            "DSP sample rate must be between 40000 and 768000 Hz",
        ));
    }
    Ok(())
}

fn validate_filter_numeric(filter: &Filter) -> Result<(), JsValue> {
    if filter.freq == 0 {
        return Err(JsValue::from_str(
            "Filter frequency must be greater than zero",
        ));
    }
    if !filter.gain.is_finite() || !filter.q.is_finite() || filter.q <= 0.0 {
        return Err(JsValue::from_str(
            "Filter gain and Q must be finite with Q greater than zero",
        ));
    }
    Ok(())
}

fn validate_peq_numeric(peq: &PEQData) -> Result<(), JsValue> {
    crate::device::normalization::validate_peq(peq).map_err(js_err)?;
    for filter in &peq.filters {
        validate_filter_numeric(filter)?;
    }
    Ok(())
}

fn validate_response_freqs(freqs: &[f32]) -> Result<(), JsValue> {
    if freqs
        .iter()
        .any(|frequency| !frequency.is_finite() || *frequency <= 0.0)
    {
        return Err(JsValue::from_str(
            "Response frequencies must be finite and positive",
        ));
    }
    Ok(())
}

fn validate_integer_parameter(value: f64, name: &str) -> Result<usize, JsValue> {
    if !value.is_finite() || value < 1.0 || value.fract() != 0.0 || value > usize::MAX as f64 {
        return Err(JsValue::from_str(&format!(
            "{name} must be a positive integer"
        )));
    }
    Ok(value as usize)
}

fn validate_global_gain_wire(protocol: &str, gain: f64) -> Result<(), JsValue> {
    if !gain.is_finite() {
        return Err(JsValue::from_str("Global gain must be finite"));
    }
    let rounded = gain.round();
    if !(-128.0..=127.0).contains(&rounded) {
        return Err(JsValue::from_str("Global gain is outside the wire range"));
    }
    let normalized = protocol.to_lowercase().replace([' ', '-', '_'], "");
    let scale = match normalized.as_str() {
        "fiio" => 10.0,
        "fiioja11" => 2560.0,
        "moondrop" => 256.0,
        _ => return Ok(()),
    };
    if !(-32768.0 / scale..=32767.0 / scale).contains(&rounded) {
        return Err(JsValue::from_str("Global gain is outside the wire range"));
    }
    Ok(())
}

fn validate_filter_packets_wire(
    protocol: &dyn EqProtocol,
    packets: &[Packet],
) -> Result<(), JsValue> {
    if packets
        .first()
        .is_some_and(|packet| !protocol.is_filter_packet_valid(&packet.payload))
    {
        return Err(JsValue::from_str(
            "Filter cannot be represented by the selected protocol wire format",
        ));
    }
    Ok(())
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
    let list: Vec<SupportedDeviceInfoWasm> = SUPPORTED_DEVICES
        .iter()
        .map(|device| SupportedDeviceInfoWasm {
            name: device.name.to_string(),
            protocol: device.protocol.name().to_string(),
            vendor_id: device.vendor_id,
            product_id: device.product_id,
            status: device.status.to_string(),
            family: device.family.to_string(),
            capabilities: (&device.caps).into(),
        })
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
    vendor_id: u16,
    product_id: u16,
) -> Result<JsValue, JsValue> {
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
    vendor_id: u16,
    product_id: u16,
) -> Result<bool, JsValue> {
    let peq: PEQData = serde_wasm_bindgen::from_value(peq_js).map_err(js_err)?;
    validate_peq_numeric(&peq)?;
    crate::device::is_default_peq_for_device(&peq, vendor_id, product_id).map_err(js_err)
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
    let normalized = crate::profiles::normalize_for_storage(&peq).map_err(js_err)?;
    Ok(crate::autoeq::peq_to_autoeq(&normalized))
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
    let protocol = supported_profile(vendor_id, product_id)
        .map(|profile| profile.protocol)
        .unwrap_or(DeviceProtocol::Unknown);

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
    Ok(response_values(
        &peq,
        freqs,
        include_preamp,
        dsp_sample_rate,
    ))
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
    Ok(response_values_and_bands(
        &peq,
        freqs,
        include_preamp,
        dsp_sample_rate,
    ))
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
    Ok(response_values(&peq, freqs, false, dsp_sample_rate))
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
    n_bands: f64,
    steps: f64,
    smooth_type: String,
    fs: f32,
    vendor_id: Option<u16>,
    product_id: Option<u16>,
) -> Result<JsValue, JsValue> {
    let measurement_points: Vec<(f64, f64)> =
        serde_wasm_bindgen::from_value(measurement_points_js).map_err(js_err)?;
    let target_points: Vec<(f64, f64)> =
        serde_wasm_bindgen::from_value(target_points_js).map_err(js_err)?;
    let n_bands = validate_integer_parameter(n_bands, "n_bands")?;
    let steps = validate_integer_parameter(steps, "steps")?;

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
pub fn is_filter_response_valid(
    protocol: String,
    data: Vec<u8>,
    index: u8,
    nonce: u8,
) -> Result<bool, JsValue> {
    let p = eq_protocol(&protocol)?;
    let unframed = unframe(p, &data)?;
    Ok(p.is_filter_response_valid(unframed, index, nonce))
}

#[wasm_bindgen]
pub fn parse_filter_response(protocol: String, data: Vec<u8>) -> Result<JsValue, JsValue> {
    let p = eq_protocol(&protocol)?;
    let unframed = unframe(p, &data)?;
    if !p.is_filter_packet_valid(unframed) {
        return Err(JsValue::from_str("Invalid filter response"));
    }
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
    validate_filter_numeric(&filter)?;
    validate_global_gain_wire(&protocol, global_gain)?;
    validate_dsp_sample_rate(dsp_sample_rate)?;
    let packets = p
        .write_filter_packets(index, &filter, dsp_sample_rate, global_gain)
        .map_err(|err| JsValue::from_str(&err))?;
    validate_filter_packets_wire(p, &packets)?;
    framed_packets(packets)
}

#[wasm_bindgen]
pub fn build_write_global_gain_packets(
    protocol: String,
    global_gain: f64,
) -> Result<JsValue, JsValue> {
    let p = eq_protocol(&protocol)?;
    validate_global_gain_wire(&protocol, global_gain)?;
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
pub fn build_mic_volume_write_packet(db: f64) -> Result<Vec<u8>, JsValue> {
    if !db.is_finite() || db.fract() != 0.0 || !(-128.0..=127.0).contains(&db) {
        return Err(JsValue::from_str(
            "Mic volume must be an integer between -128 and 127",
        ));
    }
    let payload = WalkplayProtocol::build_mic_volume_write_packet(db as i8);
    Ok(Packet::new(WalkplayProtocol::report_id(), payload).framed())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_device_autoeq_uses_editor_capabilities() {
        let caps = device_caps_or_desktop(None, None);
        assert_eq!(caps.num_bands, DESKTOP_DAC_CAPS.num_bands);
        assert_eq!(caps.global_gain_range, DESKTOP_DAC_CAPS.global_gain_range);
        assert_eq!(caps.band_gain_range, DESKTOP_DAC_CAPS.band_gain_range);
        assert_eq!(
            device_caps_or_desktop(Some(0x1234), Some(0x5678)).num_bands,
            DESKTOP_DAC_CAPS.num_bands
        );
    }

    #[test]
    fn wasm_facade_rejects_coerced_integer_parameters() {
        assert!(validate_integer_parameter(1.5, "n_bands").is_err());
        assert!(validate_integer_parameter(f64::NAN, "steps").is_err());
        assert!(validate_integer_parameter(-1.0, "steps").is_err());
    }

    #[test]
    fn wasm_filter_wire_validation_rejects_unrepresentable_values() {
        let protocol = eq_protocol("Walkplay").unwrap();
        let packets = protocol
            .write_filter_packets(
                0,
                &Filter {
                    index: 0,
                    enabled: true,
                    freq: 1000,
                    gain: 0.0,
                    q: 0.001,
                    filter_type: crate::eq::FilterType::Peak,
                },
                96_000.0,
                0.0,
            )
            .unwrap();
        assert!(validate_filter_packets_wire(protocol, &packets).is_err());
    }

    #[test]
    fn eq_protocol_matches_device_protocol_names() {
        assert!(eq_protocol("Walkplay").is_ok());
        assert!(eq_protocol("Moondrop").is_ok());
        assert!(eq_protocol("FiiO JA11").is_ok());
        assert!(eq_protocol("fiioja11").is_ok());
        assert!(eq_protocol("fiio ja11").is_ok());
        assert!(eq_protocol("FiiO").is_ok());
        assert!(eq_protocol("fiio").is_ok());
        assert!(eq_protocol("Unknown").is_err());
    }
}
