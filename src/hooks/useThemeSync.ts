import { useEffect, useState } from "react";
import { isTauri } from "../lib/platform";

export function useThemeSync(theme: string): string {
  const [resolvedTheme, setResolvedTheme] = useState("tokyo-night");

  useEffect(() => {
    const isAndroid =
      typeof navigator !== "undefined" &&
      (document.body.classList.contains("is-android") ||
        /android/i.test(navigator.userAgent) ||
        typeof window.AndroidNotifier !== "undefined");

    const applyTheme = async () => {
      let resolved = theme;

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
        resolved = prefersDark ? "tokyo-night" : "catppuccin-latte";
      }
      setResolvedTheme(resolved);
      document.documentElement.setAttribute("data-theme", resolved);
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
      let active = true;
      let tauriUnlisten: (() => void) | null = null;

      (async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const appWindow = getCurrentWindow();
          if (!active) return;
          const unlisten = await appWindow.onThemeChanged(() => {
            applyTheme();
          });
          if (!active) {
            unlisten();
          } else {
            tauriUnlisten = unlisten;
          }
        } catch (e) {
          console.error("Failed to listen to Tauri theme change:", e);
        }
      })();

      cleanups.push(() => {
        active = false;
        if (tauriUnlisten) {
          tauriUnlisten();
        }
      });
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [theme]);

  return resolvedTheme;
}
