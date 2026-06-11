// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

//! Tauri backend for Glacier EQ.

mod device_commands;
mod diagnostics;
mod profiles;
mod settings;
mod state;

use std::sync::Mutex;

use diagnostics::DiagnosticsStore;
use state::DeviceState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(DeviceState::default()))
        .manage(Mutex::new(DiagnosticsStore::default()))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_hid::init())
        .invoke_handler(tauri::generate_handler![
            device_commands::get_eq_state,
            device_commands::set_eq_state,
            profiles::list_profiles,
            profiles::save_profile,
            profiles::delete_profile,
            profiles::open_profiles_dir,
            profiles::parse_autoeq,
            profiles::peq_to_autoeq,
            device_commands::list_devices,
            device_commands::connect_device,
            device_commands::disconnect_device,
            settings::get_settings,
            settings::save_settings,
            diagnostics::get_diagnostics,
            diagnostics::clear_diagnostics,
            diagnostics::add_diagnostic_event,
        ])
        .run(tauri::generate_context!())
        .expect("error while running glacier-eq");
}
