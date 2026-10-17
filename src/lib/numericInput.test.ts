import { describe, expect, it } from "vitest";
import { parseNumericInput } from "./numericInput";

describe("numeric input", () => {
  it.each([
    ["1,5", 1.5],
    ["-1,25", -1.25],
    ["1.5", 1.5],
    ["  +2.5  ", 2.5],
    [".5", 0.5],
    [",5", 0.5],
    ["1.", 1],
    ["1,", 1],
    ["0", 0],
    ["20000", 20000],
  ])("parses %s as %s", (raw, expected) => {
    expect(parseNumericInput(raw)).toBe(expected);
  });

  it.each([
    "",
    " ",
    "-",
    "+",
    ".",
    ",",
    "1,2,3",
    "1.2.3",
    "1,000.5",
    "2oops",
    "2 dB",
    "NaN",
    "Infinity",
    "1e3",
  ])("does not partially parse %s", (raw) => {
    expect(parseNumericInput(raw)).toBeNull();
  });
});
