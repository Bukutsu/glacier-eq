// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::state::DeviceState;
use glacier_core::device::{
    capabilities::DESKTOP_DAC_CAPS, get_supported_device, DeviceCapabilities,
};
use glacier_core::eq::PEQData;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
pub struct ProfileDto {
    name: String,
    data: PEQData,
    modified: Option<String>,
}

pub(crate) fn app_data_base_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = std::env::var("GLACIER_EQ_HOME")
        .ok()
        .filter(|d| !d.trim().is_empty())
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(|| {
            app.path()
                .app_data_dir()
                .map_err(|e| format!("Failed to resolve Glacier EQ data directory: {e}"))
        })?;

    std::fs::create_dir_all(&dir).map_err(|error| {
        format!(
            "Failed to create Glacier EQ data directory {}: {error}",
            dir.display()
        )
    })?;
    Ok(dir)
}

fn profiles_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_base_dir(app)?.join("profiles");
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

fn connected_caps_or_desktop(
    state: &tauri::State<'_, Mutex<DeviceState>>,
) -> Result<DeviceCapabilities, String> {
    let connected = state
        .lock()
        .map_err(|_| "Device state lock poisoned".to_string())?
        .connected
        .clone();

    Ok(connected
        .and_then(|device| get_supported_device(device.vendor_id, device.product_id))
        .map(|profile| profile.caps.clone())
        .unwrap_or(DESKTOP_DAC_CAPS))
}

