// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

//! Tauri backend for Glacier EQ — exposes hardware and EQ operations to the web frontend.

mod walkplay;

use glacier_core::device::get_supported_device;
use glacier_core::eq::PEQData;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
struct ProfileDto {
    name: String,
    data: PEQData,
    modified: Option<String>,
}

#[derive(Debug, Clone)]
struct ConnectedDevice {
    path: String,
    vendor_id: u16,
    product_id: u16,
    profile_name: String,
}

#[derive(Debug, Default)]
struct DeviceState {
    connected: Option<ConnectedDevice>,
}

fn app_data_base_dir() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("FROST_TUNE_HOME") {
        if !dir.trim().is_empty() {
            return Ok(PathBuf::from(dir));
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            if !xdg.trim().is_empty() {
                return Ok(PathBuf::from(xdg).join("frost-tune"));
            }
        }
        let home = std::env::var("HOME").map_err(|_| {
            "Cannot resolve HOME. Set FROST_TUNE_HOME to your Frost-Tune data directory."
                .to_string()
        })?;
        return Ok(PathBuf::from(home).join(".local/share/frost-tune"));
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").map_err(|_| {
            "Cannot resolve HOME. Set FROST_TUNE_HOME to your Frost-Tune data directory."
                .to_string()
        })?;
        return Ok(PathBuf::from(home)
            .join("Library/Application Support")
            .join("frost-tune"));
    }

    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").map_err(|_| {
            "Cannot resolve APPDATA. Set FROST_TUNE_HOME to your Frost-Tune data directory."
                .to_string()
        })?;
        return Ok(PathBuf::from(appdata).join("frost-tune"));
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform. Set FROST_TUNE_HOME to your Frost-Tune data directory.".to_string())
}

fn profiles_dir() -> Result<PathBuf, String> {
    let dir = app_data_base_dir()?.join("profiles");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create profiles directory: {e}"))?;
    Ok(dir)
}

fn sanitize_profile_name(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-' || *c == ' ')
        .collect()
}

