const CACHE_PREFIX = "glacier-eq-v2-";
const CACHE_META_CACHE = "glacier-eq-cache-meta-v1";
const CACHE_META_PATH = "__glacier_eq_active_cache__";
let CACHE = "";
let CACHE_LOOKUP;

function cacheMetaUrl() {
  return new URL(CACHE_META_PATH, self.registration.scope).href;
}

async function cacheNameFor(manifest) {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${CACHE_PREFIX}${hex}`;
}

async function rememberActiveCache(name) {
  const metadata = await caches.open(CACHE_META_CACHE);
  await metadata.put(cacheMetaUrl(), new Response(name));
}

async function restoreActiveCache() {
  if (CACHE) return CACHE;
  if (!CACHE_LOOKUP) {
    CACHE_LOOKUP = (async () => {
      try {
        const metadata = await caches.open(CACHE_META_CACHE);
        const saved = await metadata.match(cacheMetaUrl());
        if (saved) {
          const name = (await saved.text()).trim();
          if (name.startsWith(CACHE_PREFIX)) {
            CACHE = name;
            return CACHE;
          }
        }
      } catch {
        // Fall through to the single-cache migration path below.
      }
      const candidates = (await caches.keys()).filter((key) => key.startsWith(CACHE_PREFIX));
      if (candidates.length === 1) CACHE = candidates[0];
      return CACHE;
    })();
  }
  CACHE = await CACHE_LOOKUP;
  return CACHE;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const manifestUrl = new URL("offline-assets.json", self.registration.scope);
      const manifestResponse = await fetch(manifestUrl);
      if (!manifestResponse.ok) {
        throw new Error(`Failed to fetch offline asset manifest: ${manifestResponse.status}`);
      }
      const manifest = await manifestResponse.json();
      CACHE = await cacheNameFor(manifest);
      const releaseCache = await caches.open(CACHE);

      const wanted = [self.registration.scope, manifestUrl.href];
      if (Array.isArray(manifest)) {
        wanted.push(
          ...manifest.map((file) => new URL(file, self.registration.scope).href),
        );
      }

      await Promise.all(
        wanted.map(async (url) => {
          const response = await fetch(url, { cache: "reload" });
          if (!response.ok) {
            throw new Error(`Failed to preload ${url}: ${response.status}`);
          }
          await releaseCache.put(url, response);
        }),
      );

      // Prune entries from previous deploys (old hashed assets, ad-hoc runtime
      // responses) so the cache stays bounded per release. Only do this with a
      // fresh manifest; a failed install never changes the remembered identity.
      if (Array.isArray(manifest)) {
        const keep = new Set(wanted);
        const keys = await releaseCache.keys();
        await Promise.all(
          keys
            .filter((request) => !keep.has(request.url))
            .map((request) => releaseCache.delete(request)),
        );
      }
      // This is the commit point for the release identity. Restarting a worker
      // can recover it without relying on process-global JavaScript state.
      await rememberActiveCache(CACHE);
    })().then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await restoreActiveCache();
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE && key !== CACHE_META_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;

  event.respondWith(
    (async () => {
      const activeCache = await restoreActiveCache();
      if (!activeCache) return fetch(request);
      try {
        const response = await fetch(request);
        if (response.ok) {
          const copy = response.clone();
          await caches.open(activeCache)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
          return response;
        }
        // A transient server error (e.g. during a Pages redeploy) shouldn't
        // fail a navigation that the warm cache could still serve.
        if (!response.ok && request.mode === "navigate") {
          const cache = await caches.open(activeCache);
          const cached = await cache.match(request) || await cache.match(self.registration.scope);
          if (cached) return cached;
        }
        return response;
      } catch {
        const cache = await caches.open(activeCache);
        const cached = await cache.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const root = await cache.match(self.registration.scope);
          if (root) return root;
        }
        throw new Error("Offline and not cached");
      }
    })(),
  );
});