#[tauri::command]
pub fn list_profiles(app: tauri::AppHandle) -> Result<Vec<ProfileDto>, String> {
    let dir = profiles_dir(&app)?;
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
pub fn save_profile(app: tauri::AppHandle, name: String, peq: PEQData) -> Result<(), String> {
    let sanitized = sanitize_profile_name(&name);
    if sanitized.trim().is_empty() {
        return Err("Enter a profile name first.".to_string());
    }

    let dir = profiles_dir(&app)?;
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
pub fn delete_profile(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let sanitized = sanitize_profile_name(&name);
    if sanitized.trim().is_empty() {
        return Err("No profile selected.".to_string());
    }

    let path = profiles_dir(&app)?.join(format!("{sanitized}.txt"));
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
pub fn open_profiles_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = profiles_dir(&app)?;
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

#[derive(Debug, Clone, serde::Serialize)]
pub struct AutoEqParseResult {
    pub peq: PEQData,
    pub headphone_name: Option<String>,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub fn parse_autoeq(
    text: String,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<AutoEqParseResult, String> {
    let (mut peq, headphone_name, mut warnings) =
        glacier_core::autoeq::parse_autoeq_text(&text).map_err(|err| err.to_string())?;

    let mut clamp_warnings = peq.clamp_to_capabilities(&connected_caps_or_desktop(&state)?);
    warnings.append(&mut clamp_warnings);

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
pub fn run_autoeq_internal(
    measurement_points: Vec<(f64, f64)>,
    target_points: Vec<(f64, f64)>,
    n_bands: usize,
    steps: usize,
    smooth_type: String,
    fs: f32,
) -> Result<PEQData, String> {
    if n_bands == 0 || n_bands > glacier_core::autoeq::MAX_N {
        return Err("Number of bands must be between 1 and 32".to_string());
    }

    let steps = if steps == 0 { 3000 } else { steps.min(5000) };

    let f = glacier_core::autoeq::generate_log_spaced_freqs();
    let src = glacier_core::autoeq::interpolate_curve(&measurement_points, &f);
    let dst = glacier_core::autoeq::interpolate_curve(&target_points, &f);

    let smooth = match smooth_type.to_lowercase().as_str() {
        "ie" => Some(&glacier_core::autoeq::IE_SMOOTH),
        "oe" => Some(&glacier_core::autoeq::OE_SMOOTH),
        _ => None,
    };

    let mut r = [0.0; glacier_core::autoeq::K];
    let preamp_mean = glacier_core::autoeq::preprocess(&f, &dst, &src, &mut r, smooth, true);

    let mut types = vec![glacier_core::eq::FilterType::Peak; n_bands];
    if n_bands >= 1 {
        types[0] = glacier_core::eq::FilterType::LowShelf;
    }
    if n_bands >= 2 {
        types[1] = glacier_core::eq::FilterType::HighShelf;
    }

    let mut f0 = vec![1000.0; n_bands];
    let mut gain = vec![0.0; n_bands];
    let mut q_vals = vec![1.0; n_bands];

    let f0_lim = vec![
        glacier_core::autoeq::Lim {
            lo: 20.0,
            hi: 16000.0
        };
        n_bands
    ];
    let gain_lim = vec![
        glacier_core::autoeq::Lim {
            lo: -16.0,
            hi: 16.0
        };
        n_bands
    ];
    let mut q_lim = vec![glacier_core::autoeq::Lim { lo: 0.4, hi: 4.0 }; n_bands];

    for n in 0..n_bands {
        if types[n] == glacier_core::eq::FilterType::LowShelf
            || types[n] == glacier_core::eq::FilterType::HighShelf
        {
            q_lim[n] = glacier_core::autoeq::Lim { lo: 0.4, hi: 3.0 };
        }
    }

    let mut amp = Some(0.0);

    glacier_core::autoeq::run_autoeq_optimization(
        steps,
        &types,
        &mut f0,
        &mut gain,
        &mut q_vals,
        &mut amp,
        &f0_lim,
        &gain_lim,
        &q_lim,
        n_bands,
        &f,
        &r,
        fs,
    );

    let mut filters = Vec::with_capacity(n_bands);
    for i in 0..n_bands {
        filters.push(glacier_core::eq::Filter {
            index: i as u8,
            enabled: true,
            freq: f0[i].round() as u16,
            gain: gain[i] as f64,
            q: q_vals[i] as f64,
            filter_type: types[i],
        });
    }

    // Sort filters by frequency and re-index sequentially
    filters.sort_by_key(|f| f.freq);
    for (i, filter) in filters.iter_mut().enumerate() {
        filter.index = i as u8;
    }

    // Calculate the combined frequency response of the optimized filters to prevent digital clipping
    let mut response = [0.0f32; glacier_core::autoeq::K];
    for filter in &filters {
        glacier_core::autoeq::spectrum(
            filter.filter_type,
            filter.freq as f32,
            filter.gain as f32,
            filter.q as f32,
            fs,
            &f,
            &mut response,
        );
    }

    let mut max_gain = 0.0f32;
    for &val in response.iter() {
        if val > max_gain {
            max_gain = val;
        }
    }

    let total_preamp = preamp_mean + amp.unwrap_or(0.0);
    let preamp_val = if total_preamp + max_gain > 0.0 {
        -max_gain
    } else {
        total_preamp
    };
    let preamp = preamp_val as f64;

    Ok(PEQData {
        filters,
        global_gain: preamp,
    })
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
    let mut peq = run_autoeq_internal(
        measurement_points,
        target_points,
        n_bands,
        steps,
        smooth_type,
        fs,
    )?;

    let warnings = peq.clamp_to_capabilities(&connected_caps_or_desktop(&state)?);

    Ok(AutoEqRunResult { peq, warnings })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_run_autoeq_preamp_clipping_prevention() {
        let mut measurement_points = Vec::new();
        let mut target_points = Vec::new();

        // Create a flat measurement and a target with a sharp +12dB boost at 1kHz
        for freq_val in [
            20.0_f64, 100.0, 500.0, 1000.0, 2000.0, 5000.0, 10000.0, 20000.0,
        ] {
            let freq = freq_val;
            measurement_points.push((freq, 0.0));
            if (freq - 1000.0).abs() < 1.0 {
                target_points.push((freq, 12.0));
            } else {
                target_points.push((freq, 0.0));
            }
        }

        let peq = run_autoeq_internal(
            measurement_points,
            target_points,
            5,
            100,
            "None".to_string(),
            48000.0,
        )
        .unwrap();

        // The optimized EQ must have a negative preamp to prevent digital clipping
        assert!(peq.global_gain < 0.0);
    }
}
