const COMMANDS: &[&str] = &["register_listener", "remove_listener"];

fn main() {
    // Android's Plugin base class exposes these inherited commands for
    // addPluginListener(). They still need ACL entries in the host app.
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
