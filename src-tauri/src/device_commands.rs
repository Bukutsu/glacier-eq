// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::diagnostics::{self, DiagnosticsStore, LogLevel, LogSource};
use crate::state::{ConnectedDevice, DeviceState};
use glacier_core::device::walkplay::{
    CMD_AMP_MODE, CMD_BALANCE, CMD_FILTER_MODE, CMD_GAIN_MODE, CMD_MIC_VOLUME,
};
use glacier_core::device::{
    get_supported_device, DeviceCapabilities, DeviceInfo, DeviceProfile, DeviceProtocol,
    EqProtocol, Packet, WalkplayProtocol,
};
use glacier_core::eq::{Filter, PEQData};
use std::collections::HashSet;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::Manager;

#[cfg(target_os = "linux")]
use crate::hid_helper::ElevatedTransport;

const READ_POST_VERSION_MS: u64 = 50;
const READ_INTER_FILTER_MS: u64 = 35;
const READ_POST_FILTER_MS: u64 = 50;
const READ_POST_GLOBAL_GAIN_MS: u64 = 25;
const READ_WAKE_DELAY_MS: u64 = 50;
const READ_PULL_RETRY_DELAY_MS: u64 = 100;

const INIT_DRAIN_ATTEMPTS: usize = 100;
const FILTER_READ_ATTEMPTS: usize = 60;
const MAX_FILTER_MISMATCHES: usize = 8;
const GLOBAL_GAIN_READ_ATTEMPTS: usize = 20;
const WRITE_ATTEMPTS: usize = 3;

#[derive(Clone, serde::Serialize)]
struct OperationProgress {
    message: String,
    percentage: f32,
}

#[derive(Clone, serde::Serialize)]
pub struct SupportedDeviceInfo {
    name: &'static str,
    protocol: &'static str,
    vendor_id: u16,
    product_id: Option<u16>,
    status: &'static str,
    family: &'static str,
    num_bands: usize,
    supports_ram_apply: bool,
}

fn supports_walkplay_utilities(connected: &ConnectedDevice) -> bool {
    get_supported_device(connected.vendor_id, connected.product_id)
        .is_some_and(|profile| profile.protocol == DeviceProtocol::Walkplay)
}

fn registered_profile(connected: &ConnectedDevice) -> Result<&'static DeviceProfile, String> {
    get_supported_device(connected.vendor_id, connected.product_id).ok_or_else(|| {
        format!(
            "No profile registered for {:04X}:{:04X}",
            connected.vendor_id, connected.product_id
        )
    })
}

fn lock_device_state<'a, 'r>(
    state: &'a tauri::State<'r, Mutex<DeviceState>>,
) -> Result<MutexGuard<'a, DeviceState>, String> {
    state.lock().map_err(|_| "Lock poisoned".to_string())
}

fn emit_progress(app: &tauri::AppHandle, message: &str, percentage: f32) {
    use tauri::Emitter;
    let _ = app.emit(
        "operation-progress",
        OperationProgress {
            message: message.to_string(),
            percentage,
        },
    );
}

// ── HID backend wrappers ──────────────────────────────────────────────
// Try direct access first; transparently fall back to pkexec-elevated
// helper on PermissionDenied (Linux only).

fn handle_disconnection(app: &tauri::AppHandle, error_msg: &str) {
    let lower = error_msg.to_lowercase();
    if lower.contains("no such device")
        || lower.contains("device not found")
        || lower.contains("disconnected")
        || lower.contains("not open")
        || lower.contains("io error")
        || lower.contains("os error 19")
        || lower.contains("os error 5")
        || lower.contains("transfer failed")
        || lower.contains("no longer exists")
    {
        let state = app.state::<Mutex<DeviceState>>();
        let mut device_to_close = None;
        if let Ok(mut guard) = state.lock() {
            if let Some(device) = guard.connected.take() {
                device_to_close = Some(device);
            }
        }
        if let Some(device) = device_to_close {
            let _ = hid_close(app, &device.path);

            #[cfg(target_os = "linux")]
            {
                if let Some(elevated_state) = app.try_state::<Mutex<Option<ElevatedTransport>>>() {
                    if let Ok(mut guard) = elevated_state.lock() {
                        *guard = None; // Reset the elevated transport helper
                    }
                }
            }

            if let Some(diagnostics_store) = app.try_state::<Mutex<DiagnosticsStore>>() {
                diagnostics::log(
                    LogLevel::Error,
                    app,
                    &diagnostics_store,
                    LogSource::HID,
                    format!(
                        "Connection lost to device (unplugged): {}",
                        device.profile_name
                    ),
                );
            }
            use tauri::Emitter;
            let _ = app.emit("device-disconnected", device.profile_name);
        }
    }
}

fn ensure_device_not_disconnected(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(state) = app.try_state::<Mutex<DeviceState>>() {
        if state
            .lock()
            .map(|guard| guard.connected.is_none())
            .unwrap_or(false)
        {
            return Err("Device disconnected".to_string());
        }
    }
    Ok(())
}

