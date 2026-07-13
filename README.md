<h1>
  <img src="public/glacier-eq.svg" alt="" width="32" height="32" style="vertical-align: middle;">
  Glacier EQ
</h1>

<div>
  <a href="https://github.com/Bukutsu/glacier-eq/actions/workflows/ci.yml"><img src="https://github.com/Bukutsu/glacier-eq/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/Bukutsu/glacier-eq/releases/latest"><img src="https://img.shields.io/github/v/release/Bukutsu/glacier-eq?style=flat&logo=github" alt="Latest release"></a>
  <a href="https://github.com/Bukutsu/glacier-eq/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-GPLv3-blue.svg" alt="License"></a>
</div>

Cross-platform parametric EQ editor for compatible USB DACs. Glacier EQ talks to
hardware over HID, edits EQ locally, and works offline.

⚡ **Try the web version directly in your browser:** [bukutsu.github.io/glacier-eq](https://bukutsu.github.io/glacier-eq/)

<img src="assets/screenshot-main.png" alt="Glacier EQ desktop interface showing EQ graph, filter bands, and profile controls" width="900">

## Features

- 10-band PEQ editor with preamp, undo/redo, graph preview, and target curves
- Pull, RAM-apply, push, verify, and rollback EQ on supported DACs
- Local profiles with search, import/export, copy/paste, and one-tap apply
- Measurement overlays from files or optional Squiglink offline cache
- Native AutoEQ matching against measurement and target curves
- Walkplay/Savitech, Moondrop, and FiiO EQ protocol support
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

The Arch package installs `udev/99-glacier-eq.rules`; after replugging a
supported DAC, the Linux desktop build can open it directly without the polkit
elevation popup.

From source:

```sh
git clone https://github.com/Bukutsu/glacier-eq.git
cd glacier-eq
npm install
npm run tauri dev
```

## CLI

Glacier EQ includes a fully offline CLI for scripting, piping profiles, and bulk AutoEQ tasks. 
Data goes to `stdout`, diagnostics to `stderr`.

For the full command reference, syntax, and examples, see the [CLI Documentation](https://github.com/Bukutsu/glacier-eq/wiki/CLI).

## GUI Usage

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
| Testing | Moondrop Dawn Pro 2 |
| Testing | FiiO JA11 |
| Testing | JCally JM12 |
| Testing | FiiO KA Series |
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

Optional local guard before pushing:

```sh
git config core.hooksPath .githooks
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
- [x] More DAC families beyond Walkplay/Savitech
- [ ] Interactive filter adjustment from the graph
- [ ] Full-screen Android filter adjustment
- [x] Command-line profile tools
- [ ] Multi-device support
- [ ] Localization
## Linux HID Permissions

On Linux, Chromium-based browsers and the desktop build can need udev access to
raw USB HID devices. Installing the packaged `udev/99-glacier-eq.rules` lets the
desktop build skip the polkit elevation popup. If you see a `NotAllowedError:
Failed to open the device` error when connecting in the browser:

1. Create a udev rule file:
   ```sh
   sudo nano /etc/udev/rules.d/50-glacier-dac.rules
   ```
2. Paste the following rule to allow access to compatible DACs:
   ```text
   # Walkplay / FiiO / Moondrop / EPZ DACs
   KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="3302", MODE="0666", TAG+="uaccess", TAG+="udev-acl"
   KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="262a", MODE="0666", TAG+="uaccess", TAG+="udev-acl"
   KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="2fc6", MODE="0666", TAG+="uaccess", TAG+="udev-acl"
   KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="2972", MODE="0666", TAG+="uaccess", TAG+="udev-acl"
   KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0661", MODE="0666", TAG+="uaccess", TAG+="udev-acl"
   KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0666", MODE="0666", TAG+="uaccess", TAG+="udev-acl"
   KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="35d8", MODE="0666", TAG+="uaccess", TAG+="udev-acl"
   KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31b2", MODE="0666", TAG+="uaccess", TAG+="udev-acl"
   KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0d8c", MODE="0666", TAG+="uaccess", TAG+="udev-acl"
   ```
3. Reload udev rules and replug the device:
   ```sh
   sudo udevadm control --reload-rules
   sudo udevadm trigger
   ```
   *Note: If you use the Chromium Flatpak or Snap version, you might also need to allow USB access in your sandbox permissions manager (e.g. Flatseal).*

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
- [Audiocular-Aura](https://github.com/mandy321/Audiocular-Aura), used as a reference for Moondrop and FiiO HID protocol behavior

## License

GPL-3.0-only. See [LICENSE](LICENSE).
