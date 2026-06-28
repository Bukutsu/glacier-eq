// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::profiles::app_data_base_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

fn default_theme() -> String {
    "tokyo-night".to_string()
}

fn default_show_diagnostics() -> bool {
    false
}

fn default_enable_online_measurements() -> bool {
    false
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub auto_pull_on_connect: bool,
    pub skip_push_verification: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_show_diagnostics")]
    pub show_diagnostics: bool,
    #[serde(default = "default_enable_online_measurements")]
    pub enable_online_measurements: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_pull_on_connect: true,
            skip_push_verification: false,
            theme: default_theme(),
            show_diagnostics: default_show_diagnostics(),
            enable_online_measurements: default_enable_online_measurements(),
        }
    }
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_base_dir(app)?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create data directory: {error}"))?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(Settings::default());
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read settings file: {error}"))?;

    let settings = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse settings JSON: {error}"))?;

    Ok(settings)
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let path = settings_path(&app)?;
    let tmp_path = path.with_extension("tmp");
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("Failed to serialize settings: {error}"))?;

    fs::write(&tmp_path, content)
        .map_err(|error| format!("Failed to write temporary settings file: {error}"))?;

    fs::rename(&tmp_path, &path)
        .map_err(|error| format!("Failed to save settings file: {error}"))?;

    Ok(())
}
