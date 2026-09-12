// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

export interface MaterialYouColors {
  available: boolean;
  dark: boolean;
  palettes: Record<string, Record<string, string>>;
}

function tone(
  palettes: Record<string, Record<string, string>>,
  family: string,
  toneValue: number,
  fallback: string,
): string {
  return palettes[family]?.[String(toneValue)] ?? fallback;
}

export function hexToRgb(hex: string): string {
  const clean = hex.replace("#", "");
  const num = Number.parseInt(
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean,
    16,
  );
  if (Number.isNaN(num)) return "125 207 255";
  return `${(num >> 16) & 255} ${(num >> 8) & 255} ${num & 255}`;
}

function hexToTuple(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).split(" ").map(Number);
  return [r, g, b];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

/** Linear blend of two hex colors; `t` is the weight of `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToTuple(a);
  const [r2, g2, b2] = hexToTuple(b);
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).split(" ").map(Number);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Map Material You tonal palettes onto Glacier EQ theme variables.
 * Dark mode follows M3 baseline roles (primary = A1-200, surface = N1-900);
 * light mode uses primary = A1-600, surface = N1-50.
 */
export function materialYouToCssVars(data: MaterialYouColors): Record<string, string> {
  const { palettes, dark } = data;
  const primary = dark
    ? tone(palettes, "accent1", 200, "#7dcfff")
    : tone(palettes, "accent1", 600, "#0b6f9e");
  const secondary = dark
    ? tone(palettes, "accent2", 200, "#bb9af7")
    : tone(palettes, "accent2", 600, "#5b4fa6");
  const tertiary = dark
    ? tone(palettes, "accent3", 200, "#73daca")
    : tone(palettes, "accent3", 600, "#0f766e");
  const bg = dark
    ? tone(palettes, "neutral1", 900, "#1a1b26")
    : tone(palettes, "neutral1", 50, "#eef1f6");
  const bgDark = dark
    ? tone(palettes, "neutral1", 950, "#16161e")
    : tone(palettes, "neutral1", 100, "#e1e2e7");
  const bgDarker = dark
    ? tone(palettes, "neutral1", 1000, "#101014")
    : tone(palettes, "neutral1", 200, "#c4c8d8");
  const error = dark
    ? tone(palettes, "error", 200, "#f7768e")
    : tone(palettes, "error", 600, "#f52a65");
  // Functional hues keep their semantics but are harmonized 25% toward the
  // wallpaper primary (M3 custom-color harmonization), so no fixed
  // Tokyo Night hue leaks through.
  const green = mixHex(dark ? "#9ece6a" : "#486a29", primary, 0.25);
  const orange = mixHex(dark ? "#ff9e64" : "#b15c00", primary, 0.25);
  const yellow = mixHex(dark ? "#e0af68" : "#8c6c3e", primary, 0.25);
  const brightCyan = mixHex(primary, "#ffffff", dark ? 0.45 : 0.25);
  const panel = dark
    ? tone(palettes, "neutral1", 800, "#1f2335")
    : tone(palettes, "neutral1", 100, "#e6e9ef");
  const surface = dark
    ? tone(palettes, "neutral2", 700, "#414868")
    : tone(palettes, "neutral2", 400, "#9aa3b2");
  const surfaceSoft = dark
    ? tone(palettes, "neutral2", 800, "#292e42")
    : tone(palettes, "neutral2", 200, "#d5dae2");
  const text = dark
    ? tone(palettes, "neutral1", 100, "#c0caf5")
    : tone(palettes, "neutral1", 900, "#1a1d29");
  const muted = dark
    ? tone(palettes, "neutral2", 400, "#a9b1d6")
    : tone(palettes, "neutral2", 600, "#4b5263");
  const comment = dark
    ? tone(palettes, "neutral2", 500, "#565f89")
    : tone(palettes, "neutral2", 500, "#6b7280");

  return {
    "--m3-primary": primary,
    "--m3-secondary": secondary,
    "--m3-tertiary": tertiary,
    "--cyan": primary,
    "--cyan-rgb": hexToRgb(primary),
    "--azure": primary,
    "--sky": primary,
    "--blue": secondary,
    "--blue-rgb": hexToRgb(secondary),
    "--purple": secondary,
    "--purple-rgb": hexToRgb(secondary),
    "--teal": tertiary,
    "--teal-rgb": hexToRgb(tertiary),
    "--bg": bg,
    "--bg-dark": bgDark,
    "--bg-dark-rgb": hexToRgb(bgDark),
    "--bg-darker-rgb": hexToRgb(bgDarker),
    "--panel": panel,
    "--panel-rgb": hexToRgb(panel),
    "--surface": surface,
    "--surface-soft": surfaceSoft,
    "--input-bg": bgDark,
    "--input-border": surface,
    "--panel-border": surface,
    "--list-hover-bg": surfaceSoft,
    "--scrollbar-color": surface,
    "--text": text,
    "--text-rgb": hexToRgb(text),
    "--muted": muted,
    "--comment": comment,
    "--steel": comment,
    "--red": error,
    "--red-rgb": hexToRgb(error),
    "--crimson": error,
    "--green": green,
    "--green-rgb": hexToRgb(green),
    "--orange": orange,
    "--orange-rgb": hexToRgb(orange),
    "--yellow": yellow,
    "--yellow-rgb": hexToRgb(yellow),
    "--bright-cyan": brightCyan,
    "--magenta2": secondary,
    "--magenta2-rgb": hexToRgb(secondary),
    "--navy": secondary,
    "--sea": tertiary,
    "--teal2": tertiary,
    "--teal2-rgb": hexToRgb(tertiary),
    "--terminal-black-rgb": hexToRgb(bgDark),
    "--sync-ok": green,
    "--sync-working": primary,
    "--sync-unsaved": orange,
    "--on-accent": luminance(primary) > 0.6 ? "#11111b" : "#f4f6fb",
  };
}

