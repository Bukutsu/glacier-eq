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

export function parseMeasurementText(text: string): MeasurementPoint[] {
  if (text.length > 1_048_576 || text.split(/\r?\n/).length > 4096) {
    throw new Error("Measurement input exceeds maximum size");
  }
  const points: MeasurementPoint[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) {
      continue;
    }

    const tokens = line
      .split(/[,\t; ]+/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (tokens.length < 2) {
      continue;
    }

    const freq = Number(tokens[0]);
    const db = Number(tokens[1]);
    if (!Number.isFinite(freq) || !Number.isFinite(db)) {
      continue;
    }

    if (freq < 20 || freq > 20000) {
      continue;
    }

    points.push({ freq, db });
  }

  if (points.length > 100_000) {
    throw new Error("Measurement input exceeds maximum point count.");
  }
  if (points.length < 2) {
    throw new Error("Need at least 2 valid frequency,dB points.");
  }

  return normalizeMeasurementPoints(points);
}

export function normalizeMeasurementPoints(points: MeasurementPoint[]): MeasurementPoint[] {
  const sorted = [...points]
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
