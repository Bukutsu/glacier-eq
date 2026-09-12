import { useEffect, useState } from "react";
import {
  applyMaterialYouVars,
  clearMaterialYouVars,
  getMaterialYouColors,
  materialYouToCssVars,
} from "../lib/materialYou";
import { isAndroidDevice, isTauri } from "../lib/platform";

const THEME_BG_COLORS: Record<string, string> = {
  "material-you": "#181920",
  "tokyo-night": "#1a1b26",
  "tokyo-night-storm": "#24283b",
  "tokyo-night-day": "#e1e2e7",
  nord: "#2e3440",
  dracula: "#191a21",
  gruvbox: "#282828",
  "catppuccin-mocha": "#1e1e2e",
  "catppuccin-latte": "#e6e9ef",
};

function updateThemeColorMeta(themeName: string, overrideColor?: string) {
  if (typeof document === "undefined") return;
  const color = overrideColor ?? THEME_BG_COLORS[themeName] ?? "#1a1b26";
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", color);
}

function getInitialTheme(theme: string): string {
  if (theme !== "auto") return theme;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "tokyo-night"
      : "tokyo-night-day";
  }
  return "tokyo-night";
}

export function useThemeSync(theme: string): string {
  const [resolvedTheme, setResolvedTheme] = useState(() => getInitialTheme(theme));

  useEffect(() => {
    let active = true;

    const isAndroid = isAndroidDevice();

    // Try Material You; returns true when dynamic colors were applied.
    const applyMaterialYou = async (): Promise<boolean> => {
      if (!isTauri()) return false;
      try {
        const colors = await getMaterialYouColors();
        if (!active || !colors) return false;
        const vars = materialYouToCssVars(colors);
        applyMaterialYouVars(vars);
        updateThemeColorMeta("material-you", vars["--bg"]);
        console.info(
          `[theme] Material You applied (dark=${colors.dark} primary=${vars["--cyan"]})`,
        );
        return true;
      } catch (e) {
        console.error("Failed to read Material You colors:", e);
        return false;
      }
    };

    const applyTheme = async () => {
      let resolved = theme;

      if (theme === "material-you" || (theme === "auto" && isAndroid)) {
        if (!active) return;
        setResolvedTheme("material-you");
        document.documentElement.setAttribute("data-theme", "material-you");
        if (await applyMaterialYou()) return;
        // Unavailable (desktop, web, or pre-Android-12): fall back to auto.
        clearMaterialYouVars();
        const prefersDark = window.matchMedia(
          "(prefers-color-scheme: dark)",
        ).matches;
        resolved = prefersDark ? "tokyo-night" : "tokyo-night-day";
        if (!active) return;
        setResolvedTheme(resolved);
        document.documentElement.setAttribute("data-theme", resolved);
        updateThemeColorMeta(resolved);
        return;
      }

      clearMaterialYouVars();

      if (theme === "auto") {
        let prefersDark = window.matchMedia(
          "(prefers-color-scheme: dark)",
        ).matches;

        if (!isAndroid && isTauri()) {
          try {
            const { getCurrentWindow } =
              await import("@tauri-apps/api/window");
            const appWindow = getCurrentWindow();
            const tauriTheme = await appWindow.theme();
            if (tauriTheme === "dark") {
              prefersDark = true;
            } else if (tauriTheme === "light") {
              prefersDark = false;
            }
          } catch (e) {
            console.error("Failed to query Tauri window theme:", e);
          }
        }
        resolved = prefersDark ? "tokyo-night" : "tokyo-night-day";
      }

      if (!active) return;
      setResolvedTheme(resolved);
      document.documentElement.setAttribute("data-theme", resolved);
      updateThemeColorMeta(resolved);
    };

    applyTheme();

    const cleanups: (() => void)[] = [];

    // 1. Web media query listener
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleMediaChange = () => {
      applyTheme();
    };
    mediaQuery.addEventListener("change", handleMediaChange);
    cleanups.push(() =>
      mediaQuery.removeEventListener("change", handleMediaChange),
    );

    // 2. Tauri window theme change listener (for instant system theme events)
    if (theme === "auto" && isTauri()) {
      let listenerActive = true;
      let tauriUnlisten: (() => void) | null = null;

      (async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const appWindow = getCurrentWindow();
          if (!listenerActive) return;
          const unlisten = await appWindow.onThemeChanged(() => {
            applyTheme();
          });
          if (!listenerActive) {
            unlisten();
          } else {
            tauriUnlisten = unlisten;
          }
        } catch (e) {
          console.error("Failed to listen to Tauri theme change:", e);
        }
      })();

      cleanups.push(() => {
        listenerActive = false;
        if (tauriUnlisten) {
          tauriUnlisten();
        }
      });
    }

    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [theme]);

  return resolvedTheme;
}
