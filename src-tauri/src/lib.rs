// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Tauri backend for Glacier EQ.

use std::path::PathBuf;
use std::sync::Mutex;

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

use diagnostics::DiagnosticsStore;
use state::{DeviceSessionLock, DeviceState};
#[cfg(not(mobile))]
use tauri_plugin_window_state::StateFlags;

mod device_commands;
mod diagnostics;
#[cfg(target_os = "linux")]
pub mod hid_helper;
mod profiles;
mod settings;
mod state;

use tauri::Manager;

const MAX_TEXT_FILE_BYTES: u64 = 1 << 20;

/// Resolve the set of directories the raw fs commands are allowed to touch.
/// We scope file access to the application data directory, user documents, and downloads
/// so these IPC commands cannot be abused to read/write arbitrary system files.
fn allowed_bases(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut bases = Vec::new();
    if let Ok(dir) = profiles::app_data_base_dir(app) {
        if let Ok(canon) = std::fs::canonicalize(&dir) {
            bases.push(canon);
        } else {
            bases.push(dir);
        }
    }
    if let Ok(docs) = app.path().document_dir() {
        if let Ok(canon) = std::fs::canonicalize(&docs) {
            bases.push(canon);
        } else {
            bases.push(docs);
        }
    }
    if let Ok(downloads) = app.path().download_dir() {
        if let Ok(canon) = std::fs::canonicalize(&downloads) {
            bases.push(canon);
        } else {
            bases.push(downloads);
        }
    }
    #[cfg(not(mobile))]
    if let Ok(desktop) = app.path().desktop_dir() {
        if let Ok(canon) = std::fs::canonicalize(&desktop) {
            bases.push(canon);
        } else {
            bases.push(desktop);
        }
    }
    bases
}

/// Returns true only if `path` canonicalizes to a location inside one of the
/// allowed base directories (symlinks resolved, traversal rejected).
fn is_path_allowed(app: &tauri::AppHandle, path: &str) -> bool {
    let bases = allowed_bases(app);
    if std::fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return false;
    }
    let Ok(canon) = std::fs::canonicalize(path) else {
        // If the file does not exist yet (write path), validate the parent.
        let p = PathBuf::from(path);
        let Some(parent) = p.parent() else {
            return false;
        };
        let Ok(parent_canon) = std::fs::canonicalize(parent) else {
            return false;
        };
        return bases.iter().any(|base| parent_canon.starts_with(base));
    };
    bases.iter().any(|base| canon.starts_with(base))
}

/// Opens `path` without following a symlink at the final component, closing
/// the check-then-use window between `is_path_allowed` and the file I/O.
#[cfg(unix)]
fn open_no_follow(path: &PathBuf, create: bool) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(!create).custom_flags(libc::O_NOFOLLOW);
    if create {
        options.write(true).create(true).truncate(true);
    }
    options.open(path)
}

#[cfg(not(unix))]
fn open_no_follow(path: &PathBuf, create: bool) -> std::io::Result<std::fs::File> {
    if create {
        std::fs::File::create(path)
    } else {
        std::fs::File::open(path)
    }
}

#[tauri::command]
fn save_text_file(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    if !is_path_allowed(&app, &path) {
        return Err("Refused: file path is outside allowed directories".into());
    }
    if content.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err("Refused: content exceeds the 1 MiB limit".into());
    }
    use std::io::Write;
    let mut file = open_no_follow(&PathBuf::from(&path), true)
        .map_err(|e| format!("Failed to write file: {e}"))?;
    // Re-validate after open: a path component swapped in between the pre-open
    // check and open() canonicalizes outside the allowed bases now. Ceiling:
    // the create/truncate has already happened at this point; fully closing
    // that gap needs openat2(RESOLVE_NO_SYMLINKS).
    if !is_path_allowed(&app, &path) {
        drop(file);
        return Err("Refused: file path is outside allowed directories".into());
    }
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write file: {e}"))
}

#[tauri::command]
fn read_text_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    if !is_path_allowed(&app, &path) {
        return Err("Refused: file path is outside allowed directories".into());
    }
    let file = open_no_follow(&PathBuf::from(&path), false)
        .map_err(|e| format!("Failed to read file: {e}"))?;
    // Re-validate after open (see save_text_file): refuses to read content if
    // a component was swapped in after the pre-open check.
    if !is_path_allowed(&app, &path) {
        drop(file);
        return Err("Refused: file path is outside allowed directories".into());
    }
    // Read bounded: the stat-then-read gap could otherwise admit a swapped or
    // growing file larger than the limit into memory.
    use std::io::Read;
    let mut limited = file.take(MAX_TEXT_FILE_BYTES + 1);
    let mut bytes = Vec::new();
    limited
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Failed to read file: {e}"))?;
    if bytes.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err("Refused: file exceeds the 1 MiB limit".into());
    }
    // Size-check before decoding so an oversized file gets the size refusal,
    // not a confusing invalid-UTF-8 error from cutting mid-character.
    String::from_utf8(bytes).map_err(|e| format!("Failed to decode file as UTF-8: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(not(mobile))]
    let window_state_flags = StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED;
    let mut builder = tauri::Builder::default()
        .manage(Mutex::new(DeviceState::default()))
        .manage(DeviceSessionLock::default())
        .manage(Mutex::new(DiagnosticsStore::default()));
    #[cfg(target_os = "linux")]
    {
        builder = builder.manage(Mutex::new(None::<hid_helper::ElevatedTransport>));
    }
    builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_hid::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    #[cfg(not(mobile))]
    {
        builder = builder.plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(window_state_flags)
                .build(),
        );
    }

    builder
        .invoke_handler(tauri::generate_handler![
            device_commands::get_eq_state,
            device_commands::set_eq_state,
            device_commands::apply_eq_state,
            device_commands::get_dac_utility_state,
            device_commands::set_dac_filter_mode,
            device_commands::set_dac_work_mode,
            device_commands::set_dac_output_gain,
            device_commands::set_dac_balance,
            device_commands::set_mic_volume,
            device_commands::reset_device_eq,
            device_commands::reset_device_controls,
            device_commands::execute_factory_reset,
            profiles::list_profiles,
            profiles::save_profile,
            profiles::delete_profile,
            profiles::open_profiles_dir,
            profiles::parse_autoeq,
            profiles::peq_to_autoeq,
            profiles::run_autoeq,
            profiles::match_profile_name,
            device_commands::list_devices,
            device_commands::list_supported_devices,
            device_commands::connect_device,
            device_commands::get_firmware_version,
            device_commands::disconnect_device,
            settings::get_settings,
            settings::save_settings,
            read_text_file,
            diagnostics::get_diagnostics,
            diagnostics::clear_diagnostics,
            diagnostics::add_diagnostic_event,
            save_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running glacier-eq");
}
