// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useEffect, useRef, useState } from "react";
import type { MeasurementPoint } from "../types";
import { normalizeMeasurementPoints } from "./measurements";
import {
  parseOnlineCurves,
  parseOnlineCurveValues,
  parseOnlineFrequencies,
  parseOnlineManifest,
} from "./onlineDbParsers";

const DB_NAME = "glacier-eq-online";
const DB_VERSION = 1;
const STORE_NAME = "curves";
const MAX_DATABASE_BYTES = 64 * 1024 * 1024;

export interface OnlineDevice {
  id: string;
  brand: string;
  name: string;
  price: number | null;
  source: string;
}

let pendingOpen: Promise<IDBDatabase> | null = null;

const META_GEN_KEY = "meta:gen";

// One shared connection for the module's lifetime. Every caller receives this
// same handle and must NOT close it: a close by any caller would invalidate
// the connection for every other user mid-transaction (the open/clear/read
// overlap during a download's fetch gap is the reachable instance). The
// handle is only released on versionchange/close or deleteDatabase().
let sharedDb: IDBDatabase | null = null;
// Bumped by deleteDatabase(): opens started before a delete must not publish
// their pre-delete handle as the shared connection.
let connectionEpoch = 0;

function requestOpenDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.onerror = () => {
      rejectOnce(request.error);
      pendingOpen = null;
    };
    // The request keeps running after onblocked. Keep this rejected attempt
    // shared until its late success or error so retries do not pile up.
    request.onblocked = () => rejectOnce(new Error("Database locked by another window"));
    request.onsuccess = () => {
      const db = request.result;
      pendingOpen = null;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      // Release the shared handle when the browser retires it (another
      // context upgraded the DB, or the connection was dropped), so the next
      // openDb() reconnects instead of handing out a dead connection.
      db.onversionchange = () => {
        if (sharedDb === db) sharedDb = null;
        db.close();
      };
      db.onclose = () => {
        if (sharedDb === db) sharedDb = null;
      };
      resolve(db);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

export function isUnrecoverableDbError(error: unknown): boolean {
  if (!error) return false;
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message)
      : String(error);

  if (name === "UnknownError" || name === "VersionError") return true;
  if (
    message.includes("Unable to establish IDB database file") ||
    message.includes("database file on disk") ||
    message.includes("corrupt") ||
    message.includes("Metadata version") ||
    message.includes("Stored database name does not match")
  ) {
    return true;
  }
  return false;
}

export function deleteDatabase(): Promise<void> {
  // In-flight opens captured the pre-delete epoch; they close themselves
  // instead of publishing a handle to a database that no longer exists.
  connectionEpoch += 1;
  pendingOpen = null;
  // Drop our own connection first so it cannot block the delete.
  const previous = sharedDb;
  sharedDb = null;
  previous?.close();
  if (typeof indexedDB === "undefined" || typeof indexedDB.deleteDatabase !== "function") {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    let settled = false;
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    // Blocked means another window still holds the database open: the delete
    // has NOT happened. Resolving here would report a wipe that never
    // occurred (callers would flip to "not downloaded" while the data
    // survives), so reject like the open path does. The request keeps
    // running; if the blocker closes later it still completes on its own.
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("Database locked by another window"));
    };
    request.onsuccess = resolveOnce;
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("Failed to delete database"));
    };
  });
}

