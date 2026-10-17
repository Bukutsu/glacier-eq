# Release readiness

This is a source-review snapshot, not a claim that a release has been tested
on every platform. It covers the changes after the frontend reorganization
and the pending profile/mobile UI work. Version manifests still read 0.14.0.

## Review fixes

- Walkplay control reset compares all control fields with the requested
  defaults. If reset fails, restoration is read back before the error claims
  that the previous settings were restored.
- Factory reset verifies its final control writes. It still does not promise
  an atomic restore of EQ and controls after failure.
- Restore default reloads the built-in through normal profile selection after
  one discard confirmation, adopting its clean baseline.
- Utility maintenance reserves the shared operation slot before confirmation.
  Queued tasks check session identity and component/scheduler lifetime before
  writing and after I/O.

Regression tests cover silently dropped reset and rollback writes, every
control field, factory-reset mismatch, stale confirmation, repeated clicks,
and single-confirmation profile loading. Browser checks confirm the actual
Restore default flow closes after one confirmation and leaves no draft.

## Local checks

After these fixes:

| Check | Result |
| --- | --- |
| Frontend tests | 781 passed |
| Real-WASM tests | 17 passed |
| Rust workspace tests | 283 passed, including 211 core tests |
| Web, desktop, and test typechecks | Passed |
| Rust formatting and clippy | Passed |

Both frontend production builds passed after the fixes, with a Vite advisory
about the main JavaScript chunk exceeding 500 kB. Builds are not native runtime
verification. Browser checks also exercised control reset and reached the
factory-reset EQ readback confirmation with the dummy DAC. Component tests
verify that the factory-reset EQ reader starts after the maintenance slot is
released. The no-hardware-EQ explanation was checked with a Dawn Pro preview
at mobile and desktop widths.

The responsive review measured Profiles at 320, 390, 720, 850, 851, and
1340 px widths without horizontal overflow. At 320 px, all graph-toolbar
controls had 44 px touch targets. These were Chromium browser checks;
coarse-pointer landscape and native mobile WebView checks remain separate.

## Hardware and platform gaps

- Windows reconnect/runtime behavior and other desktop DACs were not retested
  in this review.
- The Walkplay timing/reset measurements apply to EPZ TP35 Pro on Linux.
  Other devices need their own checks.
- TP35 control persistence after a physical power cycle is not established.
- TP35 microphone readback differs by 1 dB for some values; the discrepancy
  remains unresolved.
- The new reset-verification checks have source-level fault-injection coverage,
  not a fresh physical-device validation.
- Signed Android upgrade, background/force-stop recovery, keyboard, gestures,
  USB detach, and rotation need the physical/emulator checklist in
  [Contributing](../CONTRIBUTING.md#android).
- Linux binaries depend on the build host's libraries. A local AppImage does
  not establish an older-distribution compatibility baseline.

## Before tagging

1. Finish the platform and hardware checks required for the intended assets.
2. Run `npm run verify`, `npm run verify:rust`, `npm run build:web`, and
   `npm run build:desktop` on the final source.
3. Review and commit the intended changes. Do not include an incidental
   generated PKGBUILD version update.
4. Move the Unreleased notes into the chosen version section and synchronize
   `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
5. Publish only after reviewing the final diff and release notes. Wiki changes
   live in their own Git repository and need a separate push.
