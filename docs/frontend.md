# Frontend structure

Start with the feature you are changing. `src/app/App.tsx` composes the workspace; it is not the place to add feature state or hardware operations.

## Ownership

- `src/app/`: workspace layout, navigation wiring, application-wide feedback, and regression tests that cover the whole shell.
- `src/components/ui/`: reusable controls and dialogs. These do not know about DACs, EQ, profiles, or settings.
- `src/components/layout/`: shared page layouts.
- `src/components/feedback/`: toasts and the error boundary.
- `src/features/eq/`: EQ editor, graph, preamp, undo history, and draft recovery.
- `src/features/device/`: discovery, connection lifecycle, model-specific controls, and device operations.
- `src/features/profiles/`: profile library, naming, and profile mutations.
- `src/features/tuning/`: AutoEQ configuration and optimization state.
- `src/features/traces/`: measurement and target curves, imports, and the online database.
- `src/features/settings/`: settings persistence, appearance, and themes.
- `src/features/diagnostics/`: event logs and session-only debug controls.
- `src/lib/`: shared infrastructure, backend adapters, RPC, storage, and navigation contracts.
- `src/hooks/`: platform and viewport hooks used across features.
- `src/stores/`: application-wide notification state. Feature stores live with their feature.
- `src/types.ts`: shared domain and backend contracts.

Within a feature, `components/` renders UI, `hooks/` owns React state and effects, and `lib/` contains non-React helpers. Device `operations/` contains asynchronous workflows with explicit transport and confirmation dependencies. Add folders when they have a job; a new feature does not need an empty copy of every folder.

Tests sit beside the implementation. Shell-wide CSS and startup checks live in `app/tests/`. Reusable test data belongs in a nearby `*.test-support.ts` file.

## Imports and types

Use relative imports for nearby files and `@/` for imports across folders. The alias points to `src/` in TypeScript, Vite, and Vitest. Import the owning module directly rather than adding re-export-only `index.ts` files.

Use `import type` for types. `verbatimModuleSyntax` checks this. Keep a component's props beside that component; put a type in a shared module only when it has shared ownership.

Validate external values as `unknown` at RPC, storage, and file boundaries. A TypeScript assertion does not validate a device response or saved JSON.

Features can reuse another feature's focused components or helpers. They must not import `app/`; the app wires features together. Generic UI must not import features. The architecture tests check these direct-import boundaries and keep React UI out of feature helpers and operations.

## State and device safety

Keep transient state local. A store is useful for genuinely shared state, not as a default home for every field.

The device lifecycle has one owner:

- `features/device/hooks/useDeviceState.ts` owns connection identity, session/generation refs, busy state, and the shared operation lock.
- `useDeviceSession.ts` wires commands to that state.
- `useDeviceEvents.ts` handles backend events.
- `useDevicePolling.ts` handles desktop detach detection and automatic reconnection.
- `features/device/operations/` contains read, save, reset, restart, and read-recovery workflows.

The primary Connect DAC action uses `operations/connectPrimary.ts`: authorize
WebHID when needed, scan, then connect directly if exactly one real DAC is
present. Zero devices, multiple devices, or a failed connection open the
chooser. Development previews never become automatic connection targets.
The command pauses automatic reconnect and rejects repeated taps while it
runs. On Android, plug-in launch is opt-in: the USB attach filter sits on the
`.UsbAttachLauncher` activity alias, which ships disabled. The General setting
(`OpenOnAttachSetting`) switches it through the HID plugin's
`getOpenOnAttach`/`setOpenOnAttach`; Android stores the choice, so it is not
in `AppSettings`. When on, the HID plugin forwards an approved USB attach intent to
`useDevicePolling` even when the activity is already running. The event resumes
discovery after a manual disconnect and targets only the attached USB path;
it never switches an existing connection. Cold launches use normal discovery. Explicit device switching stays under the closed Connection options
disclosure in the device summary and opens the chooser directly.

`features/eq/hooks/useEqEditor.ts` owns editor changes, clean/dirty state, profile integration, and undo/draft handling. Device completion and editor completion have different guards: a saved DAC write may succeed even if the editor changed while it ran.

Preserve session, generation, and operation checks across awaits. The shared lock must still reject overlapping writes and maintenance actions. Reconnection may reopen and read; it must never replay a mutation. Offline edits and draft recovery must never write to hardware.

## Editor baselines and profile loading

A dirty EQ is not necessarily unfinished work. An unmatched DAC read stays
dirty so it can be saved as a profile, but the read EQ is also its clean
baseline. `hasUnfinishedEdits` decides whether the current EQ differs from
that baseline before `useEditorDraft` persists a recovery record.

Keep `editorCleanPeqRef` in the same normalized device shape as the editor.
Profile loads adopt their loaded EQ as the baseline. Ordinary edits, Undo,
Redo, and generic editor reset have their own history/baseline rules.

