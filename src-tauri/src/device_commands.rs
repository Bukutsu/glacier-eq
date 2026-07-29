// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::state::{ConnectedDevice, DeviceState};
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
    let lower = error.to_lowercase();
    if ![
        "no such device",
        "device not found",
        "disconnected",
        "not open",
        "io error",
        "os error 19",
        "os error 5",
        "transfer failed",
        "no longer exists",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
    {
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
        let _ = app.emit("device-disconnected", device.profile_name);
    }
}

fn ensure_connected(app: &tauri::AppHandle) -> Result<(), String> {
    if app
        .try_state::<Mutex<DeviceState>>()
        .map(|state| state.lock().unwrap_or_else(|p| p.into_inner()).connected.is_some())
        == Some(false)
    {
        Err("Device disconnected".into())
    } else {
        Ok(())
    }
}

fn hid_read(app: &tauri::AppHandle, path: &str, timeout: i32) -> Result<Vec<u8>, String> {
    ensure_connected(app)?;
    #[cfg(target_os = "linux")]
    if let Some(t) = app
        .state::<Mutex<Option<ElevatedTransport>>>()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_mut()
    {
        let res = t.read(path, timeout);
        if let Err(ref e) = res {
            handle_disconnection(app, e);
        }
        return res;
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
    if let Some(t) = app
        .state::<Mutex<Option<ElevatedTransport>>>()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_mut()
    {
        let res = t.write(path, data);
        if let Err(ref e) = res {
            handle_disconnection(app, e);
        }
        return res;
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
    if let Some(t) = app
        .state::<Mutex<Option<ElevatedTransport>>>()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_mut()
    {
        return t.close(path);
    }
    tauri_plugin_hid::hid(app)
        .close(path)
        .map_err(|error| error.to_string())
}

fn try_open_device(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    match tauri_plugin_hid::hid(app).open(path) {
        Ok(()) => return Ok(()),
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
            return t.open(path);
        }
        let mut transport = ElevatedTransport::spawn()?;
        transport.open(path)?;
        guard.replace(transport);
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    Err("Permission denied. Install udev/99-glacier-eq.rules and replug the DAC.".into())
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

async fn with_session<T: Send + 'static>(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, Mutex<DeviceState>>,
    operation: impl FnOnce(&mut DeviceSession<'_>) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let connected = connected_device(state)?;
    let profile = registered_profile(&connected)?;
    let app_clone = app.clone();
    let path = connected.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut io = TauriDeviceIo {
            app: &app_clone,
            path: &path,
        };
        let progress_app = app_clone.clone();
        let mut progress =
            move |message: &str, percentage| emit_progress(&progress_app, message, percentage);
        operation(&mut DeviceSession::with_progress(
            &mut io,
            profile,
            &mut progress,
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
) -> Result<(), String> {
    let skip_verification = crate::settings::get_settings(app.clone())
        .unwrap_or_default()
        .skip_push_verification;
    with_session(&app, &state, move |session| {
        if skip_verification {
            session.unverified_push(peq)
        } else {
            session.persistent_push(peq)
        }
        .map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn apply_eq_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    peq: PEQData,
) -> Result<(), String> {
    with_session(&app, &state, |session| session.apply_ram(peq).map(|_| ())).await
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
    let app_clone = app.clone();
    let path_clone = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_clone.state::<Mutex<DeviceState>>();
        let devices = tauri_plugin_hid::hid(&app_clone)
            .enumerate()
            .map_err(|error| error.to_string())?;
        let device = devices
            .iter()
            .find(|device| device.path == path_clone)
            .ok_or_else(|| "Device disappeared. Scan again and reconnect.".to_string())?;
        let profile = get_supported_device(device.vendor_id, device.product_id).ok_or_else(|| {
            format!(
                "Unsupported HID device {:04X}:{:04X}",
                device.vendor_id, device.product_id
            )
        })?;
        if let Some(previous) = lock_device_state(&state)?.connected.take() {
            let _ = hid_close(&app_clone, &previous.path);
        }
        try_open_device(&app_clone, &path_clone)?;
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
pub fn disconnect_device(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<(), String> {
    if let Some(device) = lock_device_state(&state)?.connected.take() {
        hid_close(&app, &device.path)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_firmware_version(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<Option<String>, String> {
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
    with_session(&app, &state, move |session| session.set_amp_mode(is_class_ab)).await
}

#[tauri::command]
pub async fn set_dac_output_gain(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    is_high_gain: bool,
) -> Result<(), String> {
    with_session(&app, &state, move |session| session.set_gain_mode(is_high_gain)).await
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
    with_session(&app, &state, move |session| session.set_mic_volume(volume_db)).await
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