export const MATERIAL_YOU_VARS = [
  "--m3-primary",
  "--m3-secondary",
  "--m3-tertiary",
  "--cyan",
  "--cyan-rgb",
  "--azure",
  "--sky",
  "--blue",
  "--blue-rgb",
  "--purple",
  "--purple-rgb",
  "--teal",
  "--teal-rgb",
  "--bg",
  "--bg-dark",
  "--bg-dark-rgb",
  "--bg-darker-rgb",
  "--panel",
  "--panel-rgb",
  "--surface",
  "--surface-soft",
  "--input-bg",
  "--input-border",
  "--panel-border",
  "--list-hover-bg",
  "--scrollbar-color",
  "--text",
  "--text-rgb",
  "--muted",
  "--comment",
  "--steel",
  "--red",
  "--red-rgb",
  "--crimson",
  "--green",
  "--green-rgb",
  "--orange",
  "--orange-rgb",
  "--yellow",
  "--yellow-rgb",
  "--bright-cyan",
  "--magenta2",
  "--magenta2-rgb",
  "--navy",
  "--sea",
  "--teal2",
  "--teal2-rgb",
  "--terminal-black-rgb",
  "--sync-ok",
  "--sync-working",
  "--sync-unsaved",
  "--on-accent",
];

export async function getMaterialYouColors(): Promise<MaterialYouColors | null> {
  try {
    // Dynamic import: keeps this module (and its unit tests) free of the
    // Vite-only `@glacier-eq/backend` alias that `rpc.ts` pulls in.
    const { invoke } = await import("./rpc");
    const colors =
      await invoke<MaterialYouColors>("plugin:material-you|get_dynamic_colors");
    if (!colors || !colors.available) return null;
    return colors;
  } catch {
    return null;
  }
}

export function applyMaterialYouVars(vars: Record<string, string>): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
}

export function clearMaterialYouVars(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const name of MATERIAL_YOU_VARS) {
    root.style.removeProperty(name);
  }
}
