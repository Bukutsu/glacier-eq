// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

use crate::diagnostics::{self, DiagnosticsStore, LogSource};
use crate::state::{ConnectedDevice, DeviceState};
use glacier_core::device::{
    get_device_profile, get_supported_device, DeviceCapabilities, DeviceInfo, DeviceProtocol,
};
use glacier_core::eq::PEQData;
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_hid::HidExt;

const INIT_DRAIN_ATTEMPTS: usize = 100;
const FILTER_READ_ATTEMPTS: usize = 60;
const MAX_FILTER_MISMATCHES: usize = 8;
const GLOBAL_GAIN_READ_ATTEMPTS: usize = 20;

#[tauri::command]
pub async fn get_eq_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    diagnostics_store: tauri::State<'_, Mutex<DiagnosticsStore>>,
) -> Result<PEQData, String> {
    let connected = connected_device(&state)?;
    let profile =
        get_device_profile(connected.vendor_id, connected.product_id).ok_or_else(|| {
            format!(
                "No profile registered for {:04X}:{:04X}",
                connected.vendor_id, connected.product_id
            )
        })?;
    let caps = profile.capabilities();
    let protocol = profile.protocol();

    diagnostics::log_info(
        &app,
        &diagnostics_store,
        LogSource::HID,
        "Reading from device...",
    );
    if let Err(error) = send_packet(
        &app,
        &connected.path,
        &protocol.build_global_gain_request(0),
        &*protocol,
    ) {
        log::warn!("Pull wake request failed: {error}");
    }
    sleep_ms(protocol.read_timing().wake_delay_ms);

    let first = pull_once(&app, &connected, &*protocol, &caps);
    let should_retry = match &first {
        Ok(peq) => protocol.is_default_state(peq),
        Err(_) => true,
    };

    let peq = if should_retry {
        sleep_ms(protocol.read_timing().pull_retry_delay_ms);
        match pull_once(&app, &connected, &*protocol, &caps) {
            Ok(peq) => peq,
            Err(retry_error) => match first {
                Ok(defaultish) => defaultish,
                Err(_) => {
                    diagnostics::log_error(
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
                diagnostics::log_error(
                    &app,
                    &diagnostics_store,
                    LogSource::HID,
                    format!("Pull failed: {error}"),
                );
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
    peq: &PEQData,
    protocol: &dyn DeviceProtocol,
    caps: &DeviceCapabilities,
) -> Result<(), String> {
    run_init_sequence(app, &connected.path, protocol)?;
    write_filters(app, &connected.path, protocol, peq, caps.dsp_sample_rate)?;
    write_global_gain(
        app,
        &connected.path,
        protocol,
        peq.global_gain.round() as i8,
    )?;
    commit_changes(app, &connected.path, protocol)?;
    Ok(())
}

#[tauri::command]
pub async fn set_eq_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    diagnostics_store: tauri::State<'_, Mutex<DiagnosticsStore>>,
    peq: PEQData,
) -> Result<(), String> {
    let connected = connected_device(&state)?;
    let profile =
        get_device_profile(connected.vendor_id, connected.product_id).ok_or_else(|| {
            format!(
                "No profile registered for {:04X}:{:04X}",
                connected.vendor_id, connected.product_id
            )
        })?;
    let caps = profile.capabilities();
    let protocol = profile.protocol();

    let peq = normalize_for_push(peq, &caps);
    let settings = crate::settings::get_settings(app.clone()).unwrap_or_default();

    // 1. Snapshot current state before writing
    let backup_state = if !settings.skip_push_verification {
        diagnostics::log_info(
            &app,
            &diagnostics_store,
            LogSource::HID,
            "Snapshotting current device state...",
        );
        match pull_once(&app, &connected, &*protocol, &caps) {
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

    if let Err(error) = run_init_sequence(&app, &connected.path, &*protocol) {
        diagnostics::log_error(
            &app,
            &diagnostics_store,
            LogSource::HID,
            format!("Init write failed: {error}"),
        );
        return Err(error);
    }
    if let Err(error) = write_filters(
        &app,
        &connected.path,
        &*protocol,
        &peq,
        caps.dsp_sample_rate,
    ) {
        diagnostics::log_error(
            &app,
            &diagnostics_store,
            LogSource::HID,
            format!("Filters write failed: {error}"),
        );
        return Err(error);
    }
    if let Err(error) = write_global_gain(&app, &connected.path, &*protocol, peq.global_gain as i8)
    {
        diagnostics::log_error(
            &app,
            &diagnostics_store,
            LogSource::HID,
            format!("Global gain write failed: {error}"),
        );
        return Err(error);
    }
    if let Err(error) = commit_changes(&app, &connected.path, &*protocol) {
        diagnostics::log_error(
            &app,
            &diagnostics_store,
            LogSource::HID,
            format!("Commit changes failed: {error}"),
        );
        return Err(error);
    }

    // 3. Verify write
    if !settings.skip_push_verification {
        diagnostics::log_info(
            &app,
            &diagnostics_store,
            LogSource::HID,
            "Verifying pushed settings...",
        );
        sleep_ms(protocol.read_timing().pull_retry_delay_ms);

        match pull_once(&app, &connected, &*protocol, &caps) {
            Ok(actual) => {
                if let Err(mismatch) = compare_peq(&actual, &peq, &caps) {
                    let err_msg = format!("Push verification failed: {mismatch}");
                    diagnostics::log_error(&app, &diagnostics_store, LogSource::HID, &err_msg);

                    // Execute rollback if backup is available
                    if let Some(backup) = backup_state {
                        diagnostics::log_warn(
                            &app,
                            &diagnostics_store,
                            LogSource::HID,
                            "Initiating rollback to previous state...",
                        );
                        if let Err(rollback_error) =
                            rollback_state(&app, &connected, &backup, &*protocol, &caps)
                        {
                            diagnostics::log_error(
                                &app,
                                &diagnostics_store,
                                LogSource::HID,
                                format!("Rollback failed: {rollback_error}"),
                            );
                        } else {
                            diagnostics::log_info(
                                &app,
                                &diagnostics_store,
                                LogSource::HID,
                                "Rollback successfully written. Verifying rollback...",
                            );
                            sleep_ms(protocol.read_timing().pull_retry_delay_ms);
                            match pull_once(&app, &connected, &*protocol, &caps) {
                                Ok(rolled_back_state) => {
                                    if let Err(rollback_mismatch) =
                                        compare_peq(&rolled_back_state, &backup, &caps)
                                    {
                                        diagnostics::log_error(
                                            &app,
                                            &diagnostics_store,
                                            LogSource::HID,
                                            format!(
                                                "Rollback verification failed: {rollback_mismatch}"
                                            ),
                                        );
                                    } else {
                                        diagnostics::log_info(
                                            &app,
                                            &diagnostics_store,
                                            LogSource::HID,
                                            "Rollback verified successfully.",
                                        );
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
                    diagnostics::log_info(
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
    protocol: &dyn DeviceProtocol,
    caps: &DeviceCapabilities,
) -> Result<PEQData, String> {
    run_init_sequence(app, &connected.path, protocol)?;

    let mut filters = Vec::with_capacity(caps.num_bands);
    for index in 0..caps.num_bands {
        filters.push(read_filter(app, connected, protocol, index as u8)?);
        sleep_ms(protocol.read_timing().inter_filter_ms);
    }

    sleep_ms(protocol.read_timing().post_filter_read_ms);
    let global_gain = read_global_gain(app, &connected.path, protocol)?;

    Ok(PEQData {
        filters,
        global_gain: global_gain as f64,
    })
}

fn read_filter(
    app: &tauri::AppHandle,
    connected: &ConnectedDevice,
    protocol: &dyn DeviceProtocol,
    index: u8,
) -> Result<glacier_core::eq::Filter, String> {
    let nonce = index.wrapping_add(1).max(1);
    let diagnostics_store = app.state::<Mutex<DiagnosticsStore>>();

    diagnostics::log_info(
        app,
        &diagnostics_store,
        LogSource::HID,
        format!("--- Read Filter {} (nonce {}) ---", index + 1, nonce),
    );

    send_packet(
        app,
        &connected.path,
        &protocol.build_filter_read_request(index, nonce),
        protocol,
    )?;

    let mut mismatches = 0usize;
    for attempt in 1..=FILTER_READ_ATTEMPTS {
        let bytes = app.hid().read(&connected.path, 60).map_err(|error| {
            format!(
                "Filter {} read failed on attempt {}: {error}",
                index + 1,
                attempt
            )
        })?;
        if bytes.is_empty() {
            if attempt == 1 || attempt % 20 == 0 || attempt == FILTER_READ_ATTEMPTS {
                diagnostics::log_info(
                    app,
                    &diagnostics_store,
                    LogSource::HID,
                    format!(
                        "Filter {} read attempt {}/{}: timed out (empty)",
                        index + 1,
                        attempt,
                        FILTER_READ_ATTEMPTS
                    ),
                );
            }
            continue;
        }

        diagnostics::log_info(
            app,
            &diagnostics_store,
            LogSource::HID,
            format!(
                "Filter {} read attempt {}/{}: got raw packet (len {}): {:02X?}",
                index + 1,
                attempt,
                FILTER_READ_ATTEMPTS,
                bytes.len(),
                bytes
            ),
        );

        let data_vec = match protocol.framer().unframe_packet(&bytes) {
            Ok(vec) => vec,
            Err(error) => {
                diagnostics::log_warn(
                    app,
                    &diagnostics_store,
                    LogSource::HID,
                    format!("Filter {} unframe failed: {}", index + 1, error),
                );
                continue;
            }
        };
        let data = &data_vec;
        let matches = protocol.matches_filter_response(data, index, nonce);
        diagnostics::log_info(
            app,
            &diagnostics_store,
            LogSource::HID,
            format!(
                "Filter {} response matching: matches={}",
                index + 1,
                matches
            ),
        );

        if matches {
            return protocol
                .parse_filter_response(data)
                .ok_or_else(|| format!("Filter {} response could not be parsed", index + 1));
        }

        if !data.is_empty() {
            mismatches += 1;
            diagnostics::log_warn(
                app,
                &diagnostics_store,
                LogSource::HID,
                format!(
                    "Filter {} response mismatch count: {} (max {})",
                    index + 1,
                    mismatches,
                    MAX_FILTER_MISMATCHES
                ),
            );
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

fn read_global_gain(
    app: &tauri::AppHandle,
    path: &str,
    protocol: &dyn DeviceProtocol,
) -> Result<i8, String> {
    let diagnostics_store = app.state::<Mutex<DiagnosticsStore>>();
    diagnostics::log_info(
        app,
        &diagnostics_store,
        LogSource::HID,
        "--- Read Global Gain ---",
    );

    send_packet(app, path, &protocol.build_global_gain_request(0), protocol)?;
    sleep_ms(protocol.read_timing().post_global_gain_ms);

    for attempt in 1..=GLOBAL_GAIN_READ_ATTEMPTS {
        let bytes = app
            .hid()
            .read(path, 60)
            .map_err(|error| format!("Global gain read failed on attempt {}: {error}", attempt))?;
        if bytes.is_empty() {
            continue;
        }

        diagnostics::log_info(
            app,
            &diagnostics_store,
            LogSource::HID,
            format!(
                "Global gain read attempt {}/{}: got raw packet (len {}): {:02X?}",
                attempt,
                GLOBAL_GAIN_READ_ATTEMPTS,
                bytes.len(),
                bytes
            ),
        );

        let data_vec = match protocol.framer().unframe_packet(&bytes) {
            Ok(vec) => vec,
            Err(error) => {
                diagnostics::log_warn(
                    app,
                    &diagnostics_store,
                    LogSource::HID,
                    format!("Global gain unframe failed: {}", error),
                );
                continue;
            }
        };
        let data = &data_vec;
        let matches = protocol.matches_global_gain_response(data, 0);
        diagnostics::log_info(
            app,
            &diagnostics_store,
            LogSource::HID,
            format!("Global gain response matching: matches={}", matches),
        );

        if matches {
            if let Some(gain) = protocol.parse_global_gain_response(data) {
                return Ok(gain);
            }
        }
    }

    Err("Global gain read timeout".to_string())
}

fn run_init_sequence(
    app: &tauri::AppHandle,
    path: &str,
    protocol: &dyn DeviceProtocol,
) -> Result<(), String> {
    for packet in protocol.build_init_packets() {
        send_packet(app, path, &packet, protocol)
            .map_err(|error| format!("Init write failed: {error}"))?;
    }
    sleep_ms(protocol.read_timing().post_version_ms);
    drain_stale_frames(app, path);
    Ok(())
}

fn write_filters(
    app: &tauri::AppHandle,
    path: &str,
    protocol: &dyn DeviceProtocol,
    peq: &PEQData,
    dsp_sample_rate: f64,
) -> Result<(), String> {
    for (index, filter) in peq.filters.iter().enumerate() {
        let packet = protocol.build_filter_write_packet(index as u8, filter, dsp_sample_rate);
        send_packet(app, path, &packet, protocol)
            .map_err(|error| format!("Band {} write failed: {error}", index + 1))?;
        sleep_ms(protocol.write_timing().per_filter_ms);
    }
    Ok(())
}

fn write_global_gain(
    app: &tauri::AppHandle,
    path: &str,
    protocol: &dyn DeviceProtocol,
    global_gain: i8,
) -> Result<(), String> {
    sleep_ms(protocol.write_timing().batch_ms);
    send_packet(
        app,
        path,
        &protocol.build_global_gain_write_packet(global_gain),
        protocol,
    )
    .map_err(|error| format!("Global gain write failed: {error}"))?;
    sleep_ms(protocol.write_timing().global_gain_ms);
    Ok(())
}

fn commit_changes(
    app: &tauri::AppHandle,
    path: &str,
    protocol: &dyn DeviceProtocol,
) -> Result<(), String> {
    for packet in protocol.build_commit_packets() {
        send_packet(app, path, &packet, protocol)
            .map_err(|error| format!("Commit write failed: {error}"))?;
        sleep_ms(protocol.write_timing().commit_step_ms as u64);
    }
    Ok(())
}

fn send_packet(
    app: &tauri::AppHandle,
    path: &str,
    packet: &[u8],
    protocol: &dyn DeviceProtocol,
) -> Result<(), String> {
    let framed = protocol.framer().frame_packet(packet);
    let diagnostics_store = app.state::<Mutex<DiagnosticsStore>>();
    diagnostics::log_info(
        app,
        &diagnostics_store,
        LogSource::HID,
        format!("Writing packet (len {}): {:02X?}", framed.len(), framed),
    );
    app.hid().write(path, &framed).map_err(|error| {
        let err_msg = error.to_string();
        diagnostics::log_error(
            app,
            &diagnostics_store,
            LogSource::HID,
            format!("Write failed: {}", err_msg),
        );
        err_msg
    })
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

fn normalize_for_push(mut peq: PEQData, caps: &DeviceCapabilities) -> PEQData {
    let _ = peq.clamp_to_capabilities(caps);
    peq.global_gain = peq.global_gain.round();
    peq
}
