const CACHE = "glacier-eq-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        const manifestUrl = new URL("offline-assets.json", self.registration.scope);
        let manifest = [];
        try {
          manifest = await fetch(manifestUrl).then((response) => response.json());
        } catch {}

        await Promise.allSettled([
          self.registration.scope,
          manifestUrl.href,
          new URL("MaterialIcons-Regular.ttf", self.registration.scope).href,
          ...manifest.map((file) => new URL(file, self.registration.scope).href),
        ].map(async (url) => {
          const response = await fetch(url, { cache: "reload" });
          if (response.ok) await cache.put(url, response);
        }));
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
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          return caches.open(CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => {})
            .then(() => response);
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
