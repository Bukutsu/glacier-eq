import { fuzzyMatch } from "./search";
import type { OnlineDevice } from "./onlineDb";

export const ONLINE_RESULT_LIMIT = 50;

/** Prefer literal and single-word matches over matches scattered across a name. */
export function findOnlineMeasurements(devices: readonly OnlineDevice[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return { results: [], total: 0 };

  const tokens = normalized.split(/\s+/);
  const buckets: OnlineDevice[][] = [[], [], []];
  let total = 0;
  for (const device of devices) {
    const name = `${device.brand} ${device.name}`.toLowerCase();
    if (!fuzzyMatch(normalized, name)) continue;
    const words = name.split(/\s+/);
    const rank = tokens.every((token) => name.includes(token)) ? 0
      : tokens.every((token) => words.some((word) => fuzzyMatch(token, word))) ? 1
      : 2;
    total += 1;
    if (buckets[rank].length < ONLINE_RESULT_LIMIT) buckets[rank].push(device);
  }
  return { results: buckets.flat().slice(0, ONLINE_RESULT_LIMIT), total };
}
