# Tauri plugin HID

This Tauri plugin provides access to USB HID devices. It uses hidapi-rs on
macOS, Windows, and Linux, and Android UsbManager on Android.

It can:

* Enumerate devices
* Open several devices at once
* Read and write input and output reports

Current limitations:

* Feature reports are not supported yet.
* The plugin has only been tested on macOS, Windows, and Android.

## Installation

Install the plugin with Cargo:

```sh
cd src-tauri
cargo add tauri-plugin-hid
```

Or add it directly to `Cargo.toml`:

```toml
[dependencies]
tauri-plugin-hid = "0.1.1"
```

Install the TypeScript/JavaScript API:

```sh
npm add @redfernelec/tauri-plugin-hid-api
```

Register the plugin in `src-tauri/src/lib.rs`:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_hid::init())   // Register hid plugin
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

// Enumerate devices and find one based on product string
let devices = await enumerate();
for (const device of devices) {
    if (device.productString === "My Device") {
        myDevice = device;
        break;
    }
}

if(myDevice) {
    await myDevice.open();
    await myDevice.write(new Uint8Array([0x00, 0x00]));
    let data = await myDevice.read(2);
    await myDevice.close();
}
```

The repository also includes a Vue example in
`examples/tauri-plugin-hid-vue-example`.
