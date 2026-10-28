// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::profiles::app_data_base_dir;
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use fs2::FileExt;

fn default_theme() -> String {
    "tokyo-night".to_string()
}

/// Must match the themes offered by the settings UI (and the web parser).
const KNOWN_THEMES: &[&str] = &[
    "auto",
    "glacier",
    "glacier-light",
    "tokyo-night",
    "tokyo-night-storm",
    "tokyo-night-day",
    "nord",
    "dracula",
    "gruvbox",
    "catppuccin-mocha",
    "catppuccin-latte",
    "material-you",
];

fn is_known_theme(theme: &str) -> bool {
    KNOWN_THEMES.contains(&theme)
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
    /// Opt-in: write every EQ edit straight to the DAC's RAM (nothing is saved).
    #[serde(default)]
    pub live_apply: bool,
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
            live_apply: false,
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

struct SettingsFileLock {
    file: fs::File,
}

impl Drop for SettingsFileLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}

fn with_settings_file_lock<T>(
    path: &Path,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let lock_path = path.with_file_name(".settings-operation.lock");
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|error| format!("Failed to open settings lock: {error}"))?;
    file.lock_exclusive()
        .map_err(|error| format!("Failed to lock settings: {error}"))?;
    let _lock = SettingsFileLock { file };
    operation()
}

#[derive(Debug)]
struct SettingsRead {
    settings: Settings,
    recovery: Option<String>,
}

#[tauri::command]
pub async fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let path = settings_path(&app)?;

    // Disk I/O stays off the IPC thread (see save_settings). No existence
    // pre-check: a file deleted between check and read must fall back to
    // defaults like a missing file, not surface as a hard error.
    let loaded = tauri::async_runtime::spawn_blocking(move || read_settings_detailed(&path))
        .await
        .map_err(|e| e.to_string())??;
    if let Some(notice) = loaded.recovery {
        use tauri::Manager;
        if let Some(state) = app.try_state::<Mutex<crate::diagnostics::DiagnosticsStore>>() {
            crate::diagnostics::record(
                &app,
                &state,
                crate::diagnostics::LogLevel::Warn,
                crate::diagnostics::LogSource::Storage,
                notice,
            );
        }
    }
    Ok(loaded.settings)
}

const MAX_SETTINGS_BYTES: u64 = 1 << 20;

fn read_settings_detailed(path: &Path) -> Result<SettingsRead, String> {
    with_settings_lock(|| {
        with_settings_file_lock(path, || {
            let file = match fs::File::open(path) {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return Ok(SettingsRead {
                        settings: Settings::default(),
                        recovery: None,
                    })
                }
                Err(error) => return Err(format!("Failed to open settings file: {error}")),
            };
            let mut bytes = Vec::new();
            file.take(MAX_SETTINGS_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| format!("Failed to read settings file: {error}"))?;
            if bytes.len() as u64 > MAX_SETTINGS_BYTES {
                recover_oversized_settings(path)?;
                return Ok(SettingsRead {
                settings: Settings::default(),
                recovery: Some("Settings file exceeded 1 MiB and was replaced with defaults; the original was preserved as a backup.".into()),
            });
            }
            let content = match String::from_utf8(bytes) {
                Ok(content) => content,
                Err(error) => {
                    let defaults = Settings::default();
                    quarantine_corrupt_bytes(path, &error.into_bytes())?;
                    let sanitized =
                        serde_json::to_vec_pretty(&defaults).map_err(|recovery_error| {
                            format!("Failed to serialize recovered settings: {recovery_error}")
                        })?;
                    crate::fsutil::atomic_write(path, &sanitized)?;
                    return Ok(SettingsRead {
                    settings: defaults,
                    recovery: Some("Settings contained invalid UTF-8 and were replaced with defaults; the original was preserved as a backup.".into()),
                });
                }
            };
            parse_settings(&content, path)
        })
    })
}

