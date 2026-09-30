import type { MeasurementPoint, MeasurementTrace, TargetTrace } from "../types";
import { normalizeMeasurementPoints } from "./measurements";

// Every other parser in this codebase bounds what it will accept: the
// measurement importer caps at 4_096 lines / 100_000 points, the online DB
// parser caps device and frequency counts, parsedAutoEq caps filters and
// warnings. These two did not, so a corrupt or hand-edited localStorage
// value could stall the main thread parsing it and then fail to re-save the
// result. Over-cap entries are rejected, which routes them into the
// quarantine path the caller already runs.
const MAX_PERSISTED_POINTS = 100_000;
export const MAX_PERSISTED_TRACES = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePoints(value: unknown): MeasurementPoint[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_PERSISTED_POINTS) return null;

  const points: MeasurementPoint[] = [];
  for (const point of value) {
    if (
      !isRecord(point) ||
      typeof point.freq !== "number" ||
      !Number.isFinite(point.freq) ||
      typeof point.db !== "number" ||
      !Number.isFinite(point.db)
    ) {
      return null;
    }
    points.push({ freq: point.freq, db: point.db });
  }

  const normalized = normalizeMeasurementPoints(points);
  return normalized.length >= 2 ? normalized : null;
}

export function parsePersistedMeasurements(value: unknown): MeasurementTrace[] {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_PERSISTED_TRACES) return [];

  const measurements: MeasurementTrace[] = [];
  for (const trace of value) {
    if (
      !isRecord(trace) ||
      typeof trace.id !== "string" ||
      typeof trace.name !== "string" ||
      typeof trace.color !== "string" ||
      typeof trace.visible !== "boolean"
    ) {
      continue;
    }
    const points = parsePoints(trace.points);
    if (!points) continue;

    measurements.push({
      id: trace.id,
      name: trace.name,
      color: trace.color,
      visible: trace.visible,
      points,
    });
  }
  return measurements;
}

export function parsePersistedTargets(value: unknown): TargetTrace[] {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_PERSISTED_TRACES) return [];

  const targets: TargetTrace[] = [];
  for (const target of value) {
    if (
      !isRecord(target) ||
      typeof target.id !== "string" ||
      typeof target.name !== "string" ||
      typeof target.color !== "string"
    ) {
      continue;
    }
    const points = parsePoints(target.points);
    if (!points) continue;

    targets.push({
      id: target.id,
      name: target.name,
      color: target.color,
      builtIn: false,
      points,
    });
  }
  return targets;
}
