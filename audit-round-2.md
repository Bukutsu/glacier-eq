# Lean audit — round 2

Follow-up pass after round 1 (which removed ~180 lines): re-audit of the changed areas, remaining duplication hotspots, and unreferenced assets. All items grep-verified.

## Cut this round

- `src/components/Bands.tsx` — local `clamp` was a third copy of `clampToRange` (already in `src/lib/peq.ts`). Removed the local copy, imported the shared one; exported `clampToRange` (it was module-private).
- `src/components/EqGraph.tsx` — the shape-view offset expression `viewMode === "shape" ? -(await combinedResponseAt(peq, 1000, "shape")) : 0` was repeated verbatim at three draw sites (one with a `measurement &&` guard). Extracted `shapeOffset(peq, viewMode)`; call sites stay identical semantically.
- `src/components/ToolsPanel.tsx` — the tab filter `name !== "Import" || !requestedTabs.includes("Preset")` had a redundant second clause: the `tab === "Import"` render branch does not exist (Import renders inside the Preset panel), so "Import" is simply never offered as its own tab. Simplified the filter.
- `src/App.tsx` — the mobile EQ tab and the desktop pane rendered byte-identical `<Preamp>` + `<Bands>` subtrees. Extracted `editorControls` next to the existing `graphElement` helper.
- `assets/glacier-eq-demo.mp4` (397 KB) — referenced nowhere in the repo (README, index.html, src, public all checked). Deleted; recoverable from git history if the wiki ever needs it.

## Re-checked and kept (not bloat)

- `AutoEqTab` selection sync (`localMeasId`/`localTargetId` + effects + fallbacks) — real state management for external changes (deleted traces, toggled targets), not dead machinery.
- Drag-and-drop import (App.tsx) vs Import tab file picker — same `parse_autoeq` call but different flows (immediate apply vs confirm-then-save); merging couples them for ~6 shared lines.
- `Select` component number coercion — live (steps/sample-rate options are numeric).
- `emit("device-pull")` — has a real listener in `DeviceTab`.
- `isAndroid` detection in App.tsx vs `useThemeSync` — similar but not identical (AndroidNotifier bridge check); merging changes behavior.
- `tauri-plugin-hid` fork, CLI binary, desktop/udev/PKGBUILD packaging, web-mode files — all load-bearing.

## Net

- ~35 lines removed this round (plus one 397 KB unreferenced asset); 0 dependency changes.
