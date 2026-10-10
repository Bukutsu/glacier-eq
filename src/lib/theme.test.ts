import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { systemThemeName, themeOptions } from "./theme";

describe("Glacier system appearance", () => {
  it("uses matching Glacier palettes for light and dark systems", () => {
    expect(systemThemeName(true)).toBe("glacier");
    expect(systemThemeName(false)).toBe("glacier-light");
  });

  it("offers both palettes on desktop and Android", () => {
    for (const android of [false, true]) {
      const values = themeOptions(android).map(({ value }) => value);
      expect(values).toContain("glacier");
      expect(values).toContain("glacier-light");
      expect(values[0]).toBe("auto");
    }
  });

  it("uses the same resolver before and after React mounts", () => {
    const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    const hook = readFileSync(new URL("../hooks/useThemeSync.ts", import.meta.url), "utf8");
    expect(main).toContain("systemThemeName(isDark)");
    expect(hook.match(/systemThemeName\(/g)).toHaveLength(3);
    // Named Tokyo Night remains available, but is no longer the Auto fallback.
    expect(hook).not.toContain('resolved = prefersDark ? "glacier" : "tokyo-night-day"');
  });
});
