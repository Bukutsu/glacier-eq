// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! WebHID's three asynchronous primitives, adapted to the shared Rust session.

use super::{js_err, to_js_value, validate_device_id};
use crate::device::get_supported_device_with_name;
use crate::device::session::{DeviceCommand, DeviceIo, DeviceSession};
use js_sys::{Function, Promise, Uint8Array};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

#[wasm_bindgen]
extern "C" {
    pub type WebHidIo;
    #[wasm_bindgen(method, catch, js_name = write)]
    fn write_report(this: &WebHidIo, bytes: &Uint8Array) -> Result<Promise, JsValue>;
    #[wasm_bindgen(method, catch, js_name = read)]
    fn read_report(this: &WebHidIo, timeout_ms: i32) -> Result<Promise, JsValue>;
    #[wasm_bindgen(method, catch, js_name = sleep)]
    fn sleep_report(this: &WebHidIo, ms: f64) -> Result<Promise, JsValue>;
}

fn io_error(error: JsValue) -> String {
    error
        .as_string()
        .or_else(|| {
            error
                .dyn_ref::<js_sys::Error>()
                .map(|error| String::from(error.message()))
        })
        .unwrap_or_else(|| format!("{error:?}"))
}

struct WebTransport(WebHidIo);

impl DeviceIo for WebTransport {
    async fn write(&mut self, data: &[u8]) -> Result<(), String> {
        let pending = self
            .0
            .write_report(&Uint8Array::from(data))
            .map_err(io_error)?;
        JsFuture::from(pending).await.map_err(io_error)?;
        Ok(())
    }

    async fn read(&mut self, timeout_ms: i32) -> Result<Vec<u8>, String> {
        let pending = self.0.read_report(timeout_ms).map_err(io_error)?;
        let bytes = JsFuture::from(pending).await.map_err(io_error)?;
        if !bytes.is_instance_of::<Uint8Array>() {
            return Err("WebHID read must return a Uint8Array".into());
        }
        Ok(Uint8Array::new(&bytes).to_vec())
    }

    fn reads_include_report_id(&self) -> bool {
        true
    }

    async fn sleep_ms(&mut self, ms: u64) {
        // Sleep is a timer primitive, not a device operation. A failed timer
        // is a programming error; don't continue with unvalidated pacing.
        let pending = self
            .0
            .sleep_report(ms as f64)
            .expect("WebHID sleep must return a Promise");
        JsFuture::from(pending).await.expect("WebHID timer failed");
    }
}

/// Executes a command through the shared session. The JS transport supplies
/// async write/read/sleep methods and a writable nonce property. On success or
/// device failure, nonce receives the last consumed filter nonce; use it as the
/// next operation's initial_nonce, including after a rejected Promise.
#[wasm_bindgen]
pub async fn device_operation(
    vendor_id: f64,
    product_id: f64,
    io: WebHidIo,
    request: JsValue,
    progress: Function,
    initial_nonce: f64,
) -> Result<JsValue, JsValue> {
    let vendor_id = validate_device_id(vendor_id, "vendor_id")?;
    let product_id = validate_device_id(product_id, "product_id")?;
    let nonce = super::validate_integer_range(initial_nonce, 0.0, 255.0, "nonce")? as u8;
    // Product identity comes from the bound WebHID handle, not command policy.
    let product_name = js_sys::Reflect::get(io.as_ref(), &"productName".into())?.as_string();
    let profile = get_supported_device_with_name(vendor_id, product_id, product_name.as_deref())
        .ok_or_else(|| js_err("No profile registered for connected device"))?;
    let request: DeviceCommand = serde_wasm_bindgen::from_value(request).map_err(js_err)?;
    let mut callback = |message: &str, percentage: f32| {
        // Progress delivery is advisory; a UI listener cannot abort a device
        // transaction after writes have already landed.
        let _ = progress.call2(&JsValue::NULL, &message.into(), &percentage.into());
    };
    let nonce_state: &JsValue = io.as_ref();
    let nonce_state = nonce_state.clone();
    let mut session = DeviceSession::from_io(WebTransport(io), profile, Some(&mut callback), nonce);
    let outcome = session.execute(request).await;
    // Publish correlation state even when the operation fails after sending
    // requests. Reusing a consumed nonce could accept a late, stale response.
    if !js_sys::Reflect::set(
        &nonce_state,
        &"nonce".into(),
        &session.filter_nonce().into(),
    )? {
        return Err(js_err(
            "WebHID transport must have a writable nonce property",
        ));
    }
    to_js_value(&outcome.map_err(js_err)?)
}
