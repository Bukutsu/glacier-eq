// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::profiles::app_data_base_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

fn default_theme() -> String {
    "auto".to_string()
}

fn default_snap_to_iso_frequencies() -> bool {
    true
}

fn default_floating_graph_preview() -> bool {
    true
}

fn default_auto_pull_on_connect() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default = "default_auto_pull_on_connect")]
    pub auto_pull_on_connect: bool,
    #[serde(default)]
    pub skip_push_verification: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_snap_to_iso_frequencies")]
    pub snap_to_iso_frequencies: bool,
    #[serde(default = "default_floating_graph_preview")]
    pub floating_graph_preview: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_pull_on_connect: true,
            skip_push_verification: false,
            theme: default_theme(),
            snap_to_iso_frequencies: default_snap_to_iso_frequencies(),
            floating_graph_preview: default_floating_graph_preview(),
        }
    }
}

static SETTINGS_SAVE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_base_dir(app)?.join("settings.json"))
}

#[tauri::command]
pub async fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let path = settings_path(&app)?;

    // Disk I/O stays off the IPC thread (see save_settings). No existence
    // pre-check: a file deleted between check and read must fall back to
    // defaults like a missing file, not surface as a hard error.
    let content = tauri::async_runtime::spawn_blocking(move || fs::read_to_string(&path))
        .await
        .map_err(|e| e.to_string())?;

    match content {
        Ok(content) => {
            // A corrupt or schema-drifted file must not wedge every future
            // get_settings call (or silently diverge from callers that fall
            // back to the default): self-heal to defaults instead.
            match serde_json::from_str(&content) {
                Ok(settings) => Ok(settings),
                Err(_) => Ok(Settings::default()),
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(error) => Err(format!("Failed to read settings file: {error}")),
    }
}

#[tauri::command]
pub async fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let path = settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        // Disk I/O (including sync_all) stays off the IPC thread so a slow
        // disk cannot freeze the UI.
        let _guard = SETTINGS_SAVE_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        save_settings_sync(&path, &settings)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn save_settings_sync(path: &std::path::Path, settings: &Settings) -> Result<(), String> {
    let content = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Failed to serialize settings: {error}"))?;
    crate::fsutil::atomic_write(path, content.as_bytes())
}