fn modified_time_string(path: &std::path::Path) -> Option<String> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let datetime = chrono::DateTime::<chrono::Local>::from(modified);
    Some(datetime.format("%Y-%m-%d %H:%M").to_string())
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Pull the current EQ state from the connected DAC.
#[tauri::command]
fn get_eq_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<PEQData, String> {
    use tauri_plugin_hid::HidExt;

    let connected = state
        .lock()
        .map_err(|_| "Device state lock poisoned".to_string())?
        .connected
        .clone()
        .ok_or_else(|| {
            "No supported DAC connected. Connect a device before pulling.".to_string()
        })?;

    let caps =
        walkplay::runtime_caps(connected.vendor_id, connected.product_id).ok_or_else(|| {
            format!(
                "No read protocol registered for {:04X}:{:04X}",
                connected.vendor_id, connected.product_id
            )
        })?;
    let hid = app.hid();
    let path = connected.path.as_str();

    // Same wake-up behavior as Frost-Tune's pull_with_retry: poke global gain,
    // let the DAC settle, then start a fresh init/version session that drains stale
    // frames before reading individual bands.
    if let Err(e) = hid.write(
        path,
        &walkplay::frame_packet(&walkplay::global_gain_request()),
    ) {
        log::warn!("Pull wake request failed: {e}");
    }
    std::thread::sleep(Duration::from_millis(50));

    let pull_once = || -> Result<PEQData, String> {
        for packet in walkplay::init_packets() {
            hid.write(path, &walkplay::frame_packet(&packet))
                .map_err(|e| format!("Pull init write failed: {e}"))?;
        }
        std::thread::sleep(Duration::from_millis(50));

        for _ in 0..100 {
            match hid.read(path, 20) {
                Ok(bytes) if bytes.is_empty() => break,
                Ok(_) => continue,
                Err(_) => break,
            }
        }

        let mut filters = Vec::with_capacity(caps.num_bands);
        for index in 0..caps.num_bands {
            let nonce = (index as u8).wrapping_add(1).max(1);
            let request = walkplay::filter_read_request(index as u8, nonce);
            hid.write(path, &walkplay::frame_packet(&request))
                .map_err(|e| format!("Filter {} read request failed: {e}", index + 1))?;

            let mut found = None;
            let mut mismatches = 0usize;
            for _ in 0..60 {
                let bytes = hid
                    .read(path, 60)
                    .map_err(|e| format!("Filter {} read failed: {e}", index + 1))?;
                if bytes.is_empty() {
                    continue;
                }

                let data = walkplay::unframe_packet(&bytes);
                if walkplay::matches_filter_response(data, index as u8, nonce) {
                    found = walkplay::parse_filter_response(data);
                    break;
                }

                if !data.is_empty() {
                    mismatches += 1;
                    if mismatches > 8 {
                        break;
                    }
                }
            }

            let Some(filter) = found else {
                return Err(format!(
                    "Failed to read filter {} from {}",
                    index + 1,
                    connected.profile_name
                ));
            };
            filters.push(filter);
            std::thread::sleep(Duration::from_millis(10));
        }

        std::thread::sleep(Duration::from_millis(40));
        hid.write(
            path,
            &walkplay::frame_packet(&walkplay::global_gain_request()),
        )
        .map_err(|e| format!("Global gain read request failed: {e}"))?;
        std::thread::sleep(Duration::from_millis(25));

        let mut global_gain = None;
        for _ in 0..20 {
            let bytes = hid
                .read(path, 60)
                .map_err(|e| format!("Global gain read failed: {e}"))?;
            if bytes.is_empty() {
                continue;
            }
            let data = walkplay::unframe_packet(&bytes);
            if walkplay::matches_global_gain_response(data) {
                global_gain = walkplay::parse_global_gain_response(data);
                if global_gain.is_some() {
                    break;
                }
            }
        }

        Ok(PEQData {
            filters,
            global_gain: global_gain.ok_or_else(|| "Global gain read timeout".to_string())?,
        })
    };

    let first = pull_once();
    let should_retry = match &first {
        Ok(peq) => walkplay::is_default_state(peq),
        Err(_) => true,
    };

    let peq = if should_retry {
        std::thread::sleep(Duration::from_millis(100));
        match pull_once() {
            Ok(peq) => peq,
            Err(retry_error) => match first {
                Ok(defaultish) => defaultish,
                Err(_) => return Err(retry_error),
            },
        }
    } else {
        first?
    };

    log::info!(
        "Pulled EQ from {}: {} bands, global_gain={}",
        connected.profile_name,
        peq.filters.len(),
        peq.global_gain
    );
    Ok(peq)
}

/// Apply a new EQ state to the connected DAC.
#[tauri::command]
fn set_eq_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    peq: PEQData,
) -> Result<(), String> {
    use tauri_plugin_hid::HidExt;

    let connected = state
        .lock()
        .map_err(|_| "Device state lock poisoned".to_string())?
        .connected
        .clone()
        .ok_or_else(|| {
            "No supported DAC connected. Connect a device before pushing.".to_string()
        })?;

    let caps =
        walkplay::runtime_caps(connected.vendor_id, connected.product_id).ok_or_else(|| {
            format!(
                "No write protocol registered for {:04X}:{:04X}",
                connected.vendor_id, connected.product_id
            )
        })?;
    let peq = walkplay::normalize_for_push(peq, caps);
    let hid = app.hid();

    // Match Frost-Tune's write flow: init/wake, drain stale frames, write all
    // filters, write global gain, then commit to flash with the Walkplay two-step
    // sequence. The previous implementation only logged the payload, so Push could
    // appear successful without changing hardware.
    for packet in walkplay::init_packets() {
        hid.write(&connected.path, &walkplay::frame_packet(&packet))
            .map_err(|e| format!("Init write failed: {e}"))?;
    }
    std::thread::sleep(Duration::from_millis(50));
    for _ in 0..100 {
        match hid.read(&connected.path, 20) {
            Ok(bytes) if bytes.is_empty() => break,
            Ok(_) => continue,
            Err(_) => break,
        }
    }

    for (index, filter) in peq.filters.iter().enumerate() {
        let packet = walkplay::filter_write_packet(index as u8, filter, caps.dsp_sample_rate);
        hid.write(&connected.path, &walkplay::frame_packet(&packet))
            .map_err(|e| format!("Band {} write failed: {e}", index + 1))?;
        std::thread::sleep(Duration::from_millis(80));
    }

    std::thread::sleep(Duration::from_millis(100));
    let gain_packet = walkplay::global_gain_write_packet(peq.global_gain);
    hid.write(&connected.path, &walkplay::frame_packet(&gain_packet))
        .map_err(|e| format!("Global gain write failed: {e}"))?;
    std::thread::sleep(Duration::from_millis(50));

    for packet in walkplay::commit_packets() {
        hid.write(&connected.path, &walkplay::frame_packet(&packet))
            .map_err(|e| format!("Commit write failed: {e}"))?;
        std::thread::sleep(Duration::from_millis(500));
    }

    log::info!(
        "Pushed EQ to {}: {} bands, global_gain={}",
        connected.profile_name,
        peq.filters.len(),
        peq.global_gain
    );
    Ok(())
}

