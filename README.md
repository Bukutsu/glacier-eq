# Glacier EQ ❄️🎛️

**Cross-platform parametric EQ editor for USB DACs.**  
Desktop (Linux, Windows, macOS) and Android, one codebase.

Built with [Tauri v2](https://v2.tauri.app/) + [React](https://react.dev/) + [Rust](https://www.rust-lang.org/).

## Status

🚧 **Early development** — the Tauri + React implementation of Glacier EQ.

- [x] Project scaffold + workspace structure
- [x] Core crate extracted (filter math, device protocols, error types)
- [x] Tauri backend with HID plugin
- [x] React frontend — EQ graph, band controls, device connect workflow
- [ ] Device protocol implementations ported
- [ ] USB HID read/write pipeline
- [ ] Android build pipeline
- [ ] Profile persistence
- [ ] AutoEQ integration

## Architecture

```
glacier-eq/
├── Cargo.toml              # workspace root
├── glacier-core/           # shared Rust library (UI-agnostic)
│   ├── src/eq/             # filter types, IIR math, constants
│   ├── src/device/         # DeviceProtocol trait, profiles, packet framing
│   └── src/error.rs        # AppError, ErrorKind
├── src-tauri/              # Tauri Rust backend
│   ├── src/lib.rs          # Tauri commands (HID enumerate, EQ get/set)
│   └── tauri.conf.json     # window, bundle config
├── src/                    # React + TypeScript frontend
│   ├── App.tsx             # EQ editor — graph, bands, device controls
│   └── App.css             # dark theme, responsive layout
└── package.json
```

## Getting Started

```bash
npm install
npm run tauri dev            # Desktop development
npm run tauri android init   # Android setup (first time)
npm run tauri android dev    # Android development
```

## Android Device Testing

Install the Android toolchain first:

- JDK 17, or Android Studio's bundled JDK.
- Android SDK command-line tools, platform-tools, build-tools, and NDK.
- `ANDROID_HOME` pointing at the SDK directory, for example `$HOME/Android/Sdk`.
- Rust Android targets.

Recommended local shell setup:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

Check the local machine:

```bash
npm run android:doctor
```

First-time Android project generation:

```bash
npm run android:init
```

Run on a real device:

1. Enable Developer options and USB debugging on the Android device.
2. Connect it with USB and accept the RSA prompt.
3. Confirm it is visible:

```bash
adb devices
npm run android:dev
```

Build an installable debug APK for a typical physical phone:

```bash
npm run android:apk
```

The generated APK is written under `src-tauri/gen/android/app/build/outputs/apk/`.
Use `npm run android:apk:release` only after release signing is configured.

## Supported Devices

*To be documented as protocols are ported from the legacy implementation.*
Currently expected: WalkPlay, TP35Pro, and similar USB DACs with HID-based PEQ control.

## License

MIT
