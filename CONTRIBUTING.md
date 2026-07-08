# Contributing

Thanks for considering contributing to Glacier EQ.

## Issues

- **Bug reports**: include steps to reproduce, your device/OS, and any relevant logs.
- **Feature requests**: describe the use case clearly. Small scope changes (UI touch-ups, component refactors) are more likely to be accepted quickly.

## Pull requests

1. Fork the repo and create a feature branch from `main`.
2. Run `npm run build` locally before pushing — it runs the TypeScript check, wasm build, and Vite production build.
3. Keep changes focused. A PR that does one thing is much easier to review.
4. If your change touches the Rust backend, run `cargo fmt` and `cargo check` beforehand.

## Development setup

See the [README](./README.md) for build prerequisites (Rust toolchain, Android SDK/NDK if targeting mobile).

## Code style

- TypeScript: strict mode, no `any` where avoidable.
- CSS: sharp-corner design language (`border-radius: 0`). No rounded corners unless the platform demands it (pointer:coarse thumbs).
- Rust: follow existing patterns in `src-tauri/src/`.
