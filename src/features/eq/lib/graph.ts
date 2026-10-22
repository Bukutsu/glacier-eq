import type { Filter, PEQData, ResponseModel } from "@/types";
import {
  filterResponseValues as calculateFilterResponseValues,
  peqResponseValues as calculatePeqResponseValues,
  peqResponseAndBandValues as calculatePeqResponseAndBandValues,
  snapFreqToIso,
} from "./graphMath";

const logMin = Math.log10(20);
const logMax = Math.log10(20000);

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function freqToX(freq: number, width: number): number {
  if (width <= 0) return 0;
  return (
    ((Math.log10(clamp(freq, 20, 20000)) - logMin) / (logMax - logMin)) * width
  );
}

export function xToFreq(x: number, width: number): number {
  if (width <= 0) return 20;
  return 10 ** (logMin + (x / width) * (logMax - logMin));
}

export function dbToY(db: number, height: number): number {
  if (height <= 0) return 0;
  return (1 - (clamp(db, -18, 18) + 18) / 36) * height;
}

export function yToDb(y: number, height: number): number {
  if (height <= 0) return 0;
  return (1 - clamp(y, 0, height) / height) * 36 - 18;
}

export function formatFreq(freq: number): string {
  return freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
}

/** A short label for narrow chips: 4379 → "4.4k", 12500 → "13k". */
export function formatFreqShort(freq: number): string {
  if (freq < 1000) return String(Math.round(freq));
  if (freq < 10000) return `${Number((freq / 1000).toFixed(1))}k`;
  return `${Math.round(freq / 1000)}k`;
}

let cachedWidth = -1;
let cachedFreqGrid: Float32Array | null = null;

export function getFreqGrid(width: number): Float32Array {
  if (width === cachedWidth && cachedFreqGrid) {
    return cachedFreqGrid;
  }
  const freqs = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    freqs[x] = xToFreq(x, width);
  }
  cachedWidth = width;
  cachedFreqGrid = freqs;
  return freqs;
}

export function snapFreqToIsoSync(freq: number): number {
  return snapFreqToIso(freq);
}

export async function filterResponseValues(
  filter: Filter,
  freqs: Float32Array | number[],
  dspSampleRate = 96000,
  responseModel: ResponseModel = "CanonicalQ",
): Promise<Float32Array> {
  const f32Freqs =
    freqs instanceof Float32Array ? freqs : new Float32Array(freqs);
  return calculateFilterResponseValues(
    filter,
    f32Freqs,
    dspSampleRate,
    responseModel,
  );
}

export async function peqResponseValues(
  peq: PEQData,
  freqs: Float32Array | number[],
  includePreamp: boolean,
  dspSampleRate = 96000,
  responseModel: ResponseModel = "CanonicalQ",
): Promise<Float32Array> {
  const f32Freqs =
    freqs instanceof Float32Array ? freqs : new Float32Array(freqs);
  return calculatePeqResponseValues(
    peq,
    f32Freqs,
    includePreamp,
    dspSampleRate,
    responseModel,
  );
}

export async function peqResponseAndBandValues(
  peq: PEQData,
  freqs: Float32Array | number[],
  includePreamp: boolean,
  dspSampleRate = 96000,
  responseModel: ResponseModel = "CanonicalQ",
): Promise<Float32Array> {
  const f32Freqs =
    freqs instanceof Float32Array ? freqs : new Float32Array(freqs);
  return calculatePeqResponseAndBandValues(
    peq,
    f32Freqs,
    includePreamp,
    dspSampleRate,
    responseModel,
  );
}
