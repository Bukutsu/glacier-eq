import { describe, expect, it } from "vitest";
import type { PEQData } from "../types";
import { constrainPeqToBandCount } from "./rpc";

function peqWithBands(count: number): PEQData {
  return {
    global_gain: -2,
    filters: Array.from({ length: count }, (_, index) => ({
      index,
      enabled: true,
      filter_type: "Peak",
      freq: 100 + index,
      gain: index,
      q: 0.7,
    })),
  };
}

describe("constrainPeqToBandCount", () => {
  it("truncates UI slots beyond the device band count", () => {
    const constrained = constrainPeqToBandCount(peqWithBands(10), 5);

    expect(constrained.filters).toHaveLength(5);
    expect(constrained.filters.map((filter) => filter.freq)).toEqual([100, 101, 102, 103, 104]);
    expect(constrained.global_gain).toBe(-2);
  });

  it("pads missing slots with safe disabled filters", () => {
    const constrained = constrainPeqToBandCount(peqWithBands(2), 5);

    expect(constrained.filters).toHaveLength(5);
    expect(constrained.filters.slice(2)).toEqual([
      { index: 2, enabled: false, filter_type: "Peak", freq: 1000, gain: 0, q: 1 },
      { index: 3, enabled: false, filter_type: "Peak", freq: 1000, gain: 0, q: 1 },
      { index: 4, enabled: false, filter_type: "Peak", freq: 1000, gain: 0, q: 1 },
    ]);
  });
});
