// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { themeOptions } from "./theme";

/**
 * Material You reads the Android system palette. It used to be listed in
 * Settings on every platform and honoured in useThemeSync on every platform,
 * where the palette read failed off Tauri and it silently fell back to Tokyo
 * Night — so a desktop or web user could pick "System (Material You)" and get
 * a different theme with no explanation.
 */
describe("Material You is Android-only", () => {
  it("offers the theme only on Android", () => {
    const values = (isAndroid: boolean) =>
      themeOptions(isAndroid).map((option) => option.value);

    expect(values(true)).toContain("material-you");
    expect(values(false)).not.toContain("material-you");
  });

  it("keeps every other theme on both platforms", () => {
    const android = new Set(themeOptions(true).map((o) => o.value));
    const other = new Set(themeOptions(false).map((o) => o.value));

    expect([...android].filter((v) => v !== "material-you").sort())
      .toEqual([...other].sort());
    // "auto" stays first on both, so the default selection is unchanged.
    expect(themeOptions(true)[0].value).toBe("auto");
    expect(themeOptions(false)[0].value).toBe("auto");
  });

  it("never offers a theme the app cannot apply", () => {
    // A stored value is honoured on Android only; the sync layer gates it the
    // same way. If either side drifts, a platform silently falls back.
    const known = new Set([
      "auto", "material-you", "glacier", "tokyo-night", "tokyo-night-storm",
      "tokyo-night-day", "nord", "dracula", "gruvbox",
      "catppuccin-mocha", "catppuccin-latte",
    ]);
    for (const option of themeOptions(true)) {
      expect(known).toContain(option.value);
    }
  });

  it("gates the sync layer on Android, not just the settings list", () => {
    // A value written by an Android build — the default there — or edited by
    // hand must not put an Android theme on desktop or web.
    const source = readFileSync(
      new URL("../hooks/useThemeSync.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(
      /const wantsMaterialYou\s*=\s*\n?\s*isAndroid && \(theme === "material-you"/,
    );
    // The old predicate matched the setting on any platform.
    expect(source).not.toMatch(
      /theme === "material-you" \|\| \(theme === "auto" && isAndroid\)/,
    );
  });
});
