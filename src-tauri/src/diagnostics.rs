// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::profiles::app_data_base_dir;
use crate::state::DeviceState;
use glacier_core::device::get_supported_device;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

impl std::fmt::Display for LogLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LogLevel::Info => write!(f, "INFO"),
            LogLevel::Warn => write!(f, "WARN"),
            LogLevel::Error => write!(f, "ERROR"),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[allow(clippy::upper_case_acronyms)]
pub enum LogSource {
    UI,
    Worker,
    HID,
    AutoEQ,
    Device,
    /// Storage-layer problems (profile files skipped, quarantines): emitted
    /// by the backend itself through [`record`] rather than reported by the
    /// UI. The web backend's diagnostics parser accepts the same spelling.
    Storage,
}

impl std::fmt::Display for LogSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LogSource::UI => write!(f, "UI"),
            LogSource::Worker => write!(f, "Worker"),
            LogSource::HID => write!(f, "HID"),
            LogSource::AutoEQ => write!(f, "AutoEQ"),
            LogSource::Device => write!(f, "Device"),
            LogSource::Storage => write!(f, "Storage"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticEvent {
    /// Monotonic per-process sequence number. Lets consumers deduplicate
    /// history against the live stream without relying on identical
    /// millisecond timestamps.
    pub seq: u64,
    pub timestamp: String,
    pub level: LogLevel,
    pub source: LogSource,
    pub message: String,
}

#[derive(Serialize)]
pub struct DiagnosticContext {
    app_version: &'static str,
    runtime: &'static str,
    platform: &'static str,
    architecture: &'static str,
    device_name: Option<String>,
    device_id: Option<String>,
    protocol: Option<&'static str>,
    transport: Option<&'static str>,
}

static EVENT_SEQUENCE: AtomicU64 = AtomicU64::new(1);

impl DiagnosticEvent {
    pub fn new(level: LogLevel, source: LogSource, message: String) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        let secs = now.as_secs();
        let millis = now.subsec_millis();
        let (h, m, s) = ((secs / 3600) % 24, (secs / 60) % 60, secs % 60);
        let timestamp = format!("{h:02}:{m:02}:{s:02}.{millis:03} UTC");
        Self {
            // Never reset, even on clear: a stale ID must never collide.
            seq: EVENT_SEQUENCE.fetch_add(1, Ordering::Relaxed),
            timestamp,
            level,
            source,
            message,
        }
    }
}

pub struct DiagnosticsStore {
    events: VecDeque<DiagnosticEvent>,
}

impl Default for DiagnosticsStore {
    fn default() -> Self {
        Self {
            events: VecDeque::with_capacity(500),
        }
    }
}

/// Caps message length and flattens newlines so a crafted message cannot forge
/// additional log entries or bloat the retained ring buffer.
fn sanitize_message(message: String) -> String {
    const MAX_MESSAGE_CHARS: usize = 2000;
    let flattened = message.replace(['\r', '\n'], " ");
    match flattened.char_indices().nth(MAX_MESSAGE_CHARS) {
        Some((byte_index, _)) => flattened[..byte_index].to_string(),
        None => flattened,
    }
}

impl DiagnosticsStore {
    /// Updates the in-memory ring buffer only. Log-file I/O happens in
    /// [`append_to_log`], outside the store lock.
    pub fn push(&mut self, event: DiagnosticEvent) {
        if self.events.len() >= 500 {
            self.events.pop_front();
        }
        self.events.push_back(event);
    }

    pub fn events(&self) -> Vec<DiagnosticEvent> {
        self.events.iter().cloned().collect()
    }

    pub fn clear(&mut self) {
        self.events.clear();
    }
}

fn get_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_base_dir(app)?.join("diagnostics.log"))
}

static LOG_IO_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn append_to_log(app: &tauri::AppHandle, event: &DiagnosticEvent) {
    let Ok(log_path) = get_log_path(app) else {
        return;
    };
    // Serialize rotation and append across concurrent command tasks: two
    // racing rotations would send one task's line into the backup file.
    let _guard = LOG_IO_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // Rotate log file if it exceeds 5MB
    if let Ok(meta) = fs::metadata(&log_path) {
        if meta.len() > 5 * 1024 * 1024 {
            let backup = log_path.with_extension("log.1");
            if fs::rename(&log_path, &backup).is_err() && meta.len() > 20 * 1024 * 1024 {
                // Persistent rotation failure (backup held open by a viewer
                // or AV) must not grow the log without bound: truncate above
                // a hard ceiling.
                eprintln!(
                    "diagnostics: rotating {:?} failed; truncating oversized log",
                    log_path
                );
                let _ = fs::File::create(&log_path);
            }
        }
    }
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let line = format!(
            "{} [{}] [{}] {}\n",
            event.timestamp, event.level, event.source, event.message
        );
        let _ = file.write_all(line.as_bytes());
    }
}

