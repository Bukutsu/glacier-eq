import { i18n } from "@/lib/i18n";
import type { AppSettings } from "@/types";

export type ThemeOption = {
  value: AppSettings["theme"];
  label: string;
};

/**
 * The themes Settings offers, in display order.
 *
 * Material You reads the Android system palette, so it is listed only on
 * Android. It used to be listed everywhere and honoured everywhere: off
 * Tauri the palette read failed and useThemeSync silently fell back to Tokyo
 * Night, so a desktop or web user could pick "System (Material You)" and get a
 * different theme with no explanation. The platform arrives as an argument so
 * the list is a total function of its input rather than of a global the test
 * has to fake.
 */
export function themeOptions(isAndroid: boolean): ThemeOption[] {
  return [
    { value: "auto", label: i18n.t("settings:themes.autoSystemTheme") },
    ...(isAndroid
      ? [
          {
            value: "material-you" as const,
            label: i18n.t("settings:themes.systemMaterialYou"),
          },
        ]
      : []),
    { value: "glacier", label: i18n.t("settings:themes.glacierDark") },
    { value: "glacier-light", label: i18n.t("settings:themes.glacierLight") },
    { value: "tokyo-night", label: i18n.t("settings:themes.tokyoNight") },
    {
      value: "tokyo-night-storm",
      label: i18n.t("settings:themes.tokyoNightStorm"),
    },
    {
      value: "tokyo-night-day",
      label: i18n.t("settings:themes.tokyoNightDayLight"),
    },
    { value: "nord", label: i18n.t("settings:themes.nord") },
    { value: "dracula", label: i18n.t("settings:themes.dracula") },
    { value: "gruvbox", label: i18n.t("settings:themes.gruvboxDark") },
    {
      value: "catppuccin-mocha",
      label: i18n.t("settings:themes.catppuccinMocha"),
    },
    {
      value: "catppuccin-latte",
      label: i18n.t("settings:themes.catppuccinLatteLight"),
    },
  ];
}

/** Auto keeps both system appearances in the Glacier palette. */
export function systemThemeName(
  prefersDark: boolean,
): "glacier" | "glacier-light" {
  return prefersDark ? "glacier" : "glacier-light";
}

export function cssVar(name: string, fallback = ""): string {
  if (typeof document === "undefined") return fallback;
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}

export function rgbWithAlpha(
  name: string,
  alpha: number,
  fallback = "",
): string {
  const resolved = cssVar(name, fallback);
  if (!resolved) return "transparent";

  if (resolved.startsWith("#")) {
    const hex = Number.parseInt(resolved.slice(1), 16);
    return `rgba(${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}, ${alpha})`;
  }

  // `resolved` is a space-separated triplet (e.g. "122 162 247"); use the
  // modern slash syntax — mixing spaces with a comma is invalid CSS.
  return `rgba(${resolved} / ${alpha})`;
}
