import { i18n } from "@/lib/i18n";
import type { Filter, FilterType, PEQData } from "@/types";

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
      throw new Error(
        i18n.t(
          "library:parsedAutoEq.invalidParsedAutoEQResultFilterHasAnUnknownType",
        ),
      );
  }
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      i18n.t("library:parsedAutoEq.invalidParsedAutoEQResultMustBeFinite", {
        field: field,
      }),
    );
  }
  return value;
}

function parseFilter(value: unknown, position: number): Filter {
  if (!isRecord(value)) {
    throw new Error(
      i18n.t(
        "library:parsedAutoEq.invalidParsedAutoEQResultFilterMustBeAnObject",
        { position: position },
      ),
    );
  }
  let filterType: FilterType;
  if (
    value.filter_type !== undefined &&
    value.type !== undefined &&
    value.filter_type !== value.type
  ) {
    throw new Error(
      i18n.t(
        "library:parsedAutoEq.invalidParsedAutoEQResultFilterHasConflictingTypeAliases",
        { position: position },
      ),
    );
  }
  try {
    filterType = parseFilterType(value.filter_type ?? value.type);
  } catch {
    throw new Error(
      i18n.t(
        "library:parsedAutoEq.invalidParsedAutoEQResultFilterHasAnUnknownType2",
        { position: position },
      ),
    );
  }
  if (typeof value.enabled !== "boolean") {
    throw new Error(
      i18n.t(
        "library:parsedAutoEq.invalidParsedAutoEQResultFilterEnabledMustBeBoolean",
        { position: position },
      ),
    );
  }
  const index = finiteNumber(
    value.index,
    i18n.t("library:parsedAutoEq.filterIndex", { position: position }),
  );
  // This validator claims to be checking a Rust `Filter`, whose fields are
  // index: u8 and freq: u16 and whose q parse rejects anything non-positive
  // (autoeq.rs) and refuses to serialise (peq_to_autoeq). Checking only
  // "a finite number" let index 1e9 and freq -5 through into the editor,
  // where the sibling device validator in peq.ts rejects the same values.
  if (!Number.isInteger(index) || index < 0 || index > 255) {
    throw new Error(
      i18n.t(
        "library:parsedAutoEq.invalidParsedAutoEQResultFilterIndexMustBeAn",
        { position: position },
      ),
    );
  }
  const freq = finiteNumber(
    value.freq,
    i18n.t("library:parsedAutoEq.filterFrequency", { position: position }),
  );
  if (!Number.isInteger(freq) || freq <= 0 || freq > 65_535) {
    throw new Error(
      i18n.t(
        "library:parsedAutoEq.invalidParsedAutoEQResultFilterFrequencyMustBeAn",
        { position: position },
      ),
    );
  }
  const q = finiteNumber(
    value.q,
    i18n.t("library:parsedAutoEq.filterQ", { position: position }),
  );
  if (q <= 0) {
    throw new Error(
      i18n.t(
        "library:parsedAutoEq.invalidParsedAutoEQResultFilterQMustBePositive",
        { position: position },
      ),
    );
  }

  return {
    index,
    enabled: value.enabled,
    filter_type: filterType,
    freq,
    gain: finiteNumber(
      value.gain,
      i18n.t("library:parsedAutoEq.filterGain", { position: position }),
    ),
    q,
  };
}

export function parseAutoEqResult(value: unknown): ParsedAutoEqResult {
  if (!isRecord(value) || !isRecord(value.peq)) {
    throw new Error(
      i18n.t(
        "library:parsedAutoEq.invalidParsedAutoEQResultExpectedAPeqObject",
      ),
    );
  }
  if (
    value.headphone_name !== undefined &&
    value.headphone_name !== null &&
    (typeof value.headphone_name !== "string" ||
      value.headphone_name.length > MAX_HEADPHONE_NAME)
  ) {
    throw new Error(
      i18n.t(
        "library:parsedAutoEq.invalidParsedAutoEQResultHeadphoneNameMustBeA",
        { limit: MAX_HEADPHONE_NAME },
      ),
    );
  }
  if (!Array.isArray(value.warnings) || value.warnings.length > MAX_WARNINGS) {
    throw new Error(
      i18n.t(
        "library:parsedAutoEq.invalidParsedAutoEQResultWarningsMustContainAtMost",
        { limit: MAX_WARNINGS },
      ),
    );
  }
  if (!value.warnings.every((warning) => typeof warning === "string")) {
    throw new Error(
      i18n.t(
        "library:parsedAutoEq.invalidParsedAutoEQResultWarningsMustContainStrings",
      ),
    );
  }
  if (
    !Array.isArray(value.peq.filters) ||
    value.peq.filters.length > MAX_FILTERS
  ) {
    throw new Error(
      i18n.t(
        "library:parsedAutoEq.invalidParsedAutoEQResultFiltersMustContainAtMost",
        { limit: MAX_FILTERS },
      ),
    );
  }
  if (
    value.peq.global_gain !== undefined &&
    value.peq.globalGain !== undefined &&
    value.peq.global_gain !== value.peq.globalGain
  ) {
    throw new Error(
      i18n.t(
        "library:parsedAutoEq.invalidParsedAutoEQResultConflictingGlobalGainAliases",
      ),
    );
  }

  return {
    peq: {
      global_gain: finiteNumber(
        value.peq.global_gain ?? value.peq.globalGain,
        i18n.t("library:parsedAutoEq.globalGain"),
      ),
      filters: value.peq.filters.map(parseFilter),
    },
    headphone_name: value.headphone_name ?? null,
    warnings: [...value.warnings],
  };
}
