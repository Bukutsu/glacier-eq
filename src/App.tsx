import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Bands } from "./components/Bands";
import { DeviceChooser } from "./components/DeviceChooser";
import { EqGraph } from "./components/EqGraph";
import { Header } from "./components/Header";
import { Icon } from "./components/Icon";
import { Preamp } from "./components/Preamp";
import { TargetSelector } from "./components/TargetSelector";
import { ToolsPanel, MeasureTab, AutoEqTab } from "./components/ToolsPanel";
import { DEFAULT_PROFILE_NAME } from "./constants";
import { DEV_DUMMY_DEVICE, buildDevDummyPeq, isDevDummyDevice } from "./lib/devDevice";
import { makeMeasurementName, nextMeasurementColor, normalizeMeasurementPoints } from "./lib/measurements";
import { getBuiltInTargets, makeTargetName, nextTargetColor } from "./lib/targetReferences";
import { buildDefaultState, normalizePeq } from "./lib/peq";
import { clearThemeCache } from "./lib/theme";
import type { DeviceInfo, Filter, GraphViewMode, MeasurementTrace, PEQData, Profile, TargetTrace, OperationProgress } from "./types";
import { ToastContainer, type Toast } from "./components/Toast";
import "./App.css";

const ANDROID_TOAST_DEDUPE_MS = 2000;

const sleep = (ms: number) => {
  const isAutomated = typeof navigator !== "undefined" && navigator.webdriver;
  return new Promise((resolve) => setTimeout(resolve, isAutomated ? 0 : ms));
};

declare global {
  interface Window {
    AndroidNotifier?: {
      showToast: (message: string) => void;
    };
    AndroidTheme?: {
      getMaterialColorTokens: () => string;
    };
  }
}

interface HSL {
  h: number;
  s: number;
  l: number;
}