fn hid_read(app: &tauri::AppHandle, path: &str, timeout: i32) -> Result<Vec<u8>, String> {
    ensure_device_not_disconnected(app)?;
    let res = {
        #[cfg(target_os = "linux")]
        {
            if let Some(t) = app
                .state::<Mutex<Option<ElevatedTransport>>>()
                .lock()
                .unwrap()
                .as_mut()
            {
                t.read(path, timeout)
            } else {
                tauri_plugin_hid::hid(app)
                    .read(path, timeout)
                    .map_err(|e| e.to_string())
            }
        }
        #[cfg(not(target_os = "linux"))]
        {
            tauri_plugin_hid::hid(app)
                .read(path, timeout)
                .map_err(|e| e.to_string())
        }
    };
    if let Err(ref error_msg) = res {
        handle_disconnection(app, error_msg);
    }
    res
}

fn hid_write(app: &tauri::AppHandle, path: &str, data: &[u8]) -> Result<(), String> {
    ensure_device_not_disconnected(app)?;
    let res = {
        #[cfg(target_os = "linux")]
        {
            if let Some(t) = app
                .state::<Mutex<Option<ElevatedTransport>>>()
                .lock()
                .unwrap()
                .as_mut()
            {
                t.write(path, data)
            } else {
                tauri_plugin_hid::hid(app)
                    .write(path, data)
                    .map_err(|e| e.to_string())
            }
        }
        #[cfg(not(target_os = "linux"))]
        {
            tauri_plugin_hid::hid(app)
                .write(path, data)
                .map_err(|e| e.to_string())
        }
    };
    if let Err(ref error_msg) = res {
        handle_disconnection(app, error_msg);
    }
    res
}

fn hid_close(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if let Some(t) = app
        .state::<Mutex<Option<ElevatedTransport>>>()
        .lock()
        .unwrap()
        .as_mut()
    {
        return t.close(path);
    }
    tauri_plugin_hid::hid(app)
        .close(path)
        .map_err(|e| e.to_string())
}

