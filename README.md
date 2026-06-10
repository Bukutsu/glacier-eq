# Glacier EQ ❄️🎛️

**Cross-platform parametric EQ editor for USB DACs.**  
Desktop (Linux, Windows, macOS) and Android, one codebase.

Built with [Tauri v2](https://v2.tauri.app/) + [React](https://react.dev/) + [Rust](https://www.rust-lang.org/).

## Status

🚧 **Early development** — the Tauri + React reimplementation of [Frost-Tune](https://github.com/bukutsu/frost-tune).

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

## Supported Devices

*To be documented as protocols are ported from Frost-Tune.*
Currently expected: WalkPlay, TP35Pro, and similar USB DACs with HID-based PEQ control.

## License

MIT
