import { fuzzyMatch } from "@/lib/search";
import type { OnlineDevice } from "./onlineDb";

export const ONLINE_RESULT_LIMIT = 50;

/** Prefer literal and single-word matches over matches scattered across a name. */
export function findOnlineMeasurements(
  devices: readonly OnlineDevice[],
  query: string,
  owner?: string,
) {
  const normalized = query.trim().toLowerCase();
  const tokens = normalized ? normalized.split(/\s+/) : [];
  const buckets: OnlineDevice[][] = [[], [], []];
  const owners = new Set<string>();
  let total = 0;
  for (const device of devices) {
    const name = `${device.brand} ${device.name}`.toLowerCase();
    const source = device.source.toLowerCase();
    const matchesName = Boolean(normalized) && fuzzyMatch(normalized, name);
    const matchesSource = Boolean(normalized) && fuzzyMatch(normalized, source);
    const matchesBoth =
      Boolean(normalized) && fuzzyMatch(normalized, `${name} ${source}`);
    if (normalized && !matchesName && !matchesSource && !matchesBoth) continue;
    owners.add(device.source);
    if (!normalized || (owner && device.source !== owner)) continue;
    const words = name.split(/\s+/);
    const rank = !matchesName
      ? 2
      : tokens.every((token) => name.includes(token))
        ? 0
        : tokens.every((token) => words.some((word) => fuzzyMatch(token, word)))
          ? 1
          : 2;
    total += 1;
    if (buckets[rank].length < ONLINE_RESULT_LIMIT) buckets[rank].push(device);
  }
  return {
    results: buckets.flat().slice(0, ONLINE_RESULT_LIMIT),
    total,
    owners: Array.from(owners).sort((a, b) => a.localeCompare(b)),
  };
}
