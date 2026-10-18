// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::state::{ConnectedDevice, DeviceSessionLock, DeviceState};
use glacier_core::device::{
    get_supported_device, session::EqWriteOutcome, BlockingDeviceIo as DeviceIo, Controls,
    DacUtilityState, DeviceInfo, DeviceProfile, DeviceSession, SupportedDeviceInfo,
};
use glacier_core::eq::PEQData;
use std::collections::HashSet;
use std::sync::{Mutex, MutexGuard};
use tauri::Manager;

#[cfg(target_os = "linux")]
use crate::hid_helper::ElevatedTransport;

/// Reported when a disconnect targeted a connection this process no longer
/// owns. Distinct from success, so the frontend does not report a disconnect
/// that never happened.
pub(crate) const DISCONNECT_SUPERSEDED: &str = "Connection changed before disconnect";

#[derive(Clone, serde::Serialize)]
struct OperationProgress {
    message: String,
    percentage: f32,
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
        let _ = hid_close(app, &device.path, Some(device.session_id));
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
            serde_json::json!({
                "path": device.path,
                "name": device.profile_name,
                "session_id": device.session_id,
            }),
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
    let hid = tauri_plugin_hid::hid(app);
    #[cfg(target_os = "windows")]
    let result = {
        let state = app.state::<Mutex<DeviceState>>();
        let connected = connected_device(&state)?;
        let profile = registered_profile(&connected)?;
        if profile.protocol.quirks().set_report_writes {
            hid.send_output_report(path, data)
        } else {
            hid.write(path, data)
        }
    };
    #[cfg(not(target_os = "windows"))]
    let result = hid.write(path, data);
    result.map_err(|error| {
        let error = error.to_string();
        handle_disconnection(app, &error);
        error
    })
}

fn hid_close(app: &tauri::AppHandle, path: &str, session_id: Option<u64>) -> Result<(), String> {
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
        .close(path, session_id)
        .map_err(|error| error.to_string())
}

fn try_open_device(app: &tauri::AppHandle, path: &str, session_id: u64) -> Result<(), String> {
    match tauri_plugin_hid::hid(app).open(path, session_id) {
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
    session_id: u64,
    /// Consecutive empty reads not yet logged, and their total timeout.
    idle_reads: (u32, i64),
}

/// Hex with trailing zero padding collapsed, so fixed-size HID reports stay
/// readable in the diagnostic report.
fn hid_hex(data: &[u8]) -> String {
    let used = data
        .iter()
        .rposition(|&byte| byte != 0)
        .map_or(0, |i| i + 1);
    let mut text = data[..used]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join(" ");
    if used < data.len() {
        text.push_str(&format!(" (+{} zero bytes)", data.len() - used));
    }
    text
}

impl TauriDeviceIo<'_> {
    fn trace(&self, level: crate::diagnostics::LogLevel, message: String) {
        crate::diagnostics::record(
            self.app,
            self.app
                .state::<Mutex<crate::diagnostics::DiagnosticsStore>>()
                .inner(),
            level,
            crate::diagnostics::LogSource::HID,
            format!("session={} {message}", self.session_id),
        );
    }

    fn flush_idle_reads(&mut self) {
        let (count, ms) = std::mem::take(&mut self.idle_reads);
        if count > 0 {
            self.trace(
                crate::diagnostics::LogLevel::Info,
                format!("RX no reply x{count} ({ms} ms)"),
            );
        }
    }
}

impl Drop for TauriDeviceIo<'_> {
    fn drop(&mut self) {
        self.flush_idle_reads();
    }
}

