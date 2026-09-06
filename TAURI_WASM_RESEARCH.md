# Research Report: WebAssembly Support in Tauri v2, Practical Limitations, and Architecture Strategy for Glacier EQ

**Document Path**: `/home/bukutsu/Projects/glacier-eq/TAURI_WASM_RESEARCH.md`
**Target Repository**: `glacier-eq` (v0.5.2)
**Date**: September 2026
**Scope**: Tauri v2 WebAssembly runtime capabilities, cross-platform webview limitations, root-cause diagnosis of repository build/runtime coupling, architectural options, and staged migration plan.

---

## 1. Executive Conclusion

1. **Does Tauri support WebAssembly well?**
   **Yes, but with critical architectural caveats.** Tauri acts as a host and static asset provider; WebAssembly execution does **not** take place inside the native Tauri backend process, but entirely within the system's underlying WebView engine (Chromium/WebView2 on Windows, WebKitGTK on Linux, WKWebView on macOS/iOS, and Android System WebView on Android). Tauri v2 natively serves pre-compiled `.wasm` files via its custom protocol (`tauri://localhost` or `http://tauri.localhost`), correctly detects `application/wasm` via magic byte inspection (`\0asm`), and permits WASM execution provided the Content Security Policy (CSP) includes `'wasm-unsafe-eval'`. However, Tauri provides **no zero-copy shared-memory IPC** between the WebView's WASM linear memory and the native Rust backend; every IPC call between webview and backend incurs serialization and process-boundary overhead.

2. **What are the practical limitations?**
   - **Engine Heterogeneity**: While Windows (WebView2) and Android (Chromium V8) offer best-in-class WASM performance and JIT compilation, Linux (WebKitGTK) and iOS/macOS (WebKit JavaScriptCore) exhibit quirks in memory growth, sandboxing (`bwrap` / W^X executable memory permissions), and occasional JIT validation bugs.
   - **MIME & Streaming Fallbacks**: If `.wasm` is served without strict `application/wasm` headers (common in certain proxy dev setups or legacy Android asset loaders), `WebAssembly.instantiateStreaming` throws a `TypeError`, forcing a slower fallback to `WebAssembly.instantiate(arrayBuffer)`.
   - **Toolchain Contamination**: Direct static imports of `wasm_pkg` inside TypeScript files create a hard build-time prerequisite on `wasm-pack` and the `wasm32-unknown-unknown` Rust target, forcing every desktop and packaging environment (e.g., Arch Linux `PKGBUILD`, Android NDK builds) to maintain a complete WebAssembly cross-compilation toolchain even when compiling purely native desktop binaries.

3. **Should this project separate desktop/Tauri and web/WASM implementations or branches?**
   **No. Splitting into separate git branches or an over-engineered monorepo is strongly discouraged.**
   - Git branches (`main` vs `web`) would cause severe maintenance overhead, inevitable drift of UI logic, and duplicate bug-fixing across React components.
   - A multi-package monorepo adds build complexity disproportionate to the project's size.
   - **The optimal solution is a Single Codebase with Runtime Backend Adapters and Target-Specific Build Graphs.** In this architecture, mechanism is separated from policy: `rpc.ts` is decomposed into an abstract `EqBackend` interface with two lightweight implementations (`TauriNativeBackend` and `WebBrowserBackend`). Dynamic `import()` is useful for lazy loading and code splitting, but a literal import still has to resolve during Vite/TypeScript builds; it does not by itself remove the WASM toolchain from a desktop build. To remove that dependency, the desktop entry must select an implementation that does not import the full WebHID/WASM adapter. Graph math can retain a small graph-only WASM module or use native TypeScript math if benchmarks demonstrate sufficient throughput.

---

## 2. High-Trust Primary Sources

All factual assertions in this report trace directly to the following official documentation, source code repositories, and recorded issues:

### 2.1 Official Tauri v2 Sources
- **Tauri v2 Frontend Configuration Docs** (Updated Oct 1, 2024 / 2026):
  URL: `https://v2.tauri.app/start/frontend/`
  *Key Fact*: Tauri acts as a static host; frontend can be HTML/CSS/JS and WASM. Recommends Vite for SPAs; documents Trunk/Leptos for Rust WASM frontends.
