import type { FilterType, PEQData } from "../types";

export const DEFAULT_FREQS_10_BAND = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export function buildDefaultState(): PEQData {
  return {
    global_gain: 0,
    filters: DEFAULT_FREQS_10_BAND.map((freq, index) => ({
      index,
      enabled: index === 0,
      filter_type: "Peak",
      freq,
      gain: 0,
      q: 1,
    })),
  };
}

function normalizeFilterType(raw: unknown): FilterType {
  switch (String(raw ?? "").replace(/\s+/g, "").toLowerCase()) {
    case "lsq":
    case "lsc":
    case "ls":
    case "lowshelf":
      return "LowShelf";
    case "hsq":
    case "hsc":
    case "hs":
    case "highshelf":
      return "HighShelf";
    case "hp":
    case "hpf":
    case "highpass":
      return "HighPass";
    case "lp":
    case "lpf":
    case "lowpass":
      return "LowPass";
    case "pk":
    case "peak":
    default:
      return "Peak";
  }
}

function numberOr(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function normalizePeq(
  raw: unknown,
  options: { enableLoadedFilters?: boolean; integerPreamp?: boolean } = {},
): PEQData {
  const source = raw as { filters?: unknown[]; global_gain?: unknown; globalGain?: unknown } | null | undefined;
  const defaults = buildDefaultState();
  const inputFilters = Array.isArray(source?.filters) ? source.filters : [];
  const filters = defaults.filters.map((fallback, index) => {
    const hasInput = inputFilters[index] !== undefined;
    const input = (inputFilters[index] ?? {}) as Record<string, unknown>;
    return {
      index,
      // Glacier enables every filter loaded from AutoEQ/profile text, then
      // pads missing device bands as inactive flat filters.
      enabled: hasInput
        ? options.enableLoadedFilters || (typeof input.enabled === "boolean" ? input.enabled : fallback.enabled)
        : false,
      filter_type: normalizeFilterType(input.filter_type ?? input.type ?? fallback.filter_type),
      freq: Math.round(numberOr(input.freq, fallback.freq)),
      gain: numberOr(input.gain, fallback.gain),
      q: numberOr(input.q, fallback.q),
    };
  });

  let global_gain = numberOr(source?.global_gain ?? source?.globalGain, defaults.global_gain);
  if (options.integerPreamp) {
    global_gain = Math.round(global_gain);
  }

  return {
    filters,
    global_gain,
  };
}

export function peqEquals(a: PEQData, b: PEQData): boolean {
  if (a.global_gain !== b.global_gain || a.filters.length !== b.filters.length) return false;
  return a.filters.every((filter, index) => {
    const other = b.filters[index];
    return filter.enabled === other.enabled &&
      filter.filter_type === other.filter_type &&
      filter.freq === other.freq &&
      filter.gain === other.gain &&
      filter.q === other.q;
  });
}
