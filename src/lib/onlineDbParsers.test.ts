import { describe, expect, it } from "vitest";
import {
  parseOnlineCurves,
  parseOnlineCurveValues,
  parseOnlineFrequencies,
  parseOnlineManifest,
} from "./onlineDbParsers";

const manifestFixture = {
  iems: {
    "source::Example One": { price: 99, quality: "high" },
    "source::Example Two": { price: null },
  },
};

const curvesFixture = {
  meta: { frequencies: [20, 1000, 20000] },
  curves: {
    "source::Example One": { d: [1, 2, 3] },
    "source::Example Two": { d: [-1, 0, 1] },
  },
};

describe("parseOnlineManifest", () => {
  it("returns validated IDs and finite or null prices", () => {
    expect(parseOnlineManifest(manifestFixture)).toEqual({
      iems: {
        "source::Example One": { price: 99 },
        "source::Example Two": { price: null },
      },
    });
  });

  it("rejects malformed details, IDs, and prices", () => {
    expect(() => parseOnlineManifest({ iems: { "missing-separator": { price: 1 } } }))
      .toThrow(/device ID/);
    expect(() => parseOnlineManifest({ iems: { "source::Device": null } }))
      .toThrow(/details/);
    expect(() => parseOnlineManifest({ iems: { "source::Device": { price: Infinity } } }))
      .toThrow(/price/);
  });
});

describe("parseOnlineCurves", () => {
  it("returns a fully validated frequency grid and curve values", () => {
    expect(parseOnlineCurves(curvesFixture)).toEqual({
      frequencies: [20, 1000, 20000],
      curves: {
        "source::Example One": [1, 2, 3],
        "source::Example Two": [-1, 0, 1],
      },
    });
  });

  it("rejects unordered, non-finite, and out-of-range frequencies", () => {
    expect(() => parseOnlineFrequencies([20, 20])).toThrow(/strictly increasing/);
    expect(() => parseOnlineFrequencies([20, Number.NaN])).toThrow(/finite/);
    expect(() => parseOnlineFrequencies([20, 20001])).toThrow(/within/);
  });

  it("rejects curves with mismatched lengths or non-finite values", () => {
    expect(() => parseOnlineCurves({
      meta: { frequencies: [20, 1000] },
      curves: { "source::Device": { d: [1] } },
    })).toThrow(/must contain 2 values/);

    expect(() => parseOnlineCurveValues([0, Number.NaN], 2)).toThrow(/finite/);
  });
});
