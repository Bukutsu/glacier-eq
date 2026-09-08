import { describe, it, expect } from "vitest";
import { BUILTIN_TARGETS } from "./builtinTargets";

describe("BUILTIN_TARGETS", () => {
  it("bundles all targets from target_references", () => {
    expect(BUILTIN_TARGETS.length).toBe(10);
    const names = BUILTIN_TARGETS.map((t) => t.name);
    expect(names).toContain("Harman IE 2019");
    expect(names).toContain("Diffuse Field");
    expect(names).toContain("PEQdB Diamond β");
    for (const target of BUILTIN_TARGETS) {
      expect(target.builtIn).toBe(true);
      expect(target.points.length).toBeGreaterThan(100);
      expect(target.id.startsWith("builtin-target:")).toBe(true);
    }
  });
});