- **Tauri v2 Content Security Policy (CSP) Reference** (Updated Apr 7, 2025):
  URL: `https://v2.tauri.app/security/csp/`
  *Key Fact*: Compile-time and runtime CSP injection; script execution is restricted. WebAssembly compilation requires explicit CSP grants.
- **Tauri v2 Calling Rust / WASM Guide** (Updated Jun 8, 2026):
  URL: `https://v2.tauri.app/develop/calling-rust/#wasm`
  *Key Fact*: When calling `invoke()` from inside a Rust WASM frontend, invocation calls out to `window.__TAURI__.core.invoke`. Standard Tauri IPC passes JSON or raw bytes (`tauri::ipc::Response`).
- **Tauri v2 Trunk Guide** (Updated Feb 2, 2026):
  URL: `https://v2.tauri.app/start/frontend/trunk/`
- **Tauri v2 Crate Source Code (`tauri` v2.11.5)**:
  File: `tauri-2.11.5/src/protocol/tauri.rs` (custom protocol request handler), `tauri-2.11.5/src/manager/mod.rs` (`get_asset` routine).
- **Tauri Utilities Crate Source Code (`tauri-utils` v2.9.3)**:
  File: `tauri-utils-2.9.3/src/mime_type.rs`.
  *Key Fact*: `MimeType::parse` delegates to the `infer` crate (`infer::get(content)`) to inspect binary magic bytes before falling back to URI extension matching.
- **Tauri Wry Crate Source Code (`wry` v0.55.1)**:
  File: `wry-0.55.1/src/android/kotlin/RustWebViewClient.kt`.
  *Key Fact*: Android asset loading delegates to `androidx.webkit.WebViewAssetLoader` with `AssetsPathHandler`.

### 2.2 Tauri Community & Issue Tracker
- **Tauri Issue #3897** ("impossible anymore to load wasm in release build", Apr 13, 2022):
  URL: `https://github.com/tauri-apps/tauri/issues/3897`
  *Key Fact*: Confirmed that omitting `'wasm-unsafe-eval'` triggers `CompileError: Refused to create a WebAssembly object`.
- **Tauri Issue #5749** ("incorrect mime type for wasm when using tauri build", Dec 2, 2022):
  URL: `https://github.com/tauri-apps/tauri/issues/5749`
- **Tauri Issue #7154** ("crashes : RuntimeError: Out of bounds memory access", Jun 7, 2023):
  URL: `https://github.com/tauri-apps/tauri/issues/7154`
  *Key Fact*: WebKitGTK on Linux experiencing sporadic out-of-bounds runtime errors during WASM execution under WebKit2GTK 2.40.x.
- **Tauri Issue #8857** ("(`tauri 2.0.0-beta`, `mobile`) Incorrect response MIME type when using wasm", Feb 14, 2024):
  URL: `https://github.com/tauri-apps/tauri/issues/8857`
  *Key Fact*: Android dev server / custom asset loader returning non-`application/wasm` MIME types causes `WebAssembly.instantiateStreaming` to fail with `TypeError`, forcing fallback to `WebAssembly.instantiate`.
- **Tauri Issue #10716** ("Tauri 2 + Leptos on Android", Aug 21, 2024):
  URL: `https://github.com/tauri-apps/tauri/issues/10716`

### 2.3 WebKit / WebKitGTK / Browser Engine Sources
- **WebKit Bugzilla #288722** ("Tail call result type validation not working correctly for nullable types", Resolved Mar 10, 2025):
  URL: `https://bugs.webkit.org/show_bug.cgi?id=288722`
  *Key Fact*: Confirmed discrepancies between JavaScriptCore WASM validation and V8/SpiderMonkey on Linux WebKitGTK.
- **WebKit Bugzilla #213148 & #223479** (Bubblewrap sandbox, W^X permissions, and memory isolation):
  URL: `https://bugs.webkit.org/show_bug.cgi?id=213148`

### 2.4 Rust / WASM Tooling Sources
- **wasm-bindgen Guide: Deployment Reference** (rustwasm.github.io):
  URL: `https://rustwasm.github.io/docs/wasm-bindgen/reference/deployment.html`
  *Key Fact*: `--target web` produces ES module output using `fetch()` and `WebAssembly.instantiateStreaming`, falling back to `arrayBuffer()`. `--target bundler` assumes native Wasm ES module proposals not yet standardized in all browsers.
