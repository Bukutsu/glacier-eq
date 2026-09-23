import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import vm from "node:vm";
import { TextEncoder } from "node:util";

const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

type ServiceWorkerListener = (event: { waitUntil(promise: Promise<unknown>): void }) => void;

describe("service worker preload", () => {
  it("keeps the previous cache when one asset fails", async () => {
    const listeners: Record<string, ServiceWorkerListener> = {};
    const nextCache = new Map<string, unknown>();
    const previousCache = new Map([["https://example.test/old.js", "old"]]);
    const skipWaiting = vi.fn();
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.endsWith("missing.js")) return { ok: false, status: 503 };
      if (href.endsWith("offline-assets.json")) {
        return { ok: true, json: async () => ["./missing.js"] };
      }
      return { ok: true };
    });
    const context = {
      self: {
        registration: { scope: "https://example.test/app/" },
        addEventListener: (name: string, listener: ServiceWorkerListener) => {
          listeners[name] = listener;
        },
        clients: { claim: vi.fn() },
        skipWaiting,
      },
      caches: {
        open: vi.fn(async () => ({
          put: async (url: string, response: unknown) => nextCache.set(url, response),
          keys: async () => [...nextCache.keys()],
          delete: async (url: string) => nextCache.delete(url),
        })),
        keys: async () => ["glacier-eq-v1", "glacier-eq-v2"],
        delete: vi.fn(),
      },
      fetch: fetchMock,
      crypto: webcrypto,
      TextEncoder,
      URL,
      Promise,
      console,
    };
    vm.runInNewContext(source, context);

    let installPromise: Promise<unknown> = Promise.resolve();
    listeners.install!({ waitUntil: (promise) => { installPromise = promise; } });

    await expect(installPromise).rejects.toThrow("Failed to preload");
    expect(skipWaiting).not.toHaveBeenCalled();
    expect(previousCache.get("https://example.test/old.js")).toBe("old");
  });
});
