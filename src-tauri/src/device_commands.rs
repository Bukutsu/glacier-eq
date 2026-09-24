// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::state::{ConnectedDevice, DeviceSessionLock, DeviceState};
use glacier_core::device::{
    get_supported_device, DacUtilityState, DeviceInfo, DeviceIo, DeviceProfile, DeviceSession,
    EditorCapabilities,
};
use glacier_core::eq::PEQData;
use std::collections::HashSet;
use std::sync::{Mutex, MutexGuard};
use tauri::Manager;

#[cfg(target_os = "linux")]
use crate::hid_helper::ElevatedTransport;

#[derive(Clone, serde::Serialize)]
struct OperationProgress {
    message: String,
    percentage: f32,
}

/// A completed EQ write: the committed state flattened so the response stays
/// a valid PEQ document, plus the capability-clamp warnings from
/// normalization — the UI must be able to tell the user their values were
/// adjusted instead of claiming an unqualified "Saved EQ to DAC".
#[derive(Clone, serde::Serialize)]
pub struct EqWriteOutcome {
    #[serde(flatten)]
    committed: PEQData,
    warnings: Vec<String>,
}

#[derive(Clone, serde::Serialize)]
pub struct SupportedDeviceInfo {
    name: &'static str,
    protocol: &'static str,
    vendor_id: u16,
    product_id: Option<u16>,
    status: &'static str,
    family: &'static str,
    #[serde(flatten)]
    capabilities: EditorCapabilities,
}

fn lock_device_state<'a, 'r>(
    state: &'a tauri::State<'r, Mutex<DeviceState>>,
) -> Result<MutexGuard<'a, DeviceState>, String> {
    Ok(state.lock().unwrap_or_else(|p| p.into_inner()))
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

fn handle_disconnection(app: &tauri::AppHandle, error: &str) {
    if !glacier_core::error::is_disconnection(error) {
        return;
    }
    let state = app.state::<Mutex<DeviceState>>();
    let disconnected = {
        let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
        guard.connected.take()
    };
    if let Some(device) = disconnected {
        let _ = hid_close(app, &device.path);
        #[cfg(target_os = "linux")]
        {
            if let Some(elevated_state) = app.try_state::<Mutex<Option<ElevatedTransport>>>() {
                let mut guard = elevated_state.lock().unwrap_or_else(|p| p.into_inner());
                *guard = None;
            }
        }
        use tauri::Emitter;
        // Structured identity lets listeners reject delayed events for a
        // session that has already been replaced.
        let _ = app.emit(
            "device-disconnected",
            serde_json::json!({ "path": device.path, "name": device.profile_name }),
        );
    }
}

fn ensure_connected(app: &tauri::AppHandle) -> Result<(), String> {
    if app.try_state::<Mutex<DeviceState>>().map(|state| {
        state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .connected
            .is_some()
    }) == Some(false)
    {
        Err("Device disconnected".into())
    } else {
        Ok(())
    }
}

fn hid_read(app: &tauri::AppHandle, path: &str, timeout: i32) -> Result<Vec<u8>, String> {
    ensure_connected(app)?;
    // The Linux elevated transport is guarded by a std Mutex that must never be
    // held across unbounded blocking I/O: connect/close/list all need the same
    // lock, and hidapi treats a negative timeout as "wait forever". Session
    // reads poll with 20-60 ms timeouts; cap anything longer.
    const MAX_READ_TIMEOUT_MS: i32 = 1_000;
    let timeout = if !(0..=MAX_READ_TIMEOUT_MS).contains(&timeout) {
        MAX_READ_TIMEOUT_MS
    } else {
        timeout
    };
    #[cfg(target_os = "linux")]
    {
        let transport_state = app.state::<Mutex<Option<ElevatedTransport>>>();
        let mut guard = transport_state.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(transport) = guard.as_mut() {
            let res = transport.read(path, timeout);
            let transport_died = res.is_err() && transport.is_dead();
            if transport_died {
                // Helper missed its deadline and was killed; stop routing
                // through it so later ops fall back to direct hidapi access.
                *guard = None;
            }
            drop(guard);
            if transport_died {
                handle_disconnection(app, "Device disconnected: privileged helper exited");
            } else if let Err(ref e) = res {
                handle_disconnection(app, e);
            }
            return res;
        }
    }
    tauri_plugin_hid::hid(app)
        .read(path, timeout)
        .map_err(|error| {
            let error = error.to_string();
            handle_disconnection(app, &error);
            error
        })
}

