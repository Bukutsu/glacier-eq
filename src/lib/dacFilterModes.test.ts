// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  getFilterModeMeta,
  getFilterTimeData,
  getFilterFreqData,
  DAC_FILTER_METAS,
} from "./dacFilterModes";

describe("dacFilterModes", () => {
  it("resolves FAST-LL metadata and enforces zero pre-ringing in time data", () => {
    const meta = getFilterModeMeta("FAST-LL");
    expect(meta.badge).toBe("Zero Pre-Ringing");
    expect(meta.phaseType).toBe("minimum");

    const [times, amps] = getFilterTimeData("FAST-LL");
    expect(times.length).toBe(amps.length);
    // At t = 0 (middle index), peak amplitude should be near 1.0
    const centerIdx = times.findIndex((t) => Math.abs(t) < 0.01);
    expect(amps[centerIdx]).toBeCloseTo(1.0, 1);

    // Negative time points must have 0 amplitude (zero pre-ringing)
    const preRingingPoints = amps.filter((_, idx) => times[idx] < -0.05);
    for (const val of preRingingPoints) {
      expect(val).toBe(0.0);
    }
  });

  it("resolves FAST-PC metadata and verifies symmetric pre- and post-ringing", () => {
    const meta = getFilterModeMeta("FAST-PC");
    expect(meta.badge).toBe("Symmetric Phase");
    expect(meta.phaseType).toBe("linear");

    const [times, amps] = getFilterTimeData("FAST-PC");
    // Pre-ringing exists for linear phase
    const preRinging = amps.filter((val, idx) => times[idx] < -0.05 && Math.abs(val) > 0.01);
    expect(preRinging.length).toBeGreaterThan(0);
  });

  it("resolves NON-OS and verifies clean step pulse without ringing", () => {
    const meta = getFilterModeMeta("NON-OS");
    expect(meta.badge).toBe("Zero Ringing");
    expect(meta.phaseType).toBe("nos");

    const [times, amps] = getFilterTimeData("NON-OS");
    // Pulse is only active near 0
    const farPoints = amps.filter((_, idx) => Math.abs(times[idx]) > 0.05);
    for (const val of farPoints) {
      expect(val).toBe(0.0);
    }
  });

  it("generates correct frequency roll-off profiles", () => {
    const [fastFreqs, fastDbs] = getFilterFreqData("FAST-PC");
    const [slowFreqs, slowDbs] = getFilterFreqData("Slow-PC");
    const [nosFreqs, nosDbs] = getFilterFreqData("NON-OS");

    // All should be ~0 dB at 10 kHz
    expect(fastDbs[0]).toBe(0);
    expect(slowDbs[0]).toBe(0);
    expect(nosDbs[0]).toBeCloseTo(-0.63, 1);

    // At 23 kHz (past Nyquist of 44.1k/48k band):
    const idx23 = fastFreqs.findIndex((f) => f >= 23);
    expect(fastDbs[idx23]).toBeLessThan(-50); // Brickwall steep
    expect(slowDbs[idx23]).toBeGreaterThan(-45); // Gentle slope
    expect(nosDbs[idx23]).toBeGreaterThan(-5); // Mild NOS sinc roll-off
  });

  it("handles unknown fallback mode gracefully", () => {
    const meta = getFilterModeMeta("UNKNOWN");
    expect(meta.name).toBe("Standard Interpolation");
  });

  it("has complete metadata for all declared filter modes", () => {
    for (const [key, meta] of Object.entries(DAC_FILTER_METAS)) {
      expect(meta.name.length).toBeGreaterThan(0);
      expect(meta.badge.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });
});
