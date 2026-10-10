const COMMANDS: &[&str] = &["get_dynamic_colors", "set_system_bar_appearance"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
