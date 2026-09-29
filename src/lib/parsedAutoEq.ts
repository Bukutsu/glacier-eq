import type { Filter, FilterType, PEQData } from "../types";

const MAX_FILTERS = 32;
const MAX_WARNINGS = 4_096;
// parse_autoeq caps its whole input at 1 MiB, so a name far longer than this
// could only have come from a payload nothing else bounded.
const MAX_HEADPHONE_NAME = 512;

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
  if (value.filter_type !== undefined && value.type !== undefined && value.filter_type !== value.type) {
    throw new Error(`Invalid parsed AutoEQ result: filter ${position} has conflicting type aliases`);
  }
  try {
    filterType = parseFilterType(value.filter_type ?? value.type);
  } catch {
    throw new Error(`Invalid parsed AutoEQ result: filter ${position} has an unknown type`);
  }
  if (typeof value.enabled !== "boolean") {
    throw new Error(`Invalid parsed AutoEQ result: filter ${position} enabled must be boolean`);
  }
  const index = finiteNumber(value.index, `filter ${position} index`);
  // This validator claims to be checking a Rust `Filter`, whose fields are
  // index: u8 and freq: u16 and whose q parse rejects anything non-positive
  // (autoeq.rs) and refuses to serialise (peq_to_autoeq). Checking only
  // "a finite number" let index 1e9 and freq -5 through into the editor,
  // where the sibling device validator in peq.ts rejects the same values.
  if (!Number.isInteger(index) || index < 0 || index > 255) {
    throw new Error(`Invalid parsed AutoEQ result: filter ${position} index must be an integer in 0..=255`);
  }
  const freq = finiteNumber(value.freq, `filter ${position} frequency`);
  if (!Number.isInteger(freq) || freq <= 0 || freq > 65_535) {
    throw new Error(`Invalid parsed AutoEQ result: filter ${position} frequency must be an integer in 1..=65535`);
  }
  const q = finiteNumber(value.q, `filter ${position} Q`);
  if (q <= 0) {
    throw new Error(`Invalid parsed AutoEQ result: filter ${position} Q must be positive`);
  }

  return {
    index,
    enabled: value.enabled,
    filter_type: filterType,
    freq,
    gain: finiteNumber(value.gain, `filter ${position} gain`),
    q,
  };
}

export function parseAutoEqResult(value: unknown): ParsedAutoEqResult {
  if (!isRecord(value) || !isRecord(value.peq)) {
    throw new Error("Invalid parsed AutoEQ result: expected a peq object");
  }
  if (
    value.headphone_name !== undefined
    && value.headphone_name !== null
    && (typeof value.headphone_name !== "string" || value.headphone_name.length > MAX_HEADPHONE_NAME)
  ) {
    throw new Error(`Invalid parsed AutoEQ result: headphone_name must be a string of at most ${MAX_HEADPHONE_NAME} characters, or null`);
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
  if (
    value.peq.global_gain !== undefined
    && value.peq.globalGain !== undefined
    && value.peq.global_gain !== value.peq.globalGain
  ) {
    throw new Error("Invalid parsed AutoEQ result: conflicting global gain aliases");
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
