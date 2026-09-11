import type { MeasurementPoint, MeasurementTrace, TargetTrace } from "../types";

const MEASUREMENT_COLOR_VARS = ["--steel", "--navy", "--sea", "--azure", "--sky", "--crimson"];
const TARGET_COLOR_VARS = ["--crimson", "--sky", "--azure", "--sea", "--navy", "--steel"];

function colorVar(vars: string[], index: number): string {
  return `var(${vars[index % vars.length]})`;
}

export function nextMeasurementColor(existing: MeasurementTrace[]): string {
  return colorVar(MEASUREMENT_COLOR_VARS, existing.length);
}

export function resolveTargetColor(index: number): string {
  return colorVar(TARGET_COLOR_VARS, index);
}

export function makeMeasurementName(baseName: string, existing: MeasurementTrace[]): string {
  return makeUniqueName(baseName, existing.map((trace) => trace.name), "Measurement");
}

export function makeTargetName(baseName: string, existing: TargetTrace[]): string {
  return makeUniqueName(baseName, existing.map((target) => target.name), "Target");
}

function makeUniqueName(baseName: string, existingNames: string[], fallback: string): string {
  const normalized = baseName.trim() || fallback;
  if (!existingNames.includes(normalized)) return normalized;

  let copyIndex = 2;
  while (existingNames.includes(`${normalized} ${copyIndex}`)) copyIndex += 1;
  return `${normalized} ${copyIndex}`;
}

const DELIM_TABLE = new Uint8Array(128);
for (const code of [44, 59, 9, 32]) DELIM_TABLE[code] = 1;

function isDelim(code: number): boolean {
  return code < 128 && DELIM_TABLE[code] === 1;
}

function tokenEnd(text: string, from: number, end: number): number {
  let index = from;
  while (index < end && !isDelim(text.charCodeAt(index))) index++;
  return index;
}

export function parseMeasurementText(text: string): MeasurementPoint[] {
  if (text.length > 1_048_576) {
    throw new Error("Measurement input exceeds maximum size");
  }
  const points: MeasurementPoint[] = [];
  let lineCount = 0;
  let lineStart = 0;

  const consumeLine = (lineEnd: number): void => {
    lineCount++;
    if (lineCount > 4096 || points.length > 100_000) return;
    let start = lineStart;
    const end = lineEnd;
    // No trailing trim: tokens stop at delimiters regardless, and Number()
    // tolerates trailing \r/whitespace, so a backward walk changes nothing.
    while (start < end && text.charCodeAt(start) <= 32) start++;
    if (start >= end) return;
    const first = text.charCodeAt(start);
    if (first === 35) return;
    if (first === 47 && start + 1 < end && text.charCodeAt(start + 1) === 47) return;

    const firstEnd = tokenEnd(text, start, end);
    let secondStart = firstEnd;
    while (secondStart < end && isDelim(text.charCodeAt(secondStart))) secondStart++;
    if (secondStart >= end) return;
    const secondEnd = tokenEnd(text, secondStart, end);

    const freq = Number(text.slice(start, firstEnd));
    const db = Number(text.slice(secondStart, secondEnd));
    if (!Number.isFinite(freq) || !Number.isFinite(db)) {
      return;
    }

    if (freq < 20 || freq > 20000) {
      return;
    }

    points.push({ freq, db });
  };

  // Bulk line splitting via indexOf (memchr) rather than a per-character
  // scan: identical (lineStart, lineEnd) sequence, same trailing handling.
  let lineEnd = text.indexOf("\n", lineStart);
  while (lineEnd !== -1) {
    consumeLine(lineEnd);
    lineStart = lineEnd + 1;
    lineEnd = text.indexOf("\n", lineStart);
  }
  if (lineStart < text.length) {
    consumeLine(text.length);
  } else if (lineStart === text.length && lineStart > 0) {
    // A trailing newline leaves the same empty final element that split would.
    lineCount++;
  }

  if (lineCount > 4096) {
    throw new Error("Measurement input exceeds maximum size");
  }

  if (points.length > 100_000) {
    throw new Error("Measurement input exceeds maximum point count.");
  }
  if (points.length < 2) {
    throw new Error("Need at least 2 valid frequency,dB points.");
  }

  return normalizeParsedInPlace(points);
}

