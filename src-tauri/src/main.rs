// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    if std::env::args().any(|a| a == "--hid-helper") {
        glacier_eq_lib::hid_helper::run_helper();
    }
    glacier_eq_lib::run()
}
