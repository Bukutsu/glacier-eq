# Contributing

Thanks for considering a contribution to Glacier EQ.

## Issues

- For a bug report, include reproduction steps, your device and OS, and any relevant logs.
- For a feature request, explain the use case. Small changes, such as UI touch-ups and component refactors, are usually quicker to review.

## Pull requests

1. Fork the repository and create a feature branch from `main`.
2. Run `npm run build` before pushing. It checks TypeScript, builds the wasm, and creates the Vite production build.
3. Keep the change focused. A pull request that does one thing is easier to review.
4. If you changed the Rust backend, run `cargo fmt` and `cargo check` first.

## Development setup

The [README](./README.md) lists the build requirements, including the Rust
toolchain and, for mobile builds, the Android SDK and NDK.

## Code style

- TypeScript: use strict mode and avoid `any` where practical.
- CSS: use sharp corners (`border-radius: 0`). Add rounded corners only when the platform requires them, such as `pointer: coarse` thumb controls.
- Rust: follow the existing patterns in `src-tauri/src/`.
