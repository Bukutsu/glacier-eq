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
function themeTokens(selector: string, source = css): Record<string, string> {
  const match = new RegExp(`${selector.replace(/[[\]]/g, "\\$&")}\\s*\\{`).exec(source);
  if (!match) return {};
  let depth = 1;
  let i = match.index + match[0].length;
  const start = i;
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    i += 1;
  }
  const body = source.slice(start, i - 1);
  const tokens: Record<string, string> = {};
  for (const token of body.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})/g)) {
    tokens[token[1]] = token[2];
  }
  return tokens;
}

/** Flatten `color-mix(in srgb, A p%, B)` the way a browser would in srgb. */
function mix(a: string, b: string, percentA: number): string {
  const t = percentA / 100;
  const bytes = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16));
  const [ar, ag, ab] = bytes(a);
  const [br, bg, bb] = bytes(b);
  const blend = (from: number, to: number) =>
    Math.round(from * t + to * (1 - t)).toString(16).padStart(2, "0");
  return `#${blend(ar, br)}${blend(ag, bg)}${blend(ab, bb)}`;
}

const THEME_SELECTORS = [
  [":root, :root[data-theme=\"glacier\"]", "glacier"],
  [":root[data-theme=\"glacier-light\"]", "glacier-light"],
  [":root[data-theme=\"tokyo-night\"]", "tokyo-night"],
  [":root[data-theme=\"tokyo-night-storm\"]", "tokyo-night-storm"],
  [":root[data-theme=\"material-you\"]", "material-you"],
  [":root[data-theme=\"tokyo-night-day\"]", "tokyo-night-day"],
  [":root[data-theme=\"nord\"]", "nord"],
  [":root[data-theme=\"dracula\"]", "dracula"],
  [":root[data-theme=\"gruvbox\"]", "gruvbox"],
  [":root[data-theme=\"catppuccin-mocha\"]", "catppuccin-mocha"],
  [":root[data-theme=\"catppuccin-latte\"]", "catppuccin-latte"],
] as const;

const FALLBACK_THEME_SELECTORS = THEME_SELECTORS.filter(([, name]) => !name.startsWith("tokyo-night"));