/// Load saved AutoEQ profiles from the same on-disk location Frost-Tune uses.
#[tauri::command]
fn list_profiles() -> Result<Vec<ProfileDto>, String> {
    let dir = profiles_dir()?;
    let mut profiles = Vec::new();

    for entry in std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read profiles directory {}: {e}", dir.display()))?
    {
        let entry = entry.map_err(|e| format!("Failed to read profile directory entry: {e}"))?;
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|ext| ext.to_str()) != Some("txt") {
            continue;
        }

        let metadata = std::fs::metadata(&path)
            .map_err(|e| format!("Failed to stat profile {}: {e}", path.display()))?;
        if metadata.len() > 1024 * 1024 {
            log::warn!("Skipping oversized profile {}", path.display());
            continue;
        }

        let content = match std::fs::read_to_string(&path) {
            Ok(content) => content,
            Err(e) => {
                log::warn!("Skipping unreadable profile {}: {}", path.display(), e);
                continue;
            }
        };
        let (data, _, warnings) = match glacier_core::autoeq::parse_autoeq_text(&content) {
            Ok(parsed) => parsed,
            Err(e) => {
                log::warn!("Skipping unparsable profile {}: {}", path.display(), e);
                continue;
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
        profiles.push(ProfileDto {
            name,
            data,
            modified: modified_time_string(&path),
        });
    }

    profiles.sort_by_key(|profile| profile.name.to_lowercase());
    Ok(profiles)
}

/// Save the current EQ as a Frost-Tune-compatible AutoEQ text profile.
#[tauri::command]
fn save_profile(name: String, peq: PEQData) -> Result<(), String> {
    let sanitized = sanitize_profile_name(&name);
    if sanitized.trim().is_empty() {
        return Err("Enter a profile name first.".to_string());
    }

    let dir = profiles_dir()?;
    let path = dir.join(format!("{sanitized}.txt"));
    let tmp_path = dir.join(format!(".{sanitized}.tmp"));
    let content = glacier_core::autoeq::peq_to_autoeq(&peq);

    std::fs::write(&tmp_path, content).map_err(|e| {
        format!(
            "Failed to write temporary profile {}: {e}",
            tmp_path.display()
        )
    })?;
    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to save profile {}: {e}", path.display()))?;
    Ok(())
}

#[tauri::command]
fn delete_profile(name: String) -> Result<(), String> {
    let sanitized = sanitize_profile_name(&name);
    if sanitized.trim().is_empty() {
        return Err("No profile selected.".to_string());
    }

    let path = profiles_dir()?.join(format!("{sanitized}.txt"));
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Failed to delete profile {}: {e}", path.display())),
    }
}

