// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::state::DeviceState;
use glacier_core::device::{
    capabilities::DESKTOP_DAC_CAPS, get_supported_device, DeviceCapabilities, DeviceProtocol,
};
use glacier_core::eq::PEQData;
use glacier_core::profile_match::{matching_profile_name, ProfileCandidate};
use glacier_core::profiles::{ProfileStore, StoredProfile};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

pub type ProfileDto = StoredProfile;

pub(crate) fn app_data_base_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = std::env::var_os("GLACIER_EQ_HOME")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(|| {
            app.path()
                .app_data_dir()
                .map_err(|error| format!("Failed to resolve Glacier EQ data directory: {error}"))
        })?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create {}: {error}", dir.display()))?;
    Ok(dir)
}

fn store(app: &tauri::AppHandle) -> Result<ProfileStore, String> {
    ProfileStore::new(app_data_base_dir(app)?)
}

fn connected_match_target(
    state: &tauri::State<'_, Mutex<DeviceState>>,
) -> Result<(DeviceCapabilities, DeviceProtocol), String> {
    let guard = state.lock().unwrap_or_else(|p| p.into_inner());
    let Some(connected) = &guard.connected else {
        return Ok((DESKTOP_DAC_CAPS, DeviceProtocol::Walkplay));
    };
    Ok(
        get_supported_device(connected.vendor_id, connected.product_id)
            .map(|profile| (profile.caps.clone(), profile.protocol))
            .unwrap_or((DESKTOP_DAC_CAPS, DeviceProtocol::Walkplay)),
    )
}

#[tauri::command]
pub async fn match_profile_name(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    peq: PEQData,
) -> Result<Option<String>, String> {
    let (caps, protocol) = connected_match_target(&state)?;
    // Profile listing reads every profile file from disk.
    tauri::async_runtime::spawn_blocking(move || {
        let profiles = store(&app)?.list()?;
        Ok(matching_profile_name(
            &peq,
            profiles.iter().map(|profile| ProfileCandidate {
                name: &profile.name,
                data: &profile.data,
            }),
            &caps,
            protocol,
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_profiles(app: tauri::AppHandle) -> Result<Vec<ProfileDto>, String> {
    // Reads every profile file from disk; keep it off the IPC thread.
    tauri::async_runtime::spawn_blocking(move || store(&app)?.list())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_profile(app: tauri::AppHandle, name: String, peq: PEQData) -> Result<(), String> {
    // fsync + atomic rename must not run on the IPC thread.
    tauri::async_runtime::spawn_blocking(move || store(&app)?.save(&name, &peq))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_profile(app: tauri::AppHandle, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || store(&app)?.delete(&name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn open_profiles_dir(app: tauri::AppHandle) -> Result<(), String> {
    let store = store(&app)?;
    let mut child = open_dir(store.directory()).map_err(|error| {
        format!(
            "Failed to open profiles directory {}: {error}",
            store.directory().display()
        )
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        let _ = child.wait();
    });
    Ok(())
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

#[derive(Debug, Clone, serde::Serialize)]
pub struct AutoEqParseResult {
    pub peq: PEQData,
    pub headphone_name: Option<String>,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub async fn parse_autoeq(
    text: String,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<AutoEqParseResult, String> {
    // Parsing untrusted input is CPU-bound (up to 1 MiB of text).
    let (mut peq, headphone_name, mut warnings) = tauri::async_runtime::spawn_blocking(move || {
        glacier_core::autoeq::parse_autoeq_text(&text)
    })
    .await
    .map_err(|e| e.to_string())??;
    warnings.append(&mut peq.clamp_to_capabilities(&connected_match_target(&state)?.0));
    Ok(AutoEqParseResult {
        peq,
        headphone_name,
        warnings,
    })
}

#[tauri::command]
pub fn peq_to_autoeq(peq: PEQData) -> Result<String, String> {
    Ok(glacier_core::autoeq::peq_to_autoeq(&peq))
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AutoEqRunResult {
    pub peq: PEQData,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub async fn run_autoeq(
    measurement_points: Vec<(f64, f64)>,
    target_points: Vec<(f64, f64)>,
    n_bands: usize,
    steps: usize,
    smooth_type: String,
    fs: f32,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<AutoEqRunResult, String> {
    // CPU-bound optimization: run off the async workers so progress events and
    // other IPC keep flowing while it crunches.
    let mut peq = tauri::async_runtime::spawn_blocking(move || {
        glacier_core::autoeq::run_autoeq(
            &measurement_points,
            &target_points,
            n_bands,
            steps,
            &smooth_type,
            fs,
        )
    })
    .await
    .map_err(|error| format!("AutoEQ worker failed: {error}"))??;
    let warnings = peq.clamp_to_capabilities(&connected_match_target(&state)?.0);
    Ok(AutoEqRunResult { peq, warnings })
}
