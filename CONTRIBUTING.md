# Contributing

Thanks for contributing to Glacier EQ.

## Issues

- For a bug report, include reproduction steps, your device and OS, and any relevant logs.
- For a feature request, explain the use case. Small UI fixes and focused refactors are easier to review.

## Pull requests

1. Fork the repository and create a feature branch from `main`.
2. Run `npm run verify` and `npm run verify:rust` before pushing. These are the
   same commands CI runs, so a green local run means a green pipeline. They
   need no build artifacts: the test suite stubs the WebAssembly module rather
   than loading `src/wasm_pkg`, so a fresh clone can verify immediately.
3. Run `npm run build` before pushing. It checks TypeScript, builds the WASM module, and creates the Vite production build.
4. Keep the change focused. One clear change is easier to review.
5. If you changed the Rust backend, run `cargo fmt` and `cargo check` first.

## Releasing

Releases are tag-driven: push a `vX.Y.Z` tag and the `Release` workflow verifies
the tag against `package.json`, `src-tauri/Cargo.toml`, and
`src-tauri/tauri.conf.json`, runs `npm run verify` plus `npm run verify:rust`,
builds every platform, and publishes the assets. Add a matching `## [X.Y.Z]`
section to `CHANGELOG.md` first; the workflow extracts it for the release notes
and falls back to a placeholder if it is missing.

## Development setup

The [README](./README.md) lists the build requirements, including Rust and,
for mobile builds, the Android SDK and NDK.

## Code style

- TypeScript: use strict mode and avoid `any` where practical.
- CSS: use sharp corners (`border-radius: 0`). Add rounded corners only when the platform requires them, such as `pointer: coarse` thumb controls.
- Rust: follow the existing patterns in `src-tauri/src/`.