const hexToHsl = (hex: string): HSL => {
  hex = hex.replace(/^#/, "");
  if (hex.length === 3) {
    hex = hex.split("").map((c) => c + c).join("");
  }
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
};

const hslToHex = (h: number, s: number, l: number): string => {
  h = (h % 360 + 360) % 360;
  s = Math.max(0, Math.min(100, s));
  l = Math.max(0, Math.min(100, l));

  s /= 100;
  l /= 100;
  h /= 360;

  let r = l;
  let g = l;
  let b = l;

  if (s !== 0) {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const clearAndroidDynamicColors = () => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const vars = [
    "--bg", "--bg-rgb",
    "--bg-dark", "--bg-dark-rgb",
    "--bg-darker", "--bg-darker-rgb",
    "--panel", "--panel-rgb",
    "--surface", "--surface-rgb",
    "--surface-soft", "--surface-soft-rgb",
    "--text", "--text-rgb",
    "--muted", "--muted-rgb",
    "--comment", "--comment-rgb",
    "--cyan", "--cyan-rgb",
    "--bright-cyan", "--bright-cyan-rgb",
    "--blue", "--blue-rgb",
    "--green", "--green-rgb",
    "--orange", "--orange-rgb",
    "--yellow", "--yellow-rgb",
    "--red", "--red-rgb",
    "--purple", "--purple-rgb",
    "--teal", "--teal-rgb",
    "--dark-cyan", "--dark-cyan-rgb",
    "--tab-active-pill",
    "--tab-active-icon",
    "--btn-filled-bg", "--btn-filled-bg-rgb",
    "--btn-filled-text", "--btn-filled-text-rgb",
    "--surface-disabled", "--surface-disabled-rgb",
    "--text-disabled", "--text-disabled-rgb",
    "--line", "--line-rgb",
    "--line-subtle", "--line-subtle-rgb",
    "--line-heavy", "--line-heavy-rgb",
    "--line-outline", "--line-outline-rgb"
  ];
  vars.forEach((v) => root.style.removeProperty(v));
};

const applyAndroidDynamicColors = (prefersDark: boolean) => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    const androidTheme = (window as any).AndroidTheme;
    if (!androidTheme) return;

    const tokensStr = androidTheme.getMaterialColorTokens();
    if (!tokensStr) return;

    const tokens = JSON.parse(tokensStr);
    if (!tokens || Object.keys(tokens).length === 0) return;

    const root = document.documentElement;

    const hexToRgb = (hex: string) => {
      const match = hex.replace("#", "").match(/.{1,2}/g);
      if (!match) return "0 0 0";
      return match.map((x) => Number.parseInt(x, 16)).join(" ");
    };

    const setVar = (name: string, value: string) => {
      if (!value) return;
      root.style.setProperty(name, value);
      if (value.startsWith("#")) {
        root.style.setProperty(`${name}-rgb`, hexToRgb(value));
      }
    };

    // Calculate base HSL from wallpaper primary accent for target/semantic color rotation
    const baseAccentHex = prefersDark
      ? (tokens.accent1_300 || "#8be9fd")
      : (tokens.accent1_600 || "#1e66f5");
    const baseAccentHsl = hexToHsl(baseAccentHex);

    // Resolve Material 3 color roles with robust fallbacks
    const low = tokens.surfaceContainerLow || (prefersDark ? "#16161f" : "#f7f7f9");
    const container = tokens.surfaceContainer || (prefersDark ? "#1d1d26" : "#eff1f5");
    const high = tokens.surfaceContainerHigh || (prefersDark ? "#282833" : "#e1e2ec");
    const outlineVariant = tokens.outlineVariant || (prefersDark ? "#44444f" : "#c4c6d0");
    const onSurface = tokens.onSurface || (prefersDark ? "#e3e3e9" : "#1a1c1e");
    const onSurfaceVariant = tokens.onSurfaceVariant || (prefersDark ? "#c4c4cf" : "#43474e");
    const primary = tokens.primary || (prefersDark ? "#8ca4f2" : "#1e66f5");
    const onPrimary = tokens.onPrimary || (prefersDark ? "#12131a" : "#ffffff");
    const primaryContainer = tokens.primaryContainer || (prefersDark ? "#2c303f" : "#dbe2f9");
    const onPrimaryContainer = tokens.onPrimaryContainer || (prefersDark ? "#a8c7fa" : "#001b3d");
    const secondaryContainer = tokens.secondaryContainer || primaryContainer;
    const onSecondaryContainer = tokens.onSecondaryContainer || onPrimaryContainer;

    // Apply M3 token mappings to Glacier EQ CSS variables
    setVar("--bg", container);
    setVar("--bg-dark", low);
    setVar("--bg-darker", low);
    setVar("--panel", high);
    setVar("--surface-soft", high);
    setVar("--surface", high);
    setVar("--text", onSurface);
    setVar("--muted", onSurfaceVariant);
    setVar("--comment", onSurfaceVariant);

    setVar("--cyan", primary);
    setVar("--bright-cyan", onPrimaryContainer);
    setVar("--btn-filled-bg", primary);
    setVar("--btn-filled-text", onPrimary);

    setVar("--tab-active-pill", secondaryContainer);
    setVar("--tab-active-icon", onSecondaryContainer);

    // Dividers/borders
    setVar("--line", outlineVariant);
    setVar("--line-subtle", outlineVariant);
    setVar("--line-soft", outlineVariant);
    setVar("--line-medium", outlineVariant);
    setVar("--line-strong", outlineVariant);
    setVar("--line-separator", outlineVariant);
    setVar("--line-heavy", outlineVariant);
    setVar("--line-separator-heavy", outlineVariant);
    setVar("--line-outline", outlineVariant);

    // Generate wallpaper-harmonized semantic/target colors (using hue rotation)
    const sat = Math.max(baseAccentHsl.s, prefersDark ? 50 : 60);
    const lit = prefersDark ? Math.max(baseAccentHsl.l, 65) : Math.min(baseAccentHsl.l, 45);

    setVar("--blue", hslToHex(215, sat, lit));
    setVar("--green", hslToHex(115, sat, lit));
    setVar("--orange", hslToHex(28, sat, lit));
    setVar("--yellow", hslToHex(48, sat, lit));
    setVar("--red", hslToHex(0, sat, lit));
    setVar("--purple", hslToHex(265, sat, lit));
    setVar("--teal", hslToHex(165, sat, lit));
    setVar("--dark-cyan", hslToHex(185, sat, lit));
  } catch (e) {
    console.error("Failed to apply Android dynamic colors:", e);
  }
};

