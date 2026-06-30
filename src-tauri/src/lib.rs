// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Tauri backend for Glacier EQ.

mod device_commands;
mod diagnostics;
#[cfg(target_os = "linux")]
pub mod hid_helper;
mod profiles;
mod settings;
mod state;

use std::sync::Mutex;

use diagnostics::DiagnosticsStore;
use state::DeviceState;

#[tauri::command]
fn save_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write file: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .manage(Mutex::new(DeviceState::default()))
        .manage(Mutex::new(DiagnosticsStore::default()));
    #[cfg(target_os = "linux")]
    {
        builder = builder.manage(Mutex::new(None::<hid_helper::ElevatedTransport>));
    }
    builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_m3::init())
        .plugin(tauri_plugin_hid::init())
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
            diagnostics::get_diagnostics,
            diagnostics::clear_diagnostics,
            diagnostics::add_diagnostic_event,
            save_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running glacier-eq");
}
