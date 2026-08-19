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

Install the TypeScript/JavaScript API:

```sh
npm add @redfernelec/tauri-plugin-hid-api
```

Register the plugin in `src-tauri/src/lib.rs`:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_hid::init()) // Register the HID plugin
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

Add the permission to `src-tauri/capabilities/default.json`:

```json
"permissions": [
    "core:default",
    "opener:default",
    "hid:default"
]
```

## Frontend example

```typescript
import { HidDevice, enumerate } from "@redfernelec/tauri-plugin-hid-api";

let myDevice: HidDevice | null = null;

// Find a device by product string.
let devices = await enumerate();
for (const device of devices) {
    if (device.productString === "My Device") {
        myDevice = device;
        break;
    }
}

if (myDevice) {
    await myDevice.open();
    await myDevice.write(new Uint8Array([0x00, 0x00]));
    const data = await myDevice.read(2);
    await myDevice.close();
}
```

The repository also includes Android and desktop implementation examples in
this plugin's source tree.
