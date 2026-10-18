import { describe, expect, it } from "vitest";
import {
  filterResponseValues,
  peqResponseValues,
  peqResponseAndBandValues,
} from "./graph";
import {
  fittedMoondropShelf,
  shelfFreqs,
  slopeShelfDb,
} from "./graphMath.test-support";

describe("async graph wrappers", () => {
  it.each([Array.from(shelfFreqs), shelfFreqs])(
    "passes the model to filter, aggregate, and per-band calculations",
    async (freqs) => {
      const peq = { filters: [fittedMoondropShelf], global_gain: -2 };
      const band = await filterResponseValues(
        fittedMoondropShelf,
        freqs,
        96_000,
        "MoondropShelfSlope",
      );
      const aggregate = await peqResponseValues(
        peq,
        freqs,
        true,
        96_000,
        "MoondropShelfSlope",
      );
      const combined = await peqResponseAndBandValues(
        peq,
        freqs,
        true,
        96_000,
        "MoondropShelfSlope",
      );
      band.forEach((db, i) => {
        expect(db).toBeCloseTo(slopeShelfDb[i], 5);
        expect(aggregate[i]).toBeCloseTo(db - 2, 5);
      });
      expect(combined.subarray(0, freqs.length)).toEqual(aggregate);
      expect(combined.subarray(freqs.length)).toEqual(band);
    },
  );

  it("rejects invalid slope as an async boundary error", async () => {
    const band = { ...fittedMoondropShelf, q: 20 };
    await expect(
      filterResponseValues(band, shelfFreqs, 96_000, "MoondropShelfSlope"),
    ).rejects.toThrow("Invalid Moondrop shelf slope");
    await expect(
      peqResponseValues(
        { filters: [band], global_gain: 0 },
        shelfFreqs,
        false,
        96_000,
        "MoondropShelfSlope",
      ),
    ).rejects.toThrow("Invalid Moondrop shelf slope");
  });
});