export function openDb(): Promise<IDBDatabase> {
  if (sharedDb) {
    // `closed` is spec but missing from this project's DOM lib typing; it
    // guards browsers that drop a connection without firing onclose.
    const closed = (sharedDb as IDBDatabase & { closed?: boolean }).closed;
    if (!closed) return Promise.resolve(sharedDb);
    // The browser dropped the handle without an event; reconnect below.
    sharedDb = null;
  }
  if (pendingOpen) return pendingOpen;

  const attempt = (async () => {
    let epoch = connectionEpoch;
    let db: IDBDatabase;
    try {
      db = await requestOpenDb();
    } catch (error) {
      if (!isUnrecoverableDbError(error)) {
        throw error;
      }
      console.warn(
        "IndexedDB online database cache is unreadable or incompatible; resetting database:",
        error,
      );
      try {
        await deleteDatabase();
        epoch = connectionEpoch;
        db = await requestOpenDb();
      } catch (resetError) {
        console.error("Failed to reset corrupted IndexedDB cache:", resetError);
        throw error;
      }
    }
    if (epoch !== connectionEpoch) {
      // deleteDatabase() ran while this open request was in flight; this
      // handle belongs to the pre-delete database.
      db.close();
      throw new Error("Online database cache was deleted while opening");
    }
    if (sharedDb && sharedDb !== db) {
      // A concurrent attempt already published the shared handle.
      db.close();
      return sharedDb;
    }
    sharedDb = db;
    return db;
  })();

  pendingOpen = attempt;
  return attempt;
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * The live generation readers follow; null means the legacy pre-generation
 * layout (bare `meta:*` records and device-ID curve keys). Only ever written
 * by the publish transaction of a completed download.
 */
async function liveGeneration(db: IDBDatabase): Promise<number | null> {
  const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
  const raw = await idbRequest<unknown>(store.get(META_GEN_KEY));
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 1
    ? raw
    : null;
}

/**
 * Map a legacy record key into the live generation's key space: `meta:*`
 * records drop the prefix (`meta:complete` → `gen:{n}:complete`), while curve
 * keys keep their device ID verbatim. Device IDs always contain `::`, so a
 * curve key can never alias a `meta:*` record after the prefix strip.
 */
function generationKey(generation: number | null, legacyKey: string): string {
  if (generation === null) return legacyKey;
  const name = legacyKey.startsWith("meta:") ? legacyKey.slice("meta:".length) : legacyKey;
  return `gen:${generation}:${name}`;
}

async function isDatabaseDownloaded(): Promise<boolean> {
  try {
    const db = await openDb();
    const generation = await liveGeneration(db);
    const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
    const completeKey = generationKey(generation, "meta:complete");
    return await idbRequest<unknown>(store.get(completeKey)) === true;
  } catch {
    return false;
  }
}

export async function clearCachedDatabase(): Promise<void> {
  let db: IDBDatabase;
  try {
    // openDb() already recovers from an unreadable database by deleting and
    // reopening it, so reaching here means a usable connection exists.
    db = await openDb();
  } catch (openError) {
    if (isUnrecoverableDbError(openError)) {
      await deleteDatabase();
      return;
    }
    throw openError;
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

// One download at a time: closing and reopening the modal mid-download
// remounts the hook, and a second concurrent fetch would interleave chunk
// writes into the same store.
let downloadInFlight: Promise<number> | null = null;

// Progress goes to every caller of the shared download, not just the one
// that started it.
type ProgressListener = (percent: number) => void;
const progressListeners = new Set<ProgressListener>();
const notifyProgress = (percent: number) => {
  for (const listener of [...progressListeners]) listener(percent);
};

export interface DownloadSubscription {
  result: Promise<number>;
  unsubscribe: () => void;
}

export function subscribeToDatabaseDownload(
  onProgress: ProgressListener,
): DownloadSubscription {
  progressListeners.add(onProgress);
  downloadInFlight ??= (async () => {
    try {
      // openDb() owns the shared handle and its unrecoverable-error recovery;
      // the handle must stay open for other readers during the whole download.
      const db = await openDb();
      return await downloadDatabaseWithDb(notifyProgress, undefined, db);
    } finally {
      // Reset even when openDb() rejects, or every later download would
      // await this failed promise forever.
      downloadInFlight = null;
    }
  })();

  let subscribed = true;
  return {
    result: downloadInFlight,
    unsubscribe: () => {
      if (!subscribed) return;
      subscribed = false;
      progressListeners.delete(onProgress);
    },
  };
}

async function downloadDatabaseWithDb(
  onProgress: (percent: number) => void,
  signal: AbortSignal | undefined,
  db: IDBDatabase,
): Promise<number> {
  onProgress(0.05);
  // Validate both third-party payloads before touching any cached record —
  // a failed or cancelled fetch below must leave the previous cache usable.
  const manifest = parseOnlineManifest(await fetchJson(
    "https://raw.githubusercontent.com/PEQHUB/Squig-Rank/main/public/data/manifest.json",
    undefined,
    signal,
  ));

  onProgress(0.15);

  const database = parseOnlineCurves(await fetchJson(
    "https://raw.githubusercontent.com/PEQHUB/Squig-Rank/main/public/data/curves.json",
    (p) => onProgress(0.15 + p * 0.7),
    signal,
  ));

  // Readers follow meta:gen to a complete generation. This download writes a
  // NEW generation alongside the live one and publishes it — meta:gen plus
  // the generation's completeness flag, in one transaction — only after every
  // chunk has landed. Cancellation, quota exhaustion, or a crash anywhere
  // before that flip destroys nothing of the previous cache.
  const previousGeneration = await liveGeneration(db);
  const generation = (previousGeneration ?? 0) + 1;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(manifest, generationKey(generation, "meta:manifest"));
    store.put(database.frequencies, generationKey(generation, "meta:frequencies"));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    // Aborts (quota exceeded, private-mode eviction) fire only onabort; without
    // this the awaited promise never settles and the UI hangs.
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });

  // Batch insert curves in chunks of 400 to prevent IPC buffer choke and allow GC
  const entries = Object.entries(database.curves);
  const totalEntries = entries.length;
  const chunkSize = 400;

  for (let i = 0; i < totalEntries; i += chunkSize) {
    if (signal?.aborted) {
      throw new Error("Download cancelled");
    }
    const chunk = entries.slice(i, i + chunkSize);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const [key, curve] of chunk) {
        store.put(curve, generationKey(generation, key));
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      // Aborts fire only onabort; without this the awaited promise never
      // settles and the UI hangs.
      tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
    });

    onProgress(0.85 + (i / totalEntries) * 0.14);
    // Yield to microtask/macrotask loop for Android GC
    await new Promise((r) => setTimeout(r, 0));
  }

  // Publish atomically: readers see either the previous complete generation
  // or this one, never a partial download. The flip is also a FENCE — another
  // window can clear() the store or publish a newer generation while this
  // download is writing chunks, and the completeness flag must only ever land
  // on records that are still present and still the newest generation. Both
  // checks run inside the publishing transaction, so no interleaving can slip
  // between validation and flip: a mismatch ABORTS the publish (and with it
  // the download) instead of marking a torn generation complete.
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    let fenceFailure: string | null = null;
    // Chain validation requests synchronously inside onsuccess handlers —
    // the pattern that keeps a transaction active in every engine.
    const genRequest = store.get(META_GEN_KEY);
    genRequest.onsuccess = () => {
      const current = genRequest.result;
      const currentGeneration =
        typeof current === "number" && Number.isSafeInteger(current) && current >= 1
          ? current
          : null;
      if (currentGeneration !== previousGeneration) {
        fenceFailure = currentGeneration === null
          ? "The online database cache was cleared during the download; please download again."
          : "The online database cache was updated by another window during the download; please download again.";
        tx.abort();
        return;
      }
      const keysRequest = store.getAllKeys();
      keysRequest.onsuccess = () => {
        const prefix = `gen:${generation}:`;
        let hasManifest = false;
        let hasFrequencies = false;
        let curveCount = 0;
        for (const key of keysRequest.result) {
          const name = String(key);
          if (name === generationKey(generation, "meta:manifest")) hasManifest = true;
          else if (name === generationKey(generation, "meta:frequencies")) hasFrequencies = true;
          else if (name.startsWith(prefix)) curveCount += 1;
        }
        if (!hasManifest || !hasFrequencies || curveCount < totalEntries) {
          fenceFailure = "The online database cache was cleared during the download; please download again.";
          tx.abort();
          return;
        }
        store.put(true, generationKey(generation, "meta:complete"));
        store.put(generation, META_GEN_KEY);
      };
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    // Aborts (fence failure, quota exceeded, private-mode eviction) fire only
    // onabort; without this the awaited promise never settles and the UI hangs.
    tx.onabort = () =>
      reject(
        fenceFailure !== null
          ? new Error(fenceFailure)
          : (tx.error ?? new Error("Transaction aborted")),
      );
  });

  // Best-effort sweep of superseded generations and any legacy records; a
  // failed sweep only wastes space — the next successful download retries.
  // Never touch a HIGHER generation: it belongs to a window ahead of us whose
  // in-flight records are not superseded by our older publish.
  try {
    const keys = await idbRequest<IDBValidKey[]>(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAllKeys(),
    );
    const stale = keys.filter((key) => {
      const name = String(key);
      if (name === META_GEN_KEY) return false;
      const generationMatch = /^gen:(\d+):/.exec(name);
      if (generationMatch) return Number(generationMatch[1]) < generation;
      return true;
    });
    if (stale.length > 0) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        for (const key of stale) store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
      });
    }
  } catch (cleanupError) {
    console.warn("Failed to sweep superseded online database records:", cleanupError);
  }

  onProgress(1.0);
  return totalEntries;
}

