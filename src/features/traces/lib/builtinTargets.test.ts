import { describe, it, expect } from "vitest";
import { BUILTIN_TARGETS } from "./builtinTargets";

describe("BUILTIN_TARGETS", () => {
  it("loads the PEQdB Diamond curve separately from the beta target", () => {
    const target = BUILTIN_TARGETS.find(
      (target) => target.id === "builtin-target:peqdb-diamond",
    );
    expect(target?.name).toBe("PEQdB Diamond");
    expect(target).toBeDefined();
    const first = target!.points[0];
    const last = target!.points.at(-1)!;
    expect(first.freq).toBe(20);
    expect(last.freq).toBe(20000);
    // The loader normalizes levels at 1 kHz; the curve shape is preserved.
    expect(first.db - last.db).toBeCloseTo(84.054 - 72.21, 6);
  });

  it("bundles all targets from target_references", () => {
    expect(BUILTIN_TARGETS.length).toBe(11);
    const names = BUILTIN_TARGETS.map((t) => t.name);
    expect(names).toContain("Harman IE 2019");
    expect(names).toContain("Diffuse Field");
    expect(names).toContain("PEQdB Diamond β");
    expect(names).toContain("PEQdB Diamond");
    for (const target of BUILTIN_TARGETS) {
      expect(target.builtIn).toBe(true);
      expect(target.points.length).toBeGreaterThan(100);
      expect(target.id.startsWith("builtin-target:")).toBe(true);
    }
  });
});
