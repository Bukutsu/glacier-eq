# Tauri performance research

Date: 2026-09-08

Scope: Tauri 2 desktop/mobile IPC, command scheduling, state ownership, streaming, and frontend delivery as they apply to Glacier EQ. Sources are official Tauri or Vite documentation.

## Findings from primary sources

1. **Keep rendering in the WebView and OS work in the Core.** Tauri has one Core process with full OS access and separate WebView processes that render HTML/CSS/JavaScript. The Core routes IPC and owns global state; the WebView remains a browser-style UI runtime. Platform WebViews are supplied by the OS: WebView2 on Windows, WKWebView on macOS, and WebKitGTK on Linux. Performance must therefore be measured per platform rather than inferred from the browser build. [Tauri Process Model](https://v2.tauri.app/concept/process-model/)

2. **IPC is asynchronous message passing with serialization.** Tauri commands use a JSON-RPC-like protocol, and command arguments and return values must be JSON-serializable. Large serialized values add cost. For large binary responses, Tauri documents `tauri::ipc::Response` as the optimized return path instead of JSON serialization. [Tauri IPC](https://v2.tauri.app/concept/inter-process-communication/), [Calling Rust from the Frontend](https://v2.tauri.app/develop/calling-rust/)

3. **Use async commands for heavy operations, but do not confuse `async` with CPU parallelism.** Tauri recommends asynchronous commands for work that would otherwise freeze or slow the UI. Blocking filesystem, HID, or CPU work should be moved to `spawn_blocking` (or another worker) rather than merely wrapped in an async function. [Calling Rust from the Frontend — Async Commands](https://v2.tauri.app/develop/calling-rust/#async-commands)

4. **Events are not a high-throughput transport.** Tauri describes events as suitable for small lifecycle/state messages, not low-latency or high-throughput delivery. Event payloads are JSON and async listeners can process rapid events out of order. Channels are the recommended ordered, fast mechanism for streaming data. [Calling the Frontend from Rust — Events and Channels](https://v2.tauri.app/develop/calling-frontend/#channels)

5. **Choose state locks by lifetime.** Tauri’s state guide says a standard-library `Mutex` is often preferable; an async mutex is appropriate when a guard must be held across an await point, especially for I/O resources. [Tauri State Management](https://v2.tauri.app/develop/state-management/#when-to-use-an-async-mutex)

6. **Frontend delivery still follows normal Vite performance practice.** Vite recommends dynamically importing large feature-only dependencies, avoiding barrel files, profiling with `vite --profile`, and using production chunk splitting where useful. [Vite Performance](https://vite.dev/guide/performance), [Vite Production Build](https://vite.dev/guide/build#chunking-strategy)

## Glacier EQ audit

### Already aligned

- `src-tauri/src/profiles.rs` uses `spawn_blocking` for profile disk I/O, AutoEQ parsing, and the CPU-bound AutoEQ optimizer.
- `src-tauri/src/device_commands.rs` uses async commands plus `spawn_blocking` for HID enumeration, connect, pull, push, and apply operations.
- `src-tauri/src/settings.rs` keeps settings reads/writes off the IPC thread.
- `DeviceState` uses a short-lived standard `Mutex`; the separate `DeviceSessionLock` is an async mutex intentionally held across the serialized hardware operation.
- Progress events are low-rate operation updates (initialization, per-band progress, commit stages), so the current event choice is reasonable. It is not a bulk-data stream.
- The release profile uses LTO and one codegen unit, while `glacier-core` overrides to `opt-level = 3` for its CPU-heavy math. That is a sensible size-versus-throughput split.
- The recent graph and React render optimizations keep high-frequency interaction work in the WebView and avoid unnecessary IPC.

### Worth measuring next

1. **IPC payload cost.** `run_autoeq` sends measurement and target point arrays through command serialization, and text import/export sends up to 1 MiB strings. Measure round-trip time and payload size on desktop and Android before changing the boundary. If these payloads grow, reduce/sample curves before invocation or consider a binary `Response`/channel design rather than larger JSON objects.
2. **Feature delivery.** The current production web build has a roughly 426 KB main JS asset and a roughly 248 KB WASM asset before compression. Profile startup and consider lazy-loading tools that are not needed for the initial EQ editor (AutoEQ, online database, diagnostics, or profile tooling), validating that offline packaging and mobile startup improve rather than just increasing chunk requests.
3. **Native release startup.** Measure cold start, first meaningful paint, and first usable editor state in release builds on WebView2, WebKitGTK, and Android WebView. Browser/Vite numbers are not sufficient for Tauri because the renderer is platform-provided.
4. **High-rate future flows.** If HID telemetry, streamed measurements, or database progress becomes high frequency, batch/coalesce UI updates and use a Tauri Channel for ordered streaming. Keep events for lifecycle notifications.
5. **Lock contention.** Hardware operations are intentionally serialized. If future commands need concurrent non-device work, keep the device session lock scoped to the actual operation and never hold a standard state mutex across an await.

## Recommended measurement plan

- Add a small Tauri-only benchmark harness that records command payload bytes, invoke round-trip duration, and UI frame timing for: `run_autoeq`, profile load/save, device pull/push, and text import/export.
- Run it against release desktop builds and the Android debug/release APK separately.
- Use `vite --profile` for startup/module costs and the React/browser profiler for WebView interactions.
- Keep the existing graph benchmark as the CPU baseline; pair it with frame-drop/INP measurements so a faster pure function is only kept when the user-visible interaction improves.

No Tauri-specific code change is recommended solely from this research yet; the current native command scheduling is already in good shape. The next highest-value investigation is measured IPC payload/round-trip cost on desktop versus Android.
