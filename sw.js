const CACHE = "glacier-eq-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        const manifestUrl = new URL("offline-assets.json", self.registration.scope);
        const manifest = await fetch(manifestUrl).then((response) => response.json());
        await cache.addAll([
          self.registration.scope,
          manifestUrl.href,
          new URL("MaterialIcons-Regular.ttf", self.registration.scope).href,
          ...manifest.map((file) => new URL(file, self.registration.scope).href),
        ]);
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
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match(self.registration.scope);
        throw new Error("Offline and not cached");
      }),
  );
});
