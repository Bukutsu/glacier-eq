// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use crate::profiles::app_data_base_dir;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Settings {
    pub auto_pull_on_connect: bool,
    pub skip_push_verification: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_pull_on_connect: true,
            skip_push_verification: false,
        }
    }
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(app_data_base_dir()?.join("settings.json"))
}

#[tauri::command]
pub fn get_settings() -> Result<Settings, String> {
    let path = settings_path()?;
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
pub fn save_settings(settings: Settings) -> Result<(), String> {
    let path = settings_path()?;
    let tmp_path = path.with_extension("tmp");
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("Failed to serialize settings: {error}"))?;

    fs::write(&tmp_path, content)
        .map_err(|error| format!("Failed to write temporary settings file: {error}"))?;

    fs::rename(&tmp_path, &path)
        .map_err(|error| format!("Failed to save settings file: {error}"))?;

    Ok(())
}
