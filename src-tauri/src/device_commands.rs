// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

use crate::state::{ConnectedDevice, DeviceState};
use crate::walkplay;
use glacier_core::device::{get_supported_device, DeviceInfo};
use glacier_core::eq::PEQData;
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;
use tauri_plugin_hid::HidExt;

const INIT_DRAIN_ATTEMPTS: usize = 100;
const FILTER_READ_ATTEMPTS: usize = 60;
const MAX_FILTER_MISMATCHES: usize = 8;
const GLOBAL_GAIN_READ_ATTEMPTS: usize = 20;

#[tauri::command]
pub fn get_eq_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<PEQData, String> {
    let connected = connected_device(&state)?;
    let caps = caps_for(&connected, "read")?;
    // Match Frost-Tune's pull_with_retry: wake the DAC, then perform a fresh
    // init/version session that drains stale frames before band reads.
    if let Err(error) = send_packet(&app, &connected.path, &walkplay::global_gain_request()) {
        log::warn!("Pull wake request failed: {error}");
    }
    sleep_ms(50);

    let first = pull_once(&app, &connected, caps.num_bands);
    let should_retry = match &first {
        Ok(peq) => walkplay::is_default_state(peq),
        Err(_) => true,
    };

    let peq = if should_retry {
        sleep_ms(100);
        match pull_once(&app, &connected, caps.num_bands) {
            Ok(peq) => peq,
            Err(retry_error) => match first {
                Ok(defaultish) => defaultish,
                Err(_) => return Err(retry_error),
            },
        }
    } else {
        first?
    };

    log::info!(
        "Pulled EQ from {}: {} bands, global_gain={}",
        connected.profile_name,
        peq.filters.len(),
        peq.global_gain
    );
    Ok(peq)
}

#[tauri::command]
pub fn set_eq_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    peq: PEQData,
) -> Result<(), String> {
    let connected = connected_device(&state)?;
    let caps = caps_for(&connected, "write")?;
    let peq = walkplay::normalize_for_push(peq, caps);
    run_init_sequence(&app, &connected.path)?;
    write_filters(&app, &connected.path, &peq, caps.dsp_sample_rate)?;
    write_global_gain(&app, &connected.path, peq.global_gain)?;
    commit_changes(&app, &connected.path)?;

    log::info!(
        "Pushed EQ to {}: {} bands, global_gain={}",
        connected.profile_name,
        peq.filters.len(),
        peq.global_gain
    );
    Ok(())
}

#[tauri::command]
pub async fn list_devices(app: tauri::AppHandle) -> Result<Vec<DeviceInfo>, String> {
    let hid = app.hid();
    let devices = hid.enumerate().map_err(|error| error.to_string())?;
    let mut seen_paths = HashSet::new();

    let compatible = devices
        .iter()
        .filter_map(|device| {
            let profile = get_supported_device(device.vendor_id, device.product_id)?;
            if !seen_paths.insert(device.path.clone()) {
                return None;
            }

            Some(DeviceInfo {
                vendor_id: device.vendor_id,
                product_id: device.product_id,
                path: device.path.clone(),
                manufacturer: device.manufacturer_string.clone(),
                product_string: device.product_string.clone(),
                profile_name: Some(profile.name.to_string()),
            })
        })
        .collect();

    Ok(compatible)
}

#[tauri::command]
pub async fn connect_device(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    path: String,
) -> Result<(), String> {
    let hid = app.hid();
    let devices = hid.enumerate().map_err(|error| error.to_string())?;
    let device = devices
        .iter()
        .find(|device| device.path == path)
        .ok_or_else(|| "Device disappeared. Scan again and reconnect.".to_string())?;

    let profile = get_supported_device(device.vendor_id, device.product_id).ok_or_else(|| {
        format!(
            "Unsupported HID device {:04X}:{:04X}. Glacier EQ only connects to supported DACs.",
            device.vendor_id, device.product_id
        )
    })?;

    close_previous_device(&app, &state)?;
    hid.open(&path)
        .map_err(|error| format!("Failed to open {}: {error}", profile.name))?;

    state
        .lock()
        .map_err(|_| "Device state lock poisoned".to_string())?
        .connected = Some(ConnectedDevice {
        path: path.clone(),
        vendor_id: device.vendor_id,
        product_id: device.product_id,
        profile_name: profile.name.to_string(),
    });

    log::info!("Connected to supported DAC: {} ({})", profile.name, path);
    Ok(())
}