Default EQ is an immutable library entry, not a locked editor. Loading or
restoring it uses `features/profiles/lib/loadProfile.ts` and the ordinary
profile-selection callback. It confirms dirty replacement once and rejects
results after the async context changes. Do not route profile restore through
the generic editor reset.

Utility resets reserve the shared operation slot through
`features/device/operations/runDeviceMaintenance.ts` before confirmation.
`DeviceView` also checks component lifetime and scheduler generation before
queued work starts and after I/O. A factory reset releases its maintenance
slot before the EQ reader claims its own slot.

## Shared visuals and feedback

`FilterResponse` and `DacFilterVisual` render the hardware reconstruction
filter as SVG. They are separate from the editable EQ graph. Keep the
disclosure, resize observer, theme colours, and reduced-motion behavior
together; rendering a hidden canvas caused blank output after reopening in
WebKit.

Use the shared `Badge` for quiet status labels. Toasts retain pause-on-hover
and focus behavior and auto-dismiss, without a countdown bar. Diagnostics
retain detailed events when routine recovery does not show a toast.

On compact layouts, EQ sections are full-width flat panels with hairline
dividers. Their controls use the page gutter. Mobile graph dots cannot be
dragged; a tap near one selects that band (`onBandTap`), the selected dot is
ringed, and only its single-band curve is drawn. Desktop retains graph editing.
The mobile band card always shows Gain, Frequency and Q, with the filter type
in its header. On screens at least 700 px tall the EQ graph and the band chips
stay pinned while the controls scroll; App.tsx measures the graph into
`--mobile-graph-height` for the chips' offset. The pin suppresses the duplicate
floating preview and releases when the on-screen keyboard opens. Collapsed
graphs stay collapsed. Short screens retain the floating-preview behavior.
Mobile restores a readable draft by itself and shows `DraftRestoredNotice`
with Keep and Discard; an unreadable draft, or one that cannot load (a DAC is
connected), keeps the full in-workspace recovery card. Desktop keeps its
header recovery popover. The graph toolbar keeps Curves and add together on
the left; the legend button, the A/B hold button and show/hide sit on the
right, with 44 px targets. Under 420 px wide show/hide keeps only its icon.
Phones have four tabs: Device's root page is the top of the Settings tab, and
`/device` redirects to `/settings` there; device subsections keep their
routes. When the DAC lacks the editor's EQ, tabs without the header show a
save bar above the tab bar.
A/B uses `features/device/operations/compareBypass.ts`: it writes the EQ with
every filter off to RAM, then restores what the DAC played (the editor under
live apply, otherwise the stored EQ). It is hidden when that is unknown.
The default-profile row is compact on desktop. Mobile uses the independent
`features/profiles/components/MobileProfilesView.tsx`: current-editor card,
collapsed response preview, searchable library, explicit load buttons, and
overflow actions. It shares profile operations, not the desktop view or its
layout selectors. Keep mobile controls at least 44 px and test at 320 px with
long names. AutoEQ import validates the parser's wrapped response through
`features/profiles/lib/profileImport.ts` and retains clamp warnings.
The Tuning tab's AutoEQ dropdowns own its graph view: picking a measurement or
target makes it the only curve shown, through the exclusive selection handlers
in `useTraces`. The Curves menu remains the manual override and is not
re-applied when the dropdown selection itself did not change.
Only the current profile uses a filled selection background.

## Adding UI

All new user-facing text needs a catalog entry. See [Localization](localization.md)
for translation hooks, language catalogs, and the checks run by verification.

**A reusable control:** add it to `components/ui/`, using the existing controls before introducing another implementation. Test keyboard behavior and accessible names.

**A feature panel:** put the component, state hook, helpers, and tests under its feature. Wire navigation or workspace placement in `app/`. Avoid putting feature-specific state back into `App`.

**A DAC control:** add the model-specific panel under `features/device/components/` and wire its catalog metadata in `DeviceView.tsx`. Call the shared RPC boundary; protocol bytes belong in Rust, not the component.

**A setting:** update the UI, `AppSettings` when needed, and both runtime validators. Native and web persistence must accept the same values.

**A visual change:** inspect `styles/index.css` before changing CSS. Styles intentionally remain centralized because layer and responsive-rule order affect several features. Preserve that order during refactors.

## Verification

After the initial WASM setup in [CONTRIBUTING.md](../CONTRIBUTING.md):

- Run a focused test, for example `npm test -- src/features/device/operations/pushEq.test.ts`.
- Run `npm run typecheck` for web, desktop, and tests.
- Use `npm run format` to format frontend TypeScript.
- Run `npm run verify` before handing off a change. It checks formatting, frontend tests, types, and the real WASM bridge.

Test imported production functions instead of reading source text and executing extracted callbacks. Source checks are still useful for CSS contracts; they are not a replacement for operation tests.

For interactive checks, run `npm run dev:web` and connect the Dev Dummy DAC. Check editing, Undo/Redo, profiles, settings, and narrow layouts. The dummy exists only in development and does not verify USB transport, Windows recovery, or persistence on a physical DAC.
