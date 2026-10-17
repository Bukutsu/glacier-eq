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

  it("keeps Auto explicit while startup uses the default or cached theme", () => {
    const main = readFileSync(
      new URL("../../../main.tsx", import.meta.url),
      "utf8",
    );
    const hook = readFileSync(
      new URL("../hooks/useThemeSync.ts", import.meta.url),
      "utf8",
    );
    expect(main).not.toContain("systemThemeName(isDark)");
    const html = readFileSync(
      new URL("../../../../index.html", import.meta.url),
      "utf8",
    );
    expect(html).toContain('data-theme="tokyo-night"');
    expect(hook.match(/systemThemeName\(/g)).toHaveLength(3);
    // Named Tokyo Night remains available, but is no longer the Auto fallback.
    expect(hook).not.toContain(
      'resolved = prefersDark ? "glacier" : "tokyo-night-day"',
    );
  });
});
