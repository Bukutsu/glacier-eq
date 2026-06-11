import type { MeasurementPoint, MeasurementTrace } from "../types";

const MEASUREMENT_COLORS = [
  "#7dcfff",
  "#f7768e",
  "#9ece6a",
  "#e0af68",
  "#bb9af7",
  "#7aa2f7",
];

export function nextMeasurementColor(existing: MeasurementTrace[]): string {
  return MEASUREMENT_COLORS[existing.length % MEASUREMENT_COLORS.length];
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

  const reference = sorted.reduce((closest, point) => (
    Math.abs(point.freq - 1000) < Math.abs(closest.freq - 1000) ? point : closest
  ), sorted[0]);

  return sorted.map((point) => ({
    freq: point.freq,
    db: point.db - reference.db,
  }));
}
