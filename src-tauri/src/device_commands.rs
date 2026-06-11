// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

use crate::state::{ConnectedDevice, DeviceState};
use crate::walkplay;
use crate::diagnostics::{self, DiagnosticsStore, LogSource};
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
    diagnostics_store: tauri::State<'_, Mutex<DiagnosticsStore>>,
) -> Result<PEQData, String> {
    let connected = connected_device(&state)?;
    let caps = caps_for(&connected, "read")?;
    diagnostics::log_info(&app, &diagnostics_store, LogSource::HID, "Reading from device...");
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
                Err(_) => {
                    diagnostics::log_error(&app, &diagnostics_store, LogSource::HID, format!("Pull failed: {retry_error}"));
                    return Err(retry_error);
                }
            },
        }
    } else {
        match first {
            Ok(peq) => peq,
            Err(error) => {
                diagnostics::log_error(&app, &diagnostics_store, LogSource::HID, format!("Pull failed: {error}"));
                return Err(error);
            }
        }
    };

    diagnostics::log_info(
        &app,
        &diagnostics_store,
        LogSource::HID,
        format!(
            "Pull successful: {} bands, global_gain={}",
            peq.filters.len(),
            peq.global_gain
        ),
    );
    Ok(peq)
}

fn compare_peq(actual: &PEQData, expected: &PEQData) -> Result<(), String> {
    if actual.global_gain != expected.global_gain {
        return Err(format!(
            "Global gain mismatch: expected {}, got {}",
            expected.global_gain, actual.global_gain
        ));
    }

    if actual.filters.len() != expected.filters.len() {
        return Err(format!(
            "Filter count mismatch: expected {}, got {}",
            expected.filters.len(),
            actual.filters.len()
        ));
    }

    // Tolerances matching DeviceCapabilities (gain=0.15, freq=1, q=0.05)
    let gain_tolerance = 0.15;
    let freq_tolerance = 1;
    let q_tolerance = 0.05;

    for (a, e) in actual.filters.iter().zip(expected.filters.iter()) {
        if (a.gain - e.gain).abs() > gain_tolerance {
            return Err(format!(
                "Band {} gain mismatch: expected {:.2}, got {:.2}",
                e.index + 1, e.gain, a.gain
            ));
        }
        if (a.freq as i32 - e.freq as i32).abs() > freq_tolerance {
            return Err(format!(
                "Band {} frequency mismatch: expected {}, got {}",
                e.index + 1, e.freq, a.freq
            ));
        }
        if (a.q - e.q).abs() > q_tolerance {
            return Err(format!(
                "Band {} Q mismatch: expected {:.2}, got {:.2}",
                e.index + 1, e.q, a.q
            ));
        }
        if a.filter_type != e.filter_type {
            return Err(format!(
                "Band {} filter type mismatch: expected {:?}, got {:?}",
                e.index + 1, e.filter_type, a.filter_type
            ));
        }
    }

    Ok(())
}

fn rollback_state(
    app: &tauri::AppHandle,
    connected: &ConnectedDevice,
    peq: &PEQData,
    caps: walkplay::RuntimeCaps,
) -> Result<(), String> {
    run_init_sequence(app, &connected.path)?;
    write_filters(app, &connected.path, peq, caps.dsp_sample_rate)?;
    write_global_gain(app, &connected.path, peq.global_gain)?;
    commit_changes(app, &connected.path)?;
    Ok(())
}

