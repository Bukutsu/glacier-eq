// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::profiles::app_data_base_dir;
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

fn default_theme() -> String {
    // Material You is the default on Android; everywhere else follows Auto.
    #[cfg(target_os = "android")]
    return "material-you".to_string();
    #[cfg(not(target_os = "android"))]
    return "auto".to_string();
}

/// Must match the themes offered by the settings UI (and the web parser).
fn is_known_theme(theme: &str) -> bool {
    matches!(
        theme,
        "auto"
            | "tokyo-night"
            | "tokyo-night-storm"
            | "tokyo-night-day"
            | "nord"
            | "dracula"
            | "gruvbox"
            | "catppuccin-mocha"
            | "catppuccin-latte"
            | "material-you"
    )
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
    /// Keys written by a newer or forked build. The frontend spreads them
    /// back into every save (settingsPersistence), so keeping them here
    /// stops a save from silently dropping settings this build doesn't know.
    #[serde(flatten)]
    pub extra: JsonMap<String, JsonValue>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_pull_on_connect: true,
            skip_push_verification: false,
            theme: default_theme(),
            snap_to_iso_frequencies: default_snap_to_iso_frequencies(),
            floating_graph_preview: default_floating_graph_preview(),
            extra: JsonMap::new(),
        }
    }
}

static SETTINGS_SAVE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn with_settings_lock<T>(operation: impl FnOnce() -> T) -> T {
    let _guard = SETTINGS_SAVE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    operation()
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_base_dir(app)?.join("settings.json"))
}

#[tauri::command]
pub async fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let path = settings_path(&app)?;

    // Disk I/O stays off the IPC thread (see save_settings). No existence
    // pre-check: a file deleted between check and read must fall back to
    // defaults like a missing file, not surface as a hard error.
    tauri::async_runtime::spawn_blocking(move || read_settings(&path))
        .await
        .map_err(|e| e.to_string())?
}

fn read_settings(path: &std::path::Path) -> Result<Settings, String> {
    with_settings_lock(|| match fs::read_to_string(path) {
        Ok(content) => Ok(parse_settings(&content, path)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(error) => Err(format!("Failed to read settings file: {error}")),
    })
}

fn parse_settings(content: &str, path: &std::path::Path) -> Settings {
    let value = match serde_json::from_str::<JsonValue>(content) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("glacier-eq: settings.json is unreadable; using defaults: {error}");
            let defaults = Settings::default();
            if let Err(recovery_error) = recover_corrupt_settings(path, content, &defaults) {
                eprintln!("glacier-eq: failed to recover unreadable settings: {recovery_error}");
            }
            return defaults;
        }
    };
    let JsonValue::Object(mut values) = value else {
        let defaults = Settings::default();
        if let Err(recovery_error) = recover_corrupt_settings(path, content, &defaults) {
            eprintln!("glacier-eq: failed to recover unreadable settings: {recovery_error}");
        }
        return defaults;
    };

    let mut settings = Settings::default();
    let mut malformed = false;
    for (field, target) in [
        ("auto_pull_on_connect", &mut settings.auto_pull_on_connect),
        (
            "skip_push_verification",
            &mut settings.skip_push_verification,
        ),
        (
            "snap_to_iso_frequencies",
            &mut settings.snap_to_iso_frequencies,
        ),
        (
            "floating_graph_preview",
            &mut settings.floating_graph_preview,
        ),
    ] {
        if let Some(value) = values.remove(field) {
            if let Some(valid) = value.as_bool() {
                *target = valid;
            } else {
                malformed = true;
            }
        }
    }
    if let Some(value) = values.remove("theme") {
        if let Some(theme) = value.as_str().filter(|theme| is_known_theme(theme)) {
            settings.theme = theme.to_string();
        } else {
            malformed = true;
        }
    }
    settings.extra = values;
    if malformed {
        if let Err(recovery_error) = recover_corrupt_settings(path, content, &settings) {
            eprintln!("glacier-eq: failed to recover malformed settings: {recovery_error}");
        }
    }
    settings
}

/// Preserve the corrupt bytes beside the original before replacing the
/// primary. A single backup is retained for a settings path; repeated loads
/// must not create an unbounded stream of identical quarantine files.
fn quarantine_corrupt_settings(path: &std::path::Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if let Ok(entries) = fs::read_dir(parent) {
            if entries.flatten().any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("settings.json.bak.")
            }) {
                return Ok(());
            }
        }
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let backup = path.with_file_name(format!("settings.json.bak.{stamp}"));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&backup)
        .map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())
}

fn recover_corrupt_settings(
    path: &std::path::Path,
    content: &str,
    recovered: &Settings,
) -> Result<(), String> {
    quarantine_corrupt_settings(path, content)?;
    let sanitized = serde_json::to_vec_pretty(recovered)
        .map_err(|error| format!("Failed to serialize recovered settings: {error}"))?;
    crate::fsutil::atomic_write(path, &sanitized)
}

