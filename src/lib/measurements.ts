import type { MeasurementPoint, MeasurementTrace } from "../types";

const MEASUREMENT_COLOR_VARS = ["--cyan", "--red", "--green", "--yellow", "--purple", "--blue"];

export function nextMeasurementColor(existing: MeasurementTrace[]): string {
  const idx = existing.length % MEASUREMENT_COLOR_VARS.length;
  return `var(${MEASUREMENT_COLOR_VARS[idx]})`;
}

export function makeMeasurementName(baseName: string, existing: MeasurementTrace[]): string {
  const normalized = baseName.trim() || "Measurement";
  if (!existing.some((trace) => trace.name === normalized)) {
    return normalized;
  }

  let copyIndex = 2;
  while (existing.some((trace) => trace.name === `${normalized} ${copyIndex}`)) {
    copyIndex += 1;
  }
  return `${normalized} ${copyIndex}`;
}

export function parseMeasurementText(text: string): MeasurementPoint[] {
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

  return sorted.map((point) => ({
    freq: point.freq,
    db: point.db - referenceDb,
  }));
}

function interpolateMeasurementDb(points: MeasurementPoint[], freq: number): number {
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
