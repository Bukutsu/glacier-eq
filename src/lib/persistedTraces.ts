import type { MeasurementPoint, MeasurementTrace, TargetTrace } from "../types";
import { normalizeMeasurementPoints } from "./measurements";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePoints(value: unknown): MeasurementPoint[] | null {
  if (!Array.isArray(value)) return null;

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
