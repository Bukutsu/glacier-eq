import assert from "node:assert/strict";
import { test } from "node:test";

import {
  modelKey,
  rankMeasurements,
} from "../src/features/traces/lib/measurementQuality.ts";

const freqs = [20, 100, 200, 500, 1000, 2000, 4000, 8000, 16000];
const base = [4, 2, 0, 0, 0, 0, 3, -2, -10];
const curve = (offset: number, bump = 0) =>
  base.map((db, i) => db + offset + (i === 6 ? bump : 0));

test("modelKey ignores source, case and punctuation", () => {
  assert.equal(modelKey("a::Truthear Nova"), modelKey("b::TRUTHEAR NOVA"));
  assert.notEqual(modelKey("a::Nova"), modelKey("a::Nova (Foam)"));
});

test("an outlier ranks last and level offsets do not matter", () => {
  const ranked = rankMeasurements(freqs, {
    "a::Brand Model": curve(0),
    "b::Brand Model": curve(50),
    "c::BRAND MODEL": curve(-20),
    "d::Brand Model": curve(0, 9),
  });
  assert.equal(ranked["d::Brand Model"].rank, 4);
  assert.equal(ranked["a::Brand Model"].of, 4);
  assert.ok(ranked["a::Brand Model"].agreement < 0.01);
  assert.ok(ranked["d::Brand Model"].agreement > 1);
});

test("models with fewer than 3 measurements get no rank", () => {
  assert.deepEqual(
    rankMeasurements(freqs, { "a::M": curve(0), "b::M": curve(1) }),
    {},
  );
});

test("sources that mirror each other count once and share a rank", () => {
  const ranked = rankMeasurements(freqs, {
    "a::M": curve(0, 6),
    "b::M": curve(0, 6),
    "c::M": curve(0),
    "d::M": curve(0, 0.2),
  });
  assert.equal(ranked["a::M"].rank, ranked["b::M"].rank);
  assert.equal(ranked["a::M"].of, 3);
  assert.equal(ranked["c::M"].rank, 1);
});

test("5128 sources form their own group", () => {
  assert.notEqual(modelKey("crinacle5128::Nova"), modelKey("crinacle::Nova"));
  const ranked = rankMeasurements(freqs, {
    "a::M": curve(0),
    "b::M": curve(0, 0.1),
    "c::M": curve(0, 0.2),
    "crinacle5128::M": curve(0, 9),
  });
  assert.equal(ranked["crinacle5128::M"], undefined);
  assert.equal(ranked["a::M"].of, 3);
});

test("a pick needs 5 distinct curves that agree with their median", () => {
  const three = rankMeasurements(freqs, {
    "a::M": curve(0),
    "b::M": curve(0, 0.1),
    "c::M": curve(0, 0.2),
  });
  assert.equal(three["a::M"].confident, false);
  const five = Object.fromEntries(
    [0, 0.1, 0.2, 0.3, 0.4].map((bump, i) => [`s${i}::M`, curve(0, bump)]),
  );
  assert.equal(rankMeasurements(freqs, five)["s0::M"].confident, true);
  // Each curve has its own bump, so none of them matches the median.
  const split = Object.fromEntries(
    [1, 2, 3, 4, 5].map((at) => [
      `s${at}::M`,
      base.map((db, i) => db + (i === at ? 6 : 0)),
    ]),
  );
  assert.equal(rankMeasurements(freqs, split)["s1::M"].confident, false);
});
