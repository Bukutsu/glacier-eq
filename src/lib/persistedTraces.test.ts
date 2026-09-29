import { describe, expect, it } from "vitest";
import {
  parsePersistedMeasurements,
  parsePersistedTargets,
} from "./persistedTraces";

const validPoints = [
  { freq: 100, db: 1 },
  { freq: 1000, db: 2 },
];

describe("parsePersistedMeasurements", () => {
  it("bounds what it will accept, like every other parser", () => {
    // Nothing capped these two, unlike the measurement importer (4_096 lines
    // / 100_000 points) and the online DB parser. A corrupt localStorage value
    // could stall the main thread parsing it and then fail to re-save.
    const trace = {
      id: "a",
      name: "A",
      color: "#fff",
      visible: true,
      points: validPoints,
    };
    const hugeTrace = {
      ...trace,
      points: Array.from({ length: 200_000 }, (_, i) => ({ freq: 20 + i, db: 0 })),
    };

    // Rejected entries return [], which the caller reports as malformed and
    // quarantines — the same path as any other schema damage.
    expect(parsePersistedMeasurements([hugeTrace])).toEqual([]);
    expect(parsePersistedTargets([hugeTrace])).toEqual([]);

    const tooMany = Array.from({ length: 2_001 }, (_, i) => ({ ...trace, id: `t${i}` }));
    expect(parsePersistedMeasurements(tooMany)).toEqual([]);
    expect(parsePersistedTargets(tooMany)).toEqual([]);

    // Just under the cap still parses, so the bound is not off by one.
    const atCap = Array.from({ length: 2_000 }, (_, i) => ({ ...trace, id: `t${i}` }));
    expect(parsePersistedMeasurements(atCap)).toHaveLength(2_000);
  });

  it("validates every point before normalization", () => {
    const result = parsePersistedMeasurements([
      {
        id: "valid",
        name: "Valid",
        color: "red",
        visible: true,
        points: validPoints,
      },
      {
        id: "null-point",
        name: "Null point",
        color: "blue",
        visible: true,
        points: [validPoints[0], null],
      },
      {
        id: "non-finite",
        name: "Non-finite",
        color: "green",
        visible: true,
        points: [validPoints[0], { freq: 1000, db: Number.NaN }],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("valid");
    expect(result[0].points.map((point) => point.freq)).toEqual([100, 1000]);
  });

  it("rejects traces with fewer than two points after normalization", () => {
    expect(parsePersistedMeasurements([{
      id: "mostly-out-of-range",
      name: "Mostly out of range",
      color: "red",
      visible: true,
      points: [
        { freq: 10, db: 0 },
        { freq: 100, db: 1 },
      ],
    }])).toEqual([]);
  });
});

describe("parsePersistedTargets", () => {
  it("applies the same point validation and forces user-target ownership", () => {
    const targets = parsePersistedTargets([
      {
        id: "target",
        name: "Target",
        color: "red",
        builtIn: true,
        points: validPoints,
      },
      {
        id: "bad-target",
        name: "Bad target",
        color: "blue",
        points: [{ freq: 100, db: 0 }, { freq: "1000", db: 0 }],
      },
    ]);

    expect(targets).toHaveLength(1);
    expect(targets[0].builtIn).toBe(false);
  });
});
