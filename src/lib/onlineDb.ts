// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useEffect, useState } from "react";
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

export interface OnlineDevice {
  id: string;
  brand: string;
  name: string;
  price: number | null;
  source: string;
}

let pendingOpen: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (pendingOpen) return pendingOpen;

  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
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
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
  pendingOpen = attempt;
  return attempt;
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function isDatabaseDownloaded(): Promise<boolean> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
    return await idbRequest<unknown>(store.get("meta:complete")) === true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

export async function clearCachedDatabase(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
    });
  } finally {
    db.close();
  }
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

// Only the download that starts the shared promise can pass an abort
// signal; joiners cannot cancel a download they did not initiate.
async function downloadDatabase(onProgress: (percent: number) => void): Promise<number> {
  progressListeners.add(onProgress);
  try {
    downloadInFlight ??= (async () => {
      try {
        const db = await openDb();
        try {
          return await downloadDatabaseWithDb(notifyProgress, undefined, db);
        } finally {
          db.close();
        }
      } finally {
        // Reset even when openDb() rejects, or every later download would
        // await this failed promise forever.
        downloadInFlight = null;
      }
    })();
    return await downloadInFlight;
  } finally {
    progressListeners.delete(onProgress);
  }
}

async function downloadDatabaseWithDb(
  onProgress: (percent: number) => void,
  signal: AbortSignal | undefined,
  db: IDBDatabase,
): Promise<number> {
  onProgress(0.05);
  // Validate both third-party payloads before changing the existing cache.
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

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    store.put(manifest, "meta:manifest");
    store.put(database.frequencies, "meta:frequencies");
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
        store.put(curve, key);
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

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(true, "meta:complete");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    // Aborts (quota exceeded, private-mode eviction) fire only onabort; without
    // this the awaited promise never settles and the UI hangs.
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
  onProgress(1.0);
  return totalEntries;
}

async function fetchJson(
  url: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch database: ${response.statusText}`);
  }

  const contentLength = response.headers.get("content-length");
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
  const maxBytes = 64 * 1024 * 1024;
  if (totalBytes > maxBytes) throw new Error("Online database response is too large");
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
        if (loadedBytes > maxBytes) {
          await reader.cancel();
          throw new Error("Online database response is too large");
        }
        if (onProgress && totalBytes > 0) {
          onProgress(Math.min(0.99, loadedBytes / totalBytes));
        }
      }
    }
    text += decoder.decode();
  } else {
    // Android WebView/Tauri builds may not expose ReadableStream on fetch responses.
    // Fall back to reading the whole response so the online database still works.
    text = await response.text();
    if (text.length > maxBytes) throw new Error("Online database response is too large");
  }

  onProgress?.(0.99); // Parsing JSON next
  return JSON.parse(text);
}

async function fetchManifest(): Promise<OnlineDevice[]> {
  const db = await openDb();
  try {
    const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
    const cached = await idbRequest<unknown>(store.get("meta:manifest"));
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
  } finally {
    db.close();
  }
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
    try {
      const count = await downloadDatabase(setDownloadProgress);
      setDownloaded(true);
      setTotalCount(count);
      return count;
    } finally {
      setIsDownloading(false);
      setDownloadProgress(null);
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
  try {
    // Cache contents came from a third-party source and may have been written
    // by an older app version, so validate both records on every read.
    const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
    const [cachedFrequencies, cachedValues] = await Promise.all([
      idbRequest<unknown>(store.get("meta:frequencies")),
      idbRequest<unknown>(store.get(deviceId)),
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
  } finally {
    db.close();
  }
}
