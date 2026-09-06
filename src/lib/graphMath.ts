import type { Filter, PEQData } from "../types";

const TAU = 2 * Math.PI;
const ISO_FREQUENCIES = [
  20, 25, 31, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
  800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000,
  12500, 16000, 20000,
] as const;

type BiquadCoefficients = [number, number, number, number, number, number];
type MagnitudeCoefficients = [number, number, number, number, number, number];

const IDENTITY_COEFFICIENTS: BiquadCoefficients = [1, 0, 0, 1, 0, 0];

function computeBiquadCoefficients(filter: Filter, dspSampleRate: number): BiquadCoefficients {
  if (
    !Number.isFinite(dspSampleRate) ||
    dspSampleRate < 41 ||
    !Number.isFinite(filter.freq) ||
    !Number.isFinite(filter.gain) ||
    !Number.isFinite(filter.q)
  ) {
    return IDENTITY_COEFFICIENTS;
  }

  const q = Math.min(100, Math.max(0.01, filter.q));
  const maxSafeFreq = Math.max(20, 0.49 * dspSampleRate);
  const frequency = Math.min(maxSafeFreq, Math.max(20, filter.freq));
  const gain = Math.min(150, Math.max(-150, filter.gain));
  const a = 10 ** (gain / 40);
  const omega = (frequency * TAU) / dspSampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);

  switch (filter.filter_type) {
    case "Peak":
      return [
        1 + alpha * a,
        -2 * cos,
        1 - alpha * a,
        1 + alpha / a,
        -2 * cos,
        1 - alpha / a,
      ];
    case "LowShelf": {
      const aMinusOne = a - 1;
      const aPlusOne = a + 1;
      const sqrtAAlpha = 2 * Math.sqrt(a) * alpha;
      return [
        a * (aPlusOne - aMinusOne * cos + sqrtAAlpha),
        2 * a * (aMinusOne - aPlusOne * cos),
        a * (aPlusOne - aMinusOne * cos - sqrtAAlpha),
        aPlusOne + aMinusOne * cos + sqrtAAlpha,
        -2 * (aMinusOne + aPlusOne * cos),
        aPlusOne + aMinusOne * cos - sqrtAAlpha,
      ];
    }
    case "HighShelf": {
      const aMinusOne = a - 1;
      const aPlusOne = a + 1;
      const sqrtAAlpha = 2 * Math.sqrt(a) * alpha;
      return [
        a * (aPlusOne + aMinusOne * cos + sqrtAAlpha),
        -2 * a * (aMinusOne + aPlusOne * cos),
        a * (aPlusOne + aMinusOne * cos - sqrtAAlpha),
        aPlusOne - aMinusOne * cos + sqrtAAlpha,
        2 * (aMinusOne - aPlusOne * cos),
        aPlusOne - aMinusOne * cos - sqrtAAlpha,
      ];
    }
    case "HighPass":
      return [
        (1 + cos) / 2,
        -(1 + cos),
        (1 + cos) / 2,
        1 + alpha,
        -2 * cos,
        1 - alpha,
      ];
    case "LowPass":
      return [
        (1 - cos) / 2,
        1 - cos,
        (1 - cos) / 2,
        1 + alpha,
        -2 * cos,
        1 - alpha,
      ];
    default: {
      const _exhaustive: never = filter.filter_type;
      return _exhaustive;
    }
  }
}

function magnitudeCoefficients(
  [b0, b1, b2, a0, a1, a2]: BiquadCoefficients,
): MagnitudeCoefficients {
  return [
    (b0 - b2) ** 2 + b1 ** 2,
    2 * b1 * (b0 + b2),
    4 * b0 * b2,
    (a0 - a2) ** 2 + a1 ** 2,
    2 * a1 * (a0 + a2),
    4 * a0 * a2,
  ];
}

function evaluateMagnitudeDb(
  [c0b, c1b, c2b, c0a, c1a, c2a]: MagnitudeCoefficients,
  cos: number,
): number {
  const numerator = c0b + cos * (c1b + c2b * cos);
  const denominator = c0a + cos * (c1a + c2a * cos);

  if (numerator > 0 && denominator > 0) {
    return 10 * Math.log10(numerator / denominator);
  }
  if (numerator <= 0 && denominator > 0) {
    return -150;
  }
  return 0;
}

function accumulateFilterResponse(
  filter: Filter,
  freqs: Float32Array,
  dspSampleRate: number,
  response: Float32Array,
  bandOffset: number | null,
): void {
  if (!Number.isFinite(dspSampleRate) || dspSampleRate <= 0) return;

  const coefficients = magnitudeCoefficients(computeBiquadCoefficients(filter, dspSampleRate));
  const factor = TAU / dspSampleRate;
  for (let index = 0; index < freqs.length; index++) {
    const value = evaluateMagnitudeDb(coefficients, Math.cos(freqs[index] * factor));
    if (bandOffset !== null) response[bandOffset + index] = value;
    response[index] += value;
  }
}

export function filterResponseValues(
  filter: Filter,
  freqs: Float32Array,
  dspSampleRate: number,
): Float32Array {
  const response = new Float32Array(freqs.length);
  if (filter.enabled) {
    const coefficients = magnitudeCoefficients(computeBiquadCoefficients(filter, dspSampleRate));
    const factor = TAU / dspSampleRate;
    for (let index = 0; index < freqs.length; index++) {
      response[index] = evaluateMagnitudeDb(
        coefficients,
        Math.cos(freqs[index] * factor),
      );
    }
  }
  return response;
}

export function peqResponseValues(
  peq: PEQData,
  freqs: Float32Array,
  includePreamp: boolean,
  dspSampleRate: number,
): Float32Array {
  const response = new Float32Array(freqs.length);
  if (includePreamp) response.fill(peq.global_gain);

  for (const filter of peq.filters) {
    if (!filter.enabled) continue;
    accumulateFilterResponse(filter, freqs, dspSampleRate, response, null);
  }
  return response;
}

export function peqResponseAndBandValues(
  peq: PEQData,
  freqs: Float32Array,
  includePreamp: boolean,
  dspSampleRate: number,
): Float32Array {
  const enabledFilters = peq.filters.filter((filter) => filter.enabled);
  const stride = freqs.length;
  const response = new Float32Array((enabledFilters.length + 1) * stride);
  if (includePreamp) response.subarray(0, stride).fill(peq.global_gain);

  enabledFilters.forEach((filter, bandIndex) => {
    accumulateFilterResponse(filter, freqs, dspSampleRate, response, (bandIndex + 1) * stride);
  });
  return response;
}

export function snapFreqToIso(freq: number): number {
  let closest: number = ISO_FREQUENCIES[0];
  let closestDistance = Math.abs(freq - closest);
  for (const candidate of ISO_FREQUENCIES.slice(1)) {
    const distance = Math.abs(freq - candidate);
    if (distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }
  return closest;
}