fn hid_write(app: &tauri::AppHandle, path: &str, data: &[u8]) -> Result<(), String> {
    ensure_connected(app)?;
    #[cfg(target_os = "linux")]
    {
        let transport_state = app.state::<Mutex<Option<ElevatedTransport>>>();
        let mut guard = transport_state.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(transport) = guard.as_mut() {
            let res = transport.write(path, data);
            let transport_died = res.is_err() && transport.is_dead();
            if transport_died {
                *guard = None;
            }
            drop(guard);
            if transport_died {
                handle_disconnection(app, "Device disconnected: privileged helper exited");
            } else if let Err(ref e) = res {
                handle_disconnection(app, e);
            }
            return res;
        }
    }
    tauri_plugin_hid::hid(app)
        .write(path, data)
        .map_err(|error| {
            let error = error.to_string();
            handle_disconnection(app, &error);
            error
        })
}

fn hid_close(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let transport_state = app.state::<Mutex<Option<ElevatedTransport>>>();
        let mut guard = transport_state.lock().unwrap_or_else(|p| p.into_inner());
        let route_elevated = matches!(&*guard, Some(t) if !t.is_dead());
        if route_elevated {
            return guard.as_mut().unwrap().close(path);
        }
        // A dead helper must not shadow direct access; drop it.
        *guard = None;
    }
    tauri_plugin_hid::hid(app)
        .close(path)
        .map_err(|error| error.to_string())
}

fn try_open_device(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    match tauri_plugin_hid::hid(app).open(path) {
        Ok(()) => {
            #[cfg(target_os = "linux")]
            {
                let state = app.state::<Mutex<Option<ElevatedTransport>>>();
                let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
                *guard = None;
            }
            return Ok(());
        }
        Err(e) => {
            let msg = e.to_string();
            if !msg.to_lowercase().contains("permission denied") {
                return Err(msg);
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        let state = app.state::<Mutex<Option<ElevatedTransport>>>();
        let mut guard = state.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(ref mut t) = *guard {
            if !t.is_dead() {
                return t.open(path);
            }
            // Dead helper: drop it and spawn a fresh one below.
            *guard = None;
        }
        // ElevatedTransport::spawn blocks on the pkexec prompt and can hold
        // this mutex for minutes. That's acceptable today only because every
        // contender (connect/read/write/close) serializes on DeviceSessionLock
        // first; keep that invariant when adding new transport callers.
        let mut transport = ElevatedTransport::spawn()?;
        transport.open(path)?;
        guard.replace(transport);
        Ok(())
    }
    #[cfg(target_os = "android")]
    {
        Err("USB permission denied. Please grant permission when prompted.".into())
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        Err("Permission denied. Ensure the DAC is not locked by another application.".into())
    }
}

struct TauriDeviceIo<'a> {
    app: &'a tauri::AppHandle,
    path: &'a str,
}

impl DeviceIo for TauriDeviceIo<'_> {
    fn write(&mut self, data: &[u8]) -> Result<(), String> {
        hid_write(self.app, self.path, data)
    }

    fn read(&mut self, timeout_ms: i32) -> Result<Vec<u8>, String> {
        hid_read(self.app, self.path, timeout_ms)
    }
}

