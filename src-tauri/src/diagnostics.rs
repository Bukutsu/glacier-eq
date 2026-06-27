// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

use crate::profiles::app_data_base_dir;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

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
pub enum LogSource {
    UI,
    Worker,
    HID,
    AutoEQ,
}

impl std::fmt::Display for LogSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LogSource::UI => write!(f, "UI"),
            LogSource::Worker => write!(f, "Worker"),
            LogSource::HID => write!(f, "HID"),
            LogSource::AutoEQ => write!(f, "AutoEQ"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticEvent {
    pub timestamp: String,
    pub level: LogLevel,
    pub source: LogSource,
    pub message: String,
}

impl DiagnosticEvent {
    pub fn new(level: LogLevel, source: LogSource, message: String) -> Self {
        let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
        Self {
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

impl DiagnosticsStore {
    pub fn push(&mut self, app: &tauri::AppHandle, event: DiagnosticEvent) {
        if self.events.len() >= 500 {
            self.events.pop_front();
        }

        // Append to file
        if let Ok(log_path) = get_log_path(app) {
            // Rotate log file if it exceeds 5MB
            if let Ok(meta) = fs::metadata(&log_path) {
                if meta.len() > 5 * 1024 * 1024 {
                    let backup = log_path.with_extension("log.1");
                    let _ = fs::rename(&log_path, &backup);
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

pub fn log(
    level: LogLevel,
    app: &tauri::AppHandle,
    store: &Mutex<DiagnosticsStore>,
    source: LogSource,
    message: impl Into<String>,
) {
    let event = DiagnosticEvent::new(level, source, message.into());
    if let Ok(mut store) = store.lock() {
        store.push(app, event.clone());
    }
    use tauri::Emitter;
    let _ = app.emit("diagnostic-event", event);
}

// --- Commands ---

#[tauri::command]
pub fn get_diagnostics(
    state: tauri::State<'_, Mutex<DiagnosticsStore>>,
) -> Result<Vec<DiagnosticEvent>, String> {
    Ok(state
        .lock()
        .map_err(|_| "Diagnostics store poisoned".to_string())?
        .events())
}

#[tauri::command]
pub fn clear_diagnostics(state: tauri::State<'_, Mutex<DiagnosticsStore>>) -> Result<(), String> {
    state
        .lock()
        .map_err(|_| "Diagnostics store poisoned".to_string())?
        .clear();
    Ok(())
}

/// Returns the absolute path of the persistent diagnostics log file.
#[tauri::command]
pub fn get_diagnostics_log_path(app: tauri::AppHandle) -> Result<String, String> {
    get_log_path(&app).map(|p| p.to_string_lossy().to_string())
}

/// Writes the current in-memory event buffer to the log file and opens
/// it with the default OS application (text editor / file manager).
#[tauri::command]
pub fn export_diagnostics_log(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DiagnosticsStore>>,
) -> Result<String, String> {
    let events = state
        .lock()
        .map_err(|_| "Diagnostics store poisoned".to_string())?
        .events();

    let log_path = get_log_path(&app)?;

    // Write a fresh snapshot (in addition to the live-appended file)
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Cannot open log file: {e}"))?;

    for event in &events {
        let line = format!(
            "{} [{}] [{}] {}\n",
            event.timestamp, event.level, event.source, event.message
        );
        file.write_all(line.as_bytes())
            .map_err(|e| format!("Write error: {e}"))?;
    }
    drop(file);

    // Open the log file with the OS default handler
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&log_path)
        .spawn()
        .map_err(|e| format!("Failed to open log file: {e}"))?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&log_path)
        .spawn()
        .map_err(|e| format!("Failed to open log file: {e}"))?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("notepad")
        .arg(&log_path)
        .spawn()
        .map_err(|e| format!("Failed to open log file: {e}"))?;

    Ok(log_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn add_diagnostic_event(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DiagnosticsStore>>,
    level: LogLevel,
    source: LogSource,
    message: String,
) -> Result<(), String> {
    let event = DiagnosticEvent::new(level, source, message);
    state
        .lock()
        .map_err(|_| "Diagnostics store poisoned".to_string())?
        .push(&app, event.clone());
    use tauri::Emitter;
    let _ = app.emit("diagnostic-event", event);
    Ok(())
}