/// Same poisoned-lock recovery convention as the rest of the backend: the ring
/// buffer is safe to keep after a panic while holding the guard.
fn lock_store<'a, 'r>(
    state: &'a tauri::State<'r, Mutex<DiagnosticsStore>>,
) -> MutexGuard<'a, DiagnosticsStore> {
    state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Records a problem the backend discovered itself — store, log file, and
/// frontend event — for failures the UI cannot observe on its own (e.g. a
/// profile file skipped during `list_profiles`). Unlike the
/// `add_diagnostic_event` command, which reports the outcome of a UI action
/// and must propagate its errors, this path is best-effort: a diagnostic
/// that cannot be recorded must not fail the operation that found it.
pub fn record(
    app: &tauri::AppHandle,
    store: &Mutex<DiagnosticsStore>,
    level: LogLevel,
    source: LogSource,
    message: String,
) {
    let event = DiagnosticEvent::new(level, source, sanitize_message(message));
    store
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .push(event.clone());
    let log_app = app.clone();
    let log_event = event.clone();
    tauri::async_runtime::spawn_blocking(move || append_to_log(&log_app, &log_event));
    use tauri::Emitter;
    let _ = app.emit("diagnostic-event", event);
}

// --- Commands ---

#[tauri::command]
pub fn get_diagnostic_context(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> DiagnosticContext {
    let connected = state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .connected
        .clone();
    let profile = connected
        .as_ref()
        .and_then(|device| get_supported_device(device.vendor_id, device.product_id));

    #[cfg(target_os = "linux")]
    let transport = connected.as_ref().map(|_| {
        use tauri::Manager;
        let elevated = app
            .state::<Mutex<Option<crate::hid_helper::ElevatedTransport>>>()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some();
        if elevated {
            "HIDAPI (elevated helper)"
        } else {
            "HIDAPI (direct)"
        }
    });
    #[cfg(target_os = "android")]
    let transport = connected.as_ref().map(|_| "Android USB HID");
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    let transport = connected.as_ref().map(|_| "HIDAPI (direct)");

    let _ = app;
    DiagnosticContext {
        app_version: env!("CARGO_PKG_VERSION"),
        runtime: if cfg!(target_os = "android") {
            "Android"
        } else {
            "Desktop"
        },
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        device_name: connected.as_ref().map(|device| device.profile_name.clone()),
        device_id: connected
            .as_ref()
            .map(|device| format!("{:04X}:{:04X}", device.vendor_id, device.product_id)),
        protocol: profile.map(|profile| profile.protocol.name()),
        transport,
    }
}

#[tauri::command]
pub fn get_diagnostics(
    state: tauri::State<'_, Mutex<DiagnosticsStore>>,
) -> Result<Vec<DiagnosticEvent>, String> {
    Ok(lock_store(&state).events())
}

#[tauri::command]
pub fn clear_diagnostics(state: tauri::State<'_, Mutex<DiagnosticsStore>>) -> Result<(), String> {
    lock_store(&state).clear();
    Ok(())
}

#[tauri::command]
pub async fn add_diagnostic_event(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DiagnosticsStore>>,
    level: LogLevel,
    source: LogSource,
    message: String,
) -> Result<(), String> {
    let event = DiagnosticEvent::new(level, source, sanitize_message(message));
    lock_store(&state).push(event.clone());
    // File I/O happens off the IPC thread and after the guard is dropped so
    // readers never block on disk. Cross-event ordering in the log file can
    // interleave; each line carries its own timestamp.
    let log_app = app.clone();
    let log_event = event.clone();
    tauri::async_runtime::spawn_blocking(move || append_to_log(&log_app, &log_event))
        .await
        .map_err(|e| e.to_string())?;
    use tauri::Emitter;
    let _ = app.emit("diagnostic-event", event);
    Ok(())
}