impl DeviceIo for TauriDeviceIo<'_> {
    fn write(&mut self, data: &[u8]) -> Result<(), String> {
        use crate::diagnostics::LogLevel;
        self.flush_idle_reads();
        let result = hid_write(self.app, self.path, data);
        match &result {
            Ok(()) => self.trace(LogLevel::Info, format!("TX {}", hid_hex(data))),
            Err(error) => self.trace(
                LogLevel::Error,
                format!("TX failed {}: {error}", hid_hex(data)),
            ),
        }
        result
    }

    fn read(&mut self, timeout_ms: i32) -> Result<Vec<u8>, String> {
        use crate::diagnostics::LogLevel;
        let result = hid_read(self.app, self.path, timeout_ms);
        match &result {
            Ok(bytes) if bytes.is_empty() => {
                self.idle_reads.0 += 1;
                self.idle_reads.1 += i64::from(timeout_ms);
            }
            Ok(bytes) => {
                self.flush_idle_reads();
                self.trace(LogLevel::Info, format!("RX {}", hid_hex(bytes)));
            }
            Err(error) => {
                self.flush_idle_reads();
                self.trace(LogLevel::Error, format!("RX failed: {error}"));
            }
        }
        result
    }

    fn reads_include_report_id(&self) -> bool {
        // UsbRequest interrupt-IN transfers retain the HID report ID just like
        // HIDAPI and WebHID; the transport must not silently switch to an
        // unframed matcher on Android.
        true
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

// Caller holds DeviceSessionLock across this entire transaction. The small
// state mutex must not remain locked during I/O (disconnect handling uses it).
fn run_session<T>(
    state: &Mutex<DeviceState>,
    io: &mut dyn DeviceIo,
    profile: &'static DeviceProfile,
    progress: &mut dyn FnMut(&str, f32),
    operation: impl FnOnce(&mut DeviceSession<'_>) -> Result<T, String>,
) -> Result<T, String> {
    let seed = state.lock().unwrap_or_else(|p| p.into_inner()).next_nonce;
    let mut session = DeviceSession::with_progress_and_nonce(io, profile, progress, seed);
    let result = operation(&mut session);
    // Retain every allocated nonce, including retries and failed commands,
    // before releasing DeviceSessionLock to the next operation.
    state.lock().unwrap_or_else(|p| p.into_inner()).next_nonce = session.filter_nonce();
    result
}

async fn with_session_for<T: Send + 'static>(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, Mutex<DeviceState>>,
    expected: (String, u64),
    operation: impl FnOnce(&mut DeviceSession<'_>) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let session_lock = app.state::<DeviceSessionLock>().0.clone();
    let guard = session_lock.lock_owned().await;

    let connected = connected_device(state)?;
    if connected.path != expected.0 || connected.session_id != expected.1 {
        return Err("Device session changed; operation was cancelled".into());
    }
    let profile = registered_profile(&connected)?;
    let app_clone = app.clone();
    let path = connected.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let mut io = TauriDeviceIo {
            app: &app_clone,
            path: &path,
            session_id: connected.session_id,
            idle_reads: (0, 0),
        };
        let progress_app = app_clone.clone();
        let mut progress =
            move |message: &str, percentage| emit_progress(&progress_app, message, percentage);
        run_session(
            &app_clone.state::<Mutex<DeviceState>>(),
            &mut io,
            profile,
            &mut progress,
            operation,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn with_session<T: Send + 'static>(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, Mutex<DeviceState>>,
    operation: impl FnOnce(&mut DeviceSession<'_>) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let expected = session_identity(state)?;
    with_session_for(app, state, expected, operation).await
}

fn session_identity(state: &tauri::State<'_, Mutex<DeviceState>>) -> Result<(String, u64), String> {
    let connected = connected_device(state)?;
    Ok((connected.path, connected.session_id))
}

#[tauri::command]
pub async fn get_eq_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<PEQData, String> {
    with_session(&app, &state, |session| {
        glacier_core::device::block_on(session.pull())
    })
    .await
}

#[tauri::command]
pub async fn set_eq_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    peq: PEQData,
) -> Result<EqWriteOutcome, String> {
    // Capture identity before the settings read: a reconnect can complete
    // while settings are being loaded, and the old command must not bind to
    // that replacement device.
    let expected = session_identity(&state)?;
    let skip_verification = crate::settings::get_settings(app.clone())
        .await
        .unwrap_or_default()
        .skip_push_verification;
    with_session_for(&app, &state, expected, move |session| {
        let (committed, warnings) = if skip_verification {
            glacier_core::device::block_on(session.unverified_push(peq))?
        } else {
            glacier_core::device::block_on(session.persistent_push(peq))?
        };
        Ok(EqWriteOutcome {
            committed,
            warnings,
            restarts: session.save_restarts_device(),
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
        let (committed, warnings) = glacier_core::device::block_on(session.apply_ram(peq))?;
        Ok(EqWriteOutcome {
            committed,
            warnings,
            restarts: false,
        })
    })
    .await
}

#[tauri::command]
pub async fn live_apply_eq_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    peq: PEQData,
) -> Result<EqWriteOutcome, String> {
    with_session(&app, &state, |session| {
        let (committed, warnings) = glacier_core::device::block_on(session.live_apply(peq))?;
        Ok(EqWriteOutcome {
            committed,
            warnings,
            restarts: false,
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
                    hardware_eq: profile.protocol.has_hardware_eq(),
                    controls: profile.controls,
                    spec: profile.spec,
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
        .map(SupportedDeviceInfo::from)
        .collect()
}

#[tauri::command]
pub async fn connect_device(
    app: tauri::AppHandle,
    _state: tauri::State<'_, Mutex<DeviceState>>,
    path: String,
) -> Result<u64, String> {
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
            let _ = hid_close(&app_clone, &previous.path, Some(previous.session_id));
            #[cfg(target_os = "linux")]
            {
                *app_clone
                    .state::<Mutex<Option<ElevatedTransport>>>()
                    .lock()
                    .unwrap_or_else(|p| p.into_inner()) = None;
            }
        }
        let session_id = {
            let mut state = lock_device_state(&state)?;
            let session_id = state.next_session_id.wrapping_add(1).max(1);
            // Reserve before opening. A reader can fail asynchronously before
            // the connected state is published; never reuse that ID for a
            // later attempt while its delayed event is still in flight.
            state.next_session_id = session_id;
            session_id
        };
        {
            use tauri::Emitter;
            let _ = app_clone.emit(
                "device-connecting",
                serde_json::json!({
                    "path": path_clone,
                    "name": profile.name,
                    "session_id": session_id,
                }),
            );
        }
        try_open_device(&app_clone, &path_clone, session_id)?;
        // /dev/hidrawN nodes can be reused by a different device between the
        // enumeration above and the open, so re-check the identity of what was
        // actually opened before storing it as connected.
        let reopened = tauri_plugin_hid::hid(&app_clone)
            .enumerate()
            .map_err(|error| {
                // Without this the opened device stays resident with no way
                // to disconnect (DeviceState.connected was never set).
                let _ = hid_close(&app_clone, &path_clone, Some(session_id));
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
                    let _ = hid_close(&app_clone, &path_clone, Some(session_id));
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
            let _ = hid_close(&app_clone, &path_clone, Some(session_id));
            #[cfg(target_os = "linux")]
            {
                *app_clone
                    .state::<Mutex<Option<ElevatedTransport>>>()
                    .lock()
                    .unwrap_or_else(|p| p.into_inner()) = None;
            }
            return Err("Device changed while connecting. Scan again and reconnect.".into());
        }
        {
            let mut state = lock_device_state(&state)?;
            state.connected = Some(ConnectedDevice {
                path: path_clone,
                vendor_id: device.vendor_id,
                product_id: device.product_id,
                profile_name: profile.name.to_string(),
                session_id,
            });
            session_id
        };
        Ok(session_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn disconnect_device(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    expected_path: Option<String>,
    expected_session_id: Option<u64>,
) -> Result<(), String> {
    let session_lock = app.state::<DeviceSessionLock>().0.clone();
    let guard = session_lock.lock_owned().await;
    // Bind outside the if-let so the state lock guard drops before .await.
    let device = {
        let mut state = lock_device_state(&state)?;
        if let Some(current) = state.connected.as_ref() {
            // Refusing to tear down a caller's replacement connection is the
            // point of the fence, but reporting it as success told the frontend
            // it had disconnected while this process still holds the device
            // open. Name the outcome so the caller can tell the two apart.
            if expected_path
                .as_deref()
                .is_some_and(|expected| current.path != expected)
            {
                return Err(DISCONNECT_SUPERSEDED.to_string());
            }
            if expected_session_id.is_some_and(|expected| current.session_id != expected) {
                return Err(DISCONNECT_SUPERSEDED.to_string());
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
                close_device.as_ref().map_or(Ok(()), |device| {
                    hid_close(&close_app, &device.path, Some(device.session_id))
                })
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
                serde_json::json!({
                    "path": device.path,
                    "name": device.profile_name,
                    "session_id": device.session_id,
                }),
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
    with_session(&app, &state, |session| {
        glacier_core::device::block_on(session.firmware_version())
    })
    .await
}

#[derive(serde::Serialize)]
pub struct DawnProState {
    filter: u8,
    high_gain: bool,
    led: u8,
    volume_step: u8,
    volume_raw: u8,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DawnProControl {
    Filter,
    Gain,
    Volume,
    Led,
}

fn read_dawn_pro_state(
    dawn: &mut glacier_core::device::dawn_pro::DawnPro<'_>,
) -> Result<DawnProState, String> {
    let settings = dawn.settings()?;
    let volume = dawn.volume()?;
    Ok(DawnProState {
        filter: settings.filter,
        high_gain: settings.high_gain,
        led: settings.led,
        volume_step: volume.step,
        volume_raw: volume.raw,
    })
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
struct DawnProDeviceIo<'a> {
    app: &'a tauri::AppHandle,
    path: &'a str,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl glacier_core::device::dawn_pro::DawnProIo for DawnProDeviceIo<'_> {
    fn write(&mut self, report: &[u8; 8]) -> Result<(), String> {
        // Original Dawn Pro uses report ID 0 and ordinary eight-byte writes.
        // This deliberately bypasses the Dawn Pro 2 SET_REPORT transport.
        tauri_plugin_hid::hid(self.app)
            .write(self.path, report)
            .map_err(|error| error.to_string())
    }
    fn get_input_report(&mut self, report: &mut [u8; 9]) -> Result<usize, String> {
        let bytes = tauri_plugin_hid::hid(self.app)
            .get_dawn_pro_input_report(self.path)
            .map_err(|error| error.to_string())?;
        if bytes.len() > report.len() {
            return Err("Oversized Dawn Pro reply".into());
        }
        report[..bytes.len()].copy_from_slice(&bytes);
        Ok(bytes.len())
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn with_dawn_pro<T: Send + 'static>(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, Mutex<DeviceState>>,
    path: String,
    operation: impl FnOnce(&mut glacier_core::device::dawn_pro::DawnPro<'_>) -> Result<T, String>
        + Send
        + 'static,
) -> Result<T, String> {
    let expected = session_identity(state)?;
    if expected.0 != path {
        return Err("Device session changed; operation was cancelled".into());
    }
    let session_lock = app.state::<DeviceSessionLock>().0.clone();
    let guard = session_lock.lock_owned().await;
    let connected = connected_device(state)?;
    if connected.path != expected.0 || connected.session_id != expected.1 {
        return Err("Device session changed; operation was cancelled".into());
    }
    if registered_profile(&connected)?.controls != Some(Controls::DawnPro) {
        return Err("These controls require the original Dawn Pro (2FC6:F06A)".into());
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let mut io = DawnProDeviceIo {
            app: &app,
            path: &path,
        };
        operation(&mut glacier_core::device::dawn_pro::DawnPro::new(&mut io))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(any(target_os = "android", target_os = "ios"))]
async fn with_dawn_pro<T: Send + 'static>(
    _app: &tauri::AppHandle,
    _state: &tauri::State<'_, Mutex<DeviceState>>,
    _path: String,
    _operation: impl FnOnce(&mut glacier_core::device::dawn_pro::DawnPro<'_>) -> Result<T, String>
        + Send
        + 'static,
) -> Result<T, String> {
    Err("Original Dawn Pro controls currently require the desktop app".into())
}

#[tauri::command]
pub async fn get_dawn_pro_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    path: String,
) -> Result<DawnProState, String> {
    with_dawn_pro(&app, &state, path, read_dawn_pro_state).await
}

#[tauri::command]
pub async fn set_dawn_pro_control(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    path: String,
    control: DawnProControl,
    value: u8,
) -> Result<DawnProState, String> {
    with_dawn_pro(&app, &state, path, move |dawn| {
        match control {
            DawnProControl::Filter => dawn.set_filter(value)?,
            DawnProControl::Gain => {
                if value > 1 {
                    return Err("Dawn Pro gain must be 0 or 1".into());
                }
                dawn.set_gain(value == 1)?;
            }
            DawnProControl::Volume => dawn.set_volume(value)?,
            DawnProControl::Led => dawn.set_led(value)?,
        }
        read_dawn_pro_state(dawn)
    })
    .await
}

#[tauri::command]
pub async fn ja11_control(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    path: String,
    control: String,
    value: Option<u8>,
) -> Result<Option<u8>, String> {
    let expected = session_identity(&state)?;
    if expected.0 != path {
        return Err("Device session changed; operation was cancelled".into());
    }
    with_session_for(&app, &state, expected, move |session| {
        glacier_core::device::block_on(async {
            match value {
                Some(value) => session.set_ja11_control(&control, value).await,
                None => session.ja11_control(&control).await.map(Some),
            }
        })
    })
    .await
}

#[tauri::command]
pub async fn get_dac_utility_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<DacUtilityState, String> {
    if lock_device_state(&state)?.connected.is_none() {
        return Ok(DacUtilityState::default());
    }
    with_session(&app, &state, |session| {
        glacier_core::device::block_on(session.utility_status())
    })
    .await
}

#[tauri::command]
pub async fn set_dac_filter_mode(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    mode: String,
) -> Result<(), String> {
    with_session(&app, &state, move |session| {
        glacier_core::device::block_on(session.set_filter_mode(&mode))
    })
    .await
}

#[tauri::command]
pub async fn set_dac_work_mode(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    is_class_ab: bool,
) -> Result<(), String> {
    with_session(&app, &state, move |session| {
        glacier_core::device::block_on(session.set_amp_mode(is_class_ab))
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
        glacier_core::device::block_on(session.set_gain_mode(is_high_gain))
    })
    .await
}

#[tauri::command]
pub async fn set_dac_balance(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    balance: i8,
) -> Result<(), String> {
    with_session(&app, &state, move |session| {
        glacier_core::device::block_on(session.set_balance(balance))
    })
    .await
}

#[tauri::command]
pub async fn set_mic_volume(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    volume_db: i8,
) -> Result<(), String> {
    with_session(&app, &state, move |session| {
        glacier_core::device::block_on(session.set_mic_volume(volume_db))
    })
    .await
}

#[tauri::command]
pub async fn reset_device_eq(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<bool, String> {
    with_session(&app, &state, |session| {
        glacier_core::device::block_on(session.reset_eq())
    })
    .await
}

#[tauri::command]
pub async fn reset_device_controls(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<DacUtilityState, String> {
    with_session(&app, &state, |session| {
        glacier_core::device::block_on(session.reset_controls())
    })
    .await
}

#[tauri::command]
pub async fn execute_factory_reset(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<(), String> {
    with_session(&app, &state, |session| {
        glacier_core::device::block_on(session.factory_reset())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::close_and_release;
    use std::cell::Cell;

    #[test]
    fn hid_hex_keeps_wire_bytes_and_collapses_only_trailing_padding() {
        assert_eq!(
            super::hid_hex(&[2, 0xbb, 0, 0xee, 0, 0]),
            "02 bb 00 ee (+2 zero bytes)"
        );
        assert_eq!(super::hid_hex(&[]), "");
        assert_eq!(super::hid_hex(&[0; 3]), " (+3 zero bytes)");
    }

    #[test]
    fn native_ja11_controls_use_shared_read_write_verify_flow() {
        use super::*;
        use glacier_core::device::block_on;
        #[derive(Default)]
        struct Io {
            pending: Option<Vec<u8>>,
            value: u8,
            writes: Vec<Vec<u8>>,
        }
        impl DeviceIo for Io {
            fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
                self.writes.push(bytes.to_vec());
                if bytes[1] == 0xbb {
                    self.pending = Some(vec![2, 0xbb, 0x0b, 0, 0, 2, 1, self.value, 0, 0xee]);
                } else {
                    self.value = bytes[7];
                }
                Ok(())
            }
            fn read(&mut self, _: i32) -> Result<Vec<u8>, String> {
                Ok(self.pending.take().unwrap_or_default())
            }
            fn reads_include_report_id(&self) -> bool {
                true
            }
            fn sleep_ms(&mut self, _: u64) {}
        }
        for pid in [0x0101, 0x0102] {
            let profile = get_supported_device(0x2972, pid).unwrap();
            let state = Mutex::new(DeviceState {
                next_nonce: 137,
                ..Default::default()
            });
            let mut io = Io {
                value: 30,
                ..Default::default()
            };
            let result = run_session(&state, &mut io, profile, &mut |_, _| {}, |session| {
                block_on(session.set_ja11_control("volume", 29))
            })
            .unwrap();
            assert_eq!(result, Some(29));
            assert_eq!(
                io.writes,
                [
                    vec![2, 0xbb, 0x0b, 0, 0, 2, 0, 0, 0xee],
                    vec![2, 0xaa, 0x0a, 0, 0, 2, 1, 29, 0, 0xee],
                    vec![2, 0xbb, 0x0b, 0, 0, 2, 0, 0, 0xee],
                ]
            );
            assert_eq!(state.lock().unwrap().next_nonce, 137);
        }
    }

    #[test]
    fn native_sessions_retain_consumed_nonces_on_success_and_failure() {
        use super::*;
        use glacier_core::device::block_on;

        #[derive(Default)]
        struct Io {
            pending: Option<Vec<u8>>,
            nonces: Vec<u8>,
            fail_band_one: bool,
        }
        impl DeviceIo for Io {
            fn write(&mut self, framed: &[u8]) -> Result<(), String> {
                let data = &framed[1..];
                match data[1] {
                    3 => self.pending = Some(vec![0x80, 3, 0, 0, 1, 0]),
                    9 => {
                        self.nonces.push(data[2]);
                        if self.fail_band_one && data[4] == 1 {
                            return Err("simulated filter request failure".into());
                        }
                        let mut response = vec![0; 34];
                        response[..5].copy_from_slice(&[0x80, 9, data[2], 0, data[4]]);
                        response[27..29].copy_from_slice(&1000u16.to_le_bytes());
                        response[29..31].copy_from_slice(&256u16.to_le_bytes());
                        response[31..33].copy_from_slice(&256i16.to_le_bytes());
                        response[33] = 2;
                        self.pending = Some(response);
                    }
                    _ => {}
                }
                Ok(())
            }
            fn read(&mut self, _: i32) -> Result<Vec<u8>, String> {
                Ok(self.pending.take().unwrap_or_default())
            }
            fn sleep_ms(&mut self, _: u64) {}
        }

        let profile = get_supported_device(0x3302, 0x43e6).unwrap();
        for failed in [false, true] {
            let state = Mutex::new(DeviceState {
                next_nonce: 254,
                ..Default::default()
            });
            let mut io = Io {
                fail_band_one: failed,
                ..Default::default()
            };
            let result = run_session(&state, &mut io, profile, &mut |_, _| {}, |session| {
                block_on(session.pull())
            });
            assert_eq!(result.is_err(), failed);
            let consumed = *io.nonces.last().unwrap();
            assert_eq!(state.lock().unwrap().next_nonce, consumed);
            assert!(!io.nonces.contains(&0));
            let previous = io.nonces.len();
            io.fail_band_one = false;
            run_session(&state, &mut io, profile, &mut |_, _| {}, |session| {
                block_on(session.pull())
            })
            .unwrap();
            assert_eq!(io.nonces[previous], consumed.wrapping_add(1).max(1));
            assert_eq!(state.lock().unwrap().next_nonce, *io.nonces.last().unwrap());
        }
    }

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
