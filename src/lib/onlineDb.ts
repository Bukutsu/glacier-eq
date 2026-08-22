// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useEffect, useState } from "react";
import type { MeasurementPoint } from "../types";

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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    // Without this, a second window holding an older DB version blocks the
    // upgrade forever and the promise never settles.
    request.onblocked = () => reject(new Error("Database locked by another window"));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
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
    return Boolean(await idbRequest(store.get("meta:complete")));
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

async function clearCachedDatabase(): Promise<void> {
  const db = await openDb();
  try {
    const store = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
    await idbRequest(store.clear());
  } finally {
    db.close();
  }
}

// One download at a time: closing and reopening the modal mid-download
// remounts the hook, and a second concurrent fetch would interleave chunk
// writes into the same store.
let downloadInFlight: Promise<number> | null = null;

async function downloadDatabase(
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<number> {
  downloadInFlight ??= (async () => {
    const db = await openDb();
    try {
      return await downloadDatabaseWithDb(onProgress, signal, db);
    } finally {
      db.close();
      downloadInFlight = null;
    }
  })();
  return downloadInFlight;
}

async function downloadDatabaseWithDb(
  onProgress: (percent: number) => void,
  signal: AbortSignal | undefined,
  db: IDBDatabase,
): Promise<number> {
  onProgress(0.05);
  // Download manifest first sequentially to minimize peak memory pressure
  const manifest = await fetchJson(
    "https://raw.githubusercontent.com/PEQHUB/Squig-Rank/main/public/data/manifest.json",
    undefined,
    signal,
  );

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete("meta:complete");
    tx.objectStore(STORE_NAME).put(manifest, "meta:manifest");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    // Aborts (quota exceeded, private-mode eviction) fire only onabort; without
    // this the awaited promise never settles and the UI hangs.
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });

  onProgress(0.15);

  // Now fetch curves.json
  const rawData = await fetchJson(
    "https://raw.githubusercontent.com/PEQHUB/Squig-Rank/main/public/data/curves.json",
    (p) => onProgress(0.15 + p * 0.7),
    signal,
  );

  if (!rawData?.meta || !rawData?.curves) {
    throw new Error("Invalid database format: missing meta or curves");
  }

  // Save frequencies
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(rawData.meta.frequencies, "meta:frequencies");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    // Aborts (quota exceeded, private-mode eviction) fire only onabort; without
    // this the awaited promise never settles and the UI hangs.
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });

  // Batch insert curves in chunks of 400 to prevent IPC buffer choke and allow GC
  const entries = Object.entries(rawData.curves);
  const totalEntries = entries.length;
  let count = 0;
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
        if (curve && typeof curve === "object" && "d" in curve) {
          store.put((curve as any).d, key);
          count++;
        }
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
  return count;
}

async function fetchJson(
  url: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<any> {
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
    const data = await idbRequest<any>(store.get("meta:manifest"));

    if (!data?.iems) {
      throw new Error("Search manifest not cached. Please download the database.");
    }

    const devices: OnlineDevice[] = [];
  for (const [key, details] of Object.entries(data.iems)) {
    const parts = key.split("::");
    if (parts.length < 2) continue;
    const source = parts[0];
    const fullName = parts[1];

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
      price: (details as any).price || null,
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
    // Get frequencies and raw decibels
    const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
  const [frequencies, dbValues] = await Promise.all([
    idbRequest<number[]>(store.get("meta:frequencies")).then((value) => value || []),
    idbRequest<number[]>(store.get(deviceId)).then((value) => value || []),
  ]);

  if (frequencies.length === 0 || dbValues.length === 0) {
    throw new Error(
      "Curve not found in local cache. Please download the database.",
    );
  }

  const points: MeasurementPoint[] = [];
  for (let i = 0; i < Math.min(frequencies.length, dbValues.length); i++) {
    points.push({
      freq: frequencies[i],
      db: dbValues[i],
    });
  }

    return points;
  } finally {
    db.close();
  }
}