describe("control text contrast", () => {
  it.each(FALLBACK_THEME_SELECTORS)("%s keeps text readable on quiet controls", (selector) => {
    const tokens = themeTokens(selector);
    expect(tokens["--surface-soft"]).toBeDefined();
    expect(tokens["--text"]).toBeDefined();
    expect(
      contrast(tokens["--text"], tokens["--surface-soft"]),
      `${selector}: control labels must meet WCAG AA`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(tokens["--muted"], tokens["--surface-soft"]),
      `${selector}: secondary labels must meet WCAG AA`,
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Glacier data colors", () => {
  it.each(THEME_SELECTORS.slice(0, 2))("%s keeps band labels and handles readable", (selector) => {
    const tokens = themeTokens(selector);
    for (const color of ["--red", "--orange", "--yellow", "--green", "--teal", "--cyan", "--blue", "--purple"]) {
      expect(contrast(tokens[color], tokens["--surface-soft"]), color + " band label")
        .toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens[color], tokens["--on-accent"]), color + " handle label")
        .toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("filled button contrast", () => {
  it.each(FALLBACK_THEME_SELECTORS)("%s meets WCAG AA for the button surface", (selector) => {
    const tokens = themeTokens(selector);
    expect(tokens["--cyan"], `${selector} must define --cyan`).toBeDefined();
    expect(tokens["--bg"], `${selector} must define --bg`).toBeDefined();
    expect(tokens["--text"], `${selector} must define --text`).toBeDefined();

    // The rule is: fill = the accent tinted into the page background at 22%,
    // foreground = the theme's text colour.
    const fill = mix(tokens["--cyan"], tokens["--bg"], 22);
    const ratio = contrast(fill, tokens["--text"]);
    expect(
      ratio,
      `${selector}: button surface ${fill} under --text ${tokens["--text"]} is ` +
        `${ratio.toFixed(2)}:1, below the 4.5:1 AA minimum`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("uses semantic action colors rather than painting a chart accent", () => {
    const rule = /\.btn\.filled,\s*button\.save\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule, "the .btn.filled rule must exist").not.toBe("");
    // --navy and a bare --cyan are chart/line colours: bright and
    // high-chroma by design, and wrong as a large solid block behind text.
    expect(rule).not.toMatch(/var\(--navy\)/);
    expect(rule).not.toMatch(/background:\s*var\(--cyan\)\s*;/);
    expect(rule).toContain("background: var(--primary)");
    expect(rule).toContain("color: var(--primary-foreground)");
    // A hardcoded white cannot follow the theme's polarity.
    expect(rule).not.toMatch(/#fff\b/i);
  });

  it("keeps the button readable under a live Material You palette", async () => {
    // The Android palette is applied at runtime, not from a CSS block, so the
    // static theme check cannot see it. Drive the real generator for both
    // polarities: the button surface is a tint of the accent, so it has to hold
    // against whatever the system handed us.
    const { materialYouToCssVars } = await import("./materialYou");
    for (const dark of [true, false]) {
      const vars = materialYouToCssVars({ available: true, dark, palettes: {} });
      const fill = mix(vars["--cyan"], vars["--bg"], 22);
      const ratio = contrast(fill, vars["--text"]);
      expect(
        ratio,
        `material-you (dark=${dark}): ${fill} under ${vars["--text"]} is ` +
          `${ratio.toFixed(2)}:1, below the 4.5:1 AA minimum`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("resolves --navy even with no data-theme set", () => {
    // index.html sets no data-theme, so before main.tsx applies one these fall
    // through to the bare :root block. An unresolved var() invalidates the
    // whole declaration that used it, which left the CTA background unset.
    const base = themeTokens(":root");
    expect(base["--navy"], "the base :root must define --navy").toBeDefined();
  });
});


const semanticCss = readFileSync(
  fileURLToPath(new URL("../styles/colors.css", import.meta.url)), "utf8",
);
const TOKYO_THEMES = ["tokyo-night", "tokyo-night-storm", "tokyo-night-day"] as const;

describe("T3 Code semantic color roles", () => {
  it.each(TOKYO_THEMES)("%s keeps role pairings readable", name => {
    const tokens = themeTokens(`:root[data-theme="${name}"]`, semanticCss);
    const pairs = [
      ["--foreground", "--background"],
      ["--card-foreground", "--card"],
      ["--popover-foreground", "--popover"],
      ["--primary-foreground", "--primary"],
      ["--placeholder", "--field-background"],
      ["--accent-foreground", "--accent"],
      ["--sidebar-foreground", "--sidebar"],
      ["--sidebar-muted-foreground", "--sidebar"],
      ["--accent-foreground", "--sidebar-row-selected"],
      ["--destructive-foreground", "--card"],
      ["--warning-foreground", "--card"],
    ] as const;
    for (const [foreground, background] of pairs) {
      expect(tokens[foreground], foreground).toBeDefined();
      expect(tokens[background], background).toBeDefined();
      expect(contrast(tokens[foreground], tokens[background]), `${name}: ${foreground} on ${background}`)
        .toBeGreaterThanOrEqual(4.5);
    }
    const controls = name === "tokyo-night-day"
      ? [tokens["--popover"], mix(tokens["--accent"], tokens["--popover"], 50)]
      : [32, 64].map(percent => mix(tokens["--input"], tokens["--popover"], percent));
    for (const control of controls) {
      expect(contrast(tokens["--foreground"], control)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens["--muted-foreground"], control)).toBeGreaterThanOrEqual(4.5);
    }
    const primaryHover = mix(tokens["--primary"], tokens["--card"], name === "tokyo-night-day" ? 95 : 90);
    expect(contrast(tokens["--primary-foreground"], primaryHover)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens["--ring"], tokens["--field-background"])).toBeGreaterThanOrEqual(3);
  });

  it("uses softer reference-led UI roles, not syntax cyan as the action color", () => {
    const night = themeTokens(':root[data-theme="tokyo-night"]', semanticCss);
    expect(night["--background"]).toBe("#20212b");
    expect(night["--card"]).toBe("#1e1f27");
    expect(night["--sidebar"]).toBe("#1d1e26");
    expect(night["--primary"]).toBe("#4c5b7e");
    expect(night["--primary-foreground"]).toBe("#ffffff");
    expect(night["--accent"]).toBe("#2c2e3b");
    expect(night["--primary"]).not.toBe(themeTokens(':root[data-theme="tokyo-night"]')["--cyan"]);
  });

  it("keeps runtime Material You and non-imported palettes as live semantic aliases", () => {
    const defaults = /:root\s*\{([^}]+)\}/.exec(semanticCss)?.[1] ?? "";
    expect(defaults).toContain("--background: var(--bg)");
    expect(defaults).toContain("--primary: var(--action-bg)");
    expect(defaults).toContain("--primary-foreground: var(--text)");
    expect(defaults).toContain("--field-background: var(--input-bg)");
    expect(defaults).toContain("--ring: var(--cyan)");
    const interfaceRoles = semanticCss.split("/* A stable, dedicated data palette")[0];
    expect(interfaceRoles).not.toContain(':root[data-theme="material-you"]');
    // Default aliases do not override any live Material You chart colors.
    expect(defaults).not.toMatch(/--(?:cyan|blue|green|red|yellow|on-accent):/);
  });
});

describe("all named themes share the semantic action/focus system", () => {
  it.each(FALLBACK_THEME_SELECTORS.filter(([, name]) => name !== "material-you"))("%s has an independent, readable action pairing", (selector, name) => {
    const roles = themeTokens(`:root[data-theme="${name}"]`, semanticCss);
    const palette = themeTokens(selector);
    expect(roles["--primary"]).toBeDefined();
    expect(roles["--primary-foreground"]).toBeDefined();
    expect(roles["--ring"]).toBeDefined();
    expect(contrast(roles["--primary"], roles["--primary-foreground"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(mix(roles["--primary"], palette["--panel"], 90), roles["--primary-foreground"]))
      .toBeGreaterThanOrEqual(4.5);
    expect(contrast(roles["--ring"], palette["--bg-dark"])).toBeGreaterThanOrEqual(3);
  });

  it("routes UI focus and status text through roles rather than plot colors", () => {
    for (const file of ["base", "editor", "layout", "header", "tools", "responsive", "device-selection", "toasts", "tuning"]) {
      const source = readFileSync(fileURLToPath(new URL(`../styles/${file}.css`, import.meta.url)), "utf8");
      expect(source, file).not.toMatch(/outline:[^;{}]*var\(--cyan\)/);
      expect(source, file).not.toMatch(/(?:^|[;{\s])color:\s*var\(--(?:red|yellow)\)/);
    }
  });
});
