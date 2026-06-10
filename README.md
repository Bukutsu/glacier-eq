# Glacier EQ ❄️🎛️

**Cross-platform parametric EQ editor for USB DACs.**  
Desktop (Linux, Windows, macOS) and Android, one codebase.

Built with [Tauri v2](https://v2.tauri.app/) + [Rust](https://www.rust-lang.org/) + [TypeScript](https://www.typescriptlang.org/).

## Status

🚧 **Early development** — the Tauri reimplementation of [Frost-Tune](https://github.com/bukutsu/frost-tune).

- [x] Project scaffold + workspace structure
- [x] Core crate extracted (filter math, device protocols, error types)
- [x] Tauri backend with HID plugin wired up
- [ ] Device protocol implementations ported
- [ ] EQ editor UI (bands, graph, presets)
- [ ] USB HID communication via `tauri-plugin-hid`
- [ ] Android build pipeline
- [ ] AutoEQ integration

## Architecture

```
glacier-eq/
├── Cargo.toml              # workspace root
├── glacier-core/           # shared Rust library (UI-agnostic)
│   ├── src/eq/             # filter types, IIR math, constants
│   ├── src/device/         # DeviceProtocol trait, profiles, packet framing
│   ├── src/error.rs        # AppError, ErrorKind
│   └── src/autoeq.rs       # AutoEQ import/apply logic
├── src-tauri/              # Tauri Rust backend
│   ├── src/lib.rs          # Tauri commands (HID, EQ operations)
│   ├── src/main.rs         # Entry point
│   └── tauri.conf.json     # Window, bundle config
├── src/                    # Web frontend (vanilla TypeScript)
│   ├── main.ts             # UI logic, graph rendering, Tauri IPC
│   └── styles.css          # App styling
└── package.json            # Node dependencies
```

## Getting Started

```bash
# Install dependencies
npm install

# Desktop development
npm run tauri dev

# Android setup (first time)
npm run tauri android init

# Android development
npm run tauri android dev
```

## Supported Devices

*To be documented as protocols are ported.*  
Currently expected: WalkPlay, TP35Pro, and similar USB DACs with HID-based PEQ control.

## License

MIT — see [LICENSE](./LICENSE).
