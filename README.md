<h1>
  <img src="assets/glacier-eq.svg" alt="" width="32" height="32" style="vertical-align: middle;">
  Glacier EQ
</h1>

Cross-platform parametric EQ editor for compatible USB DACs. Glacier EQ talks to
hardware over HID, edits EQ locally, and works offline.

<img src="assets/screenshot-main.png" alt="Glacier EQ desktop interface showing EQ graph, filter bands, and profile controls" width="900">

## Features

- 10-band PEQ editor with preamp, undo/redo, graph preview, and target curves
- Pull, RAM-apply, push, verify, and rollback EQ on supported DACs
- Local profiles with search, import/export, copy/paste, and one-tap apply
- Measurement overlays from files or optional Squiglink offline cache
- Native AutoEQ matching against measurement and target curves
- Hardware controls for supported Walkplay/Savitech DACs: DAC filter, amp mode,
  output gain, balance, mic monitor, and reset modes
- Desktop and Android layouts, themes, diagnostics, and dev dummy DAC

## Install

Download builds from the
[releases page](https://github.com/Bukutsu/glacier-eq/releases).

Arch Linux:

```sh
git clone https://github.com/Bukutsu/glacier-eq.git
cd glacier-eq
makepkg -si
```

From source:

```sh
git clone https://github.com/Bukutsu/glacier-eq.git
cd glacier-eq
npm install
npm run tauri dev
```

## Usage

1. Plug in a supported DAC.
2. Open Glacier EQ.
3. Select the DAC and connect.
4. Pull the current hardware state.
5. Edit preamp, bands, filter type, frequency, gain, and Q.
6. Push changes back to the device.

## Supported Devices

If your DAC appears here, plug it in and check the device picker. `Family match`
means the USB family looks compatible, but the exact model still needs more
hardware reports.

| Status | Device |
| --- | --- |
| Confirmed | EPZ TP35 Pro |
| Confirmed | TRN Black Pearl |
| Family match | Audiocular Aura |
| Family match | Fosi Audio DS2 / iBasso DC04 Pro |
| Family match | JCally JM20 / Savitech Generic |
| Family match | JCally JM20 Pro / Alt Savitech |
| Testing | Moondrop Dawn Pro |
| Testing | Truthear KEYX |

The app uses one registry for discovery, validation, capabilities, and the
chooser list:
[`glacier-core/src/device/walkplay.rs`](glacier-core/src/device/walkplay.rs).

## Development

Requirements:

- Node.js and npm
- Rust
- Tauri v2 platform dependencies
- USB/HID permissions for real hardware testing

Useful commands:

```sh
npm run dev              # frontend only
npm run tauri dev        # desktop app
npm run build            # TypeScript + Vite
cargo check              # Rust workspace
cargo test -p glacier-core
```

Android:

```sh
npm run android:doctor
npm run android:init
npm run android:dev
npm run android:apk
```

Release APK signing is not configured by default.

## Roadmap

- [x] Real-time frequency response graph
- [x] AutoEQ matching
- [x] Desktop and Android builds
- [ ] More DAC families beyond Walkplay/Savitech
- [ ] Interactive filter adjustment from the graph
- [ ] Full-screen Android filter adjustment
- [ ] Command-line interface
- [ ] Multi-device support
- [ ] Localization

## Project Layout

```text
glacier-core/       Rust EQ and device logic
src/                React frontend
src-tauri/          Tauri backend
tauri-plugin-hid/   Local HID plugin
scripts/            Helper scripts
```

## Credits

- [Tauri](https://v2.tauri.app/)
- [React](https://react.dev/)
- [hidapi](https://github.com/libusb/hidapi)
- [devicePEQ](https://github.com/jeromeof/devicePEQ)
- [AutoEQ-C](https://github.com/peqdb/autoeq-c)

## License

GPL-3.0-only. See [LICENSE](LICENSE).