#[tauri::command]
pub async fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let mut settings = settings;
    if !is_known_theme(&settings.theme) {
        settings.theme = default_theme();
    }
    let path = settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        // Disk I/O (including sync_all) stays off the IPC thread so a slow
        // disk cannot freeze the UI.
        with_settings_lock(|| save_settings_sync(&path, &settings))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn save_settings_sync(path: &std::path::Path, settings: &Settings) -> Result<(), String> {
    let content = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Failed to serialize settings: {error}"))?;
    crate::fsutil::atomic_write(path, content.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_settings_keys_survive_a_get_save_round_trip() {
        // Simulates get_settings output flowing back through save_settings:
        // the frontend spreads the whole object, so unknown keys reach the
        // deserializer and must land in `extra`, then re-serialize unchanged.
        let raw = r#"{"theme":"nord","future_option":42,"nested":{"a":true}}"#;
        let settings: Settings = serde_json::from_str(raw).unwrap();
        assert_eq!(settings.theme, "nord");
        assert_eq!(
            settings.extra.get("future_option"),
            Some(&serde_json::json!(42))
        );

        let reencoded: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&settings).unwrap()).unwrap();
        assert_eq!(reencoded["theme"], serde_json::json!("nord"));
        assert_eq!(reencoded["future_option"], serde_json::json!(42));
        assert_eq!(reencoded["nested"]["a"], serde_json::json!(true));
        // Known fields still serialize with their defaults filled in.
        assert_eq!(reencoded["auto_pull_on_connect"], serde_json::json!(true));
    }

    #[test]
    fn malformed_known_fields_recover_independently_like_web() {
        let dir = std::env::temp_dir().join(format!(
            "glacier-settings-field-recovery-{}-{:?}",
            std::process::id(),
            std::thread::current().id(),
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        fs::write(
            &path,
            r#"{"auto_pull_on_connect":false,"skip_push_verification":"true","theme":"dracula","future_setting":42}"#,
        )
        .unwrap();

        let settings = read_settings(&path).unwrap();
        assert!(!settings.auto_pull_on_connect);
        assert!(!settings.skip_push_verification);
        assert_eq!(settings.theme, "dracula");
        assert_eq!(
            settings.extra.get("future_setting"),
            Some(&serde_json::json!(42))
        );
        let repeated = read_settings(&path).unwrap();
        assert!(!repeated.auto_pull_on_connect);
        assert_eq!(repeated.theme, "dracula");

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn known_themes_match_settings_ui_options() {
        for theme in [
            "auto",
            "tokyo-night",
            "tokyo-night-storm",
            "tokyo-night-day",
            "nord",
            "dracula",
            "gruvbox",
            "catppuccin-mocha",
            "catppuccin-latte",
            "material-you",
        ] {
            assert!(is_known_theme(theme));
        }
        assert!(!is_known_theme("dark"));
        assert!(!is_known_theme(""));
    }

    #[test]
    fn corrupt_settings_default_and_keep_original_bytes_backup() {
        let dir = std::env::temp_dir().join(format!(
            "glacier-settings-quarantine-{}-{:?}",
            std::process::id(),
            std::thread::current().id(),
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        // Truncated by an external editor mid-write: parse fails, and the
        // next save_settings would irrecoverably replace these bytes.
        let corrupt = r#"{"theme": "nord", "future_option": "#;
        fs::write(&path, corrupt).unwrap();

        let settings = read_settings(&path).expect("corrupt file must not hard-error");
        assert_eq!(settings.theme, default_theme());
        assert_eq!(settings.extra.len(), 0);
        let repeated = read_settings(&path).expect("recovered settings must load");
        assert_eq!(repeated.theme, default_theme());
        assert!(serde_json::from_str::<Settings>(&fs::read_to_string(&path).unwrap()).is_ok());

        // The original bytes survive beside the file — without the quarantine
        // the directory would hold only settings.json, defaults-only.
        let backups: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("settings.json.bak.")
            })
            .collect();
        assert_eq!(backups.len(), 1, "exactly one timestamped backup");
        let preserved = fs::read(backups[0].path()).unwrap();
        assert_eq!(preserved, corrupt.as_bytes());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn valid_settings_produce_no_backup() {
        let dir = std::env::temp_dir().join(format!(
            "glacier-settings-noquarantine-{}-{:?}",
            std::process::id(),
            std::thread::current().id(),
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        fs::write(&path, r#"{"theme": "nord"}"#).unwrap();

        let settings = read_settings(&path).unwrap();
        assert_eq!(settings.theme, "nord");

        let backup_count = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("settings.json.bak.")
            })
            .count();
        assert_eq!(backup_count, 0);

        fs::remove_dir_all(&dir).ok();
    }
}
