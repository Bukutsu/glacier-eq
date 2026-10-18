# Release readiness

This is a source-review snapshot, not a claim that a release has been tested
on every platform. It covers the changes after the frontend reorganization
and the profile/mobile UI work in v0.15.0. Release manifests and lockfiles
are synchronized at 0.15.0. The
[v0.15.0 release](https://github.com/Bukutsu/glacier-eq/releases/tag/v0.15.0)
was published after the CI package and signed Android upgrade gates below
passed. Later releases still start as drafts until those checks pass.

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

| Check                             | Result                               |
| --------------------------------- | ------------------------------------ |
| Frontend tests                    | 781 passed                           |
| Real-WASM tests                   | 17 passed                            |
| Rust workspace tests              | 283 passed, including 211 core tests |
| Web, desktop, and test typechecks | Passed                               |
| Rust formatting and clippy        | Passed                               |

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

## v0.15.0 package and emulator checks

The [release workflow](https://github.com/Bukutsu/glacier-eq/actions/runs/39065737785)
passed source verification and all platform builds. All eight expected assets
were present. Their downloaded sizes and SHA-256 digests matched GitHub, and
each attestation verified against the release workflow, tag, and source commit
`57cbee12a399307e0aee65ba299b8ee68fedb436`.
The [web deployment](https://github.com/Bukutsu/glacier-eq/actions/runs/39065737752)
also passed.

The signed ARM64 APK upgraded the published v0.14.0 app with `adb install -r`,
without uninstalling. The signing certificate matched, the version code advanced
from 140050 to 150050, and a saved profile and the Nord theme survived.

An Android 37 emulator with ARM64 translation exercised profile loading,
display-only graph dots, graph visibility with expanded band settings, the
numeric keyboard and Android Back dismissal, landscape navigation, and
force-stop draft recovery. Restoring the draft retained the edited 0.10 dB
gain rather than the saved profile's 0 dB. This used a read-only AVD overlay;
it did not modify the user's base emulator or test physical USB access.

The final production browser check found no Profiles overflow at the six
widths above. Profiles passed the scoped WCAG 2 A/AA automated checks. The
settled save dialog had no automated violations; its one incomplete
description-text contrast check was manually checked at 5.37:1. These are
scoped checks, not a full accessibility audit.

Linux package inspection confirmed DEB version 0.15.0/amd64 and an x86-64
AppImage executable requiring GLIBC symbols up to 2.34. The current Linux host
resolved its shared libraries. This is not a runtime compatibility test on
every distribution.

## Hardware and platform gaps

- Windows reconnect/runtime behavior and other desktop DACs were not retested
  in this review.
- The Walkplay timing/reset measurements apply to EPZ TP35 Pro on Linux.
  Other devices need their own checks.
- TP35 control persistence after a physical power cycle is not established.
- Walkplay live apply was checked on the EPZ TP35 Pro only. Other Walkplay
  DACs are enabled from the vendor tools' packets and devicePEQ's shared
  handler, and Fosi / iBasso is excluded. Whether a power cycle drops a
  temporary EQ was not tested.
- TP35 microphone readback differs by 1 dB for some values; the discrepancy
  remains unresolved.
- The new reset-verification checks have source-level fault-injection coverage,
  not a fresh physical-device validation.
- The emulator checks above do not replace physical Android testing.
  Backgrounding, system gestures, USB detach, and device-specific keyboard,
  rotation, and lifecycle behavior still need the
  [Android checklist](../CONTRIBUTING.md#android).
- Linux binaries depend on the build host's libraries. A local AppImage does
  not establish an older-distribution compatibility baseline.

## Release gates

1. Run `npm run verify`, `npm run verify:rust`, `npm run build:web`, and
   `npm run build:desktop` on the final source.
2. Review and commit the intended changes. Do not include an incidental
   generated PKGBUILD version update.
3. Move the Unreleased notes into the chosen version section and synchronize
   `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and
   the npm/Cargo lockfiles.
4. Push the release tag. CI verifies source, builds every platform, checks
   asset coverage, attests the packages, and creates a draft release.
5. Verify APK signing and upgrade from the previous signed release without
   uninstalling. Record settings/profile retention and emulator versus
   physical-device coverage.
6. Publish only after the required checks pass and the remaining platform
   limits are recorded. Wiki changes live in their own Git repository and
   need a separate push.
