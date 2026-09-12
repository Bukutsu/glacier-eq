// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  getFilterModeMeta,
  getFilterTimeCurve,
  getFilterFreqCurve,
  lerpCurve,
  DAC_FILTER_METAS,
  DEFAULT_POINTS,
} from "./dacFilterModes";

describe("dacFilterModes", () => {
  it("generates FAST-LL time curve with zero pre-ringing", () => {
    const meta = getFilterModeMeta("FAST-LL");
    expect(meta.badge).toBe("Zero Pre-Ringing");
    expect(meta.phaseType).toBe("minimum");

    const curve = getFilterTimeCurve("FAST-LL", DEFAULT_POINTS);
    expect(curve.length).toBe(DEFAULT_POINTS);

    // Midpoint is t = 0
    const centerIdx = Math.floor(DEFAULT_POINTS / 2);
    expect(curve[centerIdx]).toBeCloseTo(1.0, 1);

    // Negative points before t = -0.05 ms should be exactly 0
    for (let i = 0; i < centerIdx - 10; i++) {
      expect(curve[i]).toBe(0);
    }
  });

  it("generates FAST-PC time curve with symmetric ringing", () => {
    const curve = getFilterTimeCurve("FAST-PC", DEFAULT_POINTS);
    const centerIdx = Math.floor(DEFAULT_POINTS / 2);

    // Check pre-ringing exists on the left
    let hasPreRinging = false;
    for (let i = 0; i < centerIdx - 5; i++) {
      if (Math.abs(curve[i]) > 0.02) hasPreRinging = true;
    }
    expect(hasPreRinging).toBe(true);

    // Check symmetry: curve[center - k] should be very close to curve[center + k]
    for (let k = 5; k < 30; k++) {
      expect(curve[centerIdx - k]).toBeCloseTo(curve[centerIdx + k], 1);
    }
  });

  it("generates NON-OS time curve with zero ringing", () => {
    const curve = getFilterTimeCurve("NON-OS", DEFAULT_POINTS);
    const centerIdx = Math.floor(DEFAULT_POINTS / 2);

    expect(curve[centerIdx]).toBe(1.0);
    // Outside the center step, all points must be 0
    expect(curve[centerIdx - 10]).toBe(0);
    expect(curve[centerIdx + 10]).toBe(0);
  });

  it("generates frequency roll-off curves properly", () => {
    const fastCurve = getFilterFreqCurve("FAST-PC", DEFAULT_POINTS);
    const slowCurve = getFilterFreqCurve("Slow-PC", DEFAULT_POINTS);
    const nosCurve = getFilterFreqCurve("NON-OS", DEFAULT_POINTS);

    // At 10 kHz (index 0)
    expect(fastCurve[0]).toBe(0);
    expect(slowCurve[0]).toBe(0);
    expect(nosCurve[0]).toBeCloseTo(-0.63, 1);

    // At 24 kHz (last index)
    expect(fastCurve[DEFAULT_POINTS - 1]).toBe(-60);
    expect(slowCurve[DEFAULT_POINTS - 1]).toBeLessThan(-10);
    expect(nosCurve[DEFAULT_POINTS - 1]).toBeGreaterThan(-6);
  });

  it("smoothly lerps between curves", () => {
    const a = new Float32Array([0, 10, 20]);
    const b = new Float32Array([10, 20, 30]);

    const mid = lerpCurve(a, b, 0.5);
    expect(mid[0]).toBe(5);
    expect(mid[1]).toBe(15);
    expect(mid[2]).toBe(25);
  });

  it("has complete metadata for all declared modes", () => {
    for (const [key, meta] of Object.entries(DAC_FILTER_METAS)) {
      expect(meta.name.length).toBeGreaterThan(0);
      expect(meta.badge.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });
});
