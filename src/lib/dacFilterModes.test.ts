// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import { getFilterModeInfo, DAC_FILTER_MODES } from "./dacFilterModes";

describe("dacFilterModes", () => {
  it("resolves FAST-LL as Low Latency with zero pre-ringing", () => {
    const info = getFilterModeInfo("FAST-LL");
    expect(info.badge).toBe("Zero Pre-Ringing");
    expect(info.tag).toContain("Low Latency");
    expect(info.path).toContain("M 4 22 L 78 22");
  });

  it("resolves FAST-PC as Phase Linear with symmetric phase", () => {
    const info = getFilterModeInfo("FAST-PC");
    expect(info.badge).toBe("Symmetric Phase");
    expect(info.tag).toContain("Phase Linear");
  });

  it("resolves Slow-LL as Minimum Phase with gentle decay", () => {
    const info = getFilterModeInfo("Slow-LL");
    expect(info.badge).toBe("Gentle Decay");
    expect(info.tag).toContain("Minimum Phase");
  });

  it("resolves Slow-PC as Linear Phase with soft linear badge", () => {
    const info = getFilterModeInfo("Slow-PC");
    expect(info.badge).toBe("Soft Linear");
    expect(info.tag).toContain("Linear Phase");
  });

  it("resolves NON-OS as Direct NOS with square pulse", () => {
    const info = getFilterModeInfo("NON-OS");
    expect(info.badge).toBe("Direct NOS");
    expect(info.tag).toContain("Non-Oversampling");
    expect(info.path).toContain("L 74 6 L 86 6");
  });

  it("falls back gracefully for unknown modes", () => {
    const info = getFilterModeInfo("CUSTOM_FILTER");
    expect(info.badge).toBe("Reconstruction");
    expect(info.tag).toBe("Standard Interpolation");
  });

  it("provides valid paths for all declared filter modes", () => {
    for (const [key, mode] of Object.entries(DAC_FILTER_MODES)) {
      expect(mode.path, `Valid path for ${key}`).toMatch(/^M\s/);
      expect(mode.badge.length).toBeGreaterThan(0);
      expect(mode.description.length).toBeGreaterThan(0);
    }
  });
});
