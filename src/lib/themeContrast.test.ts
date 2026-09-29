// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The filled-button pairing is a contrast guarantee, not a style preference:
 * it was `--navy` (a chart series colour) behind a hardcoded white, which is
 * 2.52:1 on the default dark theme and 1.70:1 under Material You. This reads
 * the stylesheet so a future edit that re-introduces a hardcoded foreground, or
 * swaps the fill back to a curve colour, fails here rather than on a device.
 */
const css = readFileSync(
  fileURLToPath(new URL("../styles/base.css", import.meta.url)),
  "utf8",
);

function relativeLuminance(hex: string): number {
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  const channels = [0, 2, 4].map((i) => {
    const value = parseInt(full.slice(i + 1, i + 3), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)]
    .sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Every declared token value for one top-level `:root...` block. */
function themeTokens(selector: string): Record<string, string> {
  const match = new RegExp(`${selector.replace(/[[\]]/g, "\\$&")}\\s*\\{`).exec(css);
  if (!match) return {};
  let depth = 1;
  let i = match.index + match[0].length;
  const start = i;
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    i += 1;
  }
  const body = css.slice(start, i - 1);
  const tokens: Record<string, string> = {};
  for (const token of body.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})/g)) {
    tokens[token[1]] = token[2];
  }
  return tokens;
}

const THEME_SELECTORS = [
  [":root, :root[data-theme=\"tokyo-night\"]", "tokyo-night"],
  [":root[data-theme=\"tokyo-night-storm\"]", "tokyo-night-storm"],
  [":root[data-theme=\"material-you\"]", "material-you"],
  [":root[data-theme=\"tokyo-night-day\"]", "tokyo-night-day"],
  [":root[data-theme=\"nord\"]", "nord"],
  [":root[data-theme=\"dracula\"]", "dracula"],
  [":root[data-theme=\"gruvbox\"]", "gruvbox"],
  [":root[data-theme=\"catppuccin-mocha\"]", "catppuccin-mocha"],
  [":root[data-theme=\"catppuccin-latte\"]", "catppuccin-latte"],
] as const;

describe("filled button contrast", () => {
  it.each(THEME_SELECTORS)("%s meets WCAG AA against its own background", (selector) => {
    const tokens = themeTokens(selector);
    expect(tokens["--cyan"], `${selector} must define --cyan`).toBeDefined();
    expect(tokens["--bg"], `${selector} must define --bg`).toBeDefined();

    // The rule is: fill = --cyan, foreground = --bg.
    const ratio = contrast(tokens["--cyan"], tokens["--bg"]);
    expect(
      ratio,
      `${selector}: --cyan on --bg is ${ratio.toFixed(2)}:1, below the 4.5:1 AA minimum`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("does not fill with a measurement curve colour or a hardcoded white", () => {
    const rule = /\.btn\.filled,\s*button\.save\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule, "the .btn.filled rule must exist").not.toBe("");
    // --navy is a chart series colour: tuned for a thin line on a dark curve,
    // not for a large solid block behind text.
    expect(rule).not.toContain("--navy");
    // A hardcoded white cannot follow the theme's polarity: the dark themes
    // need a near-black foreground on their light accents.
    expect(rule).not.toMatch(/#fff\b/i);
  });

  it("resolves --navy even with no data-theme set", () => {
    // index.html sets no data-theme, so before main.tsx applies one these fall
    // through to the bare :root block. An unresolved var() invalidates the
    // whole declaration that used it, which left the CTA background unset.
    const base = themeTokens(":root");
    expect(base["--navy"], "the base :root must define --navy").toBeDefined();
  });
});
