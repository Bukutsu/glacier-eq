import type { Filter, PEQData, ResponseModel } from "@/types";

const TAU = 2 * Math.PI;
const ISO_FREQUENCIES = [
  20, 25, 31, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
  1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500,
  16000, 20000,
] as const;

type BiquadCoefficients = [number, number, number, number, number, number];
type MagnitudeCoefficients = [number, number, number, number, number, number];

const IDENTITY_COEFFICIENTS: BiquadCoefficients = [1, 0, 0, 1, 0, 0];

function computeBiquadCoefficients(
  filter: Filter,
  dspSampleRate: number,
  responseModel: ResponseModel,
): BiquadCoefficients {
  const shelfSlope =
    responseModel === "MoondropShelfSlope" &&
    (filter.filter_type === "LowShelf" || filter.filter_type === "HighShelf");
  if (
    shelfSlope &&
    (!Number.isFinite(filter.gain) ||
      !Number.isFinite(filter.q) ||
      filter.q <= 0)
  ) {
    throw new Error(
      "Invalid Moondrop shelf slope: gain and S must be finite, and S must be positive",
    );
  }
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
  let alpha = sin / (2 * q);
  if (shelfSlope) {
    const radicand = (a + 1 / a) * (1 / filter.q - 1) + 2;
    if (!Number.isFinite(radicand) || radicand <= 0) {
      throw new Error("Invalid Moondrop shelf slope: reduce S for this gain");
    }
    alpha = (sin / 2) * Math.sqrt(radicand);
  }

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

function magnitudeCoefficients([
  b0,
  b1,
  b2,
  a0,
  a1,
  a2,
]: BiquadCoefficients): MagnitudeCoefficients {
  return [
    b0 + b1 + b2,
    -2 * (b0 + b2),
    b0 - b2,
    a0 + a1 + a2,
    -2 * (a0 + a2),
    a0 - a2,
  ];
}

function evaluateMagnitudeDb(
  [br0, br1, bi, ar0, ar1, ai]: MagnitudeCoefficients,
  phi: number,
  sin: number,
): number {
  // Rotated real/imaginary sum of squares avoids catastrophic cancellation
  // in the expanded quadratic near DC. phi = sin(omega / 2)^2.
  const br = br0 + br1 * phi;
  const ar = ar0 + ar1 * phi;
  const numerator = br * br + (bi * sin) ** 2;
  const denominator = ar * ar + (ai * sin) ** 2;

  if (numerator > 0 && denominator > 0) {
    return 10 * Math.log10(numerator / denominator);
  }
  if (numerator <= 0 && denominator > 0) {
    return -150;
  }
  return 0;
}

// Internal phase scratch is fully overwritten before use and never returned.
// Each point stores sin(omega / 2)^2 and sin(omega), for stable evaluation.
let phaseScratch: Float64Array | null = null;

function takePhases(freqs: Float32Array, dspSampleRate: number): Float64Array {
  if (phaseScratch?.length !== 2 * freqs.length)
    phaseScratch = new Float64Array(2 * freqs.length);
  if (!Number.isFinite(dspSampleRate) || dspSampleRate <= 0) {
    phaseScratch.fill(0);
    return phaseScratch;
  }
  const factor = TAU / dspSampleRate;
  for (let index = 0; index < freqs.length; index++) {
    const omega = freqs[index] * factor;
    phaseScratch[2 * index] = Math.sin(omega / 2) ** 2;
    phaseScratch[2 * index + 1] = Math.sin(omega);
  }
  return phaseScratch;
}

// Split by destination so the per-point loop has no offset branch: simpler
// bodies vectorize better and the aggregate-only path skips band stores.
function accumulateAggregateResponse(
  filter: Filter,
  phases: Float64Array,
  dspSampleRate: number,
  responseModel: ResponseModel,
  response: Float32Array,
): void {
  if (!Number.isFinite(dspSampleRate) || dspSampleRate <= 0) return;

  const coefficients = magnitudeCoefficients(
    computeBiquadCoefficients(filter, dspSampleRate, responseModel),
  );
  for (let index = 0; index < phases.length / 2; index++) {
    response[index] += evaluateMagnitudeDb(
      coefficients,
      phases[2 * index],
      phases[2 * index + 1],
    );
  }
}

function accumulateBandResponse(
  filter: Filter,
  phases: Float64Array,
  dspSampleRate: number,
  responseModel: ResponseModel,
  response: Float32Array,
  bandOffset: number,
): void {
  if (!Number.isFinite(dspSampleRate) || dspSampleRate <= 0) return;

  const coefficients = magnitudeCoefficients(
    computeBiquadCoefficients(filter, dspSampleRate, responseModel),
  );
  for (let index = 0; index < phases.length / 2; index++) {
    const value = evaluateMagnitudeDb(
      coefficients,
      phases[2 * index],
      phases[2 * index + 1],
    );
    response[bandOffset + index] = value;
    response[index] += value;
  }
}

export function filterResponseValues(
  filter: Filter,
  freqs: Float32Array,
  dspSampleRate: number,
  responseModel: ResponseModel = "CanonicalQ",
): Float32Array {
  const response = new Float32Array(freqs.length);
  if (filter.enabled) {
    const phases = takePhases(freqs, dspSampleRate);
    const coefficients = magnitudeCoefficients(
      computeBiquadCoefficients(filter, dspSampleRate, responseModel),
    );
    for (let index = 0; index < freqs.length; index++) {
      response[index] = evaluateMagnitudeDb(
        coefficients,
        phases[2 * index],
        phases[2 * index + 1],
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
  responseModel: ResponseModel = "CanonicalQ",
): Float32Array {
  const response = new Float32Array(freqs.length);
  if (includePreamp) response.fill(peq.global_gain);

  const enabledFilters = peq.filters.filter((filter) => filter.enabled);
  const phases = takePhases(freqs, dspSampleRate);
  for (const filter of enabledFilters) {
    accumulateAggregateResponse(
      filter,
      phases,
      dspSampleRate,
      responseModel,
      response,
    );
  }
  return response;
}

export function peqResponseAndBandValues(
  peq: PEQData,
  freqs: Float32Array,
  includePreamp: boolean,
  dspSampleRate: number,
  responseModel: ResponseModel = "CanonicalQ",
): Float32Array {
  const enabledFilters = peq.filters.filter((filter) => filter.enabled);
  const stride = freqs.length;
  const response = new Float32Array((enabledFilters.length + 1) * stride);
  if (includePreamp) response.subarray(0, stride).fill(peq.global_gain);

  const phases = takePhases(freqs, dspSampleRate);
  enabledFilters.forEach((filter, bandIndex) => {
    accumulateBandResponse(
      filter,
      phases,
      dspSampleRate,
      responseModel,
      response,
      (bandIndex + 1) * stride,
    );
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
