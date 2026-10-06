# Contributing

Thanks for contributing to Glacier EQ.

## Issues

- For a bug report, include reproduction steps, your device and OS, and any relevant logs.
- For a feature request, explain the use case. Small UI fixes and focused refactors are easier to review.

## Pull requests

1. Fork the repository and create a feature branch from `main`.
2. Follow the setup below, then run `npm run verify` and `npm run verify:rust`
   before pushing. CI uses these commands too, but a local pass does not check
   every platform build or deployment step.
3. Run `npm run build` before pushing. It builds WASM, checks TypeScript, and
   creates the Vite production build.
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

Install Node.js LTS, npm, and Rust stable. Use `npm ci` to install the locked
JavaScript dependencies, including the project's `wasm-pack`.

For Linux native development and workspace Rust checks, install the packages
used by [CI](./.github/workflows/deploy.yml). On Debian/Ubuntu:

```sh
sudo apt-get install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf libudev-dev pkg-config
```

### Verification

On a fresh clone:

```sh
npm ci
rustup target add wasm32-unknown-unknown
npm run wasm:build
npm run verify
npm run verify:rust
```

`npm test` uses mocked WASM and can run without generated artifacts.
`npm run verify` also checks TypeScript, which imports declarations from the
gitignored `src/wasm_pkg`. Generate them before the first verification run,
and rebuild them after changing the Rust WASM API. Existing generated files
can hide fresh-clone failures.

### Running the app

- Web: `npm run dev:web` builds WASM and starts Vite at
  `http://localhost:1420`.
- Desktop: `npm run tauri -- dev` starts the native app and its desktop
  frontend. `npm run dev:desktop` alone starts only the frontend.
- Production: `npm run build:web` builds the web app;
  `npm run build:desktop` builds only the desktop frontend. Use
  `npm run tauri -- build` for native bundles.

The backend is selected at build time: Vite's `web` mode uses WebHID/WASM;
other modes use Tauri IPC. Use the package scripts rather than bare `vite`
when testing the web app.

Development builds offer a **Dev Dummy DAC** in the device chooser. Connect
to it to test the editor without hardware. It is not available in production
and does not test real HID transport.

### Android

Install JDK 17, Android SDK command-line tools, and the SDK/NDK packages pinned
in the [Android release job](./.github/workflows/release.yml). Set `JAVA_HOME`,
`ANDROID_HOME`, and `NDK_HOME` to your installations; `NDK_HOME` must point to
the NDK version directory, not the SDK root.

Run `npm run android:doctor` to inspect the environment, then
`npm run android:dev` with a device or emulator connected.
`npm run android:apk` builds a debug APK. The Android scripts prepare the
generated Gradle project for you; do not commit it. Release APK builds also
require the signing overlay and keystore described in the release workflow.

## UI changes

Compact layout applies to narrow desktop windows too, not just phones.
JavaScript uses `MOBILE_QUERY` in `src/lib/tabs.ts`; matching CSS queries must
stay in sync with it. Keep viewport width/height separate from pointer type:
a small desktop window still has a fine pointer.

For layout changes, check:
- 320 × 740 and 390 × 844 phone portrait sizes with a coarse pointer;
- 844 × 390 phone landscape with a coarse pointer;
- 720 × 500 with a fine pointer, the native window's current minimum;
- 850px and 851px widths on either side of the compact-layout boundary;
- 1340 × 800 desktop with a fine pointer.

Use the dummy DAC to check connected, disconnected, and busy states, plus
expanded disclosures and scrolling. Render tests check markup; they do not
prove that browser layout or native WebView rendering is correct.

When adding a theme, run both verification commands. Web settings validation
uses the UI theme list directly. Tests check web parsing for every UI option
and compare native validation with the actual UI list; a theme must survive
saving and loading on both runtimes.

## Code style

- TypeScript: use strict mode and avoid `any` where practical.
- CSS: use sharp corners (`border-radius: 0`). Add rounded corners only when the platform requires them, such as `pointer: coarse` thumb controls.
- Rust: follow the existing patterns in the crate being changed.
