import type { Filter, PEQData } from "../types";
import initWasm, {
  filter_response_values,
  peq_response_values,
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

let wasmReady: Promise<unknown> | null = null;

async function ensureWasmReady() {
  wasmReady ??= initWasm();
  await wasmReady;
}

export async function snapFreqToIso(freq: number): Promise<number> {
  await ensureWasmReady();
  return snap_freq_to_iso(freq);
}

export async function filterResponseValues(filter: Filter, freqs: number[]): Promise<number[]> {
  await ensureWasmReady();
  return filter_response_values(filter, freqs) as number[];
}

export async function peqResponseValues(peq: PEQData, freqs: number[], includePreamp: boolean): Promise<number[]> {
  await ensureWasmReady();
  return peq_response_values(peq, freqs, includePreamp) as number[];
}