fn parse_settings(content: &str, path: &std::path::Path) -> Result<SettingsRead, String> {
    let value = match serde_json::from_str::<JsonValue>(content) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("glacier-eq: settings.json is unreadable; using defaults: {error}");
            let defaults = Settings::default();
            recover_corrupt_settings(path, content, &defaults)?;
            return Ok(SettingsRead {
                settings: defaults,
                recovery: Some("Settings JSON was unreadable and was replaced with defaults; the original was preserved as a backup.".into()),
            });
        }
    };
    let JsonValue::Object(mut values) = value else {
        let defaults = Settings::default();
        recover_corrupt_settings(path, content, &defaults)?;
        return Ok(SettingsRead {
            settings: defaults,
            recovery: Some("Settings JSON was not an object and was replaced with defaults; the original was preserved as a backup.".into()),
        });
    };

    let mut settings = Settings::default();
    let mut malformed = false;
    for (field, target) in [
        ("auto_pull_on_connect", &mut settings.auto_pull_on_connect),
        (
            "skip_push_verification",
            &mut settings.skip_push_verification,
        ),
        ("live_apply", &mut settings.live_apply),
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
    let mut unrecognised_theme = None;
    if let Some(value) = values.remove("theme") {
        match value.as_str() {
            // Only a wrong *type* is corruption. A theme name this build does
            // not offer is exactly the "newer or forked build" case `extra`
            // exists to carry, and dropping it here both reset the user's
            // theme and rewrote settings.json without it — permanently, since
            // every later launch took this same branch again. The UI already
            // falls back for a theme it cannot resolve.
            Some(theme) if is_known_theme(theme) => settings.theme = theme.to_string(),
            Some(_) => unrecognised_theme = Some(value),
            None => malformed = true,
        }
    }
    settings.extra = values;
    if let Some(theme) = unrecognised_theme {
        settings.extra.insert("theme".into(), theme);
    }
    if malformed {
        recover_corrupt_settings(path, content, &settings)?;
    }
    Ok(SettingsRead {
        settings,
        recovery: malformed.then(|| {
            "Settings contained invalid fields and were replaced with a valid copy; the original was preserved as a backup.".into()
        }),
    })
}

fn next_settings_backup(path: &std::path::Path) -> PathBuf {
    let mut suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    loop {
        let candidate = path.with_file_name(format!("settings.json.bak.{suffix}"));
        if !candidate.exists() {
            return candidate;
        }
        suffix += 1;
    }
}

fn quarantine_corrupt_bytes(path: &std::path::Path, content: &[u8]) -> Result<(), String> {
    let backup = next_settings_backup(path);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&backup)
        .map_err(|error| format!("Failed to create settings backup: {error}"))?;
    file.write_all(content)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Failed to write settings backup: {error}"))
}

fn quarantine_corrupt_settings(path: &std::path::Path, content: &str) -> Result<(), String> {
    quarantine_corrupt_bytes(path, content.as_bytes())
}

fn recover_oversized_settings(path: &std::path::Path) -> Result<(), String> {
    let backup = next_settings_backup(path);
    fs::rename(path, &backup)
        .map_err(|error| format!("Failed to preserve oversized settings: {error}"))?;
    let defaults = serde_json::to_vec_pretty(&Settings::default())
        .map_err(|error| format!("Failed to serialize recovered settings: {error}"))?;
    crate::fsutil::atomic_write(path, &defaults)
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
    // Fall back to the platform default only when the payload names no theme
    // at all. An unknown name is kept verbatim in `extra` so a newer or
    // forked build's setting survives a save made by this one.
    if !is_known_theme(&settings.theme) && !settings.extra.contains_key("theme") {
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

fn save_settings_sync(path: &Path, settings: &Settings) -> Result<(), String> {
    with_settings_file_lock(path, || {
        let content = serde_json::to_string_pretty(settings)
            .map_err(|error| format!("Failed to serialize settings: {error}"))?;
        crate::fsutil::atomic_write(path, content.as_bytes())
    })
}
