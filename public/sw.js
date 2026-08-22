const CACHE = "glacier-eq-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        const manifestUrl = new URL("offline-assets.json", self.registration.scope);
        let manifest = null;
        try {
          manifest = await fetch(manifestUrl).then((response) => response.json());
        } catch {}

        const wanted = [
          self.registration.scope,
          manifestUrl.href,
          new URL("MaterialIcons-Regular.ttf", self.registration.scope).href,
        ];
        if (Array.isArray(manifest)) {
          wanted.push(
            ...manifest.map((file) => new URL(file, self.registration.scope).href),
          );
        }

        await Promise.allSettled(
          wanted.map(async (url) => {
            const response = await fetch(url, { cache: "reload" });
            if (response.ok) await cache.put(url, response);
          }),
        );

        // Prune entries from previous deploys (old hashed assets, ad-hoc
        // runtime responses) so the cache stays bounded per release. Only do
        // this with a fresh manifest: without one this is likely an offline
        // install and "stale" entries may be the only copies available.
        if (Array.isArray(manifest)) {
          const keep = new Set(wanted);
          const keys = await cache.keys();
          await Promise.all(
            keys
              .filter((request) => !keep.has(request.url))
              .map((request) => cache.delete(request)),
          );
        }
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;

  event.respondWith(
    fetch(request)
      .then(async (response) => {
        if (response.ok) {
          const copy = response.clone();
          return caches.open(CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => {})
            .then(() => response);
        }
        // A transient server error (e.g. during a Pages redeploy) shouldn't
        // fail a navigation that the warm cache could still serve.
        if (!response.ok && request.mode === "navigate") {
          const cached =
            (await caches.match(request)) ||
            (await caches.match(self.registration.scope));
          if (cached) return cached;
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const root = await caches.match(self.registration.scope);
          if (root) return root;
        }
        throw new Error("Offline and not cached");
      }),
  );
});
