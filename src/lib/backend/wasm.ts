// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

type WasmApi = typeof import("../../wasm_pkg/glacier_core");

// The wasm glue and binary are loaded through a dynamic import so they stay
// out of the startup-critical chunk graph; first paint no longer waits on the
// ~248 kB compile. Callers must pass through ensureWasm() before using
// getWasm() — every invokeWeb flow already does.
let wasmApi: WasmApi | null = null;
let wasmInitPromise: Promise<WasmApi> | null = null;

export async function ensureWasm(): Promise<void> {
  wasmInitPromise ??= import("../../wasm_pkg/glacier_core")
    .then(async (api) => {
      await api.default();
      wasmApi = api;
      return api;
    })
    .catch((error) => {
      // A failed load (offline, interrupted fetch) must not poison every
      // later backend call until a full page reload; let the next caller retry.
      wasmInitPromise = null;
      throw error;
    });
  await wasmInitPromise;
}

export function getWasm(): WasmApi {
  if (!wasmApi) throw new Error("WASM backend not initialized");
  return wasmApi;
}

// After first paint, warm the wasm module during idle time so the deferred
// load is ready before the user reaches AutoEQ or device tools. Web-only
// module: the desktop backend never imports this file. PROD-only to keep dev
// reloads snappy and HMR simple.
if (import.meta.env.PROD) {
  const warm = () => {
    void ensureWasm().catch(() => {});
  };
  const kick = () => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(warm, { timeout: 2000 });
    } else {
      setTimeout(warm, 200);
    }
  };
  if (document.readyState === "complete") {
    kick();
  } else {
    window.addEventListener("load", kick, { once: true });
  }
}
