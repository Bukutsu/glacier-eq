// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Tauri backend for Glacier EQ.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

use diagnostics::DiagnosticsStore;
use state::{DeviceSessionLock, DeviceState};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};
#[cfg(not(mobile))]
use tauri_plugin_window_state::StateFlags;

mod device_commands;
mod diagnostics;
mod fsutil;
#[cfg(target_os = "linux")]
pub mod hid_helper;
mod profiles;
mod settings;
mod state;

use tauri::Manager;

const MAX_TEXT_FILE_BYTES: u64 = 1 << 20;

#[derive(serde::Serialize)]
struct OpenedTextFile {
    text: String,
    name: String,
}

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
async fn save_text_file(
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
    if !is_path_allowed(&app, &path) {
        return Err("Refused: file path is outside allowed directories".into());
    }
    if content.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err("Refused: content exceeds the 1 MiB limit".into());
    }
    // Disk I/O stays off the IPC thread so a slow/fsync-stalled disk cannot
    // freeze the UI. The write goes through a temp file + rename so a crash
    // cannot leave a truncated export behind.
    tauri::async_runtime::spawn_blocking(move || {
        if !is_path_allowed(&app, &path) {
            return Err("Refused: file path is outside allowed directories".into());
        }
        crate::fsutil::atomic_write(Path::new(&path), content.as_bytes())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn read_bounded_utf8(reader: impl std::io::Read) -> Result<String, String> {
    use std::io::Read;

    let mut limited = reader.take(MAX_TEXT_FILE_BYTES + 1);
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

fn read_selected_text(app: &tauri::AppHandle, path: FilePath) -> Result<String, String> {
    let file = match path {
        FilePath::Path(path) => open_no_follow(&path, false),
        path @ FilePath::Url(_) => {
            let mut options = OpenOptions::new();
            options.read(true);
            app.fs().open(path, options)
        }
    }
    .map_err(|error| format!("Failed to read file: {error}"))?;
    read_bounded_utf8(file)
}

fn write_selected_text(
    app: &tauri::AppHandle,
    path: FilePath,
    content: &[u8],
) -> Result<(), String> {
    match path {
        FilePath::Path(path) => crate::fsutil::atomic_write(&path, content),
        path @ FilePath::Url(_) => {
            use std::io::Write;

            // Android content URIs and iOS security-scoped URLs are not local
            // paths, so atomic sibling replacement is unavailable. The
            // platform picker grants this one handle; truncate and write it.
            let mut options = OpenOptions::new();
            options.write(true).truncate(true).create(true);
            let mut file = app
                .fs()
                .open(path, options)
                .map_err(|error| format!("Failed to open selected file: {error}"))?;
            file.write_all(content)
                .and_then(|_| file.sync_all())
                .map_err(|error| format!("Failed to write selected file: {error}"))
        }
    }
}

fn selected_file_name(path: &FilePath) -> String {
    match path {
        FilePath::Path(path) => path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned()),
        FilePath::Url(url) => url
            .path_segments()
            .and_then(|mut segments| segments.next_back())
            .filter(|name| !name.is_empty())
            .map(str::to_string),
    }
    .unwrap_or_else(|| "untitled".into())
}

fn text_default_name(requested: Option<&str>) -> String {
    let name = requested
        .and_then(|value| Path::new(value).file_name())
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("profile.txt");
    if Path::new(name)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("txt"))
    {
        name.to_string()
    } else {
        format!("{name}.txt")
    }
}

#[tauri::command]
async fn open_text_file_dialog(app: tauri::AppHandle) -> Result<Option<OpenedTextFile>, String> {
    let dialog_app = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .add_filter("Text and CSV files", &["txt", "csv"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let name = selected_file_name(&selected);
    let text = tauri::async_runtime::spawn_blocking(move || read_selected_text(&app, selected))
        .await
        .map_err(|e| e.to_string())??;
    Ok(Some(OpenedTextFile { text, name }))
}

#[tauri::command]
async fn save_text_file_dialog(
    app: tauri::AppHandle,
    content: String,
    default_name: Option<String>,
) -> Result<(), String> {
    if content.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err("Refused: content exceeds the 1 MiB limit".into());
    }
    let default_name = text_default_name(default_name.as_deref());
    let dialog_app = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .add_filter("Text files", &["txt"])
            .set_file_name(default_name)
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(selected) = selected else {
        return Err("Export cancelled".into());
    };
    tauri::async_runtime::spawn_blocking(move || {
        write_selected_text(&app, selected, content.as_bytes())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(())
}

#[tauri::command]
async fn read_text_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    if !is_path_allowed(&app, &path) {
        return Err("Refused: file path is outside allowed directories".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let file = open_no_follow(&PathBuf::from(&path), false)
            .map_err(|e| format!("Failed to read file: {e}"))?;
        // Re-validate after open (see save_text_file): refuses to read content if
        // a component was swapped in after the pre-open check.
        if !is_path_allowed(&app, &path) {
            drop(file);
            return Err("Refused: file path is outside allowed directories".into());
        }
        read_bounded_utf8(file)
    })
    .await
    .map_err(|e| e.to_string())?
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
        .plugin(tauri_plugin_fs::init())
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
            open_text_file_dialog,
            save_text_file_dialog,
            read_text_file,
            diagnostics::get_diagnostics,
            diagnostics::clear_diagnostics,
            diagnostics::add_diagnostic_event,
            save_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running glacier-eq");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn bounded_text_reader_accepts_utf8_within_limit() {
        assert_eq!(
            read_bounded_utf8(Cursor::new("Filter 1: ON")),
            Ok("Filter 1: ON".into())
        );
    }

    #[test]
    fn bounded_text_reader_rejects_oversized_input() {
        let bytes = vec![b'a'; MAX_TEXT_FILE_BYTES as usize + 1];
        assert_eq!(
            read_bounded_utf8(Cursor::new(bytes)),
            Err("Refused: file exceeds the 1 MiB limit".into())
        );
    }

    #[test]
    fn bounded_text_reader_rejects_invalid_utf8() {
        let error = read_bounded_utf8(Cursor::new([0xff])).unwrap_err();
        assert!(error.starts_with("Failed to decode file as UTF-8:"));
    }

    #[test]
    fn save_default_name_is_a_text_file_name_only() {
        assert_eq!(text_default_name(Some("eq_profile.txt")), "eq_profile.txt");
        assert_eq!(text_default_name(Some("../outside.csv")), "outside.csv.txt");
        assert_eq!(text_default_name(None), "profile.txt");
    }
}