- **Vite Guide: Features - WebAssembly** (vite.dev v8.2.1):
  URL: `https://vite.dev/guide/features#webassembly`
  *Key Fact*: Vite supports `.wasm?init` and asset URL imports (`new URL('*.wasm', import.meta.url)`). Inlines files under `assetInlineLimit` as base64 or emits them as hashed assets.

---

## 3. What Tauri Does and Does Not Support

### 3.1 What Tauri Does Support
1. **Executing WebAssembly in the Frontend**:
   Because Tauri embeds modern web engines (WebView2, WebKit, Android WebView), any standard WebAssembly binary (`mvp`, `bulk-memory`, `sign-ext`, `nontrapping-float-to-int`, `simd128`) can execute inside the JavaScript runtime of the window.
2. **Serving `.wasm` Files via Custom Protocols**:
   In production release builds, files in `frontendDist` (e.g. `../dist/assets/*.wasm`) are embedded into the application binary or read via custom URI protocols (`tauri://localhost` on macOS/Linux, `http://tauri.localhost` on Windows/Android).
3. **Automatic MIME Type Detection via Binary Sniffing**:
   As verified in `tauri-utils/src/mime_type.rs`:
   ```rust
   pub fn parse_with_fallback(content: &[u8], uri: &str, fallback: MimeType) -> String {
       let mime = infer::get(content).map(|info| info.mime_type());
       ...
   }
   ```
   The `infer` crate (v0.19.0) inspects the first 4 bytes. If it matches `\0asm` (0x00, 0x61, 0x73, 0x6D), it sets `Content-Type: application/wasm`.
4. **Permissive Content Security Policy (CSP)**:
   Tauri supports passing `'wasm-unsafe-eval'` in `app.security.csp` in `tauri.conf.json`, allowing the browser engine's JIT compiler to instantiate WASM bytecode without throwing CSP violations.

### 3.2 What Tauri Does Not Support
1. **WASM Execution in the Backend Process**:
   Tauri has no built-in WebAssembly runtime (such as Wasmer or Wasmtime) in `tauri::Builder`. `src-tauri` is an OS-native compiled binary (`elf`, `pe`, `mach-o`).
2. **Direct / Zero-Copy WASM-to-Rust IPC**:
   There is no memory-mapped or shared linear memory bridge between a WebAssembly module running in the WebView and the native Tauri Rust backend. If a WASM module in the webview wishes to communicate with Tauri's backend, it must call `window.__TAURI__.core.invoke`, which passes through the JavaScript IPC serialization boundary.
3. **Unified Single-Step Cross-Compilation**:
   `cargo build` or `cargo tauri build` cannot simultaneously compile host native crates and target `wasm32-unknown-unknown` without an orchestrated build script or frontend bundler step.
4. **Consistent JIT Guarantees Across All Platforms**:
   While Windows (V8) and macOS (JSC) allow full JIT compilation, certain restricted environments (e.g., iOS without custom JIT entitlements, or Linux distributions running strict seccomp/bubblewrap sandboxes) restrict arbitrary memory page execution (`PROT_EXEC`), forcing interpreters or causing potential startup failures.

---

## 4. Likely Causes of This Repository's Integration Problems

Inspection of `glacier-eq` reveals a hybrid architecture with several architectural tensions between native Tauri desktop and browser WebAssembly.

### 4.1 Fact: Build-Chain Toolchain Contamination
- **Evidence**:
  - `package.json` specifies:
    ```json
    "predev": "npm run wasm:build",
    "wasm:build": "cross-env RUSTFLAGS= wasm-pack build glacier-core --target web --out-dir ../src/wasm_pkg",
    "prebuild": "npm run wasm:build",
    "build": "tsc && vite build"
    ```
  - `src/wasm_pkg` is listed in `.gitignore` (line 55).
  - `src/lib/rpc.ts` and `src/lib/graph.ts` contain top-level static imports:
    ```ts
    import initWasm, { ... } from "../wasm_pkg/glacier_core";
    ```
