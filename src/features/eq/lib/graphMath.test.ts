import { describe, expect, it } from "vitest";
import type { Filter, PEQData } from "@/types";
import {
  filterResponseValues,
  peqResponseAndBandValues,
  peqResponseValues,
  snapFreqToIso,
} from "./graphMath";

import {
  fittedMoondropShelf,
  shelfFreqs,
  slopeShelfDb,
  canonicalShelfDb,
} from "./graphMath.test-support";

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
    expect(
      filterResponseValues(
        { ...filter(0, "Peak"), enabled: false },
        freqs,
        96_000,
      ),
    ).toEqual(new Float32Array(freqs.length));
  });

  it("supports every filter type with finite output", () => {
    for (const filterType of [
      "Peak",
      "LowShelf",
      "HighShelf",
      "HighPass",
      "LowPass",
    ] as const) {
      const response = filterResponseValues(
        filter(0, filterType),
        freqs,
        96_000,
      );
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
    expect(Array.from(combined.subarray(0, freqs.length))).toEqual(
      Array.from(aggregate),
    );

    const firstBand = filterResponseValues(peq.filters[0], freqs, 96_000);
    const secondBand = filterResponseValues(peq.filters[1], freqs, 96_000);
    expect(
      Array.from(combined.subarray(freqs.length, freqs.length * 2)),
    ).toEqual(Array.from(firstBand));
    expect(Array.from(combined.subarray(freqs.length * 2))).toEqual(
      Array.from(secondBand),
    );

    for (let index = 0; index < freqs.length; index++) {
      expect(aggregate[index]).toBeCloseTo(
        -2 + firstBand[index] + secondBand[index],
        5,
      );
    }
  });

  it("matches the fitted Moondrop shelf and keeps canonical fallback unchanged", () => {
    const slope = filterResponseValues(
      fittedMoondropShelf,
      shelfFreqs,
      96_000,
      "MoondropShelfSlope",
    );
    const canonical = filterResponseValues(
      fittedMoondropShelf,
      shelfFreqs,
      96_000,
    );
    shelfFreqs.forEach((_, i) => {
      expect(slope[i]).toBeCloseTo(slopeShelfDb[i], 5);
      expect(canonical[i]).toBeCloseTo(canonicalShelfDb[i], 5);
    });
    const highShelf = filterResponseValues(
      { ...fittedMoondropShelf, filter_type: "HighShelf" },
      shelfFreqs,
      96_000,
      "MoondropShelfSlope",
    );
    highShelf.forEach((db, i) =>
      expect(db).toBeCloseTo(fittedMoondropShelf.gain - slope[i], 5),
    );
    const cut = filterResponseValues(
      { ...fittedMoondropShelf, gain: -fittedMoondropShelf.gain },
      shelfFreqs,
      96_000,
      "MoondropShelfSlope",
    );
    cut.forEach((db, i) => expect(db).toBeCloseTo(-slope[i], 5));
  });

  it("changes only shelves for the Moondrop model", () => {
    for (const kind of ["Peak", "HighPass", "LowPass"] as const) {
      const band = filter(0, kind);
      expect(
        filterResponseValues(band, freqs, 96_000, "MoondropShelfSlope"),
      ).toEqual(filterResponseValues(band, freqs, 96_000, "CanonicalQ"));
    }
  });

  it.each([0, -1, NaN, Infinity, 20])(
    "rejects invalid shelf slope %s instead of drawing identity",
    (q) => {
      const band = { ...fittedMoondropShelf, q };
      const peq = { filters: [band], global_gain: 0 };
      expect(() =>
        filterResponseValues(band, freqs, 96_000, "MoondropShelfSlope"),
      ).toThrow("Invalid Moondrop shelf slope");
      expect(() =>
        peqResponseValues(peq, freqs, false, 96_000, "MoondropShelfSlope"),
      ).toThrow("Invalid Moondrop shelf slope");
      expect(() =>
        peqResponseAndBandValues(
          peq,
          freqs,
          false,
          96_000,
          "MoondropShelfSlope",
        ),
      ).toThrow("Invalid Moondrop shelf slope");
      expect(
        filterResponseValues(
          { ...band, enabled: false },
          freqs,
          96_000,
          "MoondropShelfSlope",
        ),
      ).toEqual(new Float32Array(freqs.length));
    },
  );

  it("evaluates narrow near-DC canonical filters without expanded-quadratic cancellation", () => {
    // RBJ peak magnitude equals its gain at the center, even at low frequency
    // and high Q where the old expanded quadratic lost precision.
    const band = { ...filter(0, "Peak"), freq: 20, q: 100, gain: 12 };
    expect(
      filterResponseValues(band, new Float32Array([20]), 192_000)[0],
    ).toBeCloseTo(12, 5);
  });

  it("snaps to the nearest ISO frequency and keeps the first tie", () => {
    expect(snapFreqToIso(62)).toBe(63);
    expect(snapFreqToIso(45)).toBe(40);
    expect(snapFreqToIso(19)).toBe(20);
  });
});
