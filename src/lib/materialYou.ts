// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useEffect, useState } from "react";

export interface MaterialYouColors {
  available: boolean;
  dark: boolean;
  palettes: Record<string, Record<string, string>>;
  /** Resolved Android Material 3 roles, when exposed by the platform. */
  roles?: Record<string, string>;
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

/**
 * Map Material You tonal palettes onto Glacier EQ theme variables.
 * Dark mode follows M3 baseline roles (primary = A1-200, surface = N1-900);
 * light mode uses primary = A1-600, surface = N1-50.
 */
export function materialYouToCssVars(data: MaterialYouColors): Record<string, string> {
  const { palettes, dark, roles = {} } = data;
  const materialRole = (name: string, fallback: string): string => roles[name] ?? fallback;
  const primary = materialRole(
    "primary",
    dark
      ? tone(palettes, "accent1", 200, "#bac5ee")
      : tone(palettes, "accent1", 600, "#0b6f9e"),
  );
  const secondary = materialRole(
    "secondary",
    dark
      ? tone(palettes, "accent2", 200, "#c0c6dd")
      : tone(palettes, "accent2", 600, "#5b4fa6"),
  );
  const tertiary = materialRole(
    "tertiary",
    dark
      ? tone(palettes, "accent3", 200, "#d7bdec")
      : tone(palettes, "accent3", 600, "#0f766e"),
  );

  // These are the closest web equivalents to Android's Material 3 dark
  // surface roles. Android Settings uses surfaceContainer for the window,
  // surfaceBright for cards, and surfaceContainerHighest for controls.
  const bg = materialRole(
    "surface_container",
    dark
      ? tone(palettes, "neutral1", 900, "#181920")
      : tone(palettes, "neutral1", 50, "#eef1f6"),
  );
  const neutral2Dark = tone(palettes, "neutral2", 900, "#191b23");
  const neutral2Bright = tone(palettes, "neutral2", 800, "#2e3038");
  const bgDark = materialRole(
    "surface_container_low",
    dark
      ? mixHex("#000000", bg, 0.75)
      : tone(palettes, "neutral1", 100, "#e1e2e7"),
  );
  const bgDarker = materialRole(
    "surface_container_lowest",
    dark ? "#000000" : tone(palettes, "neutral1", 200, "#c4c8d8"),
  );
  const error = materialRole(
    "error",
    dark
      ? tone(palettes, "error", 200, "#ffb3ae")
      : tone(palettes, "error", 600, "#f52a65"),
  );
  // Functional hues keep their semantics but are harmonized 25% toward the
  // wallpaper primary (M3 custom-color harmonization), so no fixed
  // Tokyo Night hue leaks through.
  const green = mixHex(dark ? "#9ece6a" : "#486a29", primary, 0.25);
  const orange = mixHex(dark ? "#ff9e64" : "#b15c00", primary, 0.25);
  const yellow = mixHex(dark ? "#e0af68" : "#8c6c3e", primary, 0.25);
  const brightCyan = mixHex(primary, "#ffffff", dark ? 0.45 : 0.25);
  const panel = materialRole(
    "surface_bright",
    dark
      ? mixHex(neutral2Dark, neutral2Bright, 0.8)
      : tone(palettes, "neutral1", 100, "#e6e9ef"),
  );
  const surface = materialRole(
    "outline",
    dark
      ? tone(palettes, "neutral2", 500, "#737680")
      : tone(palettes, "neutral2", 400, "#9aa3b2"),
  );
  const surfaceSoft = materialRole(
    "surface_container_highest",
    dark
      ? mixHex(neutral2Dark, neutral2Bright, 0.5)
      : tone(palettes, "neutral2", 200, "#d5dae2"),
  );
  const panelBorder = materialRole(
    "outline_variant",
    dark
      ? mixHex(
          tone(palettes, "neutral2", 700, "#44464f"),
          tone(palettes, "neutral2", 600, "#5c5e67"),
          0.1,
        )
      : surface,
  );
  const text = materialRole(
    "on_surface",
    dark
      ? tone(palettes, "neutral1", 100, "#e4e5f0")
      : tone(palettes, "neutral1", 900, "#1a1d29"),
  );
  const muted = materialRole(
    "on_surface_variant",
    dark
      ? tone(palettes, "neutral2", 300, "#a9aab5")
      : tone(palettes, "neutral2", 600, "#4b5263"),
  );
  const comment = materialRole(
    "outline",
    dark
      ? tone(palettes, "neutral2", 400, "#8f909a")
      : tone(palettes, "neutral2", 500, "#6b7280"),
  );
  const onAccent = materialRole(
    "on_primary",
    dark
      ? mixHex(
          tone(palettes, "accent1", 700, "#3a4668"),
          tone(palettes, "accent1", 800, "#232f50"),
          0.3,
        )
      : tone(palettes, "accent1", 0, "#ffffff"),
  );

  return {
    "--m3-primary": primary,
    "--m3-secondary": secondary,
    "--m3-tertiary": tertiary,
    "--cyan": primary,
    "--cyan-rgb": hexToRgb(primary),
    "--azure": primary,
    "--sky": primary,
    "--blue": primary,
    "--blue-rgb": hexToRgb(primary),
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
    "--panel-border": panelBorder,
    "--list-hover-bg": panel,
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
    "--terminal-black-rgb": hexToRgb(bgDarker),
    "--sync-ok": green,
    "--sync-working": primary,
    "--sync-unsaved": orange,
    "--on-accent": onAccent,
  };
}

export const THEME_VARS_CHANGED_EVENT = "theme-vars-changed";

function notifyThemeVarsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(THEME_VARS_CHANGED_EVENT));
  }
}

/** Subscribe to CSS variable updates performed outside React. */
export function useThemeVarsRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const handleChange = () => setRevision((value) => value + 1);
    window.addEventListener(THEME_VARS_CHANGED_EVENT, handleChange);
    return () => window.removeEventListener(THEME_VARS_CHANGED_EVENT, handleChange);
  }, []);
  return revision;
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
  // Canvas graphs snapshot computed vars at draw time; tell them to repaint.
  notifyThemeVarsChanged();
}

export function clearMaterialYouVars(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const name of MATERIAL_YOU_VARS) {
    root.style.removeProperty(name);
  }
  notifyThemeVarsChanged();
}