fn connected_device(
    state: &tauri::State<'_, Mutex<DeviceState>>,
) -> Result<ConnectedDevice, String> {
    lock_device_state(state)?
        .connected
        .clone()
        .ok_or_else(|| "No supported DAC connected. Connect a device first.".into())
}

fn registered_profile(connected: &ConnectedDevice) -> Result<&'static DeviceProfile, String> {
    get_supported_device(connected.vendor_id, connected.product_id).ok_or_else(|| {
        format!(
            "No profile registered for {:04X}:{:04X}",
            connected.vendor_id, connected.product_id
        )
    })
}

fn reserve_session_nonce(state: &tauri::State<'_, Mutex<DeviceState>>) -> Result<u8, String> {
    let mut guard = lock_device_state(state)?;
    let seed = guard.next_nonce.wrapping_add(1).max(1);
    guard.next_nonce = seed;
    Ok(seed)
}

async fn with_session<T: Send + 'static>(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, Mutex<DeviceState>>,
    operation: impl FnOnce(&mut DeviceSession<'_>) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let session_lock = app.state::<DeviceSessionLock>().0.clone();
    let guard = session_lock.lock_owned().await;

    let connected = connected_device(state)?;
    let profile = registered_profile(&connected)?;
    let nonce_seed = reserve_session_nonce(state)?;
    let app_clone = app.clone();
    let path = connected.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let mut io = TauriDeviceIo {
            app: &app_clone,
            path: &path,
        };
        let progress_app = app_clone.clone();
        let mut progress =
            move |message: &str, percentage| emit_progress(&progress_app, message, percentage);
        operation(&mut DeviceSession::with_progress_and_nonce(
            &mut io,
            profile,
            &mut progress,
            nonce_seed,
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_eq_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<PEQData, String> {
    with_session(&app, &state, |session| session.pull()).await
}

#[tauri::command]
pub async fn set_eq_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    peq: PEQData,
) -> Result<EqWriteOutcome, String> {
    let skip_verification = crate::settings::get_settings(app.clone())
        .await
        .unwrap_or_default()
        .skip_push_verification;
    with_session(&app, &state, move |session| {
        let (committed, warnings) = if skip_verification {
            session.unverified_push(peq)?
        } else {
            session.persistent_push(peq)?
        };
        Ok(EqWriteOutcome {
            committed,
            warnings,
        })
    })
    .await
}

#[tauri::command]
pub async fn apply_eq_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    peq: PEQData,
) -> Result<EqWriteOutcome, String> {
    with_session(&app, &state, |session| {
        let (committed, warnings) = session.apply_ram(peq)?;
        Ok(EqWriteOutcome {
            committed,
            warnings,
        })
    })
    .await
}

#[tauri::command]
pub async fn list_devices(app: tauri::AppHandle) -> Result<Vec<DeviceInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let devices = tauri_plugin_hid::hid(&app)
            .enumerate()
            .map_err(|error| error.to_string())?;
        let mut seen = HashSet::new();
        Ok(devices
            .iter()
            .filter_map(|device| {
                let profile = get_supported_device(device.vendor_id, device.product_id)?;
                seen.insert(device.path.clone()).then(|| DeviceInfo {
                    vendor_id: device.vendor_id,
                    product_id: device.product_id,
                    path: device.path.clone(),
                    manufacturer: device.manufacturer_string.clone(),
                    product_string: device.product_string.clone(),
                    profile_name: Some(profile.name.to_string()),
                    capabilities: (&profile.caps).into(),
                })
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
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
            capabilities: (&device.caps).into(),
        })
        .collect()
}

#[tauri::command]
pub async fn connect_device(
    app: tauri::AppHandle,
    _state: tauri::State<'_, Mutex<DeviceState>>,
    path: String,
) -> Result<(), String> {
    let session_lock = app.state::<DeviceSessionLock>().0.clone();
    let guard = session_lock.lock_owned().await;

    let app_clone = app.clone();
    let path_clone = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let state = app_clone.state::<Mutex<DeviceState>>();
        let devices = tauri_plugin_hid::hid(&app_clone)
            .enumerate()
            .map_err(|error| error.to_string())?;
        let device = devices
            .iter()
            .find(|device| device.path == path_clone)
            .ok_or_else(|| "Device disappeared. Scan again and reconnect.".to_string())?;
        let profile =
            get_supported_device(device.vendor_id, device.product_id).ok_or_else(|| {
                format!(
                    "Unsupported HID device {:04X}:{:04X}",
                    device.vendor_id, device.product_id
                )
            })?;
        // Bind outside the if-let so the state lock guard drops before the
        // blocking hid_close below (helper IPC can take seconds on Linux).
        let previous = lock_device_state(&state)?.connected.take();
        if let Some(previous) = previous {
            let _ = hid_close(&app_clone, &previous.path);
            #[cfg(target_os = "linux")]
            {
                *app_clone
                    .state::<Mutex<Option<ElevatedTransport>>>()
                    .lock()
                    .unwrap_or_else(|p| p.into_inner()) = None;
            }
        }
        try_open_device(&app_clone, &path_clone)?;
        // /dev/hidrawN nodes can be reused by a different device between the
        // enumeration above and the open, so re-check the identity of what was
        // actually opened before storing it as connected.
        let reopened = tauri_plugin_hid::hid(&app_clone)
            .enumerate()
            .map_err(|error| {
                // Without this the opened device stays resident with no way
                // to disconnect (DeviceState.connected was never set).
                let _ = hid_close(&app_clone, &path_clone);
                // A failed connect also leaves nothing connected: release the
                // root helper like disconnect_device does instead of idling.
                #[cfg(target_os = "linux")]
                {
                    *app_clone
                        .state::<Mutex<Option<ElevatedTransport>>>()
                        .lock()
                        .unwrap_or_else(|p| p.into_inner()) = None;
                }
                error.to_string()
            })?
            .into_iter()
            .find(|device| device.path == path_clone)
            .map_or_else(
                || {
                    let _ = hid_close(&app_clone, &path_clone);
                    #[cfg(target_os = "linux")]
                    {
                        *app_clone
                            .state::<Mutex<Option<ElevatedTransport>>>()
                            .lock()
                            .unwrap_or_else(|p| p.into_inner()) = None;
                    }
                    Err("Device disappeared during connect.".to_string())
                },
                Ok,
            )?;
        if reopened.vendor_id != device.vendor_id || reopened.product_id != device.product_id {
            let _ = hid_close(&app_clone, &path_clone);
            #[cfg(target_os = "linux")]
            {
                *app_clone
                    .state::<Mutex<Option<ElevatedTransport>>>()
                    .lock()
                    .unwrap_or_else(|p| p.into_inner()) = None;
            }
            return Err("Device changed while connecting. Scan again and reconnect.".into());
        }
        lock_device_state(&state)?.connected = Some(ConnectedDevice {
            path: path_clone,
            vendor_id: device.vendor_id,
            product_id: device.product_id,
            profile_name: profile.name.to_string(),
        });
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn disconnect_device(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    expected_path: Option<String>,
) -> Result<(), String> {
    let session_lock = app.state::<DeviceSessionLock>().0.clone();
    let guard = session_lock.lock_owned().await;
    // Bind outside the if-let so the state lock guard drops before .await.
    let device = {
        let mut state = lock_device_state(&state)?;
        if let (Some(expected), Some(current)) =
            (expected_path.as_deref(), state.connected.as_ref())
        {
            if current.path != expected {
                return Ok(());
            }
        }
        state.connected.take()
    };
    // State is already disconnected. Both close and transport destruction may
    // block, and cleanup must run even when close reports an error.
    let close_app = app.clone();
    let close_device = device.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        close_and_release(
            || {
                close_device
                    .as_ref()
                    .map_or(Ok(()), |device| hid_close(&close_app, &device.path))
            },
            || {
                #[cfg(target_os = "linux")]
                {
                    *close_app
                        .state::<Mutex<Option<ElevatedTransport>>>()
                        .lock()
                        .unwrap_or_else(|p| p.into_inner()) = None;
                }
            },
        )
    })
    .await
    .map_err(|error| error.to_string())
    .and_then(|result| result);
    if result.is_err() {
        if let Some(device) = device {
            use tauri::Emitter;
            // A rejected invoke must not leave the frontend showing a live
            // connection after local cleanup. Keep the existing identity contract.
            let _ = app.emit(
                "device-disconnected",
                serde_json::json!({ "path": device.path, "name": device.profile_name }),
            );
        }
    }
    result
}

