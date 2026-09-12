const COMMANDS: &[&str] = &["get_dynamic_colors"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
