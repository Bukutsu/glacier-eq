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

  const [b0, b1, b2, a0, a1, a2] = computeBiquadCoeffs(filter);
  const omega = (2 * Math.PI * clamp(freq, 20, 20000)) / DSP_SAMPLE_RATE;
  const cos1 = Math.cos(omega);
  const sin1 = Math.sin(omega);
  const cos2 = Math.cos(2 * omega);
  const sin2 = Math.sin(2 * omega);

  const realNumerator = b0 + b1 * cos1 + b2 * cos2;
  const imagNumerator = -(b1 * sin1 + b2 * sin2);
  const realDenominator = a0 + a1 * cos1 + a2 * cos2;
  const imagDenominator = -(a1 * sin1 + a2 * sin2);
  const numeratorMagnitude = Math.hypot(realNumerator, imagNumerator);
  const denominatorMagnitude = Math.hypot(realDenominator, imagDenominator);

  if (!Number.isFinite(numeratorMagnitude) || !Number.isFinite(denominatorMagnitude) || denominatorMagnitude === 0) {
    return 0;
  }

  return 20 * Math.log10(Math.max(1e-12, numeratorMagnitude / denominatorMagnitude));
}

const DSP_SAMPLE_RATE = 96000;

function computeBiquadCoeffs(filter: Filter): [number, number, number, number, number, number] {
  const maxSafeFreq = 0.49 * DSP_SAMPLE_RATE;
  const freq = clamp(filter.freq, 20, maxSafeFreq);
  const gain = filter.gain;
  const q = Math.max(0.001, filter.q);
  const aValue = 10 ** (gain / 40);
  const omega = (freq * 2 * Math.PI) / DSP_SAMPLE_RATE;
  const sinW = Math.sin(omega);
  const cosW = Math.cos(omega);

  // ponytail: use standard Q-factor for all filter types, matching PEQdB
  const alpha = sinW / (2 * q);

  switch (filter.filter_type) {
    case "LowShelf": {
      const aMinus1 = aValue - 1;
      const aPlus1 = aValue + 1;
      const sqrtAAlpha = 2 * Math.sqrt(aValue) * alpha;
      return [
        aValue * (aPlus1 - aMinus1 * cosW + sqrtAAlpha),
        2 * aValue * (aMinus1 - aPlus1 * cosW),
        aValue * (aPlus1 - aMinus1 * cosW - sqrtAAlpha),
        aPlus1 + aMinus1 * cosW + sqrtAAlpha,
        -2 * (aMinus1 + aPlus1 * cosW),
        aPlus1 + aMinus1 * cosW - sqrtAAlpha,
      ];
    }
    case "HighShelf": {
      const aMinus1 = aValue - 1;
      const aPlus1 = aValue + 1;
      const sqrtAAlpha = 2 * Math.sqrt(aValue) * alpha;
      return [
        aValue * (aPlus1 + aMinus1 * cosW + sqrtAAlpha),
        -2 * aValue * (aMinus1 + aPlus1 * cosW),
        aValue * (aPlus1 + aMinus1 * cosW - sqrtAAlpha),
        aPlus1 - aMinus1 * cosW + sqrtAAlpha,
        2 * (aMinus1 - aPlus1 * cosW),
        aPlus1 - aMinus1 * cosW - sqrtAAlpha,
      ];
    }
    case "HighPass": {
      return [
        (1 + cosW) / 2,
        -(1 + cosW),
        (1 + cosW) / 2,
        1 + alpha,
        -2 * cosW,
        1 - alpha,
      ];
    }
    case "LowPass": {
      return [
        (1 - cosW) / 2,
        1 - cosW,
        (1 - cosW) / 2,
        1 + alpha,
        -2 * cosW,
        1 - alpha,
      ];
    }
    case "Peak":
    default: {
      return [
        1 + alpha * aValue,
        -2 * cosW,
        1 - alpha * aValue,
        1 + alpha / aValue,
        -2 * cosW,
        1 - alpha / aValue,
      ];
    }
  }
}
