import { describe, it, expect } from "vitest";
import type { DeviceCapabilities } from "../types";
import {
  normalizePeq,
  buildDefaultState,
  DEFAULT_FREQS_10_BAND,
} from "./peq";

const CAPS: DeviceCapabilities = {
  num_bands: 10,
  global_gain_range: [-10, 10],
  band_gain_range: [-12, 12],
  freq_range: [20, 20000],
  q_range: [0.1, 10],
  supported_filter_types: ["Peak", "LowShelf"],
  supports_per_band_enable: true,
  supports_ram_apply: false,
  integer_preamp: false,
};

describe("normalizePeq", () => {
  it("returns a 10-band default state for empty input", () => {
    const peq = normalizePeq({});
    expect(peq.filters.length).toBe(10);
    expect(peq.global_gain).toBe(0);
    // no input filters were supplied, so all bands are left disabled
    expect(peq.filters.every((f) => !f.enabled)).toBe(true);
    expect(peq.filters.map((f) => f.filter_type)).toEqual(
      Array.from({ length: 10 }, () => "Peak"),
    );
    expect(peq.filters.map((f) => f.freq)).toEqual(DEFAULT_FREQS_10_BAND);
  });

  it("normalizes filter type aliases (filter_type and type)", () => {
    expect(normalizePeq({ filters: [{ filter_type: "LS" }] }).filters[0].filter_type).toBe(
      "LowShelf",
    );
    expect(normalizePeq({ filters: [{ type: "LowShelf" }] }).filters[0].filter_type).toBe(
      "LowShelf",
    );
    expect(normalizePeq({ filters: [{ filter_type: "highshelf" }] }).filters[0].filter_type).toBe(
      "HighShelf",
    );
    expect(normalizePeq({ filters: [{ type: "HPF" }] }).filters[0].filter_type).toBe("HighPass");
    expect(normalizePeq({ filters: [{ type: "lpf" }] }).filters[0].filter_type).toBe("LowPass");
    expect(normalizePeq({ filters: [{ filter_type: "PK" }] }).filters[0].filter_type).toBe("Peak");
    // unknown type falls back to Peak
    expect(normalizePeq({ filters: [{ filter_type: "bogus" }] }).filters[0].filter_type).toBe(
      "Peak",
    );
  });

  it("accepts both global_gain and globalGain aliases", () => {
    expect(normalizePeq({ global_gain: -3 }).global_gain).toBe(-3);
    expect(normalizePeq({ globalGain: -3 }).global_gain).toBe(-3);
  });

  it("rounds preamp to an integer when integerPreamp is set", () => {
    expect(normalizePeq({ global_gain: 1.5 }, { integerPreamp: true }).global_gain).toBe(2);
    expect(normalizePeq({ global_gain: 1.4 }, { integerPreamp: true }).global_gain).toBe(1);
    expect(normalizePeq({ global_gain: -1.6 }, { integerPreamp: true }).global_gain).toBe(-2);
    expect(normalizePeq({ global_gain: -1.4 }, { integerPreamp: true }).global_gain).toBe(-1);
    // without integerPreamp the fractional value is preserved
    expect(normalizePeq({ global_gain: 1.5 }).global_gain).toBe(1.5);
  });

  it("clamps values to device capabilities", () => {
    const peq = normalizePeq(
      {
        filters: [{ freq: 5, gain: 100, q: 0.01, filter_type: "HighPass" }],
      },
      { capabilities: CAPS },
    );
    const f = peq.filters[0];
    expect(f.freq).toBe(20); // clamped to range and rounded
    expect(f.gain).toBe(12); // band_gain_range upper bound
    expect(f.q).toBe(0.1); // q_range lower bound
    // HighPass is not supported -> mapped to supported_filter_types[0]
    expect(f.filter_type).toBe("Peak");
  });

  it("rounds clamped frequencies to integers", () => {
    const peq = normalizePeq({ filters: [{ freq: 80.6 }] }, { capabilities: CAPS });
    expect(peq.filters[0].freq).toBe(81);
  });

  it("clamps global gain to the capability range", () => {
    const peq = normalizePeq({ global_gain: 99 }, { capabilities: CAPS });
    expect(peq.global_gain).toBe(10);
    const low = normalizePeq({ global_gain: -99 }, { capabilities: CAPS });
    expect(low.global_gain).toBe(-10);
  });

  it("pads bands beyond num_bands as disabled (mirrors Rust max-band clamping)", () => {
    const peq = normalizePeq({ filters: [{}, {}] }, {
      capabilities: { ...CAPS, num_bands: 1 },
    });
    expect(peq.filters[0].enabled).toBe(true);
    expect(peq.filters.slice(1).every((f) => !f.enabled)).toBe(true);
  });

  it("enables loaded filters only when requested for non-first bands", () => {
    // band 3 has no explicit enabled flag; default fallback is disabled
    expect(normalizePeq({ filters: [{}, {}, {}, {}] }).filters[3].enabled).toBe(false);
    expect(
      normalizePeq({ filters: [{}, {}, {}, {}] }, { enableLoadedFilters: true }).filters[3]
        .enabled,
    ).toBe(true);
  });
});