#[tauri::command]
pub fn disconnect_device(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<(), String> {
    if let Some(device) = state
        .lock()
        .map_err(|_| "Device state lock poisoned".to_string())?
        .connected
        .take()
    {
        app.hid()
            .close(&device.path)
            .map_err(|error| format!("Failed to close {}: {error}", device.profile_name))?;
    }
    Ok(())
}

fn connected_device(
    state: &tauri::State<'_, Mutex<DeviceState>>,
) -> Result<ConnectedDevice, String> {
    state
        .lock()
        .map_err(|_| "Device state lock poisoned".to_string())?
        .connected
        .clone()
        .ok_or_else(|| "No supported DAC connected. Connect a device first.".to_string())
}

fn caps_for(device: &ConnectedDevice, operation: &str) -> Result<walkplay::RuntimeCaps, String> {
    walkplay::runtime_caps(device.vendor_id, device.product_id).ok_or_else(|| {
        format!(
            "No {operation} protocol registered for {:04X}:{:04X}",
            device.vendor_id, device.product_id
        )
    })
}

fn close_previous_device(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, Mutex<DeviceState>>,
) -> Result<(), String> {
    if let Some(previous) = state
        .lock()
        .map_err(|_| "Device state lock poisoned".to_string())?
        .connected
        .take()
    {
        let _ = app.hid().close(&previous.path);
    }
    Ok(())
}

fn pull_once(
    app: &tauri::AppHandle,
    connected: &ConnectedDevice,
    num_bands: usize,
) -> Result<PEQData, String> {
    run_init_sequence(app, &connected.path)?;

    let mut filters = Vec::with_capacity(num_bands);
    for index in 0..num_bands {
        filters.push(read_filter(app, connected, index as u8)?);
        sleep_ms(10);
    }

    sleep_ms(40);
    let global_gain = read_global_gain(app, &connected.path)?;

    Ok(PEQData {
        filters,
        global_gain,
    })
}

fn read_filter(
    app: &tauri::AppHandle,
    connected: &ConnectedDevice,
    index: u8,
) -> Result<glacier_core::eq::Filter, String> {
    let nonce = index.wrapping_add(1).max(1);
    send_packet(
        app,
        &connected.path,
        &walkplay::filter_read_request(index, nonce),
    )?;

    let mut mismatches = 0usize;
    for _ in 0..FILTER_READ_ATTEMPTS {
        let bytes = app
            .hid()
            .read(&connected.path, 60)
            .map_err(|error| format!("Filter {} read failed: {error}", index + 1))?;
        if bytes.is_empty() {
            continue;
        }

        let data = walkplay::unframe_packet(&bytes);
        if walkplay::matches_filter_response(data, index, nonce) {
            return walkplay::parse_filter_response(data)
                .ok_or_else(|| format!("Filter {} response could not be parsed", index + 1));
        }

        if !data.is_empty() {
            mismatches += 1;
            if mismatches > MAX_FILTER_MISMATCHES {
                break;
            }
        }
    }

    Err(format!(
        "Failed to read filter {} from {}",
        index + 1,
        connected.profile_name
    ))
}

fn read_global_gain(app: &tauri::AppHandle, path: &str) -> Result<i8, String> {
    send_packet(app, path, &walkplay::global_gain_request())?;
    sleep_ms(25);

    for _ in 0..GLOBAL_GAIN_READ_ATTEMPTS {
        let bytes = app
            .hid()
            .read(path, 60)
            .map_err(|error| format!("Global gain read failed: {error}"))?;
        if bytes.is_empty() {
            continue;
        }

        let data = walkplay::unframe_packet(&bytes);
        if walkplay::matches_global_gain_response(data) {
            if let Some(gain) = walkplay::parse_global_gain_response(data) {
                return Ok(gain);
            }
        }
    }

    Err("Global gain read timeout".to_string())
}

fn run_init_sequence(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    for packet in walkplay::init_packets() {
        send_packet(app, path, &packet).map_err(|error| format!("Init write failed: {error}"))?;
    }
    sleep_ms(50);
    drain_stale_frames(app, path);
    Ok(())
}

fn write_filters(
    app: &tauri::AppHandle,
    path: &str,
    peq: &PEQData,
    dsp_sample_rate: f64,
) -> Result<(), String> {
    for (index, filter) in peq.filters.iter().enumerate() {
        let packet = walkplay::filter_write_packet(index as u8, filter, dsp_sample_rate);
        send_packet(app, path, &packet)
            .map_err(|error| format!("Band {} write failed: {error}", index + 1))?;
        sleep_ms(80);
    }
    Ok(())
}

fn write_global_gain(app: &tauri::AppHandle, path: &str, global_gain: i8) -> Result<(), String> {
    sleep_ms(100);
    send_packet(app, path, &walkplay::global_gain_write_packet(global_gain))
        .map_err(|error| format!("Global gain write failed: {error}"))?;
    sleep_ms(50);
    Ok(())
}

fn commit_changes(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    for packet in walkplay::commit_packets() {
        send_packet(app, path, &packet).map_err(|error| format!("Commit write failed: {error}"))?;
        sleep_ms(500);
    }
    Ok(())
}

fn send_packet(app: &tauri::AppHandle, path: &str, packet: &[u8]) -> Result<(), String> {
    app.hid()
        .write(path, &walkplay::frame_packet(packet))
        .map_err(|error| error.to_string())
}

fn drain_stale_frames(app: &tauri::AppHandle, path: &str) {
    for _ in 0..INIT_DRAIN_ATTEMPTS {
        match app.hid().read(path, 20) {
            Ok(bytes) if bytes.is_empty() => break,
            Ok(_) => continue,
            Err(_) => break,
        }
    }
}

fn sleep_ms(ms: u64) {
    std::thread::sleep(Duration::from_millis(ms));
}
