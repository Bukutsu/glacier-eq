import type { AppSettings } from "../types";

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
    { value: "auto", label: "Auto (System Theme)" },
    ...(isAndroid
      ? [{ value: "material-you" as const, label: "System (Material You)" }]
      : []),
    { value: "glacier", label: "Glacier" },
    { value: "tokyo-night", label: "Tokyo Night" },
    { value: "tokyo-night-storm", label: "Tokyo Night Storm" },
    { value: "tokyo-night-day", label: "Tokyo Night Day (Light)" },
    { value: "nord", label: "Nord" },
    { value: "dracula", label: "Dracula" },
    { value: "gruvbox", label: "Gruvbox Dark" },
    { value: "catppuccin-mocha", label: "Catppuccin Mocha" },
    { value: "catppuccin-latte", label: "Catppuccin Latte (Light)" },
  ];
}

export function cssVar(name: string, fallback = ""): string {
  if (typeof document === "undefined") return fallback;
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim() || fallback
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