fn close_and_release(
    close: impl FnOnce() -> Result<(), String>,
    release: impl FnOnce(),
) -> Result<(), String> {
    let result = close();
    release();
    result
}

#[tauri::command]
pub async fn get_firmware_version(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<Option<String>, String> {
    if lock_device_state(&state)?.connected.is_none() {
        return Ok(None);
    }
    with_session(&app, &state, |session| session.firmware_version()).await
}

#[tauri::command]
pub async fn get_dac_utility_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<DacUtilityState, String> {
    if lock_device_state(&state)?.connected.is_none() {
        return Ok(DacUtilityState::default());
    }
    with_session(&app, &state, |session| session.utility_status()).await
}

#[tauri::command]
pub async fn set_dac_filter_mode(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    mode: String,
) -> Result<(), String> {
    with_session(&app, &state, move |session| session.set_filter_mode(&mode)).await
}

#[tauri::command]
pub async fn set_dac_work_mode(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    is_class_ab: bool,
) -> Result<(), String> {
    with_session(&app, &state, move |session| {
        session.set_amp_mode(is_class_ab)
    })
    .await
}

#[tauri::command]
pub async fn set_dac_output_gain(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    is_high_gain: bool,
) -> Result<(), String> {
    with_session(&app, &state, move |session| {
        session.set_gain_mode(is_high_gain)
    })
    .await
}

#[tauri::command]
pub async fn set_dac_balance(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    balance: i8,
) -> Result<(), String> {
    with_session(&app, &state, move |session| session.set_balance(balance)).await
}

#[tauri::command]
pub async fn set_mic_volume(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    volume_db: i8,
) -> Result<(), String> {
    with_session(&app, &state, move |session| {
        session.set_mic_volume(volume_db)
    })
    .await
}

#[tauri::command]
pub async fn reset_device_eq(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<(), String> {
    with_session(&app, &state, |session| session.reset_eq()).await
}

#[tauri::command]
pub async fn reset_device_controls(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<DacUtilityState, String> {
    with_session(&app, &state, |session| session.reset_controls()).await
}

#[tauri::command]
pub async fn execute_factory_reset(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<(), String> {
    with_session(&app, &state, |session| session.factory_reset()).await
}

#[cfg(test)]
mod tests {
    use super::close_and_release;
    use std::cell::Cell;

    #[test]
    fn failed_close_still_releases_transport_and_reports_error() {
        let released = Cell::new(false);
        let result = close_and_release(
            || Err("IPC timeout: privileged helper is unresponsive".into()),
            || released.set(true),
        );
        assert!(released.get());
        assert_eq!(
            result,
            Err("IPC timeout: privileged helper is unresponsive".into())
        );
    }

    #[test]
    fn successful_close_releases_transport_after_close() {
        let closed = Cell::new(false);
        let released = Cell::new(false);
        let result = close_and_release(
            || {
                closed.set(true);
                Ok(())
            },
            || {
                assert!(closed.get());
                released.set(true);
            },
        );
        assert!(released.get());
        assert_eq!(result, Ok(()));
    }
}
