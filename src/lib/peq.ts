import type { DeviceCapabilities, FilterType, PEQData } from "../types";

export const DEFAULT_FREQS_10_BAND = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// Name of the synthetic "reset to flat" profile shown first in the library.
export const DEFAULT_PROFILE_NAME = "Default EQ";

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

export function clampToRange(value: number, range: [number, number]): number {
  return Math.max(range[0], Math.min(range[1], value));
}

export function normalizePeq(
  raw: unknown,
  options: { enableLoadedFilters?: boolean; integerPreamp?: boolean; capabilities?: DeviceCapabilities } = {},
): PEQData {
  const source = raw as { filters?: unknown[]; global_gain?: unknown; globalGain?: unknown } | null | undefined;
  const defaults = buildDefaultState();
  const inputFilters = Array.isArray(source?.filters) ? source.filters : [];
  const filters = defaults.filters.map((fallback, index) => {
    const hasInput = inputFilters[index] !== undefined;
    const input = (inputFilters[index] ?? {}) as Record<string, unknown>;
    const capabilities = options.capabilities;
    const filterType = normalizeFilterType(input.filter_type ?? input.type ?? fallback.filter_type);
    return {
      index,
      // AutoEQ text has no enabled field, while saved profiles may explicitly
      // disable a band. Preserve an explicit state either way.
      enabled: index < (capabilities?.num_bands ?? defaults.filters.length) && hasInput
        ? typeof input.enabled === "boolean" ? input.enabled : options.enableLoadedFilters || fallback.enabled
        : false,
      filter_type: capabilities && !capabilities.supported_filter_types.includes(filterType)
        ? capabilities.supported_filter_types[0] ?? "Peak"
        : filterType,
      freq: capabilities
        ? Math.round(clampToRange(numberOr(input.freq, fallback.freq), capabilities.freq_range))
        : Math.round(numberOr(input.freq, fallback.freq)),
      gain: capabilities
        ? clampToRange(numberOr(input.gain, fallback.gain), capabilities.band_gain_range)
        : numberOr(input.gain, fallback.gain),
      q: capabilities
        ? clampToRange(numberOr(input.q, fallback.q), capabilities.q_range)
        : numberOr(input.q, fallback.q),
    };
  });

  let global_gain = numberOr(source?.global_gain ?? source?.globalGain, defaults.global_gain);
  if (options.capabilities) {
    global_gain = clampToRange(global_gain, options.capabilities.global_gain_range);
  }
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
