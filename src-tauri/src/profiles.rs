// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

use glacier_core::eq::PEQData;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct ProfileDto {
    name: String,
    data: PEQData,
    modified: Option<String>,
}

fn app_data_base_dir() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("FROST_TUNE_HOME") {
        if !dir.trim().is_empty() {
            return Ok(PathBuf::from(dir));
        }
    }

    platform_data_dir()
}

#[cfg(target_os = "linux")]
fn platform_data_dir() -> Result<PathBuf, String> {
    if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
        if !xdg.trim().is_empty() {
            return Ok(PathBuf::from(xdg).join("frost-tune"));
        }
    }

    let home = std::env::var("HOME").map_err(|_| {
        "Cannot resolve HOME. Set FROST_TUNE_HOME to your Frost-Tune data directory.".to_string()
    })?;
    Ok(PathBuf::from(home).join(".local/share/frost-tune"))
}

#[cfg(target_os = "macos")]
fn platform_data_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| {
        "Cannot resolve HOME. Set FROST_TUNE_HOME to your Frost-Tune data directory.".to_string()
    })?;
    Ok(PathBuf::from(home)
        .join("Library/Application Support")
        .join("frost-tune"))
}

#[cfg(target_os = "windows")]
fn platform_data_dir() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|_| {
        "Cannot resolve APPDATA. Set FROST_TUNE_HOME to your Frost-Tune data directory.".to_string()
    })?;
    Ok(PathBuf::from(appdata).join("frost-tune"))
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn platform_data_dir() -> Result<PathBuf, String> {
    Err("Unsupported platform. Set FROST_TUNE_HOME to your Frost-Tune data directory.".to_string())
}

fn profiles_dir() -> Result<PathBuf, String> {
    let dir = app_data_base_dir()?.join("profiles");
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create profiles directory: {error}"))?;
    Ok(dir)
}

fn sanitize_profile_name(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-' || *c == ' ')
        .collect()
}

fn modified_time_string(path: &Path) -> Option<String> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let datetime = chrono::DateTime::<chrono::Local>::from(modified);
    Some(datetime.format("%Y-%m-%d %H:%M").to_string())
}

#[tauri::command]
pub fn list_profiles() -> Result<Vec<ProfileDto>, String> {
    let dir = profiles_dir()?;
    let mut profiles = Vec::new();

    for entry in std::fs::read_dir(&dir).map_err(|error| {
        format!(
            "Failed to read profiles directory {}: {error}",
            dir.display()
        )
    })? {
        let entry =
            entry.map_err(|error| format!("Failed to read profile directory entry: {error}"))?;
        if let Some(profile) = read_profile(entry.path())? {
            profiles.push(profile);
        }
    }

    profiles.sort_by_key(|profile| profile.name.to_lowercase());
    Ok(profiles)
}

fn read_profile(path: PathBuf) -> Result<Option<ProfileDto>, String> {
    if !path.is_file() || path.extension().and_then(|ext| ext.to_str()) != Some("txt") {
        return Ok(None);
    }

    let metadata = std::fs::metadata(&path)
        .map_err(|error| format!("Failed to stat profile {}: {error}", path.display()))?;
    if metadata.len() > 1024 * 1024 {
        log::warn!("Skipping oversized profile {}", path.display());
        return Ok(None);
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) => {
            log::warn!("Skipping unreadable profile {}: {}", path.display(), error);
            return Ok(None);
        }
    };

    let (data, _, warnings) = match glacier_core::autoeq::parse_autoeq_text(&content) {
        Ok(parsed) => parsed,
        Err(error) => {
            log::warn!("Skipping unparsable profile {}: {}", path.display(), error);
            return Ok(None);
        }
    };

    for warning in warnings {
        log::warn!("Profile {} warning: {}", path.display(), warning);
    }

    let name = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("Unnamed Profile")
        .to_string();

    Ok(Some(ProfileDto {
        name,
        data,
        modified: modified_time_string(&path),
    }))
}

#[tauri::command]
pub fn save_profile(name: String, peq: PEQData) -> Result<(), String> {
    let sanitized = sanitize_profile_name(&name);
    if sanitized.trim().is_empty() {
        return Err("Enter a profile name first.".to_string());
    }

    let dir = profiles_dir()?;
    let path = dir.join(format!("{sanitized}.txt"));
    let tmp_path = dir.join(format!(".{sanitized}.tmp"));
    let content = glacier_core::autoeq::peq_to_autoeq(&peq);

    std::fs::write(&tmp_path, content).map_err(|error| {
        format!(
            "Failed to write temporary profile {}: {error}",
            tmp_path.display()
        )
    })?;
    std::fs::rename(&tmp_path, &path)
        .map_err(|error| format!("Failed to save profile {}: {error}", path.display()))?;
    Ok(())
}

#[tauri::command]
pub fn delete_profile(name: String) -> Result<(), String> {
    let sanitized = sanitize_profile_name(&name);
    if sanitized.trim().is_empty() {
        return Err("No profile selected.".to_string());
    }

    let path = profiles_dir()?.join(format!("{sanitized}.txt"));
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to delete profile {}: {error}",
            path.display()
        )),
    }
}

#[tauri::command]
pub fn open_profiles_dir() -> Result<(), String> {
    let dir = profiles_dir()?;
    open_dir(&dir).map(|_| ()).map_err(|error| {
        format!(
            "Failed to open profiles directory {}: {error}",
            dir.display()
        )
    })
}

#[cfg(target_os = "windows")]
fn open_dir(dir: &Path) -> std::io::Result<std::process::Child> {
    std::process::Command::new("explorer").arg(dir).spawn()
}

#[cfg(target_os = "macos")]
fn open_dir(dir: &Path) -> std::io::Result<std::process::Child> {
    std::process::Command::new("open").arg(dir).spawn()
}

#[cfg(target_os = "linux")]
fn open_dir(dir: &Path) -> std::io::Result<std::process::Child> {
    std::process::Command::new("xdg-open").arg(dir).spawn()
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn open_dir(_dir: &Path) -> std::io::Result<std::process::Child> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "opening profile folders is not supported on this platform",
    ))
}