- **Root Cause**: Because the TypeScript compiler (`tsc`) and Vite module resolution encounter imports to `../wasm_pkg/glacier_core`, `npm run build` fails immediately if `src/wasm_pkg` does not exist on disk. Changing a literal static import to a literal dynamic import would alter loading/chunking, but would still leave the generated module as a build-time dependency.
- **Cascading Consequences:**
  1. In commit `79574c5cfc`, building the Arch Linux native package required adding `rust-wasm` (`wasm32-unknown-unknown`) to `makedepends` in `PKGBUILD`, even though the desktop package runs native Rust code in `src-tauri`.
  2. In commit `ad6971ba4b`, an attempt to skip `wasm:build` during Android CI broke the build and had to be reverted in commit `fbbd1c6784` because the frontend could not build without the generated WASM package.
  3. In commit `e7f37dd1ee`, host-specific `RUSTFLAGS` (e.g. `-C target-cpu=native`) broke `wasm-pack` compilation for the `wasm32-unknown-unknown` target, necessitating `cross-env RUSTFLAGS=`.

### 4.2 Fact: Monolithic Architecture of `src/lib/rpc.ts`
- **Evidence**: `src/lib/rpc.ts` is 1,340 lines long. It handles:
  - Tauri IPC routing when `isTauri()` is true.
  - WebHID hardware transport, protocol packet framing/unframing, and response polling when `isTauri()` is false.
  - Web-side profile storage (`localStorage`).
  - Web-side AutoEQ optimization via WASM.
- **Impact**: All WebHID and WebAssembly fallback code is bundled into the desktop application bundle. Even though `isTauri()` bypasses `invokeWeb()` at runtime, the desktop frontend payload is bloated by unused web emulation routines.

### 4.3 Fact: Graph Math Bypasses Tauri IPC and Runs in WASM Everywhere
- **Evidence**: `src/components/EqGraph.tsx` imports from `src/lib/graph.ts`, which unconditionally initializes and runs `peq_response_and_band_values` via `../wasm_pkg/glacier_core`.
- **Reasoning**: According to `PERF.md`, evaluating 800 frequency points across 10 parametric bands executes in **0.093 ms** in WASM.
- **Architectural Reality**: The desktop application is **already a hybrid Tauri + WASM application**. It does not use WASM merely as a web fallback; it deliberately uses WASM inside the WebView to avoid IPC latency during interactive 60–120 FPS slider and canvas drag operations. Calling Tauri's native backend via `invoke("peq_response_and_band_values")` on every animation frame would serialize 800 float values over IPC, introducing measurable stutter.

### 4.4 Fact: Concurrent WASM Initialization Race Conditions
- **Evidence**: Commit `2f0037d0e6` fixed an issue where concurrent startup calls between `EqGraph` and `rpc.ts` redundantly triggered `initWasm()`. It was patched to use `wasmInitPromise ??= initWasm()`.
- **Inference**: While caching the promise prevents duplicate initialization, having multiple modules independently calling uncoordinated `ensureWasm()` functions points to the lack of a centralized lifecycle manager for client-side WebAssembly.

---

## 5. Architectural Options Analysis

We evaluate three potential architectural paths for Glacier EQ:

### Option 1: Separate Git Branches (`main` for Desktop/Tauri, `web` for Web/WASM)
- **Description**: Maintain two diverging branches in git. `main` strips all WASM imports and runs purely native Rust/Tauri; `web` maintains WebHID and WASM.
- **Tradeoffs**:
  - *Pros*: Completely removes `wasm-pack` and `wasm32-unknown-unknown` from desktop CI and `PKGBUILD`.
  - *Cons*: **Disastrous maintenance overhead.** Every UI improvement, CSS fix, tab addition, and component bug fix must be manually cherry-picked or merged across branches. Divergence is virtually guaranteed within months. Furthermore, if graph rendering in desktop loses WASM, it would need a rewritten TS math engine or suffer IPC overhead.
- **Verdict**: **Rejected.** Directly violates Unix simplicity and long-term project maintainability.

### Option 2: Monorepo with Multiple Packages (e.g. `@glacier-eq/core`, `@glacier-eq/ui`, `@glacier-eq/desktop`, `@glacier-eq/web`)
- **Description**: Convert repository into a pnpm/npm workspace with dedicated package boundaries.
- **Tradeoffs**:
  - *Pros*: Clean architectural isolation.
  - *Cons*: High configuration overhead (workspace managers, package publish/link orchestration, multiple `tsconfig.json` and `vite.config.ts` files) for a compact codebase primarily maintained by a single developer. Speculative complexity without functional gain.
