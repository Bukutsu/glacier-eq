import type { Filter, FilterType, PEQData } from "../types";

const MAX_FILTERS = 32;
const MAX_WARNINGS = 4_096;

export interface ParsedAutoEqResult {
  peq: PEQData;
  headphone_name: string | null;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFilterType(value: unknown): FilterType {
  switch (value) {
    case "PK":
    case "Peak":
      return "Peak";
    case "LSQ":
    case "LSC":
    case "LowShelf":
      return "LowShelf";
    case "HSQ":
    case "HSC":
    case "HighShelf":
      return "HighShelf";
    case "HP":
    case "HighPass":
      return "HighPass";
    case "LP":
    case "LowPass":
      return "LowPass";
    default:
      throw new Error("Invalid parsed AutoEQ result: filter has an unknown type");
  }
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid parsed AutoEQ result: ${field} must be finite`);
  }
  return value;
}

function parseFilter(value: unknown, position: number): Filter {
  if (!isRecord(value)) {
    throw new Error(`Invalid parsed AutoEQ result: filter ${position} must be an object`);
  }
  let filterType: FilterType;
  try {
    filterType = parseFilterType(value.filter_type ?? value.type);
  } catch {
    throw new Error(`Invalid parsed AutoEQ result: filter ${position} has an unknown type`);
  }
  if (typeof value.enabled !== "boolean") {
    throw new Error(`Invalid parsed AutoEQ result: filter ${position} enabled must be boolean`);
  }
  const index = finiteNumber(value.index, `filter ${position} index`);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid parsed AutoEQ result: filter ${position} index must be a non-negative integer`);
  }

  return {
    index,
    enabled: value.enabled,
    filter_type: filterType,
    freq: finiteNumber(value.freq, `filter ${position} frequency`),
    gain: finiteNumber(value.gain, `filter ${position} gain`),
    q: finiteNumber(value.q, `filter ${position} Q`),
  };
}

export function parseAutoEqResult(value: unknown): ParsedAutoEqResult {
  if (!isRecord(value) || !isRecord(value.peq)) {
    throw new Error("Invalid parsed AutoEQ result: expected a peq object");
  }
  if (
    value.headphone_name !== undefined
    && value.headphone_name !== null
    && typeof value.headphone_name !== "string"
  ) {
    throw new Error("Invalid parsed AutoEQ result: headphone_name must be a string or null");
  }
  if (!Array.isArray(value.warnings) || value.warnings.length > MAX_WARNINGS) {
    throw new Error(`Invalid parsed AutoEQ result: warnings must contain at most ${MAX_WARNINGS} entries`);
  }
  if (!value.warnings.every((warning) => typeof warning === "string")) {
    throw new Error("Invalid parsed AutoEQ result: warnings must contain strings");
  }
  if (!Array.isArray(value.peq.filters) || value.peq.filters.length > MAX_FILTERS) {
    throw new Error(`Invalid parsed AutoEQ result: filters must contain at most ${MAX_FILTERS} entries`);
  }

  return {
    peq: {
      global_gain: finiteNumber(
        value.peq.global_gain ?? value.peq.globalGain,
        "global gain",
      ),
      filters: value.peq.filters.map(parseFilter),
    },
    headphone_name: value.headphone_name ?? null,
    warnings: [...value.warnings],
  };
}
