import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import vm from "node:vm";
import { TextEncoder } from "node:util";

const source = readFileSync(
  new URL("../../../public/sw.js", import.meta.url),
  "utf8",
);
const scope = "https://example.test/app/";

type WorkerEvent =
  | {
      waitUntil(promise: Promise<unknown>): void;
    }
  | {
      request: {
        method: string;
        url: string;
        mode: string;
        destination: string;
      };
      respondWith(response: Promise<Response>): void;
    };

function cacheStorage(
  beforePut?: (cacheName: string, key: string) => Promise<void>,
) {
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
        const requestKey = key(request);
        await beforePut?.(name, requestKey);
        entries(name).set(requestKey, response.clone());
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
  buildId = "test-build",
) {
  const listeners: Record<string, (event: WorkerEvent) => void> = {};
  const skipWaiting = vi.fn();
  const claim = vi.fn();
  const workerSource = source.replace(
    '"__GLACIER_EQ_BUILD_ASSET_SET_ID__"',
    JSON.stringify(buildId),
  );
  vm.runInNewContext(workerSource, {
    self: {
      registration: { scope },
      addEventListener: (
        name: string,
        listener: (event: WorkerEvent) => void,
      ) => {
        listeners[name] = listener;
      },
      clients: { claim },
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
    claim,
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
    activate: () => {
      let pending: Promise<unknown> | undefined;
      listeners.activate({
        waitUntil: (promise) => {
          pending = promise;
        },
      });
      expect(pending).toBeDefined();
      return pending!;
    },
    fetch: (url: string, mode = "no-cors", destination = "") => {
      let pending: Promise<Response> | undefined;
      listeners.fetch({
        request: { method: "GET", url, mode, destination },
        respondWith: (promise) => {
          pending = promise;
        },
      });
      expect(pending).toBeDefined();
      return pending!;
    },
  };
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
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

  it("keeps a coherent release online and offline when the next install fails", async () => {
    const caches = cacheStorage();
    let deployment = "v1";
    let online = true;
    const fetcher = vi.fn(async (request: string | URL | { url: string }) => {
      if (!online) throw new Error("offline");
      const url = typeof request === "object" && "url" in request
        ? request.url : String(request);
      if (url.endsWith("offline-assets.json"))
        return Response.json(["./index.html", `./lazy-${deployment}.js`]);
      if (deployment === "v2" && url.endsWith("lazy-v2.js"))
        return new Response("incomplete deploy", { status: 503 });
      return new Response(url.endsWith(".js") ? `module-${deployment}` : `html-${deployment}`);
    });
    const installed = worker(caches, fetcher, "v1");
    await installed.install();
    await installed.activate();
    online = false;
    expect(await (await installed.fetch(scope, "navigate", "document")).text()).toBe("html-v1");

    online = true;
    deployment = "v2";
    for (const path of ["", "index.html", "nested/route"]) {
      expect(await (await installed.fetch(scope + path, "navigate", "document")).text()).toBe("html-v1");
    }
    expect(await (await installed.fetch(scope + "lazy-v1.js", "cors", "script")).text()).toBe("module-v1");
    expect(await (await installed.fetch(scope + "runtime.json")).text()).toBe("html-v2");

    const update = worker(caches, fetcher, "v2");
    await expect(update.install()).rejects.toThrow("Failed to preload");
    online = false;
    const restarted = worker(caches, fetcher, "v1");
    expect(await (await restarted.fetch(scope, "navigate", "document")).text()).toBe("html-v1");
    expect(await (await restarted.fetch(scope + "lazy-v1.js", "cors", "script")).text()).toBe("module-v1");
    await expect(restarted.fetch(scope + "runtime.json")).rejects.toThrow("Offline and not cached");

    // A later complete release still replaces the installed one on activation.
    online = true;
    deployment = "v3";
    const successor = worker(caches, fetcher, "v3");
    await successor.install();
    expect(await (await installed.fetch(scope, "navigate", "document")).text()).toBe("html-v1");
    await successor.activate();
    expect(await (await successor.fetch(scope, "navigate", "document")).text()).toBe("html-v3");
  });

  it("keeps the active release until a staged update activates", async () => {
    const caches = cacheStorage();
    const v1 = worker(caches, manifestFetch(["./lazy-v1.js"]), "v1");
    await v1.install();
    await v1.activate();
    expect(v1.skipWaiting).not.toHaveBeenCalled();

    const metadata = await caches.open("glacier-eq-cache-meta-v1");
    const activeUrl = scope + "__glacier_eq_active_cache__";
    const pendingUrl = (buildId: string) =>
      scope + `__glacier_eq_pending_cache__/${buildId}`;
    const v1Name = await (await metadata.match(activeUrl))!.text();
    expect(await metadata.match(pendingUrl("v1"))).toBeUndefined();

    const v2 = worker(caches, manifestFetch(["./lazy-v2.js"]), "v2");
    await v2.install();
    expect(v2.skipWaiting).not.toHaveBeenCalled();
    const v2Record = await (await metadata.match(pendingUrl("v2")))!.json();
    const v2Name = v2Record.name as string;
    expect(v2Name).not.toBe(v1Name);
    expect(await (await metadata.match(activeUrl))!.text()).toBe(v1Name);
    expect(await caches.keys()).toContain(v1Name);
    expect(await caches.keys()).toContain(v2Name);

    const oldController = worker(caches, async (request) => {
      const url =
        typeof request === "string" || request instanceof URL
          ? String(request)
          : request.url;
      return url.endsWith("lazy-v1.js")
        ? new Response("removed by deploy", { status: 404 })
        : new Response("current asset");
    });
    const staleChunk = await oldController.fetch(
      scope + "lazy-v1.js",
      "cors",
      "script",
    );
    expect(await staleChunk.text()).toBe("asset");

    // Activation can restart in a fresh worker context; the staged identity
    // survives that restart and becomes active only at the activation boundary.
    const restartedV2 = worker(caches, async () => new Response("asset"), "v2");
    await restartedV2.activate();
    expect(await (await metadata.match(activeUrl))!.text()).toBe(v2Name);
    expect(await metadata.match(pendingUrl("v2"))).toBeUndefined();
    expect(await caches.keys()).not.toContain(v1Name);
    expect(await caches.keys()).toContain(v2Name);
    expect(restartedV2.claim).toHaveBeenCalledOnce();
  });

  it("keeps an overlapping install intact while the waiting worker activates", async () => {
    const activeUrl = scope + "__glacier_eq_active_cache__";
    let pauseActiveWrite = false;
    let releaseActiveWrite = () => {};
    let notifyActiveWrite = () => {};
    const activeWriteReached = new Promise<void>((resolve) => {
      notifyActiveWrite = resolve;
    });
    const activeWriteGate = new Promise<void>((resolve) => {
      releaseActiveWrite = resolve;
    });
    const caches = cacheStorage(async (cacheName, key) => {
      if (
        pauseActiveWrite &&
        cacheName === "glacier-eq-cache-meta-v1" &&
        key === activeUrl
      ) {
        pauseActiveWrite = false;
        notifyActiveWrite();
        await activeWriteGate;
      }
    });
    const metadata = await caches.open("glacier-eq-cache-meta-v1");
    const pendingUrl = (buildId: string) =>
      scope + `__glacier_eq_pending_cache__/${buildId}`;

    const v1 = worker(caches, manifestFetch(["./lazy-v1.js"]), "v1");
    await v1.install();
    await v1.activate();
    const v1Name = await (await metadata.match(activeUrl))!.text();

    const v2 = worker(caches, manifestFetch(["./lazy-v2.js"]), "v2");
    await v2.install();
    const v2Name = (await (await metadata.match(pendingUrl("v2")))!.json())
      .name as string;

    pauseActiveWrite = true;
    const activatingV2 = v2.activate();
    await activeWriteReached;

    const v3 = worker(caches, manifestFetch(["./lazy-v3.js"]), "v3");
    await v3.install();
    const v3Name = (await (await metadata.match(pendingUrl("v3")))!.json())
      .name as string;

    releaseActiveWrite();
    await activatingV2;
    expect(await caches.keys()).toContain(v2Name);
    expect(await caches.keys()).toContain(v3Name);
    expect(await metadata.match(pendingUrl("v3"))).toBeDefined();

    const restartedV3 = worker(caches, async () => new Response("asset"), "v3");
    await restartedV3.activate();
    expect(await (await metadata.match(activeUrl))!.text()).toBe(v3Name);
    expect(await metadata.match(pendingUrl("v3"))).toBeUndefined();
    expect(await caches.keys()).toContain(v3Name);
    expect(await caches.keys()).not.toContain(v1Name);
    expect(await caches.keys()).not.toContain(v2Name);
  });

  it("keeps the active cache when a pending marker names a missing cache", async () => {
    const caches = cacheStorage();
    const metadata = await caches.open("glacier-eq-cache-meta-v1");
    const activeUrl = scope + "__glacier_eq_active_cache__";
    const pendingUrl = scope + "__glacier_eq_pending_cache__/v2";
    const v1 = worker(caches, manifestFetch(["./lazy-v1.js"]), "v1");
    await v1.install();
    await v1.activate();
    const v1Name = await (await metadata.match(activeUrl))!.text();

    const missingName =
      "glacier-eq-v2-https%3A%2F%2Fexample.test%2Fapp%2F|missing";
    await metadata.put(
      pendingUrl,
      Response.json({ buildId: "v2", name: missingName, complete: true }),
    );
    const v2 = worker(caches, manifestFetch(["./lazy-v2.js"]), "v2");
    await v2.activate();

    expect(await (await metadata.match(activeUrl))!.text()).toBe(v1Name);
    expect(await caches.keys()).toContain(v1Name);
    expect(await caches.keys()).not.toContain(missingName);
    expect(await metadata.match(pendingUrl)).toBeDefined();
  });

  it("falls back to cached script, style, and precached WASM on HTTP errors", async () => {
    const caches = cacheStorage();
    const manifest = ["./lazy.js", "./late.css", "./module.wasm"];
    let unavailable = false;
    const fetcher = async (request: string | URL | { url: string }) => {
      const url =
        typeof request === "string" || request instanceof URL
          ? String(request)
          : request.url;
      if (url.endsWith("offline-assets.json")) return Response.json(manifest);
      if (unavailable) return new Response("not found", { status: 404 });
      return new Response(`cached:${url}`);
    };
    const instance = worker(caches, fetcher, "fetch-fallback");
    await instance.install();
    await instance.activate();
    unavailable = true;

    for (const [path, destination] of [
      ["lazy.js", "script"],
      ["late.css", "style"],
      ["module.wasm", ""],
    ] as const) {
      const response = await instance.fetch(scope + path, "cors", destination);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(`cached:${scope}${path}`);
    }

    const uncached = await instance.fetch(scope + "uncached.json", "cors");
    expect(uncached.status).toBe(404);
    expect(await uncached.text()).toBe("not found");

    const navigation = await instance.fetch(
      scope + "nested/route",
      "navigate",
      "document",
    );
    expect(navigation.status).toBe(200);
    expect(await navigation.text()).toBe(`cached:${scope}`);

    unavailable = false;
    const offline = worker(
      caches,
      async () => {
        throw new Error("offline");
      },
      "offline-fallback",
    );
    const cachedWasm = await offline.fetch(scope + "module.wasm", "cors");
    expect(await cachedWasm.text()).toBe(`cached:${scope}module.wasm`);
  });

  it("changes the release cache when a public asset digest changes", async () => {
    const caches = cacheStorage();
    for (const body of ["asset-a", "asset-b"]) {
      const hash = await sha256Hex(body);
      await worker(caches, async (request) =>
        String(request).endsWith("offline-assets.json")
          ? Response.json([{ path: "./public.txt", hash }])
          : new Response(body),
      ).install();
    }
    const releaseCaches = (await caches.keys()).filter((name) =>
      name.startsWith("glacier-eq-v2-"),
    );
    expect(releaseCaches).toHaveLength(2);
    for (const name of releaseCaches) {
      const cache = await caches.open(name);
      expect(
        (await (await cache.match(`${scope}public.txt`))!.text()).startsWith(
          "asset-",
        ),
      ).toBe(true);
    }
  });

  it("rejects fetched bytes that do not match the manifest hash", async () => {
    const caches = cacheStorage();
    const hash = await sha256Hex("expected");
    const instance = worker(caches, async (request) =>
      String(request).endsWith("offline-assets.json")
        ? Response.json([{ path: "./public.txt", hash }])
        : new Response("other release"),
    );
    await expect(instance.install()).rejects.toThrow("Hash mismatch");
    expect(
      (await caches.keys()).filter((name) => name.startsWith("glacier-eq-v2-")),
    ).toHaveLength(0);
  });

  it("fails closed when a pending marker is unreadable", async () => {
    const caches = cacheStorage();
    const pendingName =
      "glacier-eq-v2-https%3A%2F%2Fexample.test%2Fapp%2F|unknown";
    const pendingCache = await caches.open(pendingName);
    await pendingCache.put(`${scope}partial.js`, new Response("partial"));
    const metadata = await caches.open("glacier-eq-cache-meta-v1");
    await metadata.put(
      `${scope}__glacier_eq_pending_cache__/broken`,
      new Response("{"),
    );
    const instance = worker(caches, async () => {
      throw new Error("network unavailable");
    });

    await expect(instance.fetch(`${scope}partial.js`)).rejects.toThrow(
      "network unavailable",
    );
  });

  it("does not fall back to a cache protected by an incomplete install marker", async () => {
    const caches = cacheStorage();
    const pendingName =
      "glacier-eq-v2-https%3A%2F%2Fexample.test%2Fapp%2F|pending";
    const pendingCache = await caches.open(pendingName);
    await pendingCache.put(`${scope}partial.js`, new Response("partial"));
    const metadata = await caches.open("glacier-eq-cache-meta-v1");
    await metadata.put(
      `${scope}__glacier_eq_pending_cache__/installing`,
      Response.json({
        buildId: "installing",
        name: pendingName,
        complete: false,
      }),
    );
    const instance = worker(caches, async () => {
      throw new Error("network unavailable");
    });

    await expect(instance.fetch(`${scope}partial.js`)).rejects.toThrow(
      "network unavailable",
    );
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
    const first = worker(caches, manifestFetch(["./app.js"]), "first");
    await first.install();
    await first.activate();

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
