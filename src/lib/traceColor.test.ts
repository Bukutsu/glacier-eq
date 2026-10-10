import { describe, expect, it } from "vitest";
import { traceDisplayColor, traceSwatchColor } from "./traceColor";

describe("trace display colors", () => {
  it("leaves other themes and stored color values unchanged", () => {
    const stored = "#2fa4b5";
    expect(traceDisplayColor(stored, "#989cad", 0)).toBe(stored);
    expect(traceDisplayColor(stored, "#989cad", 0.45)).toBe("#5ea0b1");
    expect(stored).toBe("#2fa4b5");
  });
  it("does not mute theme-variable colors twice", () => {
    expect(traceDisplayColor("var(--cyan)", "#989cad", 0.45)).toBe("var(--cyan)");
  });
  it("keeps curve-list swatches tied to live theme roles", () => {
    expect(traceSwatchColor("#2fa4b5")).toContain("var(--trace-color-mix)");
    expect(traceSwatchColor("#2fa4b5")).toContain("var(--trace-color-neutral)");
    expect(traceSwatchColor("var(--cyan)")).toBe("var(--plot-cyan)");
    expect(traceSwatchColor("var(--plot-cyan)")).toBe("var(--plot-cyan)");
  });
  it("preserves raw-line alpha after the displayed color is resolved", () => {
    expect(traceDisplayColor("rgba(94, 160, 177, 0.44)", "#989cad", 0.45))
      .toBe("rgba(94, 160, 177, 0.44)");
  });
});