function parseContentLength(value: string | null): number | null {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return null;
  const bytes = Number(normalized);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

export async function fetchJson(
  url: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch database: ${response.statusText}`);
  }

  const totalBytes = parseContentLength(response.headers.get("content-length"));
  if (totalBytes !== null && totalBytes > MAX_DATABASE_BYTES) {
    throw new Error("Online database response is too large");
  }
  let loadedBytes = 0;

  let text = "";
  const reader = response.body?.getReader?.();
  if (reader) {
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        text += decoder.decode(value, { stream: true });
        loadedBytes += value.length;
        if (loadedBytes > MAX_DATABASE_BYTES) {
          await reader.cancel();
          throw new Error("Online database response is too large");
        }
        if (onProgress && totalBytes !== null && totalBytes > 0) {
          onProgress(Math.min(0.99, loadedBytes / totalBytes));
        }
      }
    }
    text += decoder.decode();
  } else {
    // Android WebView/Tauri builds may not expose ReadableStream on fetch responses.
    // Whole-body reads are safe only when the server supplies a bounded length.
    if (totalBytes === null) {
      throw new Error("Online database response requires a valid Content-Length");
    }
    text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_DATABASE_BYTES) {
      throw new Error("Online database response is too large");
    }
  }

  onProgress?.(0.99); // Parsing JSON next
  return JSON.parse(text);
}

async function fetchManifest(): Promise<OnlineDevice[]> {
  const db = await openDb();
  const generation = await liveGeneration(db);
  const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
  const cached = await idbRequest<unknown>(
    store.get(generationKey(generation, "meta:manifest")),
  );
  if (cached === undefined) {
    throw new Error("Search manifest not cached. Please download the database.");
  }
  const data = parseOnlineManifest(cached);

  const devices: OnlineDevice[] = [];
  for (const [key, details] of Object.entries(data.iems)) {
    const separator = key.indexOf("::");
    const source = key.slice(0, separator);
    const fullName = key.slice(separator + 2);

    // Try to guess brand and model name
    let brand = source;
    let name = fullName;
    const firstSpace = fullName.indexOf(" ");
    if (firstSpace > 0) {
      brand = fullName.substring(0, firstSpace);
      name = fullName.substring(firstSpace + 1);
    }

    devices.push({
      id: key,
      brand,
      name,
      price: details.price,
      source,
    });
  }

  return devices.sort((a, b) =>
    `${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`),
  );
}

export function useOnlineDatabase(
  setStatus?: (value: string) => void,
) {
  const [downloaded, setDownloaded] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [manifest, setManifest] = useState<OnlineDevice[]>([]);
  const [loadingManifest, setLoadingManifest] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loadingDevice, setLoadingDevice] = useState<string | null>(null);
  const downloadSubscriptionRef = useRef<DownloadSubscription | null>(null);

  useEffect(() => () => {
    downloadSubscriptionRef.current?.unsubscribe();
    downloadSubscriptionRef.current = null;
  }, []);

  useEffect(() => {
    let active = true;
    isDatabaseDownloaded().then((res) => {
      if (active) setDownloaded(res);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!downloaded) return;
    let active = true;
    setLoadingManifest(true);
    fetchManifest()
      .then((devices) => {
        if (!active) return;
        setManifest(devices);
        setTotalCount(devices.length);
      })
      .catch((error) => {
        if (!active) return;
        console.error("Failed to load online manifest:", error);
        setStatus?.(`Failed to load online search manifest: ${error}`);
      })
      .finally(() => {
        if (active) setLoadingManifest(false);
      });
    return () => {
      active = false;
    };
  }, [downloaded, setStatus]);

  const download = async () => {
    setIsDownloading(true);
    setDownloadProgress(0);
    downloadSubscriptionRef.current?.unsubscribe();
    const subscription = subscribeToDatabaseDownload(setDownloadProgress);
    downloadSubscriptionRef.current = subscription;
    try {
      const count = await subscription.result;
      if (downloadSubscriptionRef.current === subscription) {
        setDownloaded(true);
        setTotalCount(count);
      }
      return count;
    } finally {
      subscription.unsubscribe();
      if (downloadSubscriptionRef.current === subscription) {
        downloadSubscriptionRef.current = null;
        setIsDownloading(false);
        setDownloadProgress(null);
      }
    }
  };

  const clearCache = async () => {
    await clearCachedDatabase();
    setDownloaded(false);
    setManifest([]);
    setSearchQuery("");
    setTotalCount(null);
  };

  const loadDevice = async (device: OnlineDevice) => {
    setLoadingDevice(device.id);
    try {
      return await loadDeviceCurvePoints(device.id);
    } finally {
      setLoadingDevice(null);
    }
  };

  return {
    downloaded,
    downloadProgress,
    isDownloading,
    manifest,
    loadingManifest,
    searchQuery,
    setSearchQuery,
    totalCount,
    loadingDevice,
    download,
    clearCache,
    loadDevice,
  };
}

async function loadDeviceCurvePoints(
  deviceId: string,
): Promise<MeasurementPoint[]> {
  const db = await openDb();
  const generation = await liveGeneration(db);
  // Cache contents came from a third-party source and may have been written
  // by an older app version, so validate both records on every read.
  const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
  const [cachedFrequencies, cachedValues] = await Promise.all([
    idbRequest<unknown>(store.get(generationKey(generation, "meta:frequencies"))),
    idbRequest<unknown>(store.get(generationKey(generation, deviceId))),
  ]);

  if (cachedFrequencies === undefined || cachedValues === undefined) {
    throw new Error(
      "Curve not found in local cache. Please download the database.",
    );
  }

  const frequencies = parseOnlineFrequencies(cachedFrequencies);
  const dbValues = parseOnlineCurveValues(
    cachedValues,
    frequencies.length,
    deviceId,
  );
  const points: MeasurementPoint[] = frequencies.map((freq, index) => ({
    freq,
    db: dbValues[index],
  }));

  return normalizeMeasurementPoints(points);
}
