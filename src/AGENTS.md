# Frontend work

For UI additions, state changes, or frontend refactors, read [the frontend guide](../docs/frontend.md) for ownership, extension points, and device-session invariants.

Device workflows share one operation lock and session identity. Preserve their guards across awaits; automatic reconnection must never replay mutation writes.

Keep `styles/index.css` layer/import order intact during file moves. Several features share its responsive and legacy rules.

`wasm_pkg/` is generated and ignored. Rebuild it with `npm run wasm:build` after changing the Rust WASM interface.
