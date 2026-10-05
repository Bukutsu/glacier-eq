import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import vm from "node:vm";
import { TextEncoder } from "node:util";

const source = readFileSync(
  new URL("../../public/sw.js", import.meta.url),
  "utf8",
);
const scope = "https://example.test/app/";

type WorkerEvent =
  | {
      waitUntil(promise: Promise<unknown>): void;
    }
  | {
      request: { method: string; url: string; mode: string };
      respondWith(response: Promise<Response>): void;
    };

function cacheStorage() {
  const registry = new Map<string, Map<string, Response>>();
  const entries = (name: string) => {
    if (!registry.has(name)) registry.set(name, new Map());
    return registry.get(name)!;
  };
  const key = (request: string | URL | { url: string }) =>
    typeof request === "string" || request instanceof URL
      ? String(request)
      : request.url;
  return {
    open: async (name: string) => ({
      put: async (
        request: string | URL | { url: string },
        response: Response,
      ) => {
        entries(name).set(key(request), response.clone());
      },
      match: async (request: string | URL | { url: string }) =>
        entries(name).get(key(request))?.clone(),
      keys: async () => [...entries(name).keys()].map((url) => ({ url })),
      delete: async (request: string | URL | { url: string }) =>
        entries(name).delete(key(request)),
    }),
    keys: async () => [...registry.keys()],
    delete: async (name: string) => registry.delete(name),
    match: vi.fn(async (request: string | URL | { url: string }) => {
      for (const cache of registry.values()) {
        const hit = cache.get(key(request));
        if (hit) return hit.clone();
      }
      return undefined;
    }),
  };
}

function worker(
  caches: ReturnType<typeof cacheStorage>,
  fetch: (request: string | URL | { url: string }) => Promise<Response>,
) {
  const listeners: Record<string, (event: WorkerEvent) => void> = {};
  const skipWaiting = vi.fn();
  vm.runInNewContext(source, {
    self: {
      registration: { scope },
      addEventListener: (
        name: string,
        listener: (event: WorkerEvent) => void,
      ) => {
        listeners[name] = listener;
      },
      clients: { claim: vi.fn() },
      skipWaiting,
    },
    location: { origin: "https://example.test" },
    caches,
    fetch,
    crypto: webcrypto,
    TextEncoder,
    URL,
    Response,
    Promise,
    console,
  });
  return {
    skipWaiting,
    install: () => {
      let pending: Promise<unknown> | undefined;
      listeners.install({
        waitUntil: (promise) => {
          pending = promise;
        },
      });
      expect(pending).toBeDefined();
      return pending!;
    },
    fetch: (url: string) => {
      let pending: Promise<Response> | undefined;
      listeners.fetch({
        request: { method: "GET", url, mode: "no-cors" },
        respondWith: (promise) => {
          pending = promise;
        },
      });
      expect(pending).toBeDefined();
      return pending!;
    },
  };
}

const manifestFetch =
  (manifest: unknown) => async (request: string | URL | { url: string }) =>
    String(request).endsWith("offline-assets.json")
      ? Response.json(manifest)
      : new Response("asset");

describe("service worker preload", () => {
  it("keeps the previous cache when one asset fails", async () => {
    const caches = cacheStorage();
    const oldName = "glacier-eq-v2-https%3A%2F%2Fexample.test%2Fapp%2F|old";
    const oldCache = await caches.open(oldName);
    await oldCache.put(`${scope}old.js`, new Response("old"));
    const metadata = await caches.open("glacier-eq-cache-meta-v1");
    const metadataUrl = `${scope}__glacier_eq_active_cache__`;
    await metadata.put(metadataUrl, new Response(oldName));
    const previousNames = await caches.keys();
    const instance = worker(caches, async (request) =>
      String(request).endsWith("missing.js")
        ? new Response("unavailable", { status: 503 })
        : manifestFetch(["./missing.js"])(request),
    );

    await expect(instance.install()).rejects.toThrow("Failed to preload");
    expect(instance.skipWaiting).not.toHaveBeenCalled();
    for (const name of previousNames)
      expect(await caches.keys()).toContain(name);
    expect(await (await oldCache.match(`${scope}old.js`))!.text()).toBe("old");
    expect(await (await metadata.match(metadataUrl))!.text()).toBe(oldName);
  });

  it("changes the release cache when a public asset digest changes", async () => {
    const caches = cacheStorage();
    for (const hash of ["hash-a", "hash-b"]) {
      await worker(
        caches,
        manifestFetch([{ path: "./public.txt", hash }]),
      ).install();
    }
    const releaseCaches = (await caches.keys()).filter((name) =>
      name.startsWith("glacier-eq-v2-"),
    );
    expect(releaseCaches).toHaveLength(2);
    for (const name of releaseCaches) {
      const cache = await caches.open(name);
      expect(await (await cache.match(`${scope}public.txt`))!.text()).toBe(
        "asset",
      );
    }
  });

  it("does not fall back to another scope's cache when no active cache exists", async () => {
    const caches = cacheStorage();
    const url = "https://example.test/app/-admin/app.js";
    const foreign = await caches.open(
      "glacier-eq-v2-https%3A%2F%2Fexample.test%2Fapp%2F-admin%2F|foreign",
    );
    await foreign.put(url, new Response("foreign asset"));
    const instance = worker(caches, async () => new Response("network asset"));

    expect(await (await instance.fetch(url)).text()).toBe("network asset");
    expect(caches.match).not.toHaveBeenCalled();

    const offline = worker(caches, async () => {
      throw new Error("network unavailable");
    });
    await expect(offline.fetch(url)).rejects.toThrow("network unavailable");
  });

  it("restores the active release cache after a worker restart", async () => {
    const caches = cacheStorage();
    await worker(caches, manifestFetch(["./app.js"])).install();

    // A second release makes the single-cache migration fallback insufficient.
    const stale = await caches.open(
      "glacier-eq-v2-https%3A%2F%2Fexample.test%2Fapp%2F|stale",
    );
    await stale.put(`${scope}app.js`, new Response("stale asset"));
    const restarted = worker(caches, async () => {
      throw new Error("offline");
    });
    expect(await (await restarted.fetch(`${scope}app.js`)).text()).toBe(
      "asset",
    );
  });
});
