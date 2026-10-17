import { describe, expect, it } from "vitest";
import { parseProfileImport } from "./profileImport";

const result = {
  peq: {
    global_gain: -4,
    filters: [
      {
        index: 0,
        enabled: true,
        filter_type: "Peak",
        freq: 100,
        gain: 3,
        q: 1,
      },
    ],
  },
  headphone_name: null,
  warnings: [],
};

describe("AutoEQ profile import boundary", () => {
  it("reads the parser's wrapped EQ and derives a file name", () => {
    const parsed = parseProfileImport(result, "Evening listening.txt");
    expect(parsed.name).toBe("Evening listening");
    expect(parsed.data.global_gain).toBe(-4);
    expect(parsed.data.filters[0].gain).toBe(3);
  });

  it("accepts the native serialized EQ aliases", () => {
    const parsed = parseProfileImport(
      {
        ...result,
        peq: {
          globalGain: -2,
          filters: [{ type: "LSQ", freq: 90, gain: 2, q: 0.7 }],
        },
      },
      "bass.txt",
    );
    expect(parsed.data.global_gain).toBe(-2);
    expect(parsed.data.filters[0].filter_type).toBe("LowShelf");
  });

  it("prefers the headphone name and preserves clamp warnings", () => {
    const parsed = parseProfileImport(
      {
        ...result,
        headphone_name: "  Headphone EQ  ",
        warnings: ["Gain was clamped"],
      },
      "download.txt",
    );
    expect(parsed.name).toBe("Headphone EQ");
    expect(parsed.warnings).toEqual(["Gain was clamped"]);
  });

  it.each([
    null,
    {},
    result.peq,
    { ...result, warnings: [42] },
    { ...result, headphone_name: 42 },
  ])("rejects malformed wrapper %j", (value) => {
    expect(() => parseProfileImport(value, "eq.txt")).toThrow(
      "Invalid AutoEQ import response",
    );
  });

  it("rejects invalid inner EQ", () => {
    expect(() =>
      parseProfileImport(
        { ...result, peq: { filters: [], global_gain: "bad" } },
        "eq.txt",
      ),
    ).toThrow();
  });
});