// Owned-array fast path for parseMeasurementText: its points are freshly
// built and already finite + range-checked, so the re-filter is redundant
// and the reference subtraction can happen in place instead of allocating
// a second object generation. Same values, order, and errors as
// normalizeMeasurementPoints on such inputs; external callers keep the
// copying contract above.
function normalizeParsedInPlace(points: MeasurementPoint[]): MeasurementPoint[] {
  points.sort((a, b) => a.freq - b.freq);

  if (points.length < 2) {
    return points;
  }

  const referenceDb = interpolateMeasurementDb(points, 1000);
  if (!Number.isFinite(referenceDb)) {
    throw new Error("Measurement normalization produced a non-finite reference");
  }

  for (const point of points) {
    point.db -= referenceDb;
    if (!Number.isFinite(point.db)) {
      throw new Error("Measurement normalization produced a non-finite dB value");
    }
  }
  return points;
}

export function normalizeMeasurementPoints(points: MeasurementPoint[]): MeasurementPoint[] {
  // filter() already returns a fresh array, so no spread is needed before
  // the in-place sort; the caller's array is never mutated.
  const sorted = points
    .filter((point) => (
      Number.isFinite(point.freq) &&
      Number.isFinite(point.db) &&
      point.freq >= 20 &&
      point.freq <= 20000
    ))
    .sort((a, b) => a.freq - b.freq);

  if (sorted.length < 2) {
    return sorted;
  }

  const referenceDb = interpolateMeasurementDb(sorted, 1000);
  if (!Number.isFinite(referenceDb)) {
    throw new Error("Measurement normalization produced a non-finite reference");
  }

  return sorted.map((point) => {
    const db = point.db - referenceDb;
    if (!Number.isFinite(db)) {
      throw new Error("Measurement normalization produced a non-finite dB value");
    }
    return { freq: point.freq, db };
  });
}

export function interpolateMeasurementDb(points: MeasurementPoint[], freq: number): number {
  if (!points || points.length === 0) return 0;
  if (freq <= points[0].freq) return points[0].db;
  if (freq >= points[points.length - 1].freq) return points[points.length - 1].db;

  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].freq < freq) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const lowPoint = points[low];
  const highPoint = points[high];
  const span = Math.log10(highPoint.freq) - Math.log10(lowPoint.freq);
  if (span <= 0) return lowPoint.db;

  const ratio = (Math.log10(freq) - Math.log10(lowPoint.freq)) / span;
  return lowPoint.db + (highPoint.db - lowPoint.db) * ratio;
}

export type TraceKind = "measurement" | "target";

const TARGET_KEYWORDS = [
  "target",
  "harman",
  "ief",
  "diffuse field",
  "diffuse-field",
  "diffuse_field",
  "free field",
  "free-field",
  "free_field",
  "house curve",
  "house-curve",
  "house_curve",
  "housecurve",
  "preference",
  "tilt",
  "df-neutral",
  "df_neutral",
  "jm-1",
  "soundid",
  "reference",
  "bass boost",
  "bass-boost",
  "bass_boost",
  "autoeq target",
  "autoeq-target",
  "autoeq_target",
  "peqdb",
  "endgame",
  "hifiendgame",
  "compensation",
];

const MEASUREMENT_KEYWORDS = [
  "measurement",
  "meas",
  "raw",
  "sample",
  "coupler",
  "coupled",
  "711",
  "5128",
  "iec",
  "spl",
  "sweep",
];

export function identifyTraceKind(
  name: string,
  text?: string,
  pointCount?: number,
): TraceKind {
  const lowerName = name.toLowerCase();

  // 1. Check content comments / headers if available
  if (text) {
    const headerText = text
      .split(/\r?\n/, 30)
      .filter((l) => /^\s*([#/*;]|Frequency|Freq)/i.test(l))
      .join(" ")
      .toLowerCase();

    if (TARGET_KEYWORDS.some((kw) => headerText.includes(kw))) {
      return "target";
    }
    if (MEASUREMENT_KEYWORDS.some((kw) => headerText.includes(kw))) {
      return "measurement";
    }
  }

  // 2. Check filename
  const isTargetName = TARGET_KEYWORDS.some((kw) => lowerName.includes(kw));
  const isMeasName = MEASUREMENT_KEYWORDS.some((kw) => lowerName.includes(kw));

  if (isTargetName && !isMeasName) {
    return "target";
  }
  if (isMeasName) {
    return "measurement";
  }

  // 3. Sparse points heuristic (house curves typically have < 50 points, whereas measurements have hundreds)
  if (typeof pointCount === "number" && pointCount >= 2 && pointCount <= 45) {
    return "target";
  }

  // Default: most imported curves are headphone measurements
  return "measurement";
}