fn try_open_device(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    match tauri_plugin_hid::hid(app).open(path) {
        Ok(()) => return Ok(()),
        Err(e) => {
            let msg = e.to_string();
            // hidapi returns "Permission denied" on EACCES
            if !msg.to_lowercase().contains("permission denied") {
                return Err(msg);
            }
        }
    }
    // PermissionDenied – try elevated fallback
    #[cfg(target_os = "linux")]
    {
        let state = app.state::<Mutex<Option<ElevatedTransport>>>();
        let mut guard = state.lock().map_err(|_| "state poisoned")?;
        if let Some(ref mut t) = *guard {
            // Reuse existing elevated transport (reconnect flow)
            return t.open(path);
        }
        let mut transport = ElevatedTransport::spawn()?;
        transport.open(path)?;
        guard.replace(transport);
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    Err("USB permission denied and elevation is not supported on this platform".into())
}

#[tauri::command]
pub async fn get_eq_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    diagnostics_store: tauri::State<'_, Mutex<DiagnosticsStore>>,
) -> Result<PEQData, String> {
    let connected = connected_device(&state)?;
    let profile = registered_profile(&connected)?;
    let caps = &profile.caps;

    diagnostics::log(
        LogLevel::Info,
        &app,
        &diagnostics_store,
        LogSource::HID,
        "Reading from device...",
    );
    if let Err(error) = send_packet(
        &app,
        &connected.path,
        &profile.protocol.read_global_gain_request(),
    ) {
        log::warn!("Pull wake request failed: {error}");
    }
    sleep_ms(READ_WAKE_DELAY_MS);

    let first = pull_once(&app, &connected, profile.protocol, caps);
    let is_connected = state
        .lock()
        .map(|guard| guard.connected.is_some())
        .unwrap_or(false);
    let should_retry = is_connected
        && match &first {
            Ok(peq) => profile.protocol.is_default_state(peq),
            Err(_) => true,
        };

    let peq = if should_retry {
        sleep_ms(READ_PULL_RETRY_DELAY_MS);
        match pull_once(&app, &connected, profile.protocol, caps) {
            Ok(peq) => peq,
            Err(retry_error) => match first {
                Ok(defaultish) => defaultish,
                Err(_) => {
                    diagnostics::log(
                        LogLevel::Error,
                        &app,
                        &diagnostics_store,
                        LogSource::HID,
                        format!("Pull failed: {retry_error}"),
                    );
                    return Err(retry_error);
                }
            },
        }
    } else {
        match first {
            Ok(peq) => peq,
            Err(error) => {
                diagnostics::log(
                    LogLevel::Error,
                    &app,
                    &diagnostics_store,
                    LogSource::HID,
                    format!("Pull failed: {error}"),
                );
                return Err(error);
            }
        }
    };

    diagnostics::log(
        LogLevel::Info,
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

fn compare_peq(
    actual: &PEQData,
    expected: &PEQData,
    caps: &DeviceCapabilities,
) -> Result<(), String> {
    if (actual.global_gain - expected.global_gain).abs() > 0.001 {
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

    for (a, e) in actual.filters.iter().zip(expected.filters.iter()) {
        if (a.gain - e.gain).abs() > caps.gain_tolerance {
            return Err(format!(
                "Band {} gain mismatch: expected {:.2}, got {:.2}",
                e.index + 1,
                e.gain,
                a.gain
            ));
        }
        if (a.freq as i32 - e.freq as i32).abs() > caps.freq_tolerance {
            return Err(format!(
                "Band {} frequency mismatch: expected {}, got {}",
                e.index + 1,
                e.freq,
                a.freq
            ));
        }
        if (a.q - e.q).abs() > caps.q_tolerance {
            return Err(format!(
                "Band {} Q mismatch: expected {:.2}, got {:.2}",
                e.index + 1,
                e.q,
                a.q
            ));
        }
        if a.filter_type != e.filter_type {
            return Err(format!(
                "Band {} filter type mismatch: expected {:?}, got {:?}",
                e.index + 1,
                e.filter_type,
                a.filter_type
            ));
        }
    }

    Ok(())
}

fn rollback_state(
    app: &tauri::AppHandle,
    connected: &ConnectedDevice,
    protocol: DeviceProtocol,
    peq: &PEQData,
    caps: &DeviceCapabilities,
) -> Result<(), String> {
    run_init_sequence(app, &connected.path, protocol)?;
    write_filters(app, &connected.path, protocol, peq, caps.dsp_sample_rate)?;
    write_global_gain(app, &connected.path, protocol, peq.global_gain)?;
    commit_changes(app, &connected.path, protocol)?;
    Ok(())
}

fn write_eq_to_ram(
    app: &tauri::AppHandle,
    connected: &ConnectedDevice,
    protocol: DeviceProtocol,
    peq: &PEQData,
    caps: &DeviceCapabilities,
) -> Result<(), String> {
    emit_progress(app, "Initializing push connection...", 10.0);
    run_init_sequence(app, &connected.path, protocol)?;
    write_filters(app, &connected.path, protocol, peq, caps.dsp_sample_rate)?;
    emit_progress(app, "Writing preamp...", 75.0);
    write_global_gain(app, &connected.path, protocol, peq.global_gain)
}

#[tauri::command]
pub async fn set_eq_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    diagnostics_store: tauri::State<'_, Mutex<DiagnosticsStore>>,
    peq: PEQData,
) -> Result<(), String> {
    let (connected, profile, peq) = connected_profile_and_peq(&state, peq)?;
    let caps = &profile.caps;
    let settings = crate::settings::get_settings(app.clone()).unwrap_or_default();

    // 1. Snapshot current state before writing
    let backup_state = if !settings.skip_push_verification {
        diagnostics::log(
            LogLevel::Info,
            &app,
            &diagnostics_store,
            LogSource::HID,
            "Snapshotting current device state...",
        );
        match pull_once(&app, &connected, profile.protocol, caps) {
            Ok(backup) => Some(backup),
            Err(error) => {
                diagnostics::log(
                    LogLevel::Warn,
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
    diagnostics::log(
        LogLevel::Info,
        &app,
        &diagnostics_store,
        LogSource::HID,
        format!("Pushing EQ to {}...", connected.profile_name),
    );

    if let Err(error) = write_eq_to_ram(&app, &connected, profile.protocol, &peq, caps) {
        diagnostics::log(
            LogLevel::Error,
            &app,
            &diagnostics_store,
            LogSource::HID,
            format!("RAM write failed: {error}"),
        );
        return Err(error);
    }
    emit_progress(&app, "Committing changes to device...", 80.0);
    if let Err(error) = commit_changes(&app, &connected.path, profile.protocol) {
        diagnostics::log(
            LogLevel::Error,
            &app,
            &diagnostics_store,
            LogSource::HID,
            format!("Commit changes failed: {error}"),
        );
        return Err(error);
    }

    // 3. Verify write
    if !settings.skip_push_verification {
        diagnostics::log(
            LogLevel::Info,
            &app,
            &diagnostics_store,
            LogSource::HID,
            "Verifying pushed settings...",
        );
        emit_progress(&app, "Verifying changes...", 90.0);
        sleep_ms(READ_PULL_RETRY_DELAY_MS);

        match pull_once(&app, &connected, profile.protocol, caps) {
            Ok(actual) => {
                if let Err(mismatch) = compare_peq(&actual, &peq, caps) {
                    let err_msg = format!("Push verification failed: {mismatch}");
                    diagnostics::log(
                        LogLevel::Error,
                        &app,
                        &diagnostics_store,
                        LogSource::HID,
                        &err_msg,
                    );

                    // Execute rollback if backup is available
                    if let Some(backup) = backup_state {
                        diagnostics::log(
                            LogLevel::Warn,
                            &app,
                            &diagnostics_store,
                            LogSource::HID,
                            "Initiating rollback to previous state...",
                        );
                        if let Err(rollback_error) =
                            rollback_state(&app, &connected, profile.protocol, &backup, caps)
                        {
                            diagnostics::log(
                                LogLevel::Error,
                                &app,
                                &diagnostics_store,
                                LogSource::HID,
                                format!("Rollback failed: {rollback_error}"),
                            );
                        } else {
                            diagnostics::log(
                                LogLevel::Info,
                                &app,
                                &diagnostics_store,
                                LogSource::HID,
                                "Rollback successfully written. Verifying rollback...",
                            );
                            sleep_ms(READ_PULL_RETRY_DELAY_MS);
                            match pull_once(&app, &connected, profile.protocol, caps) {
                                Ok(rolled_back_state) => {
                                    if let Err(rollback_mismatch) =
                                        compare_peq(&rolled_back_state, &backup, caps)
                                    {
                                        diagnostics::log(
                                            LogLevel::Error,
                                            &app,
                                            &diagnostics_store,
                                            LogSource::HID,
                                            format!(
                                                "Rollback verification failed: {rollback_mismatch}"
                                            ),
                                        );
                                    } else {
                                        diagnostics::log(
                                            LogLevel::Info,
                                            &app,
                                            &diagnostics_store,
                                            LogSource::HID,
                                            "Rollback verified successfully.",
                                        );
                                    }
                                }
                                Err(rollback_read_error) => {
                                    diagnostics::log(
                                        LogLevel::Error,
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
                    diagnostics::log(
                        LogLevel::Info,
                        &app,
                        &diagnostics_store,
                        LogSource::HID,
                        "Verification successful: Pushed settings match device state.",
                    );
                }
            }
            Err(read_error) => {
                let err_msg =
                    format!("Failed to read back settings for verification: {read_error}");
                diagnostics::log(
                    LogLevel::Error,
                    &app,
                    &diagnostics_store,
                    LogSource::HID,
                    &err_msg,
                );
                return Err(err_msg);
            }
        }
    }

    diagnostics::log(
        LogLevel::Info,
        &app,
        &diagnostics_store,
        LogSource::HID,
        "Push successful",
    );
    emit_progress(&app, "Push successful", 100.0);
    Ok(())
}

#[tauri::command]
pub async fn apply_eq_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    diagnostics_store: tauri::State<'_, Mutex<DiagnosticsStore>>,
    peq: PEQData,
) -> Result<(), String> {
    let (connected, profile, peq) = connected_profile_and_peq(&state, peq)?;
    if !profile.caps.supports_ram_apply {
        return Err(format!(
            "{} does not advertise volatile RAM apply support.",
            profile.name
        ));
    }
    let caps = &profile.caps;

    diagnostics::log(
        LogLevel::Info,
        &app,
        &diagnostics_store,
        LogSource::HID,
        format!("Applying EQ to {} RAM...", connected.profile_name),
    );
    write_eq_to_ram(&app, &connected, profile.protocol, &peq, caps)?;
    apply_ram_changes(&app, &connected.path, profile.protocol)?;
    diagnostics::log(
        LogLevel::Info,
        &app,
        &diagnostics_store,
        LogSource::HID,
        "RAM apply successful",
    );
    emit_progress(&app, "Apply successful", 100.0);
    Ok(())
}

#[tauri::command]
pub async fn list_devices(app: tauri::AppHandle) -> Result<Vec<DeviceInfo>, String> {
    let hid = tauri_plugin_hid::hid(&app);
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
                num_bands: profile.caps.num_bands,
                supports_ram_apply: profile.caps.supports_ram_apply,
            })
        })
        .collect();

    Ok(compatible)
}

#[tauri::command]
pub fn list_supported_devices() -> Vec<SupportedDeviceInfo> {
    glacier_core::device::SUPPORTED_DEVICES
        .iter()
        .map(|device| SupportedDeviceInfo {
            name: device.name,
            protocol: device.protocol.name(),
            vendor_id: device.vendor_id,
            product_id: device.product_id,
            status: device.status,
            family: device.family,
            num_bands: device.caps.num_bands,
            supports_ram_apply: device.caps.supports_ram_apply,
        })
        .collect()
}

#[tauri::command]
pub async fn connect_device(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    diagnostics_store: tauri::State<'_, Mutex<DiagnosticsStore>>,
    path: String,
) -> Result<(), String> {
    let hid = tauri_plugin_hid::hid(&app);
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
    if let Err(error) = try_open_device(&app, &path) {
        let msg = format!("Failed to open {}: {error}", profile.name);
        diagnostics::log(
            LogLevel::Error,
            &app,
            &diagnostics_store,
            LogSource::UI,
            &msg,
        );
        return Err(msg);
    }

    lock_device_state(&state)?.connected = Some(ConnectedDevice {
        path: path.clone(),
        vendor_id: device.vendor_id,
        product_id: device.product_id,
        profile_name: profile.name.to_string(),
    });

    diagnostics::log(
        LogLevel::Info,
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
    if let Some(device) = lock_device_state(&state)?.connected.take() {
        if let Err(error) = hid_close(&app, &device.path) {
            let msg = format!("Failed to close {}: {error}", device.profile_name);
            diagnostics::log(
                LogLevel::Error,
                &app,
                &diagnostics_store,
                LogSource::UI,
                &msg,
            );
            return Err(msg);
        }
        diagnostics::log(
            LogLevel::Info,
            &app,
            &diagnostics_store,
            LogSource::UI,
            format!("Disconnected from device: {}", device.profile_name),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn get_firmware_version(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<Option<String>, String> {
    let connected = connected_device(&state)?;
    let profile = registered_profile(&connected)?;

    if profile.protocol != DeviceProtocol::Walkplay {
        return Ok(None);
    }

    send_packet(
        &app,
        &connected.path,
        &Packet::new(
            WalkplayProtocol::report_id(),
            vec![
                glacier_core::device::walkplay::READ,
                glacier_core::device::walkplay::CMD_VERSION,
                glacier_core::device::walkplay::END,
            ],
        ),
    )?;
    sleep_ms(READ_POST_VERSION_MS);

    let data = read_matching_packet(
        &app,
        &connected.path,
        profile.protocol,
        "Firmware version",
        20,
        |data| {
            data.len() >= 10
                && data[0] == glacier_core::device::walkplay::READ
                && data[1] == glacier_core::device::walkplay::CMD_VERSION
        },
    )?;

    let version = parse_walkplay_firmware_version(&data);

    Ok((!version.is_empty()).then_some(version))
}

fn parse_walkplay_firmware_version(data: &[u8]) -> String {
    data.iter()
        .skip(3)
        .take(7)
        .take_while(|byte| byte.is_ascii_graphic())
        .map(|byte| *byte as char)
        .collect()
}

fn connected_device(
    state: &tauri::State<'_, Mutex<DeviceState>>,
) -> Result<ConnectedDevice, String> {
    lock_device_state(state)?
        .connected
        .clone()
        .ok_or_else(|| "No supported DAC connected. Connect a device first.".to_string())
}

fn close_previous_device(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, Mutex<DeviceState>>,
) -> Result<(), String> {
    if let Some(previous) = lock_device_state(state)?.connected.take() {
        let _ = hid_close(app, &previous.path);
    }
    Ok(())
}

fn pull_once(
    app: &tauri::AppHandle,
    connected: &ConnectedDevice,
    protocol: DeviceProtocol,
    caps: &DeviceCapabilities,
) -> Result<PEQData, String> {
    emit_progress(app, "Initializing read connection...", 5.0);
    run_init_sequence(app, &connected.path, protocol)?;

    let mut filters = Vec::with_capacity(caps.num_bands);
    for index in 0..caps.num_bands {
        let pct = 10.0 + (index as f32 / caps.num_bands as f32) * 75.0;
        emit_progress(
            app,
            &format!("Reading band {}/{}...", index + 1, caps.num_bands),
            pct,
        );
        filters.push(read_filter(app, connected, protocol, index as u8)?);
        sleep_ms(READ_INTER_FILTER_MS);
    }

    sleep_ms(READ_POST_FILTER_MS);
    emit_progress(app, "Reading device preamp...", 90.0);
    let global_gain = read_global_gain(app, &connected.path, protocol)?;

    emit_progress(app, "Read successful", 100.0);
    Ok(PEQData {
        filters,
        global_gain,
    })
}

fn read_filter(
    app: &tauri::AppHandle,
    connected: &ConnectedDevice,
    protocol: DeviceProtocol,
    index: u8,
) -> Result<glacier_core::eq::Filter, String> {
    let nonce = index.wrapping_add(1).max(1);
    let diagnostics_store = app.state::<Mutex<DiagnosticsStore>>();

    diagnostics::log(
        LogLevel::Info,
        app,
        &diagnostics_store,
        LogSource::HID,
        format!("--- Read Filter {} (nonce {}) ---", index + 1, nonce),
    );

    send_packet(
        app,
        &connected.path,
        &protocol.read_filter_request(index, nonce),
    )?;

    let data = read_matching_packet(
        app,
        &connected.path,
        protocol,
        "Filter",
        FILTER_READ_ATTEMPTS,
        |data| protocol.matches_filter_response(data, index, nonce),
    )
    .map_err(|_| {
        format!(
            "Failed to read filter {} from {}",
            index + 1,
            connected.profile_name
        )
    })?;

    protocol
        .parse_filter_response(&data)
        .ok_or_else(|| format!("Filter {} response could not be parsed", index + 1))
}

fn read_global_gain(
    app: &tauri::AppHandle,
    path: &str,
    protocol: DeviceProtocol,
) -> Result<f64, String> {
    let diagnostics_store = app.state::<Mutex<DiagnosticsStore>>();
    diagnostics::log(
        LogLevel::Info,
        app,
        &diagnostics_store,
        LogSource::HID,
        "--- Read Global Gain ---",
    );

    send_packet(app, path, &protocol.read_global_gain_request())?;
    sleep_ms(READ_POST_GLOBAL_GAIN_MS);

    let data = read_matching_packet(
        app,
        path,
        protocol,
        "Global gain",
        GLOBAL_GAIN_READ_ATTEMPTS,
        |data| protocol.matches_global_gain_response(data),
    )?;
    protocol
        .parse_global_gain_response(&data)
        .ok_or_else(|| "Global gain response could not be parsed".to_string())
}

fn read_matching_packet(
    app: &tauri::AppHandle,
    path: &str,
    protocol: DeviceProtocol,
    label: &str,
    attempts: usize,
    matches: impl Fn(&[u8]) -> bool,
) -> Result<Vec<u8>, String> {
    let diagnostics_store = app.state::<Mutex<DiagnosticsStore>>();
    let mut mismatches = 0usize;
    for attempt in 1..=attempts {
        let bytes = hid_read(app, path, 60)
            .map_err(|error| format!("{label} read failed on attempt {attempt}: {error}"))?;
        if bytes.is_empty() {
            if attempt == 1 || attempt % 20 == 0 || attempt == attempts {
                diagnostics::log(
                    LogLevel::Info,
                    app,
                    &diagnostics_store,
                    LogSource::HID,
                    format!("{label} read attempt {attempt}/{attempts}: timed out (empty)"),
                );
            }
            continue;
        }

        diagnostics::log(
            LogLevel::Info,
            app,
            &diagnostics_store,
            LogSource::HID,
            format!(
                "{label} read attempt {attempt}/{attempts}: got raw packet (len {}): {:02X?}",
                bytes.len(),
                bytes
            ),
        );

        let data = match protocol.unframe_packet(&bytes) {
            Ok(data) => data,
            Err(error) => {
                diagnostics::log(
                    LogLevel::Warn,
                    app,
                    &diagnostics_store,
                    LogSource::HID,
                    format!("{label} unframe failed: {error}"),
                );
                continue;
            }
        };
        let matched = matches(data);
        diagnostics::log(
            LogLevel::Info,
            app,
            &diagnostics_store,
            LogSource::HID,
            format!("{label} response matching: matches={matched}"),
        );
        if matched {
            return Ok(data.to_vec());
        }

        mismatches += 1;
        diagnostics::log(
            LogLevel::Warn,
            app,
            &diagnostics_store,
            LogSource::HID,
            format!("{label} response mismatch count: {mismatches} (max {MAX_FILTER_MISMATCHES})"),
        );
        if mismatches > MAX_FILTER_MISMATCHES {
            break;
        }
    }
    Err(format!("{label} read timeout"))
}

fn run_init_sequence(
    app: &tauri::AppHandle,
    path: &str,
    protocol: DeviceProtocol,
) -> Result<(), String> {
    for packet in protocol.init_packets() {
        send_packet(app, path, &packet).map_err(|error| format!("Init write failed: {error}"))?;
    }
    sleep_ms(READ_POST_VERSION_MS);
    drain_stale_frames(app, path);
    Ok(())
}

fn write_filters(
    app: &tauri::AppHandle,
    path: &str,
    protocol: DeviceProtocol,
    peq: &PEQData,
    dsp_sample_rate: f64,
) -> Result<(), String> {
    let total = peq.filters.len();
    for (index, filter) in peq.filters.iter().enumerate() {
        let pct = 15.0 + (index as f32 / total as f32) * 60.0;
        emit_progress(
            app,
            &format!("Writing band {}/{}...", index + 1, total),
            pct,
        );
        for packet in protocol
            .write_filter_packets(index as u8, filter, dsp_sample_rate, peq.global_gain)
            .map_err(|error| format!("Band {} write failed: {error}", index + 1))?
        {
            send_packet(app, path, &packet)
                .map_err(|error| format!("Band {} write failed: {error}", index + 1))?;
        }
        sleep_ms(protocol.write_timing().per_filter_ms);
    }
    Ok(())
}

fn write_global_gain(
    app: &tauri::AppHandle,
    path: &str,
    protocol: DeviceProtocol,
    global_gain: f64,
) -> Result<(), String> {
    sleep_ms(protocol.write_timing().batch_ms);
    for packet in protocol.write_global_gain_packets(global_gain) {
        send_packet(app, path, &packet)
            .map_err(|error| format!("Global gain write failed: {error}"))?;
    }
    sleep_ms(protocol.write_timing().global_gain_ms);
    Ok(())
}

fn commit_changes(
    app: &tauri::AppHandle,
    path: &str,
    protocol: DeviceProtocol,
) -> Result<(), String> {
    for packet in protocol.commit_packets() {
        send_packet(app, path, &packet).map_err(|error| format!("Commit write failed: {error}"))?;
        sleep_ms(protocol.write_timing().commit_step_ms);
    }
    Ok(())
}

fn apply_ram_changes(
    app: &tauri::AppHandle,
    path: &str,
    protocol: DeviceProtocol,
) -> Result<(), String> {
    for packet in protocol.ram_apply_packets() {
        send_packet(app, path, &packet)
            .map_err(|error| format!("RAM apply write failed: {error}"))?;
        sleep_ms(protocol.write_timing().commit_step_ms);
    }
    Ok(())
}

fn send_packet(app: &tauri::AppHandle, path: &str, packet: &Packet) -> Result<(), String> {
    let framed = packet.framed();
    let diagnostics_store = app.state::<Mutex<DiagnosticsStore>>();
    diagnostics::log(
        LogLevel::Info,
        app,
        &diagnostics_store,
        LogSource::HID,
        format!("Writing packet (len {}): {:02X?}", framed.len(), framed),
    );
    let mut last_error = None;
    for attempt in 1..=WRITE_ATTEMPTS {
        if let Some(state) = app.try_state::<Mutex<DeviceState>>() {
            if let Ok(guard) = state.lock() {
                if guard.connected.is_none() && attempt > 1 {
                    break;
                }
            }
        }
        match hid_write(app, path, &framed) {
            Ok(()) => return Ok(()),
            Err(error) => {
                diagnostics::log(
                    LogLevel::Warn,
                    app,
                    &diagnostics_store,
                    LogSource::HID,
                    format!("Write attempt {attempt}/{WRITE_ATTEMPTS} failed: {error}"),
                );
                last_error = Some(error);
                sleep_ms(50);
            }
        }
    }

    let err_msg = last_error.unwrap_or_else(|| "Write failed".to_string());
    diagnostics::log(
        LogLevel::Error,
        app,
        &diagnostics_store,
        LogSource::HID,
        format!("Write failed: {}", err_msg),
    );
    Err(err_msg)
}

fn drain_stale_frames(app: &tauri::AppHandle, path: &str) {
    for _ in 0..INIT_DRAIN_ATTEMPTS {
        match hid_read(app, path, 20) {
            Ok(bytes) if bytes.is_empty() => break,
            Ok(_) => continue,
            Err(_) => break,
        }
    }
}

fn sleep_ms(ms: u64) {
    std::thread::sleep(Duration::from_millis(ms));
}

fn connected_profile_and_peq(
    state: &tauri::State<'_, Mutex<DeviceState>>,
    peq: PEQData,
) -> Result<(ConnectedDevice, &'static DeviceProfile, PEQData), String> {
    let connected = connected_device(state)?;
    let profile = registered_profile(&connected)?;
    let peq =
        glacier_core::profile_match::normalize_for_match(peq, &profile.caps, profile.protocol);
    Ok((connected, profile, peq))
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DacUtilityState {
    pub supported: bool,
    pub filter_mode: String,
    pub amp_mode_class_ab: bool,
    pub high_gain_mode: bool,
    pub mic_volume_db: i8,
    pub channel_balance: i8,
}

impl Default for DacUtilityState {
    fn default() -> Self {
        Self {
            supported: false,
            filter_mode: "FAST-LL".to_string(),
            amp_mode_class_ab: false,
            high_gain_mode: false,
            mic_volume_db: 0,
            channel_balance: 0,
        }
    }
}

fn unsupported_utility_state() -> DacUtilityState {
    DacUtilityState::default()
}

fn read_utility_register(app: &tauri::AppHandle, path: &str, cmd: u8) -> Result<Vec<u8>, String> {
    send_packet(
        app,
        path,
        &Packet::new(
            WalkplayProtocol::report_id(),
            WalkplayProtocol::build_utility_read_request(cmd),
        ),
    )?;
    read_matching_packet(
        app,
        path,
        DeviceProtocol::Walkplay,
        "Utility register",
        10,
        |data| data.len() >= 4 && data[0] == 0x80 && data[1] == cmd,
    )
}

fn read_balance_register(app: &tauri::AppHandle, path: &str, channel: u8) -> Result<u8, String> {
    send_packet(
        app,
        path,
        &Packet::new(
            WalkplayProtocol::report_id(),
            WalkplayProtocol::build_balance_read_request(channel),
        ),
    )?;
    read_matching_packet(
        app,
        path,
        DeviceProtocol::Walkplay,
        "Balance register",
        10,
        |data| data.len() >= 6 && data[0] == 0x80 && data[1] == CMD_BALANCE && data[3] == channel,
    )
    .map(|data| data[5])
}

#[tauri::command]
pub async fn get_dac_utility_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<DacUtilityState, String> {
    let connected = lock_device_state(&state)?.connected.clone();

    let connected = match connected {
        Some(c) => c,
        None => return Ok(unsupported_utility_state()),
    };

    if !supports_walkplay_utilities(&connected) {
        return Ok(unsupported_utility_state());
    }

    drain_stale_frames(&app, &connected.path);

    let filter_val = match read_utility_register(&app, &connected.path, CMD_FILTER_MODE) {
        Ok(data) => data[3],
        Err(_) => 1,
    };
    let filter_mode = match filter_val {
        1 => "FAST-LL",
        2 => "FAST-PC",
        3 => "Slow-LL",
        4 => "Slow-PC",
        5 => "NON-OS",
        _ => "FAST-LL",
    }
    .to_string();

    let amp_val = match read_utility_register(&app, &connected.path, CMD_AMP_MODE) {
        Ok(data) => data[3],
        Err(_) => 0,
    };
    let amp_mode_class_ab = amp_val == 1;

    let gain_val = match read_utility_register(&app, &connected.path, CMD_GAIN_MODE) {
        Ok(data) => data[3],
        Err(_) => 0,
    };
    let high_gain_mode = gain_val == 1;

    let mic_val = match read_utility_register(&app, &connected.path, CMD_MIC_VOLUME) {
        Ok(data) => data[4] as i8,
        Err(_) => 0,
    };

    let left_att_raw = read_balance_register(&app, &connected.path, 0).unwrap_or(0);
    let right_att_raw = read_balance_register(&app, &connected.path, 1).unwrap_or(0);

    let left_att = if left_att_raw > 0 {
        256 - left_att_raw as u16
    } else {
        0
    };
    let right_att = if right_att_raw > 0 {
        256 - right_att_raw as u16
    } else {
        0
    };

    let channel_balance = if left_att > 0 {
        left_att as i8
    } else if right_att > 0 {
        -(right_att as i8)
    } else {
        0
    };

    Ok(DacUtilityState {
        supported: true,
        filter_mode,
        amp_mode_class_ab,
        high_gain_mode,
        mic_volume_db: mic_val,
        channel_balance,
    })
}

fn write_utility_packet(app: &tauri::AppHandle, path: &str, packet: Vec<u8>) -> Result<(), String> {
    send_packet(
        app,
        path,
        &Packet::new(WalkplayProtocol::report_id(), packet),
    )?;
    sleep_ms(50);
    flash_eq(app, path)
}

fn write_connected_utility_packet(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, Mutex<DeviceState>>,
    packet: Vec<u8>,
) -> Result<(), String> {
    let path = utility_connected_path(state)?;
    write_utility_packet(app, &path, packet)
}

fn flash_eq(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    send_packet(
        app,
        path,
        &Packet::new(
            WalkplayProtocol::report_id(),
            vec![
                glacier_core::device::walkplay::WRITE,
                glacier_core::device::walkplay::CMD_FLASH_EQ,
                0,
            ],
        ),
    )
}

fn utility_connected_path(state: &tauri::State<'_, Mutex<DeviceState>>) -> Result<String, String> {
    Ok(connected_device(state)?.path)
}

#[tauri::command]
pub async fn set_dac_filter_mode(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    mode: String,
) -> Result<(), String> {
    let r = match mode.as_str() {
        "FAST-LL" => 1,
        "FAST-PC" => 2,
        "Slow-LL" => 3,
        "Slow-PC" => 4,
        "NON-OS" => 5,
        _ => return Err("Invalid filter mode".to_string()),
    };
    write_connected_utility_packet(
        &app,
        &state,
        WalkplayProtocol::build_filter_mode_write_packet(r),
    )
}

#[tauri::command]
pub async fn set_dac_work_mode(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    is_class_ab: bool,
) -> Result<(), String> {
    write_connected_utility_packet(
        &app,
        &state,
        WalkplayProtocol::build_amp_mode_write_packet(is_class_ab),
    )
}

#[tauri::command]
pub async fn set_dac_output_gain(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    is_high_gain: bool,
) -> Result<(), String> {
    write_connected_utility_packet(
        &app,
        &state,
        WalkplayProtocol::build_gain_mode_write_packet(is_high_gain),
    )
}

#[tauri::command]
pub async fn set_dac_balance(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    balance: i8,
) -> Result<(), String> {
    let path = utility_connected_path(&state)?;
    let packets = WalkplayProtocol::build_balance_write_packets(balance);
    for packet in packets {
        send_packet(
            &app,
            &path,
            &Packet::new(WalkplayProtocol::report_id(), packet),
        )?;
        sleep_ms(20);
    }
    flash_eq(&app, &path)
}

#[tauri::command]
pub async fn set_mic_volume(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    volume_db: i8,
) -> Result<(), String> {
    write_connected_utility_packet(
        &app,
        &state,
        WalkplayProtocol::build_mic_volume_write_packet(volume_db),
    )
}

#[tauri::command]
pub async fn reset_device_eq(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<(), String> {
    let connected = connected_device(&state)?;
    let profile = registered_profile(&connected)?;
    let caps = &profile.caps;
    let peq = PEQData {
        filters: (0..caps.num_bands)
            .map(|index| Filter::enabled(index as u8, false))
            .collect(),
        global_gain: 0.0,
    };

    write_eq_to_ram(&app, &connected, profile.protocol, &peq, caps)?;
    commit_changes(&app, &connected.path, profile.protocol)
}

#[tauri::command]
pub async fn reset_device_controls(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<DacUtilityState, String> {
    let path = utility_connected_path(&state)?;

    for packet in [
        WalkplayProtocol::build_filter_mode_write_packet(1),
        WalkplayProtocol::build_amp_mode_write_packet(false),
        WalkplayProtocol::build_gain_mode_write_packet(false),
        WalkplayProtocol::build_mic_volume_write_packet(0),
    ] {
        write_utility_packet(&app, &path, packet)?;
    }
    for packet in WalkplayProtocol::build_balance_write_packets(0) {
        send_packet(
            &app,
            &path,
            &Packet::new(WalkplayProtocol::report_id(), packet),
        )?;
        sleep_ms(20);
    }
    flash_eq(&app, &path)?;

    get_dac_utility_state(app, state).await
}

#[tauri::command]
pub async fn execute_factory_reset(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<(), String> {
    write_connected_utility_packet(&app, &state, WalkplayProtocol::build_factory_reset_packet())
}

#[cfg(test)]
mod tests {
    use super::parse_walkplay_firmware_version;

    #[test]
    fn parses_walkplay_firmware_until_padding() {
        assert_eq!(
            parse_walkplay_firmware_version(&[0x80, 0x0C, 0x00, b'1', b'.', b'7', 0xFF, 0xDC]),
            "1.7"
        );
    }

    #[test]
    fn parses_empty_walkplay_firmware_as_empty() {
        assert_eq!(
            parse_walkplay_firmware_version(&[0x80, 0x0C, 0x00, 0x00]),
            ""
        );
    }
}
