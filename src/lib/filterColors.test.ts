import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { filterColorVars } from "./filterColors";

describe("dedicated graph palette", () => {
  it("uses plot roles for every band, including matching RGB companions", () => {
    const tokens = Array.from({ length: 10 }, (_, i) => filterColorVars(i));
    expect(new Set(tokens.map(([color]) => color)).size).toBe(10);
    for (const [color, rgb] of tokens) {
      expect(color).toMatch(/^--plot-/);
      expect(rgb).toBe(color + "-rgb");
    }
  });
  it("defines dark and light plot colors independently of interface accents", () => {
    const css = readFileSync(new URL("../styles/colors.css", import.meta.url), "utf8");
    const plots = css.slice(css.indexOf("/* A stable, dedicated data palette"));
    expect(plots).toContain(':root {');
    expect(plots).toContain('[data-theme="glacier-light"]');
    expect(plots).toContain('[data-theme="tokyo-night-day"]');
    expect(plots).toContain('[data-theme="catppuccin-latte"]');
    expect(plots).toContain('[data-theme="material-you"]');
    for (let i = 0; i < 10; i++) {
      const [color, rgb] = filterColorVars(i);
      expect(plots).toMatch(new RegExp(color + ": #[0-9a-f]{6}"));
      expect(plots).toMatch(new RegExp(rgb + ": \\d+ \\d+ \\d+"));
    }
    expect(plots).not.toContain("var(--blue)");
    expect(css).not.toContain("--trace-color-mix: 0.45");
  });
});
