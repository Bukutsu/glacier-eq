import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { initSync, run_autoeq } from "../../../src/wasm_pkg/glacier_core";

beforeAll(() => {
  initSync({ module: readFileSync(new URL("../../../src/wasm_pkg/glacier_core_bg.wasm", import.meta.url)) });
});

describe("low-band AutoEQ over the real WASM bridge", () => {
  it.each([1, 3, 5])("fits %i bands within the JA11 profile", n => {
    const measurement = [[20, 0], [100, 0], [500, 0], [1000, 0], [3000, 0], [10000, 0], [20000, 0]];
    const target = [[20, 4], [100, 4], [500, -3], [1000, 0], [3000, 4], [10000, -2], [20000, -2]];
    const result = run_autoeq(measurement, target, n, 200, "none", 48000, 0x2972, 0x0102);
    // The bridge pads to five hardware slots with disabled, flat bands.
    expect(result.peq.filters).toHaveLength(5);
    expect(result.peq.filters.filter((filter: { enabled: boolean }) => filter.enabled)).toHaveLength(n);
    expect(Number.isFinite(result.peq.globalGain)).toBe(true);
    for (const filter of result.peq.filters) {
      expect(Number.isFinite(filter.gain)).toBe(true);
      expect(filter.gain).toBeGreaterThanOrEqual(-12);
      expect(filter.gain).toBeLessThanOrEqual(12);
      expect(filter.q).toBeGreaterThan(0);
    }
  });
});
