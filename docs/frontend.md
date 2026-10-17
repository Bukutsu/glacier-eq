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

`features/eq/hooks/useEqEditor.ts` owns editor changes, clean/dirty state, profile integration, and undo/draft handling. Device completion and editor completion have different guards: a saved DAC write may succeed even if the editor changed while it ran.

Preserve session, generation, and operation checks across awaits. The shared lock must still reject overlapping writes and maintenance actions. Reconnection may reopen and read; it must never replay a mutation. Offline edits and draft recovery must never write to hardware.

## Adding UI

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
