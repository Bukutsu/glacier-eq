// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

//! Tauri backend for Glacier EQ.

mod device_commands;
mod diagnostics;
mod profiles;
mod settings;
mod state;

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::Emitter;

use diagnostics::DiagnosticsStore;
use state::DeviceState;

#[tauri::command]
fn save_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write file: {e}"))
}

#[tauri::command]
fn get_linux_color_scheme() -> String {
    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = Command::new("gsettings")
            .args(&["get", "org.gnome.desktop.interface", "color-scheme"])
            .output()
        {
            let val = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if val.contains("prefer-dark") {
                return "dark".to_string();
            } else if val.contains("prefer-light") {
                return "light".to_string();
            }
        }
    }
    "unknown".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(DeviceState::default()))
        .manage(Mutex::new(DiagnosticsStore::default()))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_hid::init())
        .setup(|app| {
            #[cfg(target_os = "linux")]
            {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    let mut child = match Command::new("gsettings")
                        .args(&["monitor", "org.gnome.desktop.interface", "color-scheme"])
                        .stdout(Stdio::piped())
                        .spawn()
                    {
                        Ok(c) => c,
                        Err(_) => return,
                    };

                    if let Some(stdout) = child.stdout.take() {
                        let reader = BufReader::new(stdout);
                        for line_res in reader.lines() {
                            if let Ok(line) = line_res {
                                let is_dark = line.contains("prefer-dark");
                                let theme_str = if is_dark { "dark" } else { "light" };
                                let _ = app_handle.emit("linux-theme-changed", theme_str);
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            device_commands::get_eq_state,
            device_commands::set_eq_state,
            profiles::list_profiles,
            profiles::save_profile,
            profiles::delete_profile,
            profiles::open_profiles_dir,
            profiles::parse_autoeq,
            profiles::peq_to_autoeq,
            profiles::run_autoeq,
            device_commands::list_devices,
            device_commands::connect_device,
            device_commands::disconnect_device,
            settings::get_settings,
            settings::save_settings,
            diagnostics::get_diagnostics,
            diagnostics::clear_diagnostics,
            diagnostics::add_diagnostic_event,
            save_text_file,
            get_linux_color_scheme,
        ])
        .run(tauri::generate_context!())
        .expect("error while running glacier-eq");
}
