const CACHE_PREFIX = "glacier-eq-v2-";
// `encodeURIComponent` leaves '-' unescaped, so a hyphen delimiter can make
// /app/ and /app/-admin/ share a prefix. '|' is always escaped in the scope
// component and therefore gives an unambiguous boundary.
const CACHE_SCOPE_SEPARATOR = "|";
const CACHE_SCOPE_PREFIX = `${CACHE_PREFIX}${encodeURIComponent(self.registration.scope)}${CACHE_SCOPE_SEPARATOR}`;
const CACHE_META_CACHE = "glacier-eq-cache-meta-v1";
const CACHE_META_PATH = "__glacier_eq_active_cache__";
const CACHE_PENDING_PATH = "__glacier_eq_pending_cache__";
const BUILD_ASSET_SET_ID = "__GLACIER_EQ_BUILD_ASSET_SET_ID__";
let CACHE = "";
let CACHE_LOOKUP;

function cacheMetaUrl(path = CACHE_META_PATH) {
  return new URL(path, self.registration.scope).href;
}

function pendingMetaUrl(buildId = BUILD_ASSET_SET_ID) {
  return cacheMetaUrl(`${CACHE_PENDING_PATH}/${buildId}`);
}

function manifestEntries(manifest) {
  if (!Array.isArray(manifest)) return [];
  return manifest
    .map((entry) => typeof entry === "string" ? { path: entry } : entry)
    .filter((entry) => entry && typeof entry.path === "string");
}

