// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  MATERIAL_YOU_VARS,
  hexToRgb,
  materialYouToCssVars,
  type MaterialYouColors,
} from "./materialYou";

const DARK_SAMPLE: MaterialYouColors = {
  available: true,
  dark: true,
  palettes: {
    accent1: { "200": "#abc001", "600": "#ffffff" },
    accent2: { "200": "#bb0002", "600": "#ffffff" },
    accent3: { "200": "#cc0003", "600": "#ffffff" },
    neutral1: { "50": "#000001", "100": "#d0d004", "800": "#e00008", "900": "#f00009", "950": "#aa000a" },
    neutral2: { "200": "#00000b", "400": "#c00004", "500": "#b00005", "700": "#a00007", "800": "#900008" },
  },
};

describe("hexToRgb", () => {
  it("converts 6-digit hex to triplet", () => {
    expect(hexToRgb("#7dcfff")).toBe("125 207 255");
  });

  it("expands 3-digit hex", () => {
    expect(hexToRgb("#fff")).toBe("255 255 255");
  });

  it("falls back on invalid input", () => {
    expect(hexToRgb("nope")).toBe("125 207 255");
  });
});

describe("materialYouToCssVars", () => {
  it("uses dark-mode tones for dark palettes", () => {
    const vars = materialYouToCssVars(DARK_SAMPLE);
    expect(vars["--cyan"]).toBe("#abc001");
    expect(vars["--bg"]).toBe("#f00009");
    expect(vars["--bg-dark"]).toBe("#aa000a");
    expect(vars["--panel"]).toBe("#e00008");
    expect(vars["--text"]).toBe("#d0d004");
    expect(vars["--cyan-rgb"]).toBe(hexToRgb("#abc001"));
  });

  it("uses light-mode tones for light palettes", () => {
    const light: MaterialYouColors = {
      available: true,
      dark: false,
      palettes: {
        accent1: { "200": "#111111", "600": "#222222" },
        accent2: { "200": "#111111", "600": "#333333" },
        accent3: { "200": "#111111", "600": "#444444" },
        neutral1: { "50": "#555555", "100": "#666666", "900": "#777777" },
        neutral2: { "200": "#888888", "400": "#999999", "500": "#aaaaaa", "600": "#bbbbbb" },
      },
    };
    const vars = materialYouToCssVars(light);
    expect(vars["--cyan"]).toBe("#222222");
    expect(vars["--bg"]).toBe("#555555");
    expect(vars["--text"]).toBe("#777777");
  });

  it("falls back when tones are missing", () => {
    const vars = materialYouToCssVars({ available: true, dark: true, palettes: {} });
    expect(vars["--cyan"]).toBe("#7dcfff");
    expect(vars["--bg"]).toBe("#1a1b26");
    expect(vars["--on-accent"]).toBeDefined();
  });

  it("picks readable on-accent for bright and dark primaries", () => {
    const bright = materialYouToCssVars({
      available: true,
      dark: false,
      palettes: { accent1: { "600": "#ffffff" } },
    });
    expect(bright["--on-accent"]).toBe("#11111b");
    const darkPrimary = materialYouToCssVars({
      available: true,
      dark: true,
      palettes: { accent1: { "200": "#101010" } },
    });
    expect(darkPrimary["--on-accent"]).toBe("#f4f6fb");
  });
});

describe("MATERIAL_YOU_VARS", () => {
  it("covers every var the mapper produces", () => {
    const vars = materialYouToCssVars(DARK_SAMPLE);
    for (const key of Object.keys(vars)) {
      expect(MATERIAL_YOU_VARS).toContain(key);
    }
  });

  it("emits only valid hex or rgb-triplet values", () => {
    for (const dark of [true, false]) {
      const vars = materialYouToCssVars({ available: true, dark, palettes: {} });
      for (const [key, value] of Object.entries(vars)) {
        const ok =
          /^#[0-9a-f]{6}$/i.test(value) || /^\d{1,3} \d{1,3} \d{1,3}$/.test(value);
        expect(ok, `${key}=${value}`).toBe(true);
      }
    }
  });

  it("maps every base color token used by the app", () => {
    const vars = materialYouToCssVars(DARK_SAMPLE);
    for (const token of [
      "--bg", "--bg-dark", "--bg-dark-rgb", "--bg-darker-rgb",
      "--panel", "--panel-rgb", "--surface", "--surface-soft",
      "--text", "--text-rgb", "--muted", "--comment",
      "--cyan", "--cyan-rgb", "--blue", "--purple", "--teal",
      "--red", "--crimson", "--green", "--orange", "--yellow",
      "--bright-cyan", "--magenta2", "--navy", "--sea", "--teal2",
      "--sync-ok", "--sync-working", "--sync-unsaved",
    ]) {
      expect(vars[token], token).toBeDefined();
    }
  });

  it("reads error red from system_error tones", () => {
    const vars = materialYouToCssVars({
      available: true,
      dark: true,
      palettes: { error: { "200": "#aabb11" } },
    });
    expect(vars["--red"]).toBe("#aabb11");
    expect(vars["--crimson"]).toBe("#aabb11");
  });
});
