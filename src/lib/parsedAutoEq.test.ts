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

  it("accepts run results without a headphone name", () => {
    const result = parseAutoEqResult({
      peq: { globalGain: 0, filters: [filter] },
      warnings: [],
    });

    expect(result.headphone_name).toBeNull();
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

  it("rejects conflicting DTO aliases", () => {
    expect(() => parseAutoEqResult({
      peq: { global_gain: 0, globalGain: -1, filters: [filter] },
      warnings: [],
    })).toThrow(/conflicting global gain/);
    expect(() => parseAutoEqResult({
      peq: {
        global_gain: 0,
        filters: [{ ...filter, type: "PK", filter_type: "LowShelf" }],
      },
      warnings: [],
    })).toThrow(/conflicting type/);
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

  it("rejects filter values outside the Rust Filter's own domain", () => {
    // Rust's Filter is index: u8, freq: u16, and parse_filter_line refuses
    // q <= 0 — this validator was checking only "a finite number", so a
    // device host could hand the editor an index of 1e9, a negative
    // frequency, or a zero Q that the sibling device validator in peq.ts
    // rejects for the same payload.
    const rejects = (patch: Record<string, unknown>, pattern: RegExp) =>
      expect(() => parseAutoEqResult({
        peq: { global_gain: 0, filters: [{ ...filter, ...patch }] },
        headphone_name: null,
        warnings: [],
      })).toThrow(pattern);

    rejects({ index: 256 }, /index must be an integer/);
    rejects({ index: 1e9 }, /index must be an integer/);
    rejects({ index: 2 ** 53 }, /index must be an integer/);
    rejects({ freq: 0 }, /frequency must be an integer/);
    rejects({ freq: -5 }, /frequency must be an integer/);
    rejects({ freq: 100_000 }, /frequency must be an integer/);
    rejects({ freq: 1000.5 }, /frequency must be an integer/);
    rejects({ q: 0 }, /Q must be positive/);
    rejects({ q: -1 }, /Q must be positive/);
  });

  it("bounds the headphone name like parse_autoeq bounds its input", () => {
    expect(() => parseAutoEqResult({
      peq: { global_gain: 0, filters: [filter] },
      headphone_name: "x".repeat(5_000_000),
      warnings: [],
    })).toThrow(/headphone_name must be a string of at most/);
  });
});
