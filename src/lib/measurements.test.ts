import { describe, it, expect } from "vitest";
import type { MeasurementTrace } from "../types";
import {
  parseMeasurementText,
  normalizeMeasurementPoints,
  interpolateMeasurementDb,
  nextMeasurementColor,
  makeMeasurementName,
} from "./measurements";

function trace(name: string): MeasurementTrace {
  return { id: name, name, color: "", visible: true, points: [] };
}

describe("parseMeasurementText", () => {
  it("parses valid points, skips comments and extra columns (mirrors Rust parse_curve_text)", () => {
    const text = "# frequency response\n20, 5, ignored\n100 10\n10000;20\n// footer";
    const points = parseMeasurementText(text);
    expect(points.length).toBe(3);
    // sorted ascending by frequency
    expect(points.map((p) => p.freq)).toEqual([20, 100, 10000]);
    // normalized around 1000 Hz -> interpolation there is 0 dB
    expect(interpolateMeasurementDb(points, 1000)).toBeCloseTo(0, 9);
  });

  it("throws when fewer than 2 points remain after range filtering", () => {
    // 10 Hz is out of the [20, 20000] range and gets dropped, leaving one point
    expect(() => parseMeasurementText("header\n10,2\n20,3")).toThrow();
  });

  it("throws when only a single valid point is provided", () => {
    expect(() => parseMeasurementText("100, 5")).toThrow();
    expect(() => parseMeasurementText("")).toThrow();
  });

  it("skips blank lines, comments, and invalid numbers", () => {
    const text = [
      "# comment",
      "   ",
      "// another comment",
      "abc, 5", // non-numeric frequency
      "100, xyz", // non-numeric dB
      "200, 2",
      "300, 3",
    ].join("\n");
    const points = parseMeasurementText(text);
    expect(points.map((p) => p.freq)).toEqual([200, 300]);
  });

  it("parses scientific notation", () => {
    // 2e1 = 20, 2e4 = 20000 (both in range), 1e1 = 10 dropped
    expect(() => parseMeasurementText("1e1, 1\n2e4, 0")).toThrow();
    const points = parseMeasurementText("2e1, 0\n2e4, 0");
    expect(points.map((p) => p.freq)).toEqual([20, 20000]);
    const sci = parseMeasurementText("1e3, 5\n1e4, 5");
    expect(sci.map((p) => p.freq)).toEqual([1000, 10000]);
  });

  it("parses tab and semicolon delimiters", () => {
    expect(parseMeasurementText("100\t10\n200\t20").map((p) => p.freq)).toEqual([100, 200]);
    expect(parseMeasurementText("100;10\n200;20").map((p) => p.freq)).toEqual([100, 200]);
  });
});

describe("normalizeMeasurementPoints", () => {
  it("returns a single point unchanged when fewer than 2 survive filtering", () => {
    // 10 Hz is filtered out, leaving one point that must NOT be normalized
    const out = normalizeMeasurementPoints([
      { freq: 10, db: 0 },
      { freq: 20, db: 5 },
    ]);
    expect(out).toEqual([{ freq: 20, db: 5 }]);
  });

  it("sorts and normalizes dB around the 1000 Hz reference", () => {
    const out = normalizeMeasurementPoints([
      { freq: 1000, db: 20 },
      { freq: 100, db: 10 },
    ]);
    expect(out.map((p) => p.freq)).toEqual([100, 1000]);
    expect(out[1].db).toBeCloseTo(0, 9);
    expect(out[0].db).toBeCloseTo(-10, 9);
  });

  it("drops non-finite and out-of-range points", () => {
    const out = normalizeMeasurementPoints([
      { freq: Number.NaN, db: 0 },
      { freq: 19, db: 0 },
      { freq: 20001, db: 0 },
      { freq: 100, db: 1 },
      { freq: 1000, db: 2 },
    ]);
    expect(out.map((p) => p.freq)).toEqual([100, 1000]);
  });
});

describe("nextMeasurementColor", () => {
  const VARS = ["--steel", "--navy", "--sea", "--azure", "--sky", "--crimson"];

  it("cycles through the color variables and wraps around", () => {
    for (let i = 0; i < VARS.length; i++) {
      expect(nextMeasurementColor(Array.from({ length: i }, trace))).toBe(`var(${VARS[i]})`);
    }
    expect(nextMeasurementColor(Array.from({ length: VARS.length }, trace))).toBe(`var(${VARS[0]})`);
    expect(nextMeasurementColor(Array.from({ length: VARS.length + 1 }, trace))).toBe(`var(${VARS[1]})`);
  });
});

describe("makeMeasurementName", () => {
  it("uses the base name when unique", () => {
    expect(makeMeasurementName("Test", [])).toBe("Test");
  });

  it("falls back to 'Measurement' for empty/whitespace base names", () => {
    expect(makeMeasurementName("", [])).toBe("Measurement");
    expect(makeMeasurementName("   ", [])).toBe("Measurement");
  });

  it("appends a copy index for duplicate names", () => {
    expect(makeMeasurementName("Test", [trace("Test")])).toBe("Test 2");
    expect(makeMeasurementName("Test", [trace("Test"), trace("Test 2")])).toBe("Test 3");
  });
});