async function cacheNameFor(manifest) {
  const bytes = new TextEncoder().encode(JSON.stringify({
    assetSet: BUILD_ASSET_SET_ID,
    manifest,
  }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${CACHE_SCOPE_PREFIX}${hex}`;
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

// The manifest hashes the bytes written to dist; reject anything else so a
// deploy that changes mid-install or a stale intermediary cannot be promoted.
async function assertHash(url, response, expected) {
  if (typeof expected !== "string") return;
  const actual = await sha256Hex(await response.clone().arrayBuffer());
  if (actual !== expected) {
    throw new Error(`Hash mismatch for ${url}`);
  }
}

async function rememberActiveCache(name) {
  const metadata = await caches.open(CACHE_META_CACHE);
  await metadata.put(cacheMetaUrl(), new Response(name));
}

function pendingRecord(name, complete) {
  return JSON.stringify({
    buildId: BUILD_ASSET_SET_ID,
    name,
    complete,
  });
}

async function rememberPendingCache(metadata, url, name, complete) {
  await metadata.put(
    url,
    new Response(pendingRecord(name, complete)),
  );
}

async function removePendingIfUnchanged(metadata, url, expected) {
  const current = await metadata.match(url);
  if (current && await current.text() === expected) {
    await metadata.delete(url);
  }
}

async function readPendingRecord(metadata, request) {
  const response = await metadata.match(request);
  if (!response) return null;
  const raw = await response.text();
  try {
    const record = JSON.parse(raw);
    if (
      record &&
      typeof record.buildId === "string" &&
      typeof record.name === "string" &&
      typeof record.complete === "boolean"
    ) {
      return { raw, ...record };
    }
  } catch {
    // An unreadable marker is not permission to discard any release cache.
  }
  return { raw, invalid: true };
}

async function pendingCacheNames(metadata, cacheNames) {
  const keep = new Set();
  const pendingPrefix = cacheMetaUrl(`${CACHE_PENDING_PATH}/`);
  for (const request of await metadata.keys()) {
    const isCurrentFormat = request.url.startsWith(pendingPrefix);
    const isLegacyFormat = request.url === cacheMetaUrl(CACHE_PENDING_PATH);
    if (!isCurrentFormat && !isLegacyFormat) continue;

    const record = await readPendingRecord(metadata, request);
    if (isLegacyFormat && record) {
      // The previous worker stored the cache name as plain text.
      const legacy = record.invalid ? record.raw.trim() : record.name;
      if (
        legacy.startsWith(CACHE_SCOPE_PREFIX) &&
        cacheNames.includes(legacy)
      ) {
        keep.add(legacy);
      } else if (record.invalid) {
        // An unreadable marker cannot identify which cache was being written.
        for (const name of cacheNames) keep.add(name);
      }
    } else if (
      record &&
      !record.invalid &&
      record.name.startsWith(CACHE_SCOPE_PREFIX) &&
      cacheNames.includes(record.name)
    ) {
      keep.add(record.name);
    } else if (record?.invalid) {
      // Fail closed: an unreadable current-format marker may refer to any
      // scoped cache, so none is safe to prune or use as an unmarked fallback.
      for (const name of cacheNames) keep.add(name);
    }
  }
  return keep;
}

async function stagedCacheIsComplete(name) {
  const names = await caches.keys();
  if (!names.includes(name)) return false;

  const cache = await caches.open(name);
  const manifestUrl = new URL("offline-assets.json", self.registration.scope).href;
  const root = await cache.match(self.registration.scope);
  const manifestResponse = await cache.match(manifestUrl);
  if (!root || !manifestResponse) return false;
  try {
    return manifestEntries(await manifestResponse.json()).length > 0;
  } catch {
    return false;
  }
}

async function restoreActiveCache() {
  if (CACHE) {
    const names = await caches.keys();
    if (names.includes(CACHE)) return CACHE;
    CACHE = "";
  }
  if (!CACHE_LOOKUP) {
    CACHE_LOOKUP = (async () => {
      try {
        const metadata = await caches.open(CACHE_META_CACHE);
        const names = (await caches.keys()).filter((key) =>
          key.startsWith(CACHE_SCOPE_PREFIX),
        );
        const saved = await metadata.match(cacheMetaUrl());
        if (saved) {
          const name = (await saved.text()).trim();
          if (
            name.startsWith(CACHE_SCOPE_PREFIX) &&
            names.includes(name)
          ) {
            CACHE = name;
            return CACHE;
          }
        }

        const pending = await pendingCacheNames(metadata, names);
        const candidates = names.filter((name) => !pending.has(name));
        // Without a trustworthy active identity, do not select an arbitrary
        // cache or one that may still be under construction.
        if (candidates.length === 1) CACHE = candidates[0];
      } catch {
        CACHE = "";
      }
      return CACHE;
    })();
  }
  CACHE = await CACHE_LOOKUP;
  if (!CACHE) CACHE_LOOKUP = undefined;
  return CACHE;
}

async function matchScopedCache(request) {
  const names = (await caches.keys()).filter((name) =>
    name.startsWith(CACHE_SCOPE_PREFIX),
  );
  const metadata = await caches.open(CACHE_META_CACHE);
  const pending = await pendingCacheNames(metadata, names);
  const candidates = names.filter((name) => !pending.has(name));
  // Without an active release, multiple candidates are ambiguous. Never
  // serve a cache that may still be under construction.
  if (candidates.length !== 1) return undefined;
  const cache = await caches.open(candidates[0]);
  return cache.match(request);
}

async function activatePendingCache() {
  const metadata = await caches.open(CACHE_META_CACHE);
  const request = pendingMetaUrl();
  const pending = await readPendingRecord(metadata, request);
  if (!pending) {
    await restoreActiveCache();
    if (CACHE) await rememberActiveCache(CACHE);
    return false;
  }
  if (
    pending.invalid ||
    pending.buildId !== BUILD_ASSET_SET_ID ||
    !pending.complete ||
    !pending.name.startsWith(CACHE_SCOPE_PREFIX) ||
    !(await stagedCacheIsComplete(pending.name))
  ) {
    await restoreActiveCache();
    return false;
  }

  CACHE = pending.name;
  CACHE_LOOKUP = Promise.resolve(CACHE);
  await rememberActiveCache(CACHE);
  await removePendingIfUnchanged(metadata, request, pending.raw);
  return true;
}

async function pruneInactiveCaches() {
  // List caches before pending markers. Installs write their marker before
  // creating a cache, so a cache created after this snapshot cannot be pruned.
  const names = (await caches.keys()).filter((name) =>
    name.startsWith(CACHE_SCOPE_PREFIX),
  );
  const metadata = await caches.open(CACHE_META_CACHE);
  const pending = await pendingCacheNames(metadata, names);
  const keep = new Set([CACHE, ...pending]);
  await Promise.all(
    names
      .filter((name) => !keep.has(name))
      .map((name) => caches.delete(name)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const manifestUrl = new URL("offline-assets.json", self.registration.scope);
      const manifestResponse = await fetch(manifestUrl, { cache: "reload" });
      if (!manifestResponse.ok) {
        throw new Error(`Failed to fetch offline asset manifest: ${manifestResponse.status}`);
      }
      const manifest = await manifestResponse.json();
      const entries = manifestEntries(manifest);
      if (entries.length === 0) throw new Error("Offline asset manifest is empty");
      const releaseName = await cacheNameFor(manifest);
      const metadata = await caches.open(CACHE_META_CACHE);
      const markerUrl = pendingMetaUrl();
      const installingRecord = pendingRecord(releaseName, false);
      await metadata.put(markerUrl, new Response(installingRecord));

      try {
        const releaseCache = await caches.open(releaseName);
        const hashes = new Map(
          entries.map((entry) => [
            new URL(entry.path, self.registration.scope).href,
            entry.hash,
          ]),
        );
        // The scope root serves index.html.
        hashes.set(
          self.registration.scope,
          hashes.get(new URL("index.html", self.registration.scope).href),
        );
        const wanted = [self.registration.scope, manifestUrl.href];
        wanted.push(
          ...entries.map((entry) =>
            new URL(entry.path, self.registration.scope).href,
          ),
        );

        await Promise.all(
          wanted.map(async (url) => {
            // The manifest validated above is the one the cache name is
            // bound to; cache that response rather than fetching it again.
            const response =
              url === manifestUrl.href
                ? new Response(JSON.stringify(manifest))
                : await fetch(url, { cache: "reload" });
            if (!response.ok) {
              throw new Error(`Failed to preload ${url}: ${response.status}`);
            }
            await assertHash(url, response, hashes.get(url));
            await releaseCache.put(url, response);
          }),
        );

        const keep = new Set(wanted);
        const keys = await releaseCache.keys();
        await Promise.all(
          keys
            .filter((request) => !keep.has(request.url))
            .map((request) => releaseCache.delete(request)),
        );

        await rememberPendingCache(metadata, markerUrl, releaseName, true);
      } catch (error) {
        try {
          await caches.delete(releaseName);
          await removePendingIfUnchanged(
            metadata,
            markerUrl,
            installingRecord,
          );
        } catch {
          // A leftover install marker protects any cache still being written.
        }
        throw error;
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const promoted = await activatePendingCache();
      if (promoted) await pruneInactiveCaches();
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
      if (!activeCache) {
        const cached = await matchScopedCache(request);
        return cached || fetch(request);
      }
      // Installed releases are immutable. A network-first navigation could
      // mix the next deploy's HTML with this release's modules if its install
      // later fails. Serve this release until a complete successor activates.
      const cache = await caches.open(activeCache);
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        const root = await cache.match(self.registration.scope);
        if (root) return root;
      }
      // Non-release requests stay on the network; they never modify a
      // release cache or become an implicit offline dependency.
      try {
        return await fetch(request);
      } catch {
        throw new Error("Offline and not cached");
      }
    })(),
  );
});
