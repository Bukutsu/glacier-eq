// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

export interface FilterModeMeta {
  name: string;
  tag: string;
  badge: string;
  description: string;
  phaseType: "linear" | "minimum" | "nos";
  rollOff: "fast" | "slow" | "none";
}

export const DAC_FILTER_METAS: Record<string, FilterModeMeta> = {
  "FAST-LL": {
    name: "Fast Roll-Off, Low Latency",
    tag: "Minimum Phase · Fast",
    badge: "Zero Pre-Ringing",
    description: "Eliminates unnatural pre-echo for punchy, authentic transient attack on percussion and strings.",
    phaseType: "minimum",
    rollOff: "fast",
  },
  "FAST-PC": {
    name: "Fast Roll-Off, Phase Compensated",
    tag: "Linear Phase · Fast",
    badge: "Symmetric Phase",
    description: "Preserves perfect linear phase alignment across all frequencies for holographic spatial imaging.",
    phaseType: "linear",
    rollOff: "fast",
  },
  "Slow-LL": {
    name: "Slow Roll-Off, Low Latency",
    tag: "Minimum Phase · Slow",
    badge: "Gentle Decay",
    description: "Gentle high-frequency attenuation with zero pre-ringing for a warm, relaxed presentation.",
    phaseType: "minimum",
    rollOff: "slow",
  },
  "Slow-PC": {
    name: "Slow Roll-Off, Phase Compensated",
    tag: "Linear Phase · Slow",
    badge: "Soft Linear",
    description: "Linear phase with a softer roll-off slope to tame aggressive high-frequency harshness.",
    phaseType: "linear",
    rollOff: "slow",
  },
  "NON-OS": {
    name: "Non-Oversampling (Direct NOS)",
    tag: "Direct Conversion",
    badge: "Zero Ringing",
    description: "Bypasses the digital interpolation filter entirely for raw zero-order-hold analog conversion.",
    phaseType: "nos",
    rollOff: "none",
  },
};

export const DEFAULT_FILTER_META: FilterModeMeta = {
  name: "Standard Interpolation",
  tag: "Reconstruction Filter",
  badge: "Standard",
  description: "Digital reconstruction filter applied by the DAC hardware during conversion.",
  phaseType: "linear",
  rollOff: "fast",
};

export function getFilterModeMeta(mode: string): FilterModeMeta {
  return DAC_FILTER_METAS[mode] ?? DEFAULT_FILTER_META;
}

// ─── Mathematical Simulation for Real Graph Plotting ──────────────────────────

function sinc(x: number): number {
  if (Math.abs(x) < 1e-6) return 1.0;
  const pix = Math.PI * x;
  return Math.sin(pix) / pix;
}

/**
 * Generates high-resolution impulse response data (Time Domain).
 * X: time in milliseconds [-0.8 ms, +0.8 ms]
 * Y: normalized amplitude [-0.5, 1.0]
 */
export function getFilterTimeData(mode: string): [number[], number[]] {
  const meta = getFilterModeMeta(mode);
  const samplePeriodMs = 1 / 48; // 48 kHz standard base (~0.02083 ms)
  const steps = 160;
  const startMs = -0.8;
  const endMs = 0.8;
  const stepMs = (endMs - startMs) / steps;

  const times: number[] = [];
  const amplitudes: number[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = Number((startMs + i * stepMs).toFixed(4));
    const n = t / samplePeriodMs;
    let y = 0;

    switch (meta.phaseType) {
      case "nos":
        // Zero-Order Hold rectangular pulse
        y = Math.abs(t) <= samplePeriodMs * 0.75 ? 1.0 : 0.0;
        break;

      case "minimum":
        if (t < -0.01) {
          y = 0.0; // ZERO pre-ringing!
        } else if (meta.rollOff === "fast") {
          y = sinc(n) * Math.exp(-0.065 * n);
        } else {
          y = sinc(0.65 * n) * Math.exp(-0.16 * n);
        }
        break;

      case "linear":
      default:
        if (meta.rollOff === "fast") {
          y = sinc(n) * Math.exp(-0.0032 * n * n);
        } else {
          y = sinc(0.65 * n) * Math.exp(-0.022 * n * n);
        }
        break;
    }

    times.push(t);
    amplitudes.push(Number(y.toFixed(4)));
  }

  return [times, amplitudes];
}

/**
 * Generates high-resolution frequency roll-off curve data (Frequency Domain).
 * X: frequency in kHz [10.0 kHz, 24.0 kHz]
 * Y: attenuation in dB [-60 dB, 0 dB]
 */
export function getFilterFreqData(mode: string): [number[], number[]] {
  const meta = getFilterModeMeta(mode);
  const steps = 140;
  const startKhz = 10.0;
  const endKhz = 24.0;
  const stepKhz = (endKhz - startKhz) / steps;

  const freqs: number[] = [];
  const dbs: number[] = [];

  for (let i = 0; i <= steps; i++) {
    const f = Number((startKhz + i * stepKhz).toFixed(2));
    let db = 0;

    switch (meta.rollOff) {
      case "none": {
        // NOS Sinc envelope: 20 * log10(|sinc(f / 48)|)
        const sincVal = Math.abs(sinc(f / 48));
        db = sincVal > 1e-4 ? 20 * Math.log10(sincVal) : -40;
        break;
      }

      case "slow": {
        // Gentle roll-off starting around 15 kHz, -3 dB at 20 kHz, -18 dB at 22 kHz, -32 dB at 24 kHz
        if (f <= 15) {
          db = 0;
        } else {
          const delta = f - 15;
          db = -Math.pow(delta / 2.8, 2.2);
        }
        break;
      }

      case "fast":
      default: {
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
    }

    freqs.push(f);
    dbs.push(Number(Math.max(-60, db).toFixed(2)));
  }

  return [freqs, dbs];
}
