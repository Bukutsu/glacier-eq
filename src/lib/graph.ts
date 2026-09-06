import type { Filter, PEQData } from "../types";
import initWasm, {
  filter_response_values,
  peq_response_values,
  peq_response_and_band_values,
  snap_freq_to_iso,
} from "../wasm_pkg/glacier_core";

const logMin = Math.log10(20);
const logMax = Math.log10(20000);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function freqToX(freq: number, width: number): number {
  if (width <= 0) return 0;
  return ((Math.log10(clamp(freq, 20, 20000)) - logMin) / (logMax - logMin)) * width;
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

let wasmReady: Promise<unknown> | null = null;

async function ensureWasmReady() {
  wasmReady ??= initWasm();
  await wasmReady;
}

export function snapFreqToIsoSync(freq: number): number {
  try {
    return snap_freq_to_iso(freq);
  } catch {
    return freq;
  }
}

export async function filterResponseValues(
  filter: Filter,
  freqs: Float32Array | number[],
  dspSampleRate = 96000,
): Promise<Float32Array> {
  await ensureWasmReady();
  const f32Freqs = freqs instanceof Float32Array ? freqs : new Float32Array(freqs);
  return filter_response_values(filter, f32Freqs, dspSampleRate) as Float32Array;
}

export async function peqResponseValues(
  peq: PEQData,
  freqs: Float32Array | number[],
  includePreamp: boolean,
  dspSampleRate = 96000,
): Promise<Float32Array> {
  await ensureWasmReady();
  const f32Freqs = freqs instanceof Float32Array ? freqs : new Float32Array(freqs);
  return peq_response_values(peq, f32Freqs, includePreamp, dspSampleRate) as Float32Array;
}

export async function peqResponseAndBandValues(
  peq: PEQData,
  freqs: Float32Array | number[],
  includePreamp: boolean,
  dspSampleRate = 96000,
): Promise<Float32Array> {
  await ensureWasmReady();
  const f32Freqs = freqs instanceof Float32Array ? freqs : new Float32Array(freqs);
  return peq_response_and_band_values(peq, f32Freqs, includePreamp, dspSampleRate);
}
