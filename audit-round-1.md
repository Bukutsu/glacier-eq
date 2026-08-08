# Lean audit — round 1

Inventory of dead code and duplication found by a full-tree pass (frontend + Rust core + Tauri layer), each item verified with workspace-wide grep before listing.

## Dead code — delete or privatize

### Rust

- `glacier-core/src/error.rs` — `ErrorKind` enum (serde wire-format machinery), `classify_error` with 6 branches: only `is_disconnection` has a consumer (`src-tauri/src/device_commands.rs:53`). Collapse to a single needle-list check.
- `glacier-core/src/eq/constants.rs` — `GAIN_STEP`, `ISO_Q_VALUES`: zero references in the workspace. `MAX_BAND_GAIN`: referenced only by autoeq tests. Delete the module entirely.
- `glacier-core/src/device/walkplay.rs` — 8 `pub` constants used only inside the module (`OFFSET_FREQ_L/H`, `OFFSET_Q_L/H`, `OFFSET_GAIN_L/H`, `OFFSET_FILTER_TYPE`, `QUANTIZER_SCALE`). Make private.
- `glacier-core/src/autoeq.rs` — 14 `pub` items used only inside the module (`normalize_curve_points`, `spectrum_values`, `preprocess`, `run_autoeq_optimization`, `generate_log_spaced_freqs`, `interpolate_curve`, `K`, `MAX_N`, `Biquad`, `InitFilter`, `Lim`, `Smooth`, `IE_SMOOTH`, `OE_SMOOTH`). Make private so the compiler can enforce future dead-code detection on the optimizer.
- `glacier-core/src/device/session.rs` — `validate_peq`, `compare_peq`, `DeviceSession::new` used only in-module; `ProgressCallback` never named by callers. Make private.
- `glacier-core/src/profiles.rs` — `data_dir()` used only by `default_location()` (CLI). Make private.
- `glacier-core/src/profile_match.rs` — `peq_matches_profile` used only in-module. Make private.

### TypeScript

- `src/hooks/useTraces.ts` — `setMeasurements`, `userTargets`, `setUserTargets`, `setActiveTargetIds` returned but never consumed by the single caller (`App.tsx`). Drop from the return.
- `src/lib/measurements.ts` — `makeUniqueName` exported, never imported. Un-export.
- `src/components/ToolsPanel.tsx` — `canUndo`/`canRedo`/`onUndo`/`onRedo` declared on `ToolsPanelProps` and passed at 4 call sites, never read in the file. Remove prop + passings. `canDelete` is a trivial alias of `selectedIsSaved` — inline it.
- `src/App.tsx` — `selectedPresetRef`: write-only ref (initializer + sync effect + 6 writes, zero reads). Remove.
- `src/lib/rpc.ts` — `get_eq_state`: redundant re-check of `matches_global_gain_response` after `readMatchingReport` already matched. Remove.
- `src/components/Preamp.tsx` — `range`/`integerMode` defaults never exercised (both call sites pass them). Make required.
- `src/lib/onlineDb.ts` — `useOnlineDatabase(enabled)` always called with `true`; the `enabled` flag and its guards are constant. Drop the parameter.

## Duplication — collapse

- `src/App.tsx` — three near-identical ~40-line mobile `ToolsPanel` prop blocks (profiles/settings/device) differ only in `availableTabs`/`defaultTab`/`showActions`/`connected`/`hideProfileFolderButton`. Extract one shared props object.
- `src/App.tsx` — four identical `<EqGraph …/>` 8-prop elements (two mobile, two desktop, differing only in the optional editor-props spread). Extract a local render helper.
- `src/App.tsx` — desktop `Preamp` `onChange` inlines the same 4 lines as the existing `handlePreampChange` callback. Reuse the callback.
- `src/components/AddTraceModal.tsx` — `handleTargetFile` is a near-verbatim copy of `handleMeasurementFile` (identical body, different label). Merge into one parameterized handler.

## Kept (boundary mirrors, not cut)

- `src/lib/errors.ts` `DISCONNECT_NEEDLES` vs Rust `is_disconnection` needle list — same list needed in two runtimes (Tauri backend vs web frontend); neither can call the other.
- `Bands.tsx` freq/Q slider mapping vs `lib/graph.ts` axis mapping — same log10 math but different clamp ranges (device capability range vs fixed 20–20000 Hz), not safely mergeable.
- `tauri-plugin-hid` vendored fork — trims the upstream plugin (no guest-js/commands.rs/tests); crates.io 0.2.3 would restore those, not remove them.

## Net

- ~250 lines removable across frontend + core, 0 dependency changes.
