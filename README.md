<h1>
  <img src="public/glacier-eq.svg" alt="" width="32" height="32" style="vertical-align: middle;">
  Glacier EQ
</h1>

<div>
  <a href="https://github.com/Bukutsu/glacier-eq/releases/latest"><img src="https://img.shields.io/github/v/release/Bukutsu/glacier-eq?style=flat&logo=github" alt="Latest release"></a>
  <a href="https://github.com/Bukutsu/glacier-eq/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-GPLv3-blue.svg" alt="License"></a>
</div>

Glacier EQ is a cross-platform parametric EQ editor for compatible USB DACs.
It talks to the hardware over HID, stores edits locally, and works offline.

Use the web version at [bukutsu.github.io/glacier-eq](https://bukutsu.github.io/glacier-eq/).

<img src="assets/screenshot-main.png" alt="Glacier EQ desktop interface showing EQ graph, filter bands, and profile controls" width="900">

## Features

- 10-band PEQ editor with preamp, undo and redo, graph preview, and target curves
- Pull, RAM apply, push, verify, and rollback operations for supported DACs
- Local profiles with search, import and export, copy and paste, and one-tap apply
- Measurement overlays from local files or an optional offline Squiglink cache
- Native AutoEQ matching against measurement and target curves
- EQ protocol support for Walkplay/Savitech, Moondrop, and FiiO devices
- Hardware controls for supported Walkplay/Savitech DACs, including DAC filter, amp mode, output gain, balance, mic monitor, and reset modes
- Desktop and Android layouts, themes, diagnostics, and a dummy DAC for development

## Installation

Download a build from the [releases page](https://github.com/Bukutsu/glacier-eq/releases).

On Arch Linux:

```sh
git clone https://github.com/Bukutsu/glacier-eq.git
cd glacier-eq
makepkg -si
```

The Arch package installs `udev/99-glacier-eq.rules`. Replug the DAC after
installation so the Linux desktop build can open it without a polkit elevation
prompt.

To run from source:

```sh
git clone https://github.com/Bukutsu/glacier-eq.git
cd glacier-eq
npm install
npm run tauri dev
```

## CLI

The offline CLI supports scripts, piped profiles, and bulk AutoEQ jobs. It writes
data to `stdout` and diagnostics to `stderr`.

See the [CLI documentation](https://github.com/Bukutsu/glacier-eq/wiki/CLI) for
commands and examples.

## Using the GUI

1. Plug in a supported DAC.
2. Open Glacier EQ.
3. Select the DAC and connect.
4. Pull the current hardware state.
5. Edit the preamp, bands, filter type, frequency, gain, and Q.
6. Push the changes to the device.

## Supported devices

If your DAC is listed below, plug it in and check the device picker. A `Family
match` means its USB family appears compatible, but the exact model still needs
more hardware reports.

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

Discovery, validation, capabilities, and the device picker all use the registry
in [`glacier-core/src/device/walkplay.rs`](glacier-core/src/device/walkplay.rs).

## Development

### System dependencies

Building the Tauri desktop app on Linux requires GTK 3, WebKitGTK, `pkg-config`, and related build tools.

**Debian / Ubuntu**

```sh
sudo apt update
sudo apt install -y build-essential curl wget file libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev pkg-config
```

**Arch Linux**

```sh
sudo pacman -S --needed base-devel curl wget file openssl gtk3 webkit2gtk-4.1 libappindicator-gtk3 librsvg pkg-config
```

**Fedora**

```sh
sudo dnf install @development-tools webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel gtk3-devel pkgconf-pkg-config
```

### Useful commands:

```sh
npm run wasm:build       # build WASM module (glacier-core)
npm run dev              # frontend only
npm run tauri dev        # desktop app
npm run build            # TypeScript + Vite
cargo check              # Rust workspace
cargo test -p glacier-core
```

To enable the optional local check before pushing:

```sh
git config core.hooksPath .githooks
```

Android commands:

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

## Linux HID permissions

On Linux, Chromium-based browsers and the desktop build may need udev access to
raw USB HID devices. The packaged `udev/99-glacier-eq.rules` lets the desktop
build open supported devices without a polkit elevation prompt. If the browser
shows `NotAllowedError: Failed to open the device` while connecting:

1. Create a udev rule file:

   ```sh
   sudo nano /etc/udev/rules.d/50-glacier-dac.rules
   ```

2. Add these rules for compatible DACs:

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

3. Reload the udev rules, then replug the device:

   ```sh
   sudo udevadm control --reload-rules
   sudo udevadm trigger
   ```

Chromium Flatpak and Snap installations may also need USB access enabled in the
sandbox permissions manager, such as Flatseal.

## Project layout

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

Glacier EQ is licensed under GPL-3.0-only. See [LICENSE](LICENSE).
