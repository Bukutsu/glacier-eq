// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

export interface FilterModeMeta {
  name: string;
  tag: string;
  badge: string;
  sound: string;
  description: string;
  phaseType: "linear" | "minimum" | "nos";
  rollOff: "fast" | "slow" | "none";
}

export const DAC_FILTER_METAS: Record<string, FilterModeMeta> = {
  "FAST-LL": {
    name: "Fast roll-off, low latency",
    tag: "Minimum phase · fast",
    badge: "No pre-ringing",
    sound: "Minimum phase",
    description: "Fast roll-off with minimum phase and no pre-ringing.",
    phaseType: "minimum",
    rollOff: "fast",
  },
  "FAST-PC": {
    name: "Fast roll-off, phase compensated",
    tag: "Linear phase · fast",
    badge: "Symmetric",
    sound: "Linear phase",
    description: "Fast roll-off with linear phase and a symmetric impulse response.",
    phaseType: "linear",
    rollOff: "fast",
  },
  "Slow-LL": {
    name: "Slow roll-off, low latency",
    tag: "Minimum phase · slow",
    badge: "Gentle slope",
    sound: "Minimum phase",
    description: "Slow roll-off with minimum phase and no pre-ringing.",
    phaseType: "minimum",
    rollOff: "slow",
  },
  "Slow-PC": {
    name: "Slow roll-off, phase compensated",
    tag: "Linear phase · slow",
    badge: "Soft treble",
    sound: "Linear phase",
    description: "Slow roll-off with linear phase and a symmetric impulse response.",
    phaseType: "linear",
    rollOff: "slow",
  },
  "NON-OS": {
    name: "Non-oversampling (NOS)",
    tag: "Direct conversion",
    badge: "Zero ringing",
    sound: "Direct NOS",
    description: "Bypasses digital interpolation, with a gradual reduction in high-frequency output.",
    phaseType: "nos",
    rollOff: "none",
  },
};

export const DEFAULT_FILTER_META: FilterModeMeta = {
  name: "Standard interpolation",
  tag: "Reconstruction filter",
  badge: "Standard",
  sound: "Default",
  description: "Standard digital filter applied by the hardware to convert samples to analog.",
  phaseType: "linear",
  rollOff: "fast",
};

export function getFilterModeMeta(mode: string): FilterModeMeta {
  return DAC_FILTER_METAS[mode] ?? DEFAULT_FILTER_META;
}

// ─── Mathematical Simulation for Canvas Oscilloscope ──────────────────────────

export const TIME_RANGE_MS = [-0.8, 0.8] as const;
export const FREQ_RANGE_KHZ = [10.0, 24.0] as const;
export const DEFAULT_POINTS = 181;

function sinc(x: number): number {
  if (Math.abs(x) < 1e-6) return 1.0;
  const pix = Math.PI * x;
  return Math.sin(pix) / pix;
}

/**
 * Generates an array of normalized amplitude values for Time Domain [-0.8ms, +0.8ms].
 * Peak at t = 0 is normalized to 1.0.
 */
export function getFilterTimeCurve(mode: string, length = DEFAULT_POINTS): Float32Array {
  const meta = getFilterModeMeta(mode);
  const samplePeriodMs = 1 / 48; // 48 kHz standard base (~0.02083 ms)
  const [startMs, endMs] = TIME_RANGE_MS;
  const stepMs = (endMs - startMs) / (length - 1);

  const curve = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const t = startMs + i * stepMs;
    const n = t / samplePeriodMs;
    let y = 0;

    switch (meta.phaseType) {
      case "nos":
        // Zero-order hold sample step pulse
        y = Math.abs(t) <= samplePeriodMs * 0.75 ? 1.0 : 0.0;
        break;

      case "minimum":
        if (t < -0.015) {
          y = 0.0; // ZERO pre-ringing!
        } else if (meta.rollOff === "fast") {
          y = sinc(n) * Math.exp(-0.065 * n);
        } else {
          y = sinc(0.65 * n) * Math.exp(-0.16 * n);
        }
        break;

      case "linear":
        if (meta.rollOff === "fast") {
          y = sinc(n) * Math.exp(-0.0032 * n * n);
        } else {
          y = sinc(0.65 * n) * Math.exp(-0.022 * n * n);
        }
        break;

      default: {
        // Not a fall-through to linear: a new phase type used to render a
        // linear-phase impulse bit-identically to FAST-PC, with nothing to
        // say so.
        const exhaustive: never = meta.phaseType;
        throw new Error(`unhandled filter phase type: ${exhaustive}`);
      }
    }

    curve[i] = y;
  }

  return curve;
}

/**
 * Generates an array of attenuation dB values for Frequency Domain [10.0kHz, 24.0kHz].
 * Range: [-60 dB, 0 dB]
 */
export function getFilterFreqCurve(mode: string, length = DEFAULT_POINTS): Float32Array {
  const meta = getFilterModeMeta(mode);
  const [startKhz, endKhz] = FREQ_RANGE_KHZ;
  const stepKhz = (endKhz - startKhz) / (length - 1);

  const curve = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const f = startKhz + i * stepKhz;
    let db = 0;

    switch (meta.rollOff) {
      case "none": {
        // NOS Sinc envelope: 20 * log10(|sinc(f / 48)|)
        const sincVal = Math.abs(sinc(f / 48));
        db = sincVal > 1e-4 ? 20 * Math.log10(sincVal) : -40;
        break;
      }

      case "slow": {
        // Gentle roll-off starting around 15 kHz
        if (f <= 15) {
          db = 0;
        } else {
          const delta = f - 15;
          db = -Math.pow(delta / 2.8, 2.2);
        }
        break;
      }

      case "fast": {
        // Brick-wall steep filter: flat up to 20 kHz, steep drop to -60 dB by 22.05 kHz
        if (f <= 20) {
          db = 0;
        } else if (f <= 22.05) {
          const norm = (f - 20) / 2.05;
          db = -Math.pow(norm, 2.5) * 60;
        } else {
          db = -60;
        }
        break;
      }

      default: {
        // Not a fall-through to fast: a new roll-off used to render a
        // brick-wall response, bit-identically to FAST, with nothing to say so.
        const exhaustive: never = meta.rollOff;
        throw new Error(`unhandled filter roll-off: ${exhaustive}`);
      }
    }

    curve[i] = Math.max(-60, db);
  }

  return curve;
}

/**
 * Smoothly interpolates between two curves point-by-point.
 */
export function lerpCurve(a: Float32Array, b: Float32Array, t: number): Float32Array {
  const len = Math.min(a.length, b.length);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = a[i] + (b[i] - a[i]) * t;
  }
  return out;
}