#[tauri::command]
fn open_profiles_dir() -> Result<(), String> {
    let dir = profiles_dir()?;

    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(&dir).spawn();

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&dir).spawn();

    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(&dir).spawn();

    result
        .map(|_| ())
        .map_err(|e| format!("Failed to open profiles directory {}: {e}", dir.display()))
}

/// List connected USB DACs compatible with Glacier EQ.
///
/// Frost-Tune only shows DACs that match its compiled-in registry. Keep the same
/// behavior here: enumerate HID devices, match by VID/PID, and drop every other
/// keyboard/mouse/gamepad/debug HID interface before it reaches the UI.
#[tauri::command]
async fn list_devices(
    app: tauri::AppHandle,
) -> Result<Vec<glacier_core::device::DeviceInfo>, String> {
    use std::collections::HashSet;
    use tauri_plugin_hid::HidExt;

    let hid = app.hid();
    let devices = hid.enumerate().map_err(|e| e.to_string())?;
    let mut seen_paths = HashSet::new();

    let compatible: Vec<glacier_core::device::DeviceInfo> = devices
        .iter()
        .filter_map(|d| {
            let profile = get_supported_device(d.vendor_id, d.product_id)?;

            // HID enumeration can expose more than one interface for the same DAC.
            // Deduplicate by path to keep the picker readable while preserving the
            // exact path needed for connect/open later.
            if !seen_paths.insert(d.path.clone()) {
                return None;
            }

            Some(glacier_core::device::DeviceInfo {
                vendor_id: d.vendor_id,
                product_id: d.product_id,
                path: d.path.clone(),
                manufacturer: d.manufacturer_string.clone(),
                product_string: d.product_string.clone(),
                profile_name: Some(profile.name.to_string()),
            })
        })
        .collect();

    Ok(compatible)
}

/// Connect to a specific DAC by its device path.
#[tauri::command]
async fn connect_device(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
    path: String,
) -> Result<(), String> {
    use tauri_plugin_hid::HidExt;

    let hid = app.hid();
    let devices = hid.enumerate().map_err(|e| e.to_string())?;
    let Some(device) = devices.iter().find(|d| d.path == path) else {
        return Err("Device disappeared. Scan again and reconnect.".to_string());
    };

    let Some(profile) = get_supported_device(device.vendor_id, device.product_id) else {
        return Err(format!(
            "Unsupported HID device {:04X}:{:04X}. Glacier EQ only connects to supported DACs.",
            device.vendor_id, device.product_id
        ));
    };

    if let Some(previous) = state
        .lock()
        .map_err(|_| "Device state lock poisoned".to_string())?
        .connected
        .take()
    {
        let _ = hid.close(&previous.path);
    }

    hid.open(&path)
        .map_err(|e| format!("Failed to open {}: {e}", profile.name))?;

    state
        .lock()
        .map_err(|_| "Device state lock poisoned".to_string())?
        .connected = Some(ConnectedDevice {
        path: path.clone(),
        vendor_id: device.vendor_id,
        product_id: device.product_id,
        profile_name: profile.name.to_string(),
    });

    log::info!("Connected to supported DAC: {} ({})", profile.name, path);
    Ok(())
}

/// Disconnect from the current DAC.
#[tauri::command]
fn disconnect_device(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DeviceState>>,
) -> Result<(), String> {
    use tauri_plugin_hid::HidExt;

    if let Some(device) = state
        .lock()
        .map_err(|_| "Device state lock poisoned".to_string())?
        .connected
        .take()
    {
        app.hid()
            .close(&device.path)
            .map_err(|e| format!("Failed to close {}: {e}", device.profile_name))?;
    }
    Ok(())
}

// ── App entry point ─────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(DeviceState::default()))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_hid::init())
        .invoke_handler(tauri::generate_handler![
            get_eq_state,
            set_eq_state,
            list_profiles,
            save_profile,
            delete_profile,
            open_profiles_dir,
            list_devices,
            connect_device,
            disconnect_device,
        ])
        .run(tauri::generate_context!())
        .expect("error while running glacier-eq");
}
