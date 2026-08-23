import { describe, expect, it } from "vitest";
import { parseAutoEqResult } from "./parsedAutoEq";

const filter = {
  index: 0,
  enabled: true,
  type: "PK",
  freq: 1000,
  gain: -2,
  q: 1.2,
};

describe("parseAutoEqResult", () => {
  it("normalizes Rust's serialized field aliases", () => {
    const result = parseAutoEqResult({
      peq: { globalGain: -1, filters: [filter] },
      headphone_name: "Example",
      warnings: [],
    });

    expect(result.peq.global_gain).toBe(-1);
    expect(result.peq.filters[0]).toEqual({
      index: 0,
      enabled: true,
      filter_type: "Peak",
      freq: 1000,
      gain: -2,
      q: 1.2,
    });
  });

  it.each([
    ["LSQ", "LowShelf"],
    ["HSQ", "HighShelf"],
    ["HP", "HighPass"],
    ["LP", "LowPass"],
  ] as const)("maps Rust type %s to %s", (rustType, frontendType) => {
    const result = parseAutoEqResult({
      peq: { global_gain: 0, filters: [{ ...filter, type: rustType }] },
      headphone_name: null,
      warnings: [],
    });

    expect(result.peq.filters[0].filter_type).toBe(frontendType);
  });

  it("accepts the frontend filter_type field too", () => {
    const result = parseAutoEqResult({
      peq: {
        global_gain: 0,
        filters: [{ ...filter, type: undefined, filter_type: "LowShelf" }],
      },
      headphone_name: null,
      warnings: ["Adjusted filter"],
    });

    expect(result.peq.filters[0].filter_type).toBe("LowShelf");
  });

  it("rejects malformed filter fields", () => {
    expect(() => parseAutoEqResult({
      peq: { global_gain: 0, filters: [{ ...filter, gain: Number.NaN }] },
      headphone_name: null,
      warnings: [],
    })).toThrow(/gain must be finite/);

    expect(() => parseAutoEqResult({
      peq: { global_gain: 0, filters: [{ ...filter, type: "Unknown" }] },
      headphone_name: null,
      warnings: [],
    })).toThrow(/unknown type/);
  });
});