function App() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 768px)").matches);
  const isAndroid = typeof navigator !== "undefined" && (
    document.body.classList.contains("is-android") ||
    /android/i.test(navigator.userAgent) ||
    typeof window.AndroidNotifier !== "undefined"
  );
  const [activeTab, setActiveTab] = useState<"eq" | "tuning" | "profiles" | "settings">("eq");

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const listener = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const [theme, setTheme] = useState("tokyo-night");
  const [resolvedTheme, setResolvedTheme] = useState("tokyo-night");
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  useEffect(() => {
    const applyTheme = async () => {
      let resolved = theme;
      
      // Clear any previous Android dynamic color overrides first
      clearAndroidDynamicColors();

      if (theme === "auto") {
        let prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        
        // If Android interface is present, apply dynamic Material You color tokens
        const androidTheme = (window as any).AndroidTheme;
        if (androidTheme) {
          applyAndroidDynamicColors(prefersDark);
          resolved = prefersDark ? "tokyo-night" : "catppuccin-latte"; // set data-theme so non-overridden base styles match
        } else if (!!(window as any).__TAURI_INTERNALS__) {
          // On environments like GNOME/Linux, prefers-color-scheme might not propagate instantly,
          // so query the Tauri window theme directly as a primary source of truth if available
          try {
            // First try GNOME settings check via backend
            const linuxScheme = await invoke<string>("get_linux_color_scheme");
            if (linuxScheme === "dark") {
              prefersDark = true;
            } else if (linuxScheme === "light") {
              prefersDark = false;
            } else {
              // Fall back to window.theme()
              const { getCurrentWindow } = await import("@tauri-apps/api/window");
              const appWindow = getCurrentWindow();
              const tauriTheme = await appWindow.theme();
              if (tauriTheme === "dark") {
                prefersDark = true;
              } else if (tauriTheme === "light") {
                prefersDark = false;
              }
            }
          } catch (e) {
            console.error("Failed to query Linux/Tauri window theme:", e);
          }
        }
        resolved = prefersDark ? "tokyo-night" : "catppuccin-latte";
      }
      setResolvedTheme(resolved);
      document.documentElement.setAttribute("data-theme", resolved);
      clearThemeCache();
    };

    applyTheme();

    const cleanups: (() => void)[] = [];

    // 1. Web media query listener
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleMediaChange = () => {
      applyTheme();
    };
    mediaQuery.addEventListener("change", handleMediaChange);
    cleanups.push(() => mediaQuery.removeEventListener("change", handleMediaChange));

    // 2. Tauri window theme change listener (for instant system theme events)
    if (theme === "auto" && !!(window as any).__TAURI_INTERNALS__) {
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

    // 3. Linux theme change backend event listener (for GNOME/dconf settings portal)
    if (theme === "auto" && !!(window as any).__TAURI_INTERNALS__) {
      let active = true;
      let tauriEventUnlisten: (() => void) | null = null;

      (async () => {
        try {
          const { listen } = await import("@tauri-apps/api/event");
          if (!active) return;
          const unlisten = await listen<string>("linux-theme-changed", (event) => {
            const linuxTheme = event.payload; // "dark" or "light"
            const resolved = linuxTheme === "dark" ? "tokyo-night" : "catppuccin-latte";
            setResolvedTheme(resolved);
            document.documentElement.setAttribute("data-theme", resolved);
            clearThemeCache();
          });
          if (!active) {
            unlisten();
          } else {
            tauriEventUnlisten = unlisten;
          }
        } catch (e) {
          console.error("Failed to listen to linux-theme-changed event:", e);
        }
      })();

      cleanups.push(() => {
        active = false;
        if (tauriEventUnlisten) {
          tauriEventUnlisten();
        }
      });
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [theme]);

  useEffect(() => {
    invoke<{ theme?: string; show_diagnostics?: boolean }>("get_settings")
      .then((settings) => {
        if (settings) {
          if (settings.theme) {
            setTheme(settings.theme);
          }
          if (settings.show_diagnostics !== undefined) {
            setShowDiagnostics(settings.show_diagnostics);
          }
        }
      })
      .catch((err) => {
        console.error("Failed to load initial settings:", err);
      });
  }, []);

  const [peq, setPeq] = useState<PEQData>(buildDefaultState);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [connected, setConnected] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [progress, setProgress] = useState<OperationProgress | null>(null);
  const [status, setStatusState] = useState("Ready");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastAndroidToastRef = useRef<{ message: string; shownAt: number } | null>(null);

  const showToast = useCallback((message: string, type: "info" | "error" | "success" = "info") => {
    if (isAndroid) return;
    if (message === "Ready" || !message.trim()) return;

    let toastType = type;
    if (message.toLowerCase().includes("failed") || message.toLowerCase().includes("error")) {
      toastType = "error";
    } else if (
      message.toLowerCase().includes("successful") ||
      message.toLowerCase().includes("synced") ||
      message.toLowerCase().includes("loaded") ||
      message.toLowerCase().includes("parsed") ||
      message.toLowerCase().includes("deleted") ||
      message.toLowerCase().includes("saved")
    ) {
      toastType = "success";
    }

    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type: toastType }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, [isAndroid]);

  const setStatus = useCallback((message: string) => {
    setStatusState(message);
    if (connected && !isAndroid) {
      showToast(message);
    }
  }, [connected, isAndroid, showToast]);

  // Show native Android Toast when status changes, instead of the web StatusBanner
  useEffect(() => {
    if (!isAndroid || status === "Ready") return;
    const now = Date.now();
    const lastToast = lastAndroidToastRef.current;
    if (lastToast?.message === status && now - lastToast.shownAt < ANDROID_TOAST_DEDUPE_MS) {
      return;
    }
    lastAndroidToastRef.current = { message: status, shownAt: now };
    try {
      window.AndroidNotifier?.showToast(status);
    } catch {
      // Native bridge not available, fall through silently
    }
  }, [status, isAndroid]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedPreset, setSelectedPreset] = useState(DEFAULT_PROFILE_NAME);
  const [profileSearch, setProfileSearch] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [measurements, setMeasurements] = useState<MeasurementTrace[]>([]);
  const builtInTargets = useMemo(getBuiltInTargets, []);
  const [userTargets, setUserTargets] = useState<TargetTrace[]>([]);
  const allTargets = useMemo(() => [...builtInTargets, ...userTargets], [builtInTargets, userTargets]);
  const [activeTargetIds, setActiveTargetIds] = useState<string[]>(() => builtInTargets[0] ? [builtInTargets[0].id] : []);
  const activeTargets = useMemo(
    () => allTargets.filter((target) => activeTargetIds.includes(target.id)),
    [activeTargetIds, allTargets],
  );
  const [graphViewMode, setGraphViewMode] = useState<GraphViewMode>(() => (
    window.localStorage.getItem("glacier-graph-view-mode") === "level" ? "level" : "shape"
  ));
  const [dirty, setDirty] = useState(false);
  const selectedPresetRef = useRef(selectedPreset);
  const peqRef = useRef(peq);

  useEffect(() => {
    peqRef.current = peq;
  }, [peq]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("glacier-measurements");
      if (!saved) return;

      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return;

      const normalized = parsed
        .filter((trace): trace is MeasurementTrace => (
          trace &&
          typeof trace.id === "string" &&
          typeof trace.name === "string" &&
          typeof trace.color === "string" &&
          typeof trace.visible === "boolean" &&
          Array.isArray(trace.points)
        ))
        .map((trace) => ({
          ...trace,
          points: normalizeMeasurementPoints(trace.points),
        }));

      setMeasurements(normalized);
    } catch {
      // Ignore malformed local measurement cache.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("glacier-measurements", JSON.stringify(measurements));
  }, [measurements]);

  useEffect(() => {
    try {
      const savedTargets = window.localStorage.getItem("glacier-user-targets");
      if (savedTargets) {
        const parsedTargets = JSON.parse(savedTargets);
        if (Array.isArray(parsedTargets)) {
          setUserTargets(parsedTargets
            .filter((target): target is TargetTrace => (
              target &&
              typeof target.id === "string" &&
              typeof target.name === "string" &&
              typeof target.color === "string" &&
              Array.isArray(target.points)
            ))
            .map((target) => ({
              ...target,
              builtIn: false,
              points: normalizeMeasurementPoints(target.points),
            })));
        }
      }

      const savedActiveIds = window.localStorage.getItem("glacier-active-targets");
      if (savedActiveIds) {
        const parsedActiveIds = JSON.parse(savedActiveIds);
        if (Array.isArray(parsedActiveIds) && parsedActiveIds.every((id) => typeof id === "string")) {
          setActiveTargetIds(parsedActiveIds);
        }
      }
    } catch {
      // Ignore malformed local target cache.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("glacier-user-targets", JSON.stringify(userTargets));
  }, [userTargets]);

  useEffect(() => {
    window.localStorage.setItem("glacier-active-targets", JSON.stringify(activeTargetIds));
  }, [activeTargetIds]);

  useEffect(() => {
    window.localStorage.setItem("glacier-graph-view-mode", graphViewMode);
  }, [graphViewMode]);

  const [undoStack, setUndoStack] = useState<PEQData[]>([]);
  const [redoStack, setRedoStack] = useState<PEQData[]>([]);

  const pushToUndoStack = useCallback((currentPeq: PEQData) => {
    setUndoStack((prev) => {
      if (prev.length > 0 && JSON.stringify(prev[prev.length - 1]) === JSON.stringify(currentPeq)) {
        return prev;
      }
      const next = [...prev, currentPeq];
      if (next.length > 50) {
        next.shift();
      }
      return next;
    });
    setRedoStack([]);
  }, []);

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, peqRef.current]);
    setPeq(prev);
    setDirty(true);
  }, [undoStack]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, peqRef.current]);
    setPeq(next);
    setDirty(true);
  }, [redoStack]);

  const handleStartChange = useCallback(() => {
    pushToUndoStack(peqRef.current);
  }, [pushToUndoStack]);

  useEffect(() => {
    selectedPresetRef.current = selectedPreset;
  }, [selectedPreset]);

  const deviceName = useMemo(() => {
    const selected = devices.find((device) => device.path === selectedDevice);
    return selected?.profile_name || selected?.product_string || "EPZ TP35 Pro";
  }, [devices, selectedDevice]);

  const applyProfile = useCallback((profile: Profile) => {
    pushToUndoStack(peqRef.current);
    const data = normalizePeq(profile.data, { enableLoadedFilters: true });
    selectedPresetRef.current = profile.name;
    setPeq(data);
    setSelectedPreset(profile.name);
    setNewProfileName(profile.name);
    setDirty(false);
  }, [pushToUndoStack]);

  const importPeq = useCallback((data: PEQData, name: string, isSaved: boolean) => {
    pushToUndoStack(peqRef.current);
    const normalized = normalizePeq(data, { enableLoadedFilters: true });
    setPeq(normalized);
    setSelectedPreset(name);
    setNewProfileName(name);
    setDirty(!isSaved);
  }, [pushToUndoStack]);

  const loadProfiles = useCallback(async () => {
    try {
      const loaded = await invoke<Profile[]>("list_profiles");
      setProfiles(loaded);

      const current = selectedPresetRef.current;
      const selected = loaded.find((profile) => profile.name === current) ?? loaded[0];
      if (selected) {
        applyProfile(selected);
      } else if (current === DEFAULT_PROFILE_NAME) {
        setPeq(buildDefaultState());
      }
    } catch (error) {
      setStatus(`Profile load failed: ${error}`);
    }
  }, [applyProfile]);

  const scanDevices = useCallback(async () => {
    setIsBusy(true);
    setStatus("Scanning for devices...");
    try {
      const realDevices = await invoke<DeviceInfo[]>("list_devices");
      const list = import.meta.env.DEV ? [...realDevices, DEV_DUMMY_DEVICE] : realDevices;
      setDevices(list);
      if (list[0]) setSelectedDevice(list[0].path);
      setStatus(list.length ? `Found ${list.length} device(s)` : "No compatible DACs found");
    } catch (error) {
      if (import.meta.env.DEV) {
        setDevices([DEV_DUMMY_DEVICE]);
        setSelectedDevice(DEV_DUMMY_DEVICE.path);
        setStatus("Hardware scan failed; using dummy DAC for dev review");
        return;
      }
      setStatus(`Scan failed: ${error}`);
    } finally {
      setIsBusy(false);
    }
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    let active = true;
    let unlistenFn: (() => void) | null = null;

    const safeUnlisten = (fn: () => void) => {
      try {
        const p = fn() as any;
        if (p && typeof p.catch === "function") {
          p.catch((err: any) => {
            console.warn("Failed to unlisten from operation-progress (async):", err);
          });
        }
      } catch (err) {
        console.warn("Failed to unlisten from operation-progress (sync):", err);
      }
    };

    listen<OperationProgress>("operation-progress", (event) => {
      setProgress(event.payload);
    }).then((fn) => {
      if (active) {
        unlistenFn = fn;
      } else {
        safeUnlisten(fn);
      }
    });

    return () => {
      active = false;
      if (unlistenFn) {
        safeUnlisten(unlistenFn);
      }
    };
  }, []);

  useEffect(() => {
    scanDevices();
  }, [scanDevices]);

  const pullEq = useCallback(async () => {
    pushToUndoStack(peqRef.current);
    setProgress(null);
    setIsBusy(true);
    try {
      let data: PEQData;
      if (isDevDummyDevice(selectedDevice)) {
        setProgress({ message: "Initializing read connection...", percentage: 5 });
        await sleep(200);
        setProgress({ message: "Reading band 1/10...", percentage: 15 });
        await sleep(150);
        setProgress({ message: "Reading band 4/10...", percentage: 40 });
        await sleep(150);
        setProgress({ message: "Reading band 7/10...", percentage: 65 });
        await sleep(150);
        setProgress({ message: "Reading band 10/10...", percentage: 85 });
        await sleep(150);
        setProgress({ message: "Reading device preamp...", percentage: 90 });
        await sleep(150);
        setProgress({ message: "Read successful", percentage: 100 });
        await sleep(400);
        data = buildDevDummyPeq();
      } else {
        data = await invoke<PEQData>("get_eq_state");
        await sleep(400);
      }
      setPeq(normalizePeq(data));
      selectedPresetRef.current = "Pulled from device";
      setSelectedPreset("Pulled from device");
      setDirty(false);
      setStatus(isDevDummyDevice(selectedDevice) ? "Loaded dummy DAC EQ" : "Pull successful");
    } catch (error) {
      setStatus(`Pull failed: ${error}`);
    } finally {
      setIsBusy(false);
      setProgress(null);
    }
  }, [pushToUndoStack, selectedDevice]);

  const connectDevice = useCallback(async () => {
    if (!selectedDevice) return;
    setIsBusy(true);
    try {
      if (isDevDummyDevice(selectedDevice)) {
        setConnected(true);
        setStatus("Connected to dummy DAC");
        await pullEq();
        return;
      }

      await invoke("connect_device", { path: selectedDevice });
      setConnected(true);
      setStatus("Ready");

      const settings = await invoke<{ auto_pull_on_connect: boolean }>("get_settings");
      if (settings.auto_pull_on_connect) {
        // We call the inner fetch code of pullEq directly or call pullEq itself.
        // Since pullEq sets state asynchronously, calling it is safe.
        await pullEq();
      }
    } catch (error) {
      setStatus(`Connection failed: ${error}`);
    } finally {
      setIsBusy(false);
    }
  }, [selectedDevice, pullEq]);

  const pushEq = useCallback(async () => {
    setProgress(null);
    setIsBusy(true);
    try {
      if (isDevDummyDevice(selectedDevice)) {
        setProgress({ message: "Initializing push connection...", percentage: 10 });
        await sleep(200);
        setProgress({ message: "Writing band 1/10...", percentage: 20 });
        await sleep(150);
        setProgress({ message: "Writing band 5/10...", percentage: 45 });
        await sleep(150);
        setProgress({ message: "Writing band 10/10...", percentage: 70 });
        await sleep(150);
        setProgress({ message: "Writing preamp...", percentage: 75 });
        await sleep(150);
        setProgress({ message: "Committing changes to device...", percentage: 80 });
        await sleep(200);
        setProgress({ message: "Verifying changes...", percentage: 90 });
        await sleep(200);
        setProgress({ message: "Push successful", percentage: 100 });
        await sleep(400);
      } else {
        await invoke("set_eq_state", { peq });
        await sleep(400);
      }
      setDirty(false);
      setStatus(isDevDummyDevice(selectedDevice) ? "Dummy DAC push simulated" : "Push successful");
    } catch (error) {
      setStatus(`Push failed: ${error}`);
    } finally {
      setIsBusy(false);
      setProgress(null);
    }
  }, [peq, selectedDevice]);

  const disconnectDevice = useCallback(async () => {
    setIsBusy(true);
    try {
      if (!isDevDummyDevice(selectedDevice)) {
        await invoke("disconnect_device");
      }
      setConnected(false);
      setStatus("Disconnected");
    } catch (error) {
      setStatus(`Disconnect failed: ${error}`);
    } finally {
      setIsBusy(false);
    }
  }, [selectedDevice]);

  const saveProfile = useCallback(async () => {
    const name = newProfileName.trim() || selectedPreset;
    if (!name || name === DEFAULT_PROFILE_NAME || name === "Pulled from device") {
      setStatus("Enter a profile name before saving.");
      return;
    }

    try {
      await invoke("save_profile", { name, peq });
      selectedPresetRef.current = name;
      setSelectedPreset(name);
      setNewProfileName("");
      setDirty(false);
      await loadProfiles();
      setStatus("Profile saved");
    } catch (error) {
      setStatus(`Save failed: ${error}`);
    }
  }, [loadProfiles, newProfileName, peq, selectedPreset]);

  const deleteSelectedProfile = useCallback(async () => {
    if (selectedPreset === DEFAULT_PROFILE_NAME) return;

    try {
      await invoke("delete_profile", { name: selectedPreset });
      selectedPresetRef.current = DEFAULT_PROFILE_NAME;
      setSelectedPreset(DEFAULT_PROFILE_NAME);
      setPeq(buildDefaultState());
      await loadProfiles();
      setStatus("Profile deleted");
    } catch (error) {
      setStatus(`Delete failed: ${error}`);
    }
  }, [loadProfiles, selectedPreset]);

  const openProfilesDir = useCallback(async () => {
    try {
      await invoke("open_profiles_dir");
    } catch (error) {
      setStatus(`Open profiles folder failed: ${error}`);
    }
  }, []);

  const updateFilter = (index: number, updated: Filter) => {
    setDirty(true);
    setPeq((previous) => {
      const filters = [...previous.filters];
      filters[index] = updated;
      return { ...previous, filters };
    });
  };

  const reset = () => {
    pushToUndoStack(peqRef.current);
    selectedPresetRef.current = DEFAULT_PROFILE_NAME;
    setPeq(buildDefaultState());
    setSelectedPreset(DEFAULT_PROFILE_NAME);
    setDirty(true);
  };

  const addMeasurement = useCallback((name: string, points: MeasurementTrace["points"]) => {
    setMeasurements((current) => [
      ...current,
      {
        id: `${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
        name: makeMeasurementName(name, current),
        color: nextMeasurementColor(current),
        visible: true,
        points: normalizeMeasurementPoints(points),
      },
    ]);
  }, []);

  const removeMeasurement = useCallback((id: string) => {
    setMeasurements((current) => current.filter((trace) => trace.id !== id));
  }, []);

  const toggleMeasurement = useCallback((id: string) => {
    setMeasurements((current) =>
      current.map((trace) => trace.id === id ? { ...trace, visible: !trace.visible } : trace),
    );
  }, []);

  const clearMeasurements = useCallback(() => {
    setMeasurements([]);
  }, []);

  const toggleTarget = useCallback((id: string) => {
    setActiveTargetIds((current) => (
      current.includes(id) ? current.filter((targetId) => targetId !== id) : [...current, id]
    ));
  }, []);

  const addTarget = useCallback((name: string, points: TargetTrace["points"]) => {
    setUserTargets((current) => {
      const nextTarget = {
        id: `user-target:${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
        name: makeTargetName(name, [...builtInTargets, ...current]),
        color: nextTargetColor(builtInTargets.length + current.length),
        builtIn: false,
        points: normalizeMeasurementPoints(points),
      };
      setActiveTargetIds((activeIds) => [...activeIds, nextTarget.id]);
      return [...current, nextTarget];
    });
  }, [builtInTargets]);

  const removeTarget = useCallback((id: string) => {
    setUserTargets((current) => current.filter((target) => target.id !== id));
    setActiveTargetIds((current) => current.filter((targetId) => targetId !== id));
  }, []);

  const undoRedoRef = useRef({
    undo,
    redo,
    save: saveProfile,
    reset,
    pull: pullEq,
    push: pushEq,
  });

  useEffect(() => {
    undoRedoRef.current = {
      undo,
      redo,
      save: saveProfile,
      reset,
      pull: pullEq,
      push: pushEq,
    };
  }, [undo, redo, saveProfile, reset, pullEq, pushEq]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const isEditingText = active && (
        active.tagName === "INPUT" || 
        active.tagName === "TEXTAREA" || 
        (active as HTMLElement).isContentEditable
      );

      const isCtrl = e.ctrlKey || e.metaKey;
      if (isCtrl) {
        if (isEditingText) {
          if (e.key.toLowerCase() === "s") {
            e.preventDefault();
            undoRedoRef.current.save();
          } else if (e.shiftKey && e.key.toLowerCase() === "r") {
            e.preventDefault();
            undoRedoRef.current.reset();
          } else if (e.key.toLowerCase() === "r") {
            e.preventDefault();
            undoRedoRef.current.pull();
          }
          return;
        }

        if (e.shiftKey && e.key.toLowerCase() === "z") {
          e.preventDefault();
          undoRedoRef.current.redo();
        } else if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          undoRedoRef.current.undo();
        } else if (e.key.toLowerCase() === "y") {
          e.preventDefault();
          undoRedoRef.current.redo();
        } else if (e.key.toLowerCase() === "s") {
          e.preventDefault();
          undoRedoRef.current.save();
        } else if (e.shiftKey && e.key.toLowerCase() === "r") {
          e.preventDefault();
          undoRedoRef.current.reset();
        } else if (e.key.toLowerCase() === "r") {
          e.preventDefault();
          undoRedoRef.current.pull();
        } else if (e.key === "Enter") {
          e.preventDefault();
          undoRedoRef.current.push();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div id="app">
      {!(isAndroid && activeTab === "settings") && (
        <Header
          connected={connected}
          isBusy={isBusy}
          progress={progress}
          profile={selectedPreset}
          deviceName={deviceName}
          dirty={dirty}
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          onUndo={undo}
          onRedo={redo}
          onPull={pullEq}
          onPush={pushEq}
          onDisconnect={disconnectDevice}
        />
      )}
      {!connected ? (
        <DeviceChooser
          devices={devices}
          onScan={scanDevices}
          onConnect={connectDevice}
          selectedDevice={selectedDevice}
          setSelectedDevice={setSelectedDevice}
          status={status}
          isBusy={isBusy}
        />
      ) : isMobile ? (
        <main className="workspace mobile-workspace">
          <div className="mobile-content-area">
            {activeTab === "eq" && (
              <section className="left-pane">
                <section className="graph-card">
                  <EqGraph
                    peq={peq}
                    measurements={measurements}
                    targets={activeTargets}
                    viewMode={graphViewMode}
                    theme={resolvedTheme}
                  />
                </section>
                <Preamp
                  value={peq.global_gain}
                  onStartChange={handleStartChange}
                  onChange={(global_gain) => {
                    setDirty(true);
                    setPeq((previous) => ({ ...previous, global_gain }));
                  }}
                />
                <Bands peq={peq} onFilterChange={updateFilter} onStartChange={handleStartChange} />
              </section>
            )}
            {activeTab === "tuning" && (
              <section className="left-pane">
                <section className="graph-card">
                  <EqGraph
                    peq={peq}
                    measurements={measurements}
                    targets={activeTargets}
                    viewMode={graphViewMode}
                    theme={resolvedTheme}
                  />
                </section>

                <TargetSelector
                  targets={allTargets}
                  activeTargetIds={activeTargetIds}
                  onToggleTarget={toggleTarget}
                  onAddTarget={addTarget}
                  onRemoveTarget={removeTarget}
                  setStatus={setStatus}
                />

                <section className="tuning-card card">
                  <div className="tuning-card-header">
                    <Icon>auto_awesome</Icon>
                    <strong>AutoEQ (Tuning Assistant)</strong>
                  </div>
                  <div className="tuning-card-body">
                    <AutoEqTab
                      measurements={measurements}
                      allTargets={allTargets}
                      onImportPEQ={importPeq}
                      setStatus={setStatus}
                    />
                  </div>
                </section>

                <section className="tuning-card card">
                  <div className="tuning-card-header">
                    <Icon>analytics</Icon>
                    <strong>Measurement Traces</strong>
                  </div>
                  <div className="tuning-card-body" style={{ padding: 0 }}>
                    <MeasureTab
                      measurements={measurements}
                      onAddMeasurement={addMeasurement}
                      onRemoveMeasurement={removeMeasurement}
                      onToggleMeasurement={toggleMeasurement}
                      onClearMeasurements={clearMeasurements}
                      setStatus={setStatus}
                    />
                  </div>
                </section>
              </section>
            )}
            {activeTab === "profiles" && (
              <ToolsPanel
                peq={peq}
                onImportPEQ={importPeq}
                profiles={profiles}
                selectedPreset={selectedPreset}
                profileSearch={profileSearch}
                setProfileSearch={setProfileSearch}
                newProfileName={newProfileName}
                setNewProfileName={setNewProfileName}
                onSelectProfile={applyProfile}
                onReloadProfiles={loadProfiles}
                onOpenProfilesDir={openProfilesDir}
                onReset={reset}
                onSave={saveProfile}
                onDelete={deleteSelectedProfile}
                setStatus={setStatus}
                measurements={measurements}
                onAddMeasurement={addMeasurement}
                onRemoveMeasurement={removeMeasurement}
                onToggleMeasurement={toggleMeasurement}
                onClearMeasurements={clearMeasurements}
                canUndo={undoStack.length > 0}
                canRedo={redoStack.length > 0}
                onUndo={undo}
                onRedo={redo}
                availableTabs={["Preset", "Import"]}
                defaultTab="Preset"
                showDiagnostics={showDiagnostics}
                onShowDiagnosticsChange={setShowDiagnostics}
                theme={theme}
                onThemeChange={setTheme}
              />
            )}
            {activeTab === "settings" && (
              <ToolsPanel
                peq={peq}
                onImportPEQ={importPeq}
                profiles={profiles}
                selectedPreset={selectedPreset}
                profileSearch={profileSearch}
                setProfileSearch={setProfileSearch}
                newProfileName={newProfileName}
                setNewProfileName={setNewProfileName}
                onSelectProfile={applyProfile}
                onReloadProfiles={loadProfiles}
                onOpenProfilesDir={openProfilesDir}
                onReset={reset}
                onSave={saveProfile}
                onDelete={deleteSelectedProfile}
                setStatus={setStatus}
                measurements={measurements}
                onAddMeasurement={addMeasurement}
                onRemoveMeasurement={removeMeasurement}
                onToggleMeasurement={toggleMeasurement}
                onClearMeasurements={clearMeasurements}
                canUndo={undoStack.length > 0}
                canRedo={redoStack.length > 0}
                onUndo={undo}
                onRedo={redo}
                availableTabs={["Settings"]}
                defaultTab="Settings"
                showActions={false}
                showDiagnostics={showDiagnostics}
                onShowDiagnosticsChange={setShowDiagnostics}
                graphViewMode={graphViewMode}
                onGraphViewModeChange={setGraphViewMode}
                theme={theme}
                onThemeChange={setTheme}
              />
            )}
          </div>
          <nav className="mobile-tab-bar">
            <button
              className={`mobile-tab-item ${activeTab === "eq" ? "active" : ""}`}
              onClick={() => setActiveTab("eq")}
            >
              <div className="mobile-tab-icon-wrapper">
                <Icon>tune</Icon>
              </div>
              <span>EQ</span>
            </button>
            <button
              className={`mobile-tab-item ${activeTab === "tuning" ? "active" : ""}`}
              onClick={() => setActiveTab("tuning")}
            >
              <div className="mobile-tab-icon-wrapper">
                <Icon>auto_awesome</Icon>
              </div>
              <span>Tuning</span>
            </button>
            <button
              className={`mobile-tab-item ${activeTab === "profiles" ? "active" : ""}`}
              onClick={() => setActiveTab("profiles")}
            >
              <div className="mobile-tab-icon-wrapper">
                <Icon>folder</Icon>
              </div>
              <span>Profiles</span>
            </button>
            <button
              className={`mobile-tab-item ${activeTab === "settings" ? "active" : ""}`}
              onClick={() => setActiveTab("settings")}
            >
              <div className="mobile-tab-icon-wrapper">
                <Icon>settings</Icon>
              </div>
              <span>Settings</span>
            </button>
          </nav>
        </main>
      ) : (
        <main className="workspace">
          <section className="left-pane">
            <section className="graph-card">
              <EqGraph
                peq={peq}
                measurements={measurements}
                targets={activeTargets}
                viewMode={graphViewMode}
                theme={resolvedTheme}
              />
            </section>
            <TargetSelector
              targets={allTargets}
              activeTargetIds={activeTargetIds}
              onToggleTarget={toggleTarget}
              onAddTarget={addTarget}
              onRemoveTarget={removeTarget}
              setStatus={setStatus}
            />
            <Preamp
              value={peq.global_gain}
              onStartChange={handleStartChange}
              onChange={(global_gain) => {
                setDirty(true);
                setPeq((previous) => ({ ...previous, global_gain }));
              }}
            />
            <Bands peq={peq} onFilterChange={updateFilter} onStartChange={handleStartChange} />
          </section>
          <ToolsPanel
            peq={peq}
            onImportPEQ={importPeq}
            profiles={profiles}
            selectedPreset={selectedPreset}
            profileSearch={profileSearch}
            setProfileSearch={setProfileSearch}
            newProfileName={newProfileName}
            setNewProfileName={setNewProfileName}
            onSelectProfile={applyProfile}
            onReloadProfiles={loadProfiles}
            onOpenProfilesDir={openProfilesDir}
            onReset={reset}
            onSave={saveProfile}
            onDelete={deleteSelectedProfile}
            setStatus={setStatus}
            measurements={measurements}
            allTargets={allTargets}
            onAddMeasurement={addMeasurement}
            onRemoveMeasurement={removeMeasurement}
            onToggleMeasurement={toggleMeasurement}
            onClearMeasurements={clearMeasurements}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            onUndo={undo}
            onRedo={redo}
            graphViewMode={graphViewMode}
            onGraphViewModeChange={setGraphViewMode}
            theme={theme}
            onThemeChange={setTheme}
            showDiagnostics={showDiagnostics}
            onShowDiagnosticsChange={setShowDiagnostics}
          />
        </main>
      )}
      <ToastContainer toasts={toasts} onClose={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </div>
  );
}

export default App;
