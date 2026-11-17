// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

/** How a measurement compares with other measurements of the same model. */
export interface MeasurementQuality {
  /** 1 is the best of `of`. Identical copies of a curve share a rank. */
  rank: number;
  /** Distinct curves for this model on this rig. */
  of: number;
  /** RMS dB distance from the median of the other measurements, 20 Hz–8 kHz. */
  agreement: number;
  /**
   * True when the group is big enough and its top curve agrees with the
   * median closely enough to call a pick. Otherwise show the rank only.
   */
  confident: boolean;
}

/** Fewer measurements than this have no meaningful consensus. */
export const MIN_MEASUREMENTS_TO_RANK = 3;
/** Smaller groups are ranked but never called a pick. */
export const MIN_MEASUREMENTS_FOR_PICK = 5;
/** Above this agreement a measurement is called out as unusual. */
export const UNUSUAL_AGREEMENT_DB = 1;

const LEVEL_BAND: [number, number] = [200, 2000];
const COMPARE_BAND: [number, number] = [20, 8000];
const SMOOTHING_WINDOW = 5;

/**
 * Same model across sources: ignore case, spaces and punctuation. 5128-rig
 * sources (`crinacle5128`) read differently from the 711 majority, so they
 * form their own group instead of losing the vote.
 */
export function modelKey(deviceId: string): string {
  const separator = deviceId.indexOf("::");
  const rig = deviceId.slice(0, separator).endsWith("5128") ? "5128:" : "";
  return (
    rig +
    deviceId
      .slice(separator + 2)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}()]+/gu, "")
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function rms(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
}

function inBand(frequencies: readonly number[], [lo, hi]: [number, number]) {
  return frequencies.flatMap((f, i) => (f >= lo && f <= hi ? [i] : []));
}

/** Residual noise: RMS of the curve minus its own moving average. */
function roughness(curve: readonly number[]): number {
  const half = SMOOTHING_WINDOW >> 1;
  const residuals: number[] = [];
  for (let i = half; i < curve.length - half; i++) {
    let sum = 0;
    for (let j = i - half; j <= i + half; j++) sum += curve[j];
    residuals.push(curve[i] - sum / SMOOTHING_WINDOW);
  }
  return rms(residuals);
}

/**
 * Rank every group of same-model measurements. Levels are aligned at
 * 200 Hz–2 kHz, then each curve is scored by its distance from the group
 * median (agreement) plus its own noise. Identical curves (sources that
 * mirror each other) count once toward the median and share a rank. Groups
 * with fewer than MIN_MEASUREMENTS_TO_RANK distinct curves get no entry.
 */
export function rankMeasurements(
  frequencies: readonly number[],
  curves: Readonly<Record<string, readonly number[]>>,
): Record<string, MeasurementQuality> {
  const levelBand = inBand(frequencies, LEVEL_BAND);
  const compareBand = inBand(frequencies, COMPARE_BAND);
  if (levelBand.length === 0 || compareBand.length === 0) return {};

  const groups = new Map<string, string[]>();
  for (const id of Object.keys(curves)) {
    const key = modelKey(id);
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }

  const ranked: Record<string, MeasurementQuality> = {};
  for (const ids of groups.values()) {
    if (ids.length < MIN_MEASUREMENTS_TO_RANK) continue;
    const byShape = new Map<string, string[]>();
    for (const id of ids) {
      const shape = curves[id].join(",");
      byShape.set(shape, [...(byShape.get(shape) ?? []), id]);
    }
    if (byShape.size < MIN_MEASUREMENTS_TO_RANK) continue;
    const copies = [...byShape.values()];
    const distinct = copies.map(([id]) => id);
    const aligned = distinct.map((id) => {
      const curve = curves[id];
      const level = levelBand.reduce((s, i) => s + curve[i], 0) / levelBand.length;
      return curve.map((db) => db - level);
    });
    const consensus = frequencies.map((_, i) => median(aligned.map((c) => c[i])));
    const scored = distinct.map((id, n) => {
      const agreement = rms(compareBand.map((i) => aligned[n][i] - consensus[i]));
      return { id, agreement, score: agreement + roughness(aligned[n]) };
    });
    scored.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
    const confident =
      scored.length >= MIN_MEASUREMENTS_FOR_PICK &&
      scored[0].agreement <= UNUSUAL_AGREEMENT_DB;
    scored.forEach(({ id, agreement }, index) => {
      const quality = { rank: index + 1, of: scored.length, agreement, confident };
      for (const copy of byShape.get(curves[id].join(","))!) ranked[copy] = quality;
    });
  }
  return ranked;
}
