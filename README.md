<a id="readme-top"></a>

<div align="center">
  <img src="assets/glacier-eq.svg" alt="Glacier EQ" width="80" height="80">

## Glacier EQ

Cross-platform parametric EQ editor for USB DACs. Offline, direct, and built for dense tuning work on desktop and Android.

[Usage](#usage) · [Android](#android-device-testing) · [Development](#development)

</div>

## Table of Contents

- [About](#about)
- [Supported Devices](#supported-devices)
- [Getting Started](#getting-started)
- [Usage](#usage)
- [Android Device Testing](#android-device-testing)
- [Development](#development)
- [License](#license)
- [Acknowledgments](#acknowledgments)

## About

Glacier EQ talks to compatible USB DACs over HID, edits 10-band parametric EQ, and verifies writes before they stick. It is the Tauri + React successor to Frost Tune, with the same low-level device focus and a newer cross-platform UI.

**Features**

- Direct USB HID control through the Tauri backend
- 10-band parametric EQ with preamp, filter type, frequency, gain, and Q controls
- Pull current EQ from hardware and push edited state back to the DAC
- Read-back verification with rollback on failed writes
- Local profile save, load, search, import, export, copy, and paste workflows
- AutoEQ text import/export for profile exchange
- Measurement trace overlays from `.csv` or `.txt` files
- Target reference overlays and graph shape/level views
- Android-oriented mobile layout with EQ, Tuning, Profiles, and Settings tabs
- Dev-only dummy DAC for UI review without plugging in hardware
- Offline by design, with no account or cloud dependency

**Built with:** Tauri v2, React, TypeScript, Rust, Playwright

## Supported Devices

| Manufacturer | Model | Status | Family / Protocol |
| :--- | :--- | :--- | :--- |
| **EPZ** | TP35 Pro | Tested | Walkplay Family |
| **Moondrop** | Dawn Pro | Untested | Walkplay Family |
| **Truthear** | KEYX | Untested | Walkplay Family |

## Getting Started

**Prerequisites**

- Node.js and npm
- Rust toolchain
- Platform dependencies required by Tauri v2
- USB/HID access for real-device testing

Install dependencies:

```sh
npm install
```

Run the desktop development server:

```sh
npm run tauri dev
```

Build the web frontend:

```sh
npm run build
```

Run Playwright smoke tests:

```sh
npm run test
```

## Usage

1. Plug in a supported DAC.
2. Launch Glacier EQ.
3. Select the DAC and connect.
4. Pull the current hardware state.
5. Edit preamp, bands, filter type, frequency, gain, and Q.
6. Add measurement traces or target overlays when tuning against references.
7. Push changes back to the device.
8. Save, load, import, or export profiles as needed.

In development builds, `Glacier Dummy DAC` appears in the device chooser. It connects without hardware and loads a realistic test EQ state for UI review.

## Android Device Testing

Install the Android toolchain first:

- JDK 17, or Android Studio's bundled JDK
- Android SDK command-line tools, platform-tools, build-tools, and NDK
- `ANDROID_HOME` pointing at the SDK directory, for example `$HOME/Android/Sdk`
- Rust Android targets

Recommended local shell setup:

```sh
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

Check the local machine:

```sh
npm run android:doctor
```

Generate the Android project the first time:

```sh
npm run android:init
```

Run on a real Android device:

```sh
adb devices
npm run android:dev
```

Build an installable debug APK for a typical physical phone:

```sh
npm run android:apk
```

The generated APK is written under `src-tauri/gen/android/app/build/outputs/apk/`.
Use `npm run android:apk:release` only after release signing is configured.

## Development

Useful commands:

```sh
npm run dev              # Vite frontend only
npm run tauri dev        # Desktop app development
npm run build            # TypeScript + Vite build
npm run test             # Playwright test suite
npm run android:doctor   # Android toolchain checks
```

Diagnostics are shown only in dev builds by default. The diagnostics log can be copied, cleared, or exported from the dev UI.

Project layout:

```text
glacier-eq/
├── glacier-core/       # Shared Rust library for EQ/device logic
├── src/                # React + TypeScript frontend
├── src-tauri/          # Tauri Rust backend and commands
├── tauri-plugin-hid/   # Local HID plugin used by the backend
├── e2e/                # Playwright smoke tests
└── scripts/            # Local helper scripts
```

## License

MIT. See `LICENSE`.

## Acknowledgments

- [Tauri](https://v2.tauri.app/)
- [React](https://react.dev/)
- [hidapi](https://github.com/libusb/hidapi)
- [Playwright](https://playwright.dev/)
- [devicePEQ](https://github.com/jeromeof/devicePEQ) for reverse-engineered DAC protocols
