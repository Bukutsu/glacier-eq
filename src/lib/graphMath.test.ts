import { describe, expect, it } from "vitest";
import type { Filter, PEQData } from "../types";
import {
  filterResponseValues,
  peqResponseAndBandValues,
  peqResponseValues,
  snapFreqToIso,
} from "./graphMath";

const freqs = new Float32Array([20, 100, 1000, 10_000, 20_000]);

function filter(index: number, filterType: Filter["filter_type"]): Filter {
  return {
    index,
    enabled: true,
    filter_type: filterType,
    freq: 1000,
    gain: 6,
    q: 0.707,
  };
}

describe("graph math", () => {
  it("returns zero response for disabled filters", () => {
    expect(filterResponseValues({ ...filter(0, "Peak"), enabled: false }, freqs, 96_000))
      .toEqual(new Float32Array(freqs.length));
  });

  it("supports every filter type with finite output", () => {
    for (const filterType of ["Peak", "LowShelf", "HighShelf", "HighPass", "LowPass"] as const) {
      const response = filterResponseValues(filter(0, filterType), freqs, 96_000);
      expect(Array.from(response).every(Number.isFinite)).toBe(true);
    }
  });

  it("keeps aggregate and per-band responses consistent", () => {
    const peq: PEQData = {
      global_gain: -2,
      filters: [
        filter(0, "Peak"),
        { ...filter(1, "LowShelf"), gain: -3, freq: 200 },
        { ...filter(2, "HighPass"), enabled: false },
      ],
    };
    const aggregate = peqResponseValues(peq, freqs, true, 96_000);
    const combined = peqResponseAndBandValues(peq, freqs, true, 96_000);

    expect(combined.length).toBe(freqs.length * 3);
    expect(Array.from(combined.subarray(0, freqs.length))).toEqual(Array.from(aggregate));

    const firstBand = filterResponseValues(peq.filters[0], freqs, 96_000);
    const secondBand = filterResponseValues(peq.filters[1], freqs, 96_000);
    expect(Array.from(combined.subarray(freqs.length, freqs.length * 2))).toEqual(Array.from(firstBand));
    expect(Array.from(combined.subarray(freqs.length * 2))).toEqual(Array.from(secondBand));

    for (let index = 0; index < freqs.length; index++) {
      expect(aggregate[index]).toBeCloseTo(-2 + firstBand[index] + secondBand[index], 5);
    }
  });

  it("snaps to the nearest ISO frequency and keeps the first tie", () => {
    expect(snapFreqToIso(62)).toBe(63);
    expect(snapFreqToIso(45)).toBe(40);
    expect(snapFreqToIso(19)).toBe(20);
  });
});
