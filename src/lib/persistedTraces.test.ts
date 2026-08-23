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
