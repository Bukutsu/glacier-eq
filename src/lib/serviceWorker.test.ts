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

  it("changes the release cache when a public asset digest changes", async () => {
    const opened: string[] = [];
    const runInstall = async (hash: string) => {
      const listeners: Record<string, ServiceWorkerListener> = {};
      const cache = {
        put: vi.fn(async () => undefined),
        keys: vi.fn(async () => []),
        delete: vi.fn(async () => true),
      };
      const context = {
        self: {
          registration: { scope: "https://example.test/app/" },
          addEventListener: (name: string, listener: ServiceWorkerListener) => {
            listeners[name] = listener;
          },
          clients: { claim: vi.fn() },
          skipWaiting: vi.fn(),
        },
        caches: {
          open: vi.fn(async (name: string) => {
            opened.push(name);
            return cache;
          }),
          keys: vi.fn(async () => []),
          delete: vi.fn(async () => true),
        },
        fetch: vi.fn(async (url: string | URL) => {
          if (String(url).endsWith("offline-assets.json")) {
            return {
              ok: true,
              json: async () => [{ path: "./public.txt", hash }],
            };
          }
          return { ok: true };
        }),
        crypto: webcrypto,
        TextEncoder,
        URL,
        Response: class { constructor(public readonly body: string = "") {} },
        Promise,
        console,
      };
      vm.runInNewContext(source, context);
      let installPromise: Promise<unknown> = Promise.resolve();
      listeners.install!({ waitUntil: (promise) => { installPromise = promise; } });
      await installPromise;
    };

    await runInstall("hash-a");
    await runInstall("hash-b");
    const releaseCaches = opened.filter((name) => name.startsWith("glacier-eq-v2-"));
    expect(releaseCaches).toHaveLength(2);
    expect(releaseCaches[0]).not.toBe(releaseCaches[1]);
  });

  it("does not fall back to another scope's cache when no active cache exists", async () => {
    const listeners: Record<string, (event: any) => void> = {};
    const broadCache = new Map([["https://example.test/app/-admin/app.js", "broad"]]);
    const cache = {
      match: async (request: string | URL) => broadCache.get(String(request)),
      put: async () => undefined,
      keys: async () => [],
      delete: async () => true,
    };
    const context = {
      self: {
        registration: { scope: "https://example.test/app/" },
        addEventListener: (name: string, listener: (event: any) => void) => {
          listeners[name] = listener;
        },
        clients: { claim: vi.fn() },
        skipWaiting: vi.fn(),
      },
      location: { origin: "https://example.test" },
      caches: {
        open: vi.fn(async (name: string) => name.includes("cache-meta") ? {
          match: async () => undefined,
          put: async () => undefined,
        } : cache),
        keys: vi.fn(async () => ["glacier-eq-v2-https%3A%2F%2Fexample.test%2Fapp%2F-admin%2F|foreign"]),
        delete: vi.fn(),
        match: vi.fn(async () => {
          throw new Error("global cache fallback must not be used");
        }),
      },
      fetch: vi.fn(async () => ({ ok: true, clone: () => ({}) })),
      crypto: webcrypto,
      TextEncoder,
      URL,
      Response: class {},
      Promise,
      console,
    };
    vm.runInNewContext(source, context);
    let responsePromise: Promise<unknown> | undefined;
    listeners.fetch({
      request: { method: "GET", url: "https://example.test/app/-admin/app.js", mode: "no-cors" },
      respondWith: (promise: Promise<unknown>) => { responsePromise = promise; },
    });
    await expect(responsePromise).resolves.toBeDefined();
    expect(context.caches.match).not.toHaveBeenCalled();
  });

  it("restores the active release cache after a worker restart", async () => {
    const scope = "https://example.test/app/";
    const origin = "https://example.test";
    const registry = new Map<string, Map<string, unknown>>();
    const getCache = (name: string) => {
      let entries = registry.get(name);
      if (!entries) {
        entries = new Map();
        registry.set(name, entries);
      }
      return entries;
    };
    const keyFor = (value: string | URL | { url: string }) =>
      typeof value === "string" || value instanceof URL ? String(value) : value.url;
    const makeCache = (name: string) => ({
      put: async (url: string | URL, response: unknown) => getCache(name).set(keyFor(url), response),
      keys: async () => [...getCache(name).keys()].map((url) => ({ url })),
      delete: async (url: string | URL) => getCache(name).delete(keyFor(url)),
      match: async (url: string | URL | { url: string }) => getCache(name).get(keyFor(url)),
    });
    const cacheApi = {
      open: async (name: string) => makeCache(name),
      keys: async () => [...registry.keys()],
      delete: async (name: string) => registry.delete(name),
      match: async (url: string | URL) => {
        for (const entries of registry.values()) {
          const hit = entries.get(String(url));
          if (hit) return hit;
        }
        return undefined;
      },
    };
    class TestResponse {
      constructor(private readonly body: string) {}
      async text() { return this.body; }
    }
    const response = (body: string, ok = true) => ({
      ok,
      status: ok ? 200 : 503,
      clone: () => response(body, ok),
      json: async () => JSON.parse(body),
      text: async () => body,
    });
    const listeners: Record<string, (event: any) => void> = {};
    const context = (fetchImpl: (url: string | URL) => Promise<unknown>) => ({
      self: {
        registration: { scope },
        addEventListener: (name: string, listener: (event: any) => void) => {
          listeners[name] = listener;
        },
        clients: { claim: vi.fn() },
        skipWaiting: vi.fn(),
      },
      location: { origin },
      caches: cacheApi,
      fetch: fetchImpl,
      crypto: webcrypto,
      TextEncoder,
      URL,
      Response: TestResponse,
      Promise,
      console,
    });

    const firstListeners: Record<string, (event: any) => void> = {};
    const firstContext = context(async (url) => {
      const href = String(url);
      return href.endsWith("offline-assets.json") ? response(JSON.stringify(["./app.js"])) : response("asset");
    });
    const firstVmListeners: Record<string, (event: any) => void> = {};
    firstVmListeners.addEventListener = (name: string, listener: (event: any) => void) => {
      firstListeners[name] = listener;
    };
    vm.runInNewContext(source, { ...firstContext, self: { ...firstContext.self, addEventListener: firstVmListeners.addEventListener } });
    let installPromise: Promise<unknown> = Promise.resolve();
    firstListeners.install({ waitUntil: (promise: Promise<unknown>) => { installPromise = promise; } });
    await installPromise;

    const restartedListeners: Record<string, (event: any) => void> = {};
    const restartedContext = context(async () => { throw new Error("offline"); });
    vm.runInNewContext(source, {
      ...restartedContext,
      self: {
        ...restartedContext.self,
        addEventListener: (name: string, listener: (event: any) => void) => {
          restartedListeners[name] = listener;
        },
      },
    });
    let responsePromise: Promise<unknown> | undefined;
    restartedListeners.fetch({
      request: { method: "GET", url: `${scope}app.js`, mode: "no-cors" },
      respondWith: (promise: Promise<unknown>) => { responsePromise = promise; },
    });
    expect(responsePromise).toBeDefined();
    await expect(responsePromise).resolves.toBeDefined();
  });
});