#[tauri::command]
pub fn set_eq_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    diagnostics_store: tauri::State<'_, Mutex<DiagnosticsStore>>,
    peq: PEQData,
) -> Result<(), String> {
    let connected = connected_device(&state)?;
    let caps = caps_for(&connected, "write")?;
    let peq = walkplay::normalize_for_push(peq, caps);

    let settings = crate::settings::get_settings().unwrap_or_default();

    // 1. Snapshot current state before writing
    let backup_state = if !settings.skip_push_verification {
        diagnostics::log_info(&app, &diagnostics_store, LogSource::HID, "Snapshotting current device state...");
        match pull_once(&app, &connected, caps.num_bands) {
            Ok(backup) => Some(backup),
            Err(error) => {
                diagnostics::log_warn(
                    &app,
                    &diagnostics_store,
                    LogSource::HID,
                    format!("Failed to snapshot current state before push: {error}. Proceeding without rollback recovery."),
                );
                None
            }
        }
    } else {
        None
    };

    // 2. Write the new settings
    diagnostics::log_info(
        &app,
        &diagnostics_store,
        LogSource::HID,
        format!("Pushing EQ to {}...", connected.profile_name),
    );

    if let Err(error) = run_init_sequence(&app, &connected.path) {
        diagnostics::log_error(&app, &diagnostics_store, LogSource::HID, format!("Init write failed: {error}"));
        return Err(error);
    }
    if let Err(error) = write_filters(&app, &connected.path, &peq, caps.dsp_sample_rate) {
        diagnostics::log_error(&app, &diagnostics_store, LogSource::HID, format!("Filters write failed: {error}"));
        return Err(error);
    }
    if let Err(error) = write_global_gain(&app, &connected.path, peq.global_gain) {
        diagnostics::log_error(&app, &diagnostics_store, LogSource::HID, format!("Global gain write failed: {error}"));
        return Err(error);
    }
    if let Err(error) = commit_changes(&app, &connected.path) {
        diagnostics::log_error(&app, &diagnostics_store, LogSource::HID, format!("Commit changes failed: {error}"));
        return Err(error);
    }

    // 3. Verify write
    if !settings.skip_push_verification {
        diagnostics::log_info(&app, &diagnostics_store, LogSource::HID, "Verifying pushed settings...");
        
        // Wait a brief moment for hardware flash to settle before reading back
        sleep_ms(100);

        match pull_once(&app, &connected, caps.num_bands) {
            Ok(actual) => {
                if let Err(mismatch) = compare_peq(&actual, &peq) {
                    let err_msg = format!("Push verification failed: {mismatch}");
                    diagnostics::log_error(&app, &diagnostics_store, LogSource::HID, &err_msg);

                    // Execute rollback if backup is available
                    if let Some(backup) = backup_state {
                        diagnostics::log_warn(&app, &diagnostics_store, LogSource::HID, "Initiating rollback to previous state...");
                        if let Err(rollback_error) = rollback_state(&app, &connected, &backup, caps) {
                            diagnostics::log_error(
                                &app,
                                &diagnostics_store,
                                LogSource::HID,
                                format!("Rollback failed: {rollback_error}"),
                            );
                        } else {
                            diagnostics::log_info(&app, &diagnostics_store, LogSource::HID, "Rollback successfully written. Verifying rollback...");
                            sleep_ms(100);
                            match pull_once(&app, &connected, caps.num_bands) {
                                Ok(rolled_back_state) => {
                                    if let Err(rollback_mismatch) = compare_peq(&rolled_back_state, &backup) {
                                        diagnostics::log_error(
                                            &app,
                                            &diagnostics_store,
                                            LogSource::HID,
                                            format!("Rollback verification failed: {rollback_mismatch}"),
                                        );
                                    } else {
                                        diagnostics::log_info(&app, &diagnostics_store, LogSource::HID, "Rollback verified successfully.");
                                    }
                                }
                                Err(rollback_read_error) => {
                                    diagnostics::log_error(
                                        &app,
                                        &diagnostics_store,
                                        LogSource::HID,
                                        format!("Failed to read state after rollback: {rollback_read_error}"),
                                    );
                                }
                            }
                        }
                    }

                    return Err(err_msg);
                } else {
                    diagnostics::log_info(&app, &diagnostics_store, LogSource::HID, "Verification successful: Pushed settings match device state.");
                }
            }
            Err(read_error) => {
                let err_msg = format!("Failed to read back settings for verification: {read_error}");
                diagnostics::log_error(&app, &diagnostics_store, LogSource::HID, &err_msg);
                return Err(err_msg);
            }
        }
    }

    diagnostics::log_info(&app, &diagnostics_store, LogSource::HID, "Push successful");
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
    diagnostics_store: tauri::State<'_, Mutex<DiagnosticsStore>>,
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
    if let Err(error) = hid.open(&path) {
        let msg = format!("Failed to open {}: {error}", profile.name);
        diagnostics::log_error(&app, &diagnostics_store, LogSource::UI, &msg);
        return Err(msg);
    }

    state
        .lock()
        .map_err(|_| "Device state lock poisoned".to_string())?
        .connected = Some(ConnectedDevice {
        path: path.clone(),
        vendor_id: device.vendor_id,
        product_id: device.product_id,
        profile_name: profile.name.to_string(),
    });

    diagnostics::log_info(
        &app,
        &diagnostics_store,
        LogSource::UI,
        format!("Connected to supported DAC: {} ({})", profile.name, path),
    );
    Ok(())
}

#[tauri::command]
pub fn disconnect_device(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    diagnostics_store: tauri::State<'_, Mutex<DiagnosticsStore>>,
) -> Result<(), String> {
    if let Some(device) = state
        .lock()
        .map_err(|_| "Device state lock poisoned".to_string())?
        .connected
        .take()
    {
        if let Err(error) = app.hid().close(&device.path) {
            let msg = format!("Failed to close {}: {error}", device.profile_name);
            diagnostics::log_error(&app, &diagnostics_store, LogSource::UI, &msg);
            return Err(msg);
        }
        diagnostics::log_info(
            &app,
            &diagnostics_store,
            LogSource::UI,
            format!("Disconnected from device: {}", device.profile_name),
        );
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
