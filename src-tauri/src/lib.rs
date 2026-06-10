// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

//! Tauri backend for Glacier EQ — exposes hardware and EQ operations to the web frontend.

use glacier_core::eq::{Filter, PEQData};

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Return the current EQ state (10 bands + global gain).
/// In phase 1 this returns a dummy; later it reads from the connected DAC.
#[tauri::command]
fn get_eq_state() -> PEQData {
    let mut filters: Vec<Filter> = (0..10)
        .map(|i| Filter {
            index: i,
            enabled: false,
            filter_type: glacier_core::eq::FilterType::Peak,
            freq: 1000,
            gain: 0.0,
            q: 1.0,
        })
        .collect();
    // Enable and set a sensible middle band for visual feedback
    if let Some(f) = filters.get_mut(4) {
        f.enabled = true;
        f.freq = 1000;
        f.gain = 0.0;
    }
    PEQData {
        filters,
        global_gain: 0,
    }
}

/// Apply a new EQ state to the connected DAC.
#[tauri::command]
fn set_eq_state(peq: PEQData) -> Result<(), String> {
    // TODO: write to device via tauri-plugin-hid
    log::info!("EQ state updated: {} bands, global_gain={}", peq.filters.len(), peq.global_gain);
    Ok(())
}

/// List connected USB DACs compatible with Glacier EQ.
#[tauri::command]
async fn list_devices(app: tauri::AppHandle) -> Result<Vec<glacier_core::device::DeviceInfo>, String> {
    use tauri_plugin_hid::HidExt;
    let hid = app.hid();
    let devices = hid.enumerate().map_err(|e| e.to_string())?;

    let compatible: Vec<glacier_core::device::DeviceInfo> = devices
        .iter()
        .filter_map(|d| {
            let vid = d.vendor_id;
            let pid = d.product_id;
            // TODO: match against known device profiles from glacier-core
            // For now accept any HID device as a demo
            Some(glacier_core::device::DeviceInfo {
                vendor_id: vid,
                product_id: pid,
                path: d.path.clone(),
                manufacturer: d.manufacturer_string.clone(),
                product_string: d.product_string.clone(),
            })
        })
        .collect();

    Ok(compatible)
}

/// Connect to a specific DAC by its device path.
#[tauri::command]
async fn connect_device(path: String) -> Result<(), String> {
    // TODO: open device via tauri-plugin-hid and verify protocol compatibility
    log::info!("Connecting to device: {}", path);
    Ok(())
}

/// Disconnect from the current DAC.
#[tauri::command]
fn disconnect_device() -> Result<(), String> {
    // TODO: close HID handle
    Ok(())
}

// ── App entry point ─────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_hid::init())
        .invoke_handler(tauri::generate_handler![
            get_eq_state,
            set_eq_state,
            list_devices,
            connect_device,
            disconnect_device,
        ])
        .run(tauri::generate_context!())
        .expect("error while running glacier-eq");
}
