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
    request.onsuccess = () => resolve(request.result);
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
  try {
    const db = await openDb();
    const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
    return (await idbRequest(store.count())) > 10;
  } catch {
    return false;
  }
}

async function clearCachedDatabase(): Promise<void> {
  const db = await openDb();
  const store = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
  await idbRequest(store.clear());
}

async function downloadDatabase(
  onProgress: (percent: number) => void,
): Promise<number> {
  const [rawData, manifest] = await Promise.all([
    fetchJson("https://raw.githubusercontent.com/PEQHUB/Squig-Rank/main/public/data/curves.json", onProgress),
    fetchJson("https://raw.githubusercontent.com/PEQHUB/Squig-Rank/main/public/data/manifest.json"),
  ]);

  if (!rawData.meta || !rawData.curves) {
    throw new Error("Invalid database format: missing meta or curves");
  }

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    // Save frequencies
    store.put(rawData.meta.frequencies, "meta:frequencies");
    store.put(manifest, "meta:manifest");

    // Save each curve
    let count = 0;
    for (const [key, curve] of Object.entries(rawData.curves)) {
      if (curve && typeof curve === "object" && "d" in curve) {
        store.put(curve.d, key);
        count++;
      }
    }

    transaction.oncomplete = () => {
      onProgress(1.0);
      resolve(count);
    };
    transaction.onerror = () => {
      reject(transaction.error);
    };
  });
}

async function fetchJson(url: string, onProgress?: (percent: number) => void): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch database: ${response.statusText}`);
  }

  const contentLength = response.headers.get("content-length");
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
  let loadedBytes = 0;

  let text: string;
  const reader = response.body?.getReader?.();
  if (reader) {
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loadedBytes += value.length;
        if (onProgress && totalBytes > 0) {
          onProgress(Math.min(0.99, loadedBytes / totalBytes));
        }
      }
    }

    const blob = new Blob(chunks as BlobPart[]);
    text = await blob.text();
  } else {
    // Android WebView/Tauri builds may not expose ReadableStream on fetch responses.
    // Fall back to reading the whole response so the online database still works.
    text = await response.text();
  }

  onProgress?.(0.99); // Parsing JSON next
  return JSON.parse(text);
}

async function fetchManifest(): Promise<OnlineDevice[]> {
  const db = await openDb();
  const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
  const data = await idbRequest<any>(store.get("meta:manifest"));

  if (!data.iems) {
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
}

export function useOnlineDatabase(
  enabled: boolean | undefined,
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
    if (enabled) isDatabaseDownloaded().then(setDownloaded);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !downloaded) return;
    setLoadingManifest(true);
    fetchManifest()
      .then((devices) => {
        setManifest(devices);
        setTotalCount(devices.length);
      })
      .catch((error) => {
        console.error("Failed to load online manifest:", error);
        setStatus?.(`Failed to load online search manifest: ${error}`);
      })
      .finally(() => setLoadingManifest(false));
  }, [enabled, downloaded, setStatus]);

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
}
