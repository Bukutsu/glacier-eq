// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

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

export interface OnlineDbStatus {
  enabled: boolean;
  downloaded: boolean;
  totalDevices: number;
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

export async function isDatabaseDownloaded(): Promise<boolean> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const countRequest = store.count();
      countRequest.onsuccess = () => {
        // We expect at least some curves + the meta key
        resolve(countRequest.result > 10);
      };
      countRequest.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export async function clearCachedDatabase(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function downloadDatabase(
  onProgress: (percent: number) => void,
): Promise<number> {
  const url =
    "https://raw.githubusercontent.com/PEQHUB/Squig-Rank/main/public/data/curves.json";
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
        if (totalBytes > 0) {
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

  onProgress(0.99); // Parsing JSON next

  const rawData = JSON.parse(text);

  if (!rawData.meta || !rawData.curves) {
    throw new Error("Invalid database format: missing meta or curves");
  }

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    // Save frequencies
    store.put(rawData.meta.frequencies, "meta:frequencies");

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

export async function fetchManifest(): Promise<OnlineDevice[]> {
  const url =
    "https://raw.githubusercontent.com/PEQHUB/Squig-Rank/main/public/data/manifest.json";
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest: ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.iems) {
    throw new Error("Invalid manifest format");
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

export async function loadDeviceCurvePoints(
  deviceId: string,
): Promise<MeasurementPoint[]> {
  const db = await openDb();

  // Get frequencies and raw decibels
  const [frequencies, dbValues] = await Promise.all([
    new Promise<number[]>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const req = store.get("meta:frequencies");
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }),
    new Promise<number[]>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const req = store.get(deviceId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }),
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
