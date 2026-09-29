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

describe("remote payload guards", () => {
  // These are the boundary between a remote JSON document and the local curve
  // cache, and each guard below existed with no fixture reaching it: a 34-mutant
  // sweep found all six survived. The reserved prefix is the one that matters
  // most — generationKey() strips "meta:" when building a cache key, so an id
  // of "meta:A::X" and one of "A::X" collide and the download silently
  // overwrites one curve with another.
  it("rejects a device id in the reserved meta: namespace", () => {
    expect(() => parseOnlineManifest({ iems: { "meta:source::Device": { price: 1 } } }))
      .toThrow(/unusable device ID/);
    expect(() => parseOnlineCurves({
      meta: { frequencies: [20, 1000] },
      curves: { "meta:source::Device": { d: [0, 0] } },
    })).toThrow(/unusable device ID/);
  });

  it("rejects an over-long device id", () => {
    const long = `${"s".repeat(2_000)}::Device`;
    expect(() => parseOnlineManifest({ iems: { [long]: { price: 1 } } }))
      .toThrow(/unusable device ID/);
  });

  it("rejects a device id with an empty source or name segment", () => {
    expect(() => parseOnlineManifest({ iems: { " ::Device": { price: 1 } } }))
      .toThrow(/must contain a source and name/);
    expect(() => parseOnlineManifest({ iems: { "source:: ": { price: 1 } } }))
      .toThrow(/must contain a source and name/);
  });

  it("rejects an empty or blank device id", () => {
    expect(() => parseOnlineManifest({ iems: { "   ": { price: 1 } } }))
      .toThrow(/unusable device ID/);
  });

  it("rejects an empty manifest or an empty curve set", () => {
    expect(() => parseOnlineManifest({ iems: {} })).toThrow(/between 1 and/);
    expect(() => parseOnlineCurves({
      meta: { frequencies: [20, 1000] },
      curves: {},
    })).toThrow(/between 1 and/);
  });
});
