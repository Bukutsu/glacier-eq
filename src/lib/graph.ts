import type { Filter } from "../types";

const logMin = Math.log10(20);
const logMax = Math.log10(20000);

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function freqToX(freq: number, width: number): number {
  return ((Math.log10(clamp(freq, 20, 20000)) - logMin) / (logMax - logMin)) * width;
}

export function xToFreq(x: number, width: number): number {
  return 10 ** (logMin + (x / width) * (logMax - logMin));
}

export function dbToY(db: number, height: number): number {
  return (1 - (clamp(db, -18, 18) + 18) / 36) * height;
}

export function formatFreq(freq: number): string {
  return freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
}

export function bandResponse(freq: number, filter: Filter): number {
  if (!filter.enabled || filter.freq <= 0) return 0;

  const octaves = Math.log2(freq / filter.freq);
  const width = Math.max(0.18, 1 / Math.max(0.2, filter.q));
  const bell = Math.exp(-0.5 * (octaves / width) ** 2);

  switch (filter.filter_type) {
    case "LowShelf":
      return filter.gain / (1 + (freq / filter.freq) ** (Math.max(0.4, filter.q) * 2));
    case "HighShelf":
      return filter.gain / (1 + (filter.freq / freq) ** (Math.max(0.4, filter.q) * 2));
    case "HighPass":
      return -18 / (1 + (freq / filter.freq) ** (Math.max(0.5, filter.q) * 3));
    case "LowPass":
      return -18 / (1 + (filter.freq / freq) ** (Math.max(0.5, filter.q) * 3));
    default:
      return filter.gain * bell;
  }
}