- **Verdict**: **Rejected for current scale.**

### Option 3: Single Codebase with Runtime Adapters & Target-Specific Builds (Recommended)
- **Description**: Retain a single unified repository with shared UI/domain code and distinct desktop/web build graphs, then restructure the boundary between Tauri, Web, and WASM:
  1. **Separate the build graph before adding lazy loading**: Give the desktop and web builds distinct runtime entry points or Vite aliases. The web entry may dynamically import the full `glacier-core` WASM package for lazy loading; the desktop entry must not import that web adapter if the goal is to remove `wasm-pack` from desktop builds.
  2. **Separate Mechanism from Policy via Backend Adapter**: Decompose `src/lib/rpc.ts` into a clean interface (`EqBackend`) with two implementations:
     - `TauriBackend`: Direct, zero-WASM passthrough to Tauri IPC (`tauriInvoke`).
     - `WebBackend`: WebHID + dynamically loaded `glacier-core` WASM.
  3. **Preserve or Optimize Graph Math**:
     - *Alternative A*: Retain `glacier_core_bg.wasm` purely for graph math, loaded asynchronously on application startup.
     - *Alternative B*: Port the 60 lines of biquad magnitude math from `glacier-core/src/eq/iir_math.rs` into a pure TypeScript Float32Array function for graph rendering. If TS math matches WASM speeds (see Benchmark Plan in Section 7), WASM can be removed from desktop entirely, eliminating `wasm-pack` from desktop builds!
- **Tradeoffs**:
  - *Pros*: Single codebase, zero branch drift, clean separation of concerns, fast development iteration, and eliminates build-breaking hard dependencies.
  - *Cons*: Requires a minor refactor of `rpc.ts` and `graph.ts`.
- **Verdict**: **Strongly Recommended.**

---

## 6. Detailed Comparison Matrix

| Criterion | Option 1: Separate Branches | Option 2: Monorepo Packages | Option 3: Unified Codebase + Adapters (Recommended) |
| :--- | :--- | :--- | :--- |
| **Code Sharing** | Low (divergence risk) | High (shared packages) | Maximum (single React frontend) |
| **Maintenance Burden** | High (constant cherry-picking) | Medium (monorepo tooling overhead) | Lowest (standard npm scripts) |
| **Desktop Toolchain Cleanliness** | Clean (no wasm tools on desktop) | Clean (wasm isolated to web package) | Clean only after target-specific entry selection or TS/graph-only math; dynamic import alone is insufficient |
| **Runtime Performance** | Identical | Identical | Identical (or faster with pure TS graph math) |
| **Adherence to Unix Philosophy** | Poor (stateful branch duplication) | Fair (heavy package boundaries) | Best (small pieces, one job each, composable) |

---

## 7. Recommendation and Staged Migration Plan

### 7.1 Recommendation Summary
Retain the single repository and shared UI/domain code. Add clean runtime adapters and target-specific frontend entry points; only then decide whether desktop keeps a graph-only WASM module or uses TypeScript math.

### 7.2 Staged Migration Plan

#### Phase 1: Establish the `EqBackend` Interface (Decouple Mechanism from Policy)
Create an abstract interface representing backend operations:
```ts
// src/lib/backend/types.ts
export interface EqBackend {
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  listProfiles(): Promise<Profile[]>;
  saveProfile(name: string, peq: PEQData): Promise<void>;
  deleteProfile(name: string): Promise<void>;
  listDevices(): Promise<DeviceInfo[]>;
  connectDevice(device: DeviceInfo): Promise<void>;
  disconnectDevice(): Promise<void>;
  getEqState(): Promise<PEQData>;
  setEqState(peq: PEQData): Promise<void>;
  runAutoEq(args: AutoEqArgs): Promise<AutoEqResult>;
  ...
}
```

#### Phase 2: Split `rpc.ts` into Isolated Implementations

A literal dynamic import improves lazy loading and code splitting, but it still has to resolve during the build. It only becomes a desktop toolchain decoupling mechanism when the desktop entry excludes the web adapter entirely.
1. **`src/lib/backend/tauriBackend.ts`**:
   - Thin wrapper around `@tauri-apps/api/core` `invoke()`.
   - Contains zero WebHID code and zero WebAssembly imports.
   - Clean, auditable, ~150 lines.
