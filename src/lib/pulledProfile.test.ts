import { describe, expect, it } from "vitest";
import { buildDefaultState } from "./peq";
import { resolvePulledProfile } from "./pulledProfile";

describe("resolvePulledProfile", () => {
  it("discards a delayed match after the editor or connection changes", async () => {
    let current = true;
    let complete: (name: string) => void = () => {};
    const match = new Promise<string>((resolve) => { complete = resolve; });
    const result = resolvePulledProfile(buildDefaultState(), () => match, () => current);
    current = false;
    complete("Old profile");
    expect(await result).toBeNull();
  });

  it("returns the matched name or fallback only for a current pull", async () => {
    expect(await resolvePulledProfile(buildDefaultState(), async () => "Saved", () => true))
      .toBe("Saved");
    expect(await resolvePulledProfile(buildDefaultState(), async () => null, () => true))
      .toBe("Pulled from device");
  });

  it("propagates lookup failures", async () => {
    await expect(resolvePulledProfile(buildDefaultState(), async () => {
      throw new Error("lookup failed");
    }, () => true)).rejects.toThrow("lookup failed");
  });
});
