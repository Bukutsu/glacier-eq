import type { DeviceCapabilities, FilterType, PEQData } from "../types";

export const DEFAULT_FREQS_10_BAND = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// Name of the synthetic "reset to flat" profile shown first in the library.
export const DEFAULT_PROFILE_NAME = "Default EQ";

// Storage ceiling shared with ProfileStore::save and parseStoredPeq: stored
// or device-reported filter lists are clamped, never trusted to any length.
const MAX_FILTERS = 32;

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
  // Never truncate stored data, but pad at least to the device band count:
  // the UI and push paths slice by num_bands, so fewer bands than that would
  // silently drop filters on devices with more bands than the 10 defaults.
  const size = Math.min(
    MAX_FILTERS,
    Math.max(inputFilters.length, options.capabilities?.num_bands ?? defaults.filters.length),
  );
  const filters = Array.from({ length: size }, (_, index) => {
    const fallback = defaults.filters[index] ?? {
      index,
      enabled: false,
      filter_type: "Peak" as FilterType,
      freq: 1000,
      gain: 0,
      q: 1,
    };
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

/**
 * Validates a set/apply_eq_state response before trusting it as the
 * committed device state, then normalizes it to the DAC capabilities.
 * Throws when the device payload is malformed.
 */
export function parseStoredPeqResponse(
  value: unknown,
  options: { integerPreamp?: boolean; capabilities?: DeviceCapabilities } = {},
): PEQData {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { filters?: unknown }).filters)
  ) {
    throw new Error("Device returned an invalid EQ state");
  }
  const raw = value as { filters: unknown[]; global_gain?: unknown; globalGain?: unknown };
  const globalGain = raw.global_gain ?? raw.globalGain;
  if (typeof globalGain !== "number" || !Number.isFinite(globalGain)) {
    throw new Error("Device returned an invalid EQ state");
  }
  for (const filter of raw.filters) {
    if (typeof filter !== "object" || filter === null) {
      throw new Error("Device returned an invalid EQ state");
    }
    const f = filter as Record<string, unknown>;
    if (
      typeof f.gain !== "number" || !Number.isFinite(f.gain) ||
      typeof f.q !== "number" || !Number.isFinite(f.q) || f.q <= 0 ||
      typeof f.freq !== "number" || !(f.freq > 0)
    ) {
      throw new Error("Device returned an invalid EQ state");
    }
  }
  return normalizePeq(value, options);
}
