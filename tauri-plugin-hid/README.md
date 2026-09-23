# Tauri plugin HID

This plugin gives a Tauri app access to USB HID devices. It uses hidapi-rs on
macOS, Windows, and Linux, and Android's `UsbManager` on Android.

It supports device enumeration, multiple open devices, and input/output reports.

Known limits:

- Feature reports are not supported.
- The plugin has been tested on macOS, Windows, and Android.

## Installation

Install the plugin with Cargo:

```sh
cd src-tauri
cargo add tauri-plugin-hid
```

Or add it directly to `Cargo.toml`:

```toml
[dependencies]
tauri-plugin-hid = "0.2.4"
```

This plugin exposes HID through the host application's Rust API. It does not
register a frontend `enumerate`/`open`/`read`/`write` command set, so there is
no separate TypeScript package to install and no `hid:default` permission to
add for those operations.

Register the plugin in `src-tauri/src/lib.rs`:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_hid::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

Use the Rust API from a Tauri command or other trusted host code:

```rust
let hid = tauri_plugin_hid::hid(&app);
let devices = hid.enumerate()?;
hid.open("/dev/hidraw0")?;
hid.write("/dev/hidraw0", &[0x00, 0x00])?;
let data = hid.read("/dev/hidraw0", 100)?;
hid.close("/dev/hidraw0")?;
```

The Android implementation uses the same host-side lifecycle, while the
browser build uses the WebHID adapter in the application. Listener commands
(`register_listener` and `remove_listener`) are the only commands registered
by this plugin's Tauri builder.