2. **`src/lib/backend/webBackend.ts`**:
   - Contains WebHID management, USB packet framing, and localStorage profile storage.
   - Dynamically imports WASM on first access:
     ```ts
     async function getWasm() {
       return await import("../../wasm_pkg/glacier_core");
     }
     ```
3. **`src/lib/backend/index.ts`**:
   - Single factory:
     ```ts
     export const backend: EqBackend = isTauri() ? new TauriBackend() : new WebBackend();
     ```

#### Phase 3: Evaluate Graph Math Decoupling
- Inspect `src/lib/graph.ts`. It currently imports `peq_response_and_band_values` from WASM.
- Implement a pure TypeScript equivalent of `accumulate_response_values_cos` (from `glacier-core/src/eq/iir_math.rs`) operating directly on `Float32Array`.
- Run comparative performance benchmarks (see Section 8). If pure TypeScript executes 800 points in < 0.25 ms on target devices, use TypeScript math for graph rendering.
- **Outcome if TS math is adopted**: Desktop builds no longer require WebAssembly *at all*. The `wasm:build` step is only executed when building the web deployment (`npm run build:web`).
- **Outcome if WASM math is retained**: The WASM binary is lazily fetched or compiled as an isolated micro-module (`glacier_math.wasm`) without bundling entire AutoEQ/HID protocol engines into the webview.

#### Phase 4: Build Script & CI Streamlining
1. In `package.json`:
   - Introduce explicit target scripts, for example `"build:web": "npm run wasm:build && vite build --mode web"` and `"build:desktop": "vite build --mode desktop"`.
   - Point `tauri.conf.json`'s `beforeBuildCommand` at the desktop build only after the desktop module graph no longer imports the full WebHID/WASM adapter.
   - Keep a lazy dynamic import in the web adapter where it improves startup; it is not a substitute for target-specific module selection.
2. In Arch Linux `PKGBUILD`:
   - Remove `rust-wasm` from `makedepends`.
3. In `.github/workflows/release.yml`:
   - Remove `targets: wasm32-unknown-unknown` from desktop and Android release jobs.

---

## 8. Open Questions and Benchmark Plan

### 8.1 Critical Open Question
**Is WebAssembly strictly necessary for interactive graph rendering, or is modern V8/JavaScriptCore JIT execution of Float32Array biquad math fast enough?**

- In `PERF.md`, WASM curve response calculation took **0.093 ms** for 800 frequency points and 10 bands.
- The biquad magnitude equation:
  $$\text{dB} = 10 \log_{10}\left(\frac{c_{0b} + \cos\omega(c_{1b} + c_{2b}\cos\omega)}{c_{0a} + \cos\omega(c_{1a} + c_{2a}\cos\omega)}\right)$$
  requires only 4 multiplications, 4 additions, 1 division, and 1 logarithm per frequency point.
- For 800 points and 10 bands, this totals 8,000 evaluations per render frame. The expected TypeScript latency is an open hypothesis, not a result from this audit; measure it on WebKitGTK, WebView2, and Android WebView before replacing the current WASM path.

### 8.2 Empirical Benchmark Plan
Before modifying production math routines, execute the following benchmark suite:

1. **Synthetic Math Benchmark (`scripts/bench-graph-math.ts`)**:
   - Compare `glacier-core` WASM `peq_response_and_band_values` against a native TypeScript implementation across 1,000 iterations:
     - 800 grid points, 10 active parametric filters.
     - Sample rates: 48,000 Hz and 96,000 Hz.
     - Measure mean latency, 99th percentile latency, and memory allocations.
2. **Platform Verification Matrix**:
   - **Linux**: Test under WebKitGTK 2.44+ on Wayland and X11 to verify that neither TS nor WASM triggers UI stutters.
   - **Windows**: Test under Edge WebView2 (V8).
   - **Android**: Test on a low-end budget device (e.g. ARM Cortex-A55) to measure garbage collection pauses and frame render times during continuous filter drag.
3. **MIME Type Validation**:
   - Verify that production Android APK assets loaded via `http://tauri.localhost` return `application/wasm` if WASM is retained, avoiding console warnings and ensuring `instantiateStreaming` functions correctly.

---

*Report authored for the Glacier EQ repository. No product source code was modified during this research; this report is the research artifact.*
