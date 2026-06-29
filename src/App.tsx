import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, listen } from "./lib/rpc";
import { Bands } from "./components/Bands";
import { DeviceChooser } from "./components/DeviceChooser";
import { EqGraph } from "./components/EqGraph";
import { Header } from "./components/Header";
import { Icon } from "./components/Icon";
import { Preamp } from "./components/Preamp";
import { TargetSelector } from "./components/TargetSelector";
import { ToolsPanel, MeasureTab, AutoEqTab } from "./components/ToolsPanel";
import {
  DEV_DUMMY_DEVICE,
  buildDevDummyPeq,
  isDevDummyDevice,
} from "./lib/devDevice";
import {
  makeMeasurementName,
  nextMeasurementColor,
  normalizeMeasurementPoints,
} from "./lib/measurements";
import {
  getBuiltInTargets,
  makeTargetName,
  nextTargetColor,
} from "./lib/targetReferences";
import { buildDefaultState, normalizePeq, peqEquals } from "./lib/peq";
import { isTauri } from "./lib/platform";
import { clearThemeCache } from "./lib/theme";
import type {
  DeviceInfo,
  Filter,
  GraphViewMode,
  MeasurementTrace,
  PEQData,
  Profile,
  TargetTrace,
  OperationProgress,
  AppSettings,
} from "./types";
import { ToastContainer, type Toast } from "./components/Toast";
import "./App.css";

const ANDROID_TOAST_DEDUPE_MS = 2000;
const DEFAULT_PROFILE_NAME = "Default EQ";
const DEFAULT_SETTINGS: AppSettings = {
  auto_pull_on_connect: true,
  skip_push_verification: false,
  theme: "tokyo-night",
  show_diagnostics: false,
  enable_online_measurements: false,
  snap_to_iso_frequencies: true,
};

function usePersistedJson(key: string, value: unknown, delayMs = 0) {
  useEffect(() => {
    const save = () => window.localStorage.setItem(key, JSON.stringify(value));
    if (delayMs <= 0) {
      save();
      return;
    }
    const timer = window.setTimeout(save, delayMs);
    return () => window.clearTimeout(timer);
  }, [key, value, delayMs]);
}

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

const ANDROID_DYNAMIC_COLOR_VARS = [
  "--bg",
  "--bg-dark",
  "--bg-darker",
  "--panel",
  "--surface",
  "--surface-soft",
  "--text",
  "--muted",
  "--comment",
  "--cyan",
  "--bright-cyan",
  "--btn-filled-bg",
  "--btn-filled-text",
  "--tab-active-pill",
  "--tab-active-icon",
  "--line",
  "--line-subtle",
  "--line-soft",
  "--line-medium",
  "--line-strong",
  "--line-separator",
  "--line-heavy",
  "--line-separator-heavy",
  "--line-outline",
] as const;

const clearAndroidDynamicColors = () => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  ANDROID_DYNAMIC_COLOR_VARS.forEach((name) => {
    root.style.removeProperty(name);
    root.style.removeProperty(`${name}-rgb`);
  });
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

    const low =
      tokens.surfaceContainerLow || (prefersDark ? "#16161f" : "#f7f7f9");
    const container =
      tokens.surfaceContainer || (prefersDark ? "#1d1d26" : "#eff1f5");
    const high =
      tokens.surfaceContainerHigh || (prefersDark ? "#282833" : "#e1e2ec");
    const outlineVariant =
      tokens.outlineVariant || (prefersDark ? "#44444f" : "#c4c6d0");
    const onSurface = tokens.onSurface || (prefersDark ? "#e3e3e9" : "#1a1c1e");
    const onSurfaceVariant =
      tokens.onSurfaceVariant || (prefersDark ? "#c4c4cf" : "#43474e");
    const primary = tokens.primary || (prefersDark ? "#8ca4f2" : "#1e66f5");
    const onPrimary = tokens.onPrimary || (prefersDark ? "#12131a" : "#ffffff");
    const primaryContainer =
      tokens.primaryContainer || (prefersDark ? "#2c303f" : "#dbe2f9");
    const onPrimaryContainer =
      tokens.onPrimaryContainer || (prefersDark ? "#a8c7fa" : "#001b3d");
    const secondaryContainer = tokens.secondaryContainer || primaryContainer;
    const onSecondaryContainer =
      tokens.onSecondaryContainer || onPrimaryContainer;

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

    setVar("--line", outlineVariant);
    setVar("--line-subtle", outlineVariant);
    setVar("--line-soft", outlineVariant);
    setVar("--line-medium", outlineVariant);
    setVar("--line-strong", outlineVariant);
    setVar("--line-separator", outlineVariant);
    setVar("--line-heavy", outlineVariant);
    setVar("--line-separator-heavy", outlineVariant);
    setVar("--line-outline", outlineVariant);

  } catch (e) {
    console.error("Failed to apply Android dynamic colors:", e);
  }
};

const MOBILE_QUERY = "(max-width: 768px) and (min-height: 600px)";

const isDisconnectionError = (error: any): boolean => {
  const errStr = String(error).toLowerCase();
  return (
    errStr.includes("device disconnected") ||
    errStr.includes("disconnected") ||
    errStr.includes("no such device") ||
    errStr.includes("device not open") ||
    errStr.includes("no longer exists")
  );
};

function App() {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia(MOBILE_QUERY).matches,
  );
  const isAndroid =
    typeof navigator !== "undefined" &&
    (document.body.classList.contains("is-android") ||
      /android/i.test(navigator.userAgent) ||
      typeof window.AndroidNotifier !== "undefined");
  const [activeTab, setActiveTab] = useState<
    "eq" | "tuning" | "profiles" | "settings"
  >("eq");

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const listener = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const theme = settings.theme;
  const enableOnlineMeasurements = settings.enable_online_measurements;
  const snapToIso = settings.snap_to_iso_frequencies;
  const [resolvedTheme, setResolvedTheme] = useState("tokyo-night");
  const [showGraphPreview, setShowGraphPreview] = useState(false);
  const graphPreviewTimerRef = useRef<number | null>(null);

  const updateSetting = useCallback(<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    setSettings((previous) => {
      const updated = { ...previous, [key]: value };
      if (isTauri()) {
        invoke("save_settings", { settings: updated }).catch((err) => {
          console.error("Failed to save settings:", err);
        });
      }
      return updated;
    });
  }, []);

  const handleEnableOnlineMeasurementsChange = useCallback((value: boolean) => {
    updateSetting("enable_online_measurements", value);
  }, [updateSetting]);

  useEffect(() => {
    const applyTheme = async () => {
      let resolved = theme;

      // Clear any previous Android dynamic color overrides first
      clearAndroidDynamicColors();

      if (theme === "auto") {
        let prefersDark = window.matchMedia(
          "(prefers-color-scheme: dark)",
        ).matches;

        // If Android interface is present, apply dynamic Material You color tokens
        const androidTheme = (window as any).AndroidTheme;
        if (androidTheme) {
          applyAndroidDynamicColors(prefersDark);
          resolved = prefersDark ? "tokyo-night" : "catppuccin-latte"; // set data-theme so non-overridden base styles match
        } else if (isTauri()) {
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

  useEffect(() => {
    if (!isTauri()) return;

    invoke<AppSettings>("get_settings")
      .then((settings) => {
        setSettings({ ...DEFAULT_SETTINGS, ...settings });
      })
      .catch((err) => {
        console.error("Failed to load initial settings:", err);
      });
  }, []);

  const [peq, setPeq] = useState<PEQData>(buildDefaultState);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [connected, setConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [connectedDeviceName, setConnectedDeviceName] = useState("");
  const [firmwareVersion, setFirmwareVersion] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [progress, setProgress] = useState<OperationProgress | null>(null);
  const [status, setStatusState] = useState("Ready");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastAndroidToastRef = useRef<{
    message: string;
    shownAt: number;
  } | null>(null);

  const showToast = useCallback(
    (message: string, type: "info" | "error" | "success" = "info") => {
      if (isAndroid) return;
      if (message === "Ready" || !message.trim()) return;

      let toastType = type;
      if (
        message.toLowerCase().includes("failed") ||
        message.toLowerCase().includes("error")
      ) {
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

      // Automatically log all toast notifications to the diagnostics board
      const diagLevel = toastType === "error" ? "Error" : "Info";
      invoke("add_diagnostic_event", {
        level: diagLevel,
        source: "UI",
        message: `Notification: ${message}`,
      }).catch((err) => console.error("Failed to log diagnostic from toast:", err));

      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev, { id, message, type: toastType }]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    },
    [isAndroid],
  );

  const setStatus = useCallback(
    (message: string) => {
      setStatusState(message);
      if (connected && !isAndroid) {
        showToast(message);
      }
    },
    [connected, isAndroid, showToast],
  );

  const reportStatus = useCallback((
    level: "Info" | "Warn" | "Error",
    message: string,
    toastType: "success" | "info" | "error" | null = null,
    source: "UI" | "Worker" | "HID" | "AutoEQ" | "Device" = "UI",
    statusText: string = message
  ) => {
    setStatusState(statusText);
    invoke("add_diagnostic_event", { level, source, message })
      .catch((err) => console.error("Failed to log diagnostic:", err));
    if (toastType) {
      showToast(message, toastType);
    }
  }, [showToast]);

  // Show native Android Toast when status changes, instead of the web StatusBanner
  useEffect(() => {
    if (!isAndroid || status === "Ready") return;
    const now = Date.now();
    const lastToast = lastAndroidToastRef.current;
    if (
      lastToast?.message === status &&
      now - lastToast.shownAt < ANDROID_TOAST_DEDUPE_MS
    ) {
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
  const allTargets = useMemo(
    () => [...builtInTargets, ...userTargets],
    [builtInTargets, userTargets],
  );
  const [activeTargetIds, setActiveTargetIds] = useState<string[]>([]);
  const activeTargets = useMemo(
    () => allTargets.filter((target) => activeTargetIds.includes(target.id)),
    [activeTargetIds, allTargets],
  );
  const [graphViewMode, setGraphViewMode] = useState<GraphViewMode>(() =>
    window.localStorage.getItem("glacier-graph-view-mode") === "level"
      ? "level"
      : "shape",
  );
  const [dirty, setDirty] = useState(false);
  const selectedPresetRef = useRef(selectedPreset);
  const peqRef = useRef(peq);
  const [lastPushedPeq, setLastPushedPeq] = useState<PEQData | null>(null);
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);
  const [activeBandIndex, setActiveBandIndex] = useState<number | null>(null);

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
        .filter(
          (trace): trace is MeasurementTrace =>
            trace &&
            typeof trace.id === "string" &&
            typeof trace.name === "string" &&
            typeof trace.color === "string" &&
            typeof trace.visible === "boolean" &&
            Array.isArray(trace.points),
        )
        .map((trace) => ({
          ...trace,
          points: normalizeMeasurementPoints(trace.points),
        }));

      setMeasurements(normalized);
    } catch {
      // Ignore malformed local measurement cache.
    }
  }, []);

  usePersistedJson("glacier-measurements", measurements, 300);

  useEffect(() => {
    try {
      const savedTargets = window.localStorage.getItem("glacier-user-targets");
      if (savedTargets) {
        const parsedTargets = JSON.parse(savedTargets);
        if (Array.isArray(parsedTargets)) {
          setUserTargets(
            parsedTargets
              .filter(
                (target): target is TargetTrace =>
                  target &&
                  typeof target.id === "string" &&
                  typeof target.name === "string" &&
                  typeof target.color === "string" &&
                  Array.isArray(target.points),
              )
              .map((target) => ({
                ...target,
                builtIn: false,
                points: normalizeMeasurementPoints(target.points),
              })),
          );
        }
      }

      const savedActiveIds = window.localStorage.getItem(
        "glacier-active-targets",
      );
      if (savedActiveIds) {
        const parsedActiveIds = JSON.parse(savedActiveIds);
        if (
          Array.isArray(parsedActiveIds) &&
          parsedActiveIds.every((id) => typeof id === "string")
        ) {
          setActiveTargetIds(parsedActiveIds);
        }
      }
    } catch {
      // Ignore malformed local target cache.
    }
  }, []);

  usePersistedJson("glacier-user-targets", userTargets, 300);
  usePersistedJson("glacier-active-targets", activeTargetIds);

  useEffect(() => {
    window.localStorage.setItem("glacier-graph-view-mode", graphViewMode);
  }, [graphViewMode]);

  const [undoStack, setUndoStack] = useState<PEQData[]>([]);
  const [redoStack, setRedoStack] = useState<PEQData[]>([]);

  const pushToUndoStack = useCallback((currentPeq: PEQData) => {
    setUndoStack((prev) => {
      if (prev.length > 0 && peqEquals(prev[prev.length - 1], currentPeq)) {
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

  const flashGraphPreview = useCallback(() => {
    if (!isMobile || activeTab !== "eq") return;
    if (graphPreviewTimerRef.current !== null) {
      window.clearTimeout(graphPreviewTimerRef.current);
    }
    setShowGraphPreview(true);
    graphPreviewTimerRef.current = window.setTimeout(() => {
      setShowGraphPreview(false);
      graphPreviewTimerRef.current = null;
    }, 900);
  }, [activeTab, isMobile]);

  useEffect(
    () => () => {
      if (graphPreviewTimerRef.current !== null) {
        window.clearTimeout(graphPreviewTimerRef.current);
      }
    },
    [],
  );

  const handleStartChange = useCallback(() => {
    flashGraphPreview();
    pushToUndoStack(peqRef.current);
  }, [flashGraphPreview, pushToUndoStack]);

  useEffect(() => {
    selectedPresetRef.current = selectedPreset;
  }, [selectedPreset]);

  const deviceName = useMemo(() => {
    const selected = devices.find((device) => device.path === selectedDevice);
    return selected?.profile_name || selected?.product_string || "Supported DAC";
  }, [devices, selectedDevice]);

  const maxFilterBands = useMemo(() => {
    const selected = devices.find((device) => device.path === selectedDevice);
    return selected?.num_bands ?? peq.filters.length;
  }, [devices, peq.filters.length, selectedDevice]);

  const supportsRamApply = useMemo(() => {
    const selected = devices.find((device) => device.path === selectedDevice);
    return selected?.supports_ram_apply === true;
  }, [devices, selectedDevice]);

  const loadFirmwareVersion = useCallback(async () => {
    if (isDevDummyDevice(selectedDevice)) {
      setFirmwareVersion("DEV");
      return;
    }
    try {
      setFirmwareVersion(await invoke<string | null>("get_firmware_version"));
    } catch (error) {
      setFirmwareVersion(null);
      console.error("Failed to read firmware version:", error);
    }
  }, [selectedDevice]);

  const applyProfile = useCallback(
    (profile: Profile) => {
      pushToUndoStack(peqRef.current);
      const data = normalizePeq(profile.data, { enableLoadedFilters: true });
      selectedPresetRef.current = profile.name;
      setPeq(data);
      setSelectedPreset(profile.name);
      setNewProfileName(profile.name);
      setDirty(false);
    },
    [pushToUndoStack],
  );

  const importPeq = useCallback(
    (data: PEQData, name: string, isSaved: boolean) => {
      pushToUndoStack(peqRef.current);
      const normalized = normalizePeq(data, { enableLoadedFilters: true });
      setPeq(normalized);
      setSelectedPreset(name);
      setNewProfileName(name);
      setDirty(!isSaved);
    },
    [pushToUndoStack],
  );

  const loadProfiles = useCallback(async () => {
    try {
      const loaded = await invoke<Profile[]>("list_profiles");
      setProfiles(loaded);

      const current = selectedPresetRef.current;
      const selected =
        loaded.find((profile) => profile.name === current) ?? loaded[0];
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
      const list = import.meta.env.DEV
        ? [...realDevices, DEV_DUMMY_DEVICE]
        : realDevices;
      setDevices(list);
      if (list[0]) setSelectedDevice(list[0].path);
      setStatus(
        list.length
          ? `Found ${list.length} device(s)`
          : "No compatible DACs found",
      );
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
    if (!isTauri()) return;

    let active = true;
    const unlistenFns: (() => void)[] = [];

    listen<OperationProgress>("operation-progress", (event) => {
      setProgress(event.payload);
    }).then((fn) => {
      if (active) {
        unlistenFns.push(fn);
      } else {
        try { fn(); } catch {}
      }
    });

    listen<string>("device-disconnected", (event) => {
      setIsReconnecting(true);
      setFirmwareVersion(null);
      reportStatus("Error", `Connection lost to device (unplugged): ${event.payload}`, "error", "Device", "Reconnecting...");
    }).then((fn) => {
      if (active) {
        unlistenFns.push(fn);
      } else {
        try { fn(); } catch {}
      }
    });

    return () => {
      active = false;
      unlistenFns.forEach((fn) => {
        try { fn(); } catch {}
      });
    };
  }, [reportStatus]);

  useEffect(() => {
    scanDevices();
  }, [scanDevices]);

  // Global uncaught error and promise rejection logger
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const msg = `Uncaught error: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`;
      invoke("add_diagnostic_event", { level: "Error", source: "UI", message: msg })
        .catch((err) => console.error("Failed to log uncaught error:", err));
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const reasonStr = event.reason instanceof Error ? event.reason.message : String(event.reason);
      const msg = `Unhandled rejection: ${reasonStr}`;
      invoke("add_diagnostic_event", { level: "Error", source: "UI", message: msg })
        .catch((err) => console.error("Failed to log unhandled rejection:", err));
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  // Automatic reconnection loop
  useEffect(() => {
    if (!isReconnecting || !connectedDeviceName) return;

    let active = true;
    let timerId: any = null;

    const runPoll = async () => {
      if (!active) return;
      try {
        const realDevices = await invoke<DeviceInfo[]>("list_devices");
        const found = realDevices.find(
          (d) =>
            d.profile_name === connectedDeviceName ||
            d.product_string === connectedDeviceName
        );
        if (found && active) {
          reportStatus("Info", `Device found: ${connectedDeviceName}. Attempting to reconnect...`, null, "Device", "Device found. Reconnecting...");
          try {
            await invoke("connect_device", { path: found.path });
            await invoke("set_eq_state", { peq: peqRef.current });
            
            if (active) {
              setSelectedDevice(found.path);
              setConnected(true);
              setIsReconnecting(false);
              await loadFirmwareVersion();
              reportStatus("Info", `Successfully reconnected to ${connectedDeviceName} and restored EQ state`, "success", "Device", "Ready");
              return;
            }
          } catch (err) {
            reportStatus("Warn", `Auto-reconnect connection failed: ${err}. Retrying...`, null, "Device", "Reconnecting...");
            try {
              await invoke("disconnect_device");
            } catch {}
          }
        }
      } catch (error) {
        console.error("Auto-reconnect poll error:", error);
      }

      if (active) {
        timerId = setTimeout(runPoll, 1500);
      }
    };

    timerId = setTimeout(runPoll, 1000);

    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [isReconnecting, connectedDeviceName, loadFirmwareVersion, reportStatus]);

  const pullEq = useCallback(async () => {
    pushToUndoStack(peqRef.current);
    setProgress(null);
    setIsBusy(true);
    try {
      let data: PEQData;
      if (isDevDummyDevice(selectedDevice)) {
        setProgress({
          message: "Initializing read connection...",
          percentage: 5,
        });
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
      const normalized = normalizePeq(data);
      setPeq(normalized);
      setLastPushedPeq(normalized);
      selectedPresetRef.current = "Pulled from device";
      setSelectedPreset("Pulled from device");
      setDirty(false);
      reportStatus(
        "Info",
        isDevDummyDevice(selectedDevice)
          ? "Loaded dummy DAC EQ"
          : "Pull successful",
        "success",
        "UI"
      );
    } catch (error) {
      if (isDisconnectionError(error)) {
        setIsReconnecting(true);
        reportStatus("Error", `Pull failed (disconnected): ${error}`, "error", "HID", "Reconnecting...");
      } else {
        reportStatus("Error", `Pull failed: ${error}`, "error", "UI");
      }
    } finally {
      setIsBusy(false);
      setProgress(null);
    }
  }, [pushToUndoStack, selectedDevice, reportStatus]);

  const connectDevice = useCallback(async () => {
    if (!selectedDevice) return;
    setIsBusy(true);
    try {
      if (isDevDummyDevice(selectedDevice)) {
        setConnected(true);
        setConnectedDeviceName("Glacier Dummy DAC");
        reportStatus("Info", "Connected to dummy DAC", "success", "UI", "Connected to dummy DAC");
        await pullEq();
        await loadFirmwareVersion();
        return;
      }

      await invoke("connect_device", { path: selectedDevice });
      setConnected(true);
      
      let devName = "";
      const found = devices.find((d) => d.path === selectedDevice);
      if (found) {
        devName = found.profile_name ?? found.product_string ?? "";
        setConnectedDeviceName(devName);
      }
      
      reportStatus("Info", `Connected to device: ${devName}`, "success", "UI", "Ready");

      if (settings.auto_pull_on_connect) {
        // We call the inner fetch code of pullEq directly or call pullEq itself.
        // Since pullEq sets state asynchronously, calling it is safe.
        await pullEq();
      }
      await loadFirmwareVersion();
    } catch (error) {
      if (isDisconnectionError(error)) {
        setConnected(false);
        reportStatus("Error", `Connection failed (disconnected): ${error}`, "error", "UI", "Device disconnected");
      } else {
        reportStatus("Error", `Connection failed: ${error}`, "error", "UI");
      }
    } finally {
      setIsBusy(false);
    }
  }, [selectedDevice, pullEq, devices, loadFirmwareVersion, reportStatus, settings.auto_pull_on_connect]);

  const pushEq = useCallback(async () => {
    setProgress(null);
    setIsBusy(true);
    try {
      if (isDevDummyDevice(selectedDevice)) {
        setProgress({
          message: "Initializing push connection...",
          percentage: 10,
        });
        await sleep(200);
        setProgress({ message: "Writing band 1/10...", percentage: 20 });
        await sleep(150);
        setProgress({ message: "Writing band 5/10...", percentage: 45 });
        await sleep(150);
        setProgress({ message: "Writing band 10/10...", percentage: 70 });
        await sleep(150);
        setProgress({ message: "Writing preamp...", percentage: 75 });
        await sleep(150);
        setProgress({
          message: "Committing changes to device...",
          percentage: 80,
        });
        await sleep(200);
        setProgress({ message: "Verifying changes...", percentage: 90 });
        await sleep(200);
        setProgress({ message: "Push successful", percentage: 100 });
        await sleep(400);
      } else {
        await invoke("set_eq_state", { peq });
        await sleep(400);
      }
      setLastPushedPeq(peqRef.current);
      setDirty(false);
      reportStatus(
        "Info",
        isDevDummyDevice(selectedDevice)
          ? "Dummy DAC push simulated"
          : "Push successful",
        "success",
        "UI"
      );
    } catch (error) {
      if (isDisconnectionError(error)) {
        setIsReconnecting(true);
        reportStatus("Error", `Push failed (disconnected): ${error}`, "error", "HID", "Reconnecting...");
      } else {
        reportStatus("Error", `Push failed: ${error}`, "error", "UI");
      }
    } finally {
      setIsBusy(false);
      setProgress(null);
    }
  }, [peq, selectedDevice, reportStatus]);

  const applyProfileToRam = useCallback(
    async (profile: Profile) => {
      const data = normalizePeq(profile.data, { enableLoadedFilters: true });
      pushToUndoStack(peqRef.current);
      selectedPresetRef.current = profile.name;
      setPeq(data);
      setSelectedPreset(profile.name);
      setNewProfileName(profile.name);
      setDirty(false);

      setProgress(null);
      setIsBusy(true);
      try {
        if (isDevDummyDevice(selectedDevice)) {
          setProgress({ message: "Writing to RAM...", percentage: 60 });
          await sleep(250);
          setProgress({ message: "Apply successful", percentage: 100 });
          await sleep(300);
        } else {
          await invoke("apply_eq_state", { peq: data });
          await sleep(300);
        }
        setLastPushedPeq(data);
        reportStatus(
          "Info",
          isDevDummyDevice(selectedDevice)
            ? "Dummy DAC apply simulated"
            : `Applied ${profile.name} to device RAM`,
          "success",
          "UI"
        );
      } catch (error) {
        if (isDisconnectionError(error)) {
          setIsReconnecting(true);
          reportStatus("Error", `Apply failed (disconnected): ${error}`, "error", "HID", "Reconnecting...");
        } else {
          reportStatus("Error", `Apply failed: ${error}`, "error", "UI");
        }
      } finally {
        setIsBusy(false);
        setProgress(null);
      }
    },
    [pushToUndoStack, selectedDevice, reportStatus],
  );

  const disconnectDevice = useCallback(async () => {
    setIsBusy(true);
    try {
      if (!isDevDummyDevice(selectedDevice)) {
        await invoke("disconnect_device");
      }
      setConnected(false);
      setIsReconnecting(false);
      setConnectedDeviceName("");
      setFirmwareVersion(null);
      reportStatus("Info", "Device disconnected manually", null, "UI", "Disconnected");
    } catch (error) {
      reportStatus("Error", `Disconnect failed: ${error}`, "error", "UI");
    } finally {
      setIsBusy(false);
    }
  }, [selectedDevice, reportStatus]);

  const saveProfile = useCallback(async () => {
    const name = newProfileName.trim() || selectedPreset;
    if (
      !name ||
      name === DEFAULT_PROFILE_NAME ||
      name === "Pulled from device"
    ) {
      setStatus("Enter a profile name before saving.");
      return;
    }

    try {
      await invoke("save_profile", { name, peq });
      selectedPresetRef.current = name;
      setSelectedPreset(name);
      setNewProfileName("");
      setDirty(false);
      setProfiles(await invoke<Profile[]>("list_profiles"));
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
      setProfiles(await invoke<Profile[]>("list_profiles"));
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

  const updateFilter = useCallback((index: number, updated: Filter) => {
    setActiveBandIndex(index);
    flashGraphPreview();
    setDirty(true);
    setPeq((previous) => {
      const filters = [...previous.filters];
      filters[index] = updated;
      return { ...previous, filters };
    });
  }, [flashGraphPreview]);

  const reset = () => {
    pushToUndoStack(peqRef.current);
    selectedPresetRef.current = DEFAULT_PROFILE_NAME;
    setPeq(buildDefaultState());
    setSelectedPreset(DEFAULT_PROFILE_NAME);
    setDirty(true);
  };

  const addMeasurement = useCallback(
    (name: string, points: MeasurementTrace["points"]) => {
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
    },
    [],
  );

  const removeMeasurement = useCallback((id: string) => {
    setMeasurements((current) => current.filter((trace) => trace.id !== id));
  }, []);

  const toggleMeasurement = useCallback((id: string) => {
    setMeasurements((current) =>
      current.map((trace) =>
        trace.id === id ? { ...trace, visible: !trace.visible } : trace,
      ),
    );
  }, []);

  const clearMeasurements = useCallback(() => {
    setMeasurements([]);
  }, []);

  const toggleTarget = useCallback((id: string) => {
    setActiveTargetIds((current) =>
      current.includes(id)
        ? current.filter((targetId) => targetId !== id)
        : [...current, id],
    );
  }, []);

  const addTarget = useCallback(
    (name: string, points: TargetTrace["points"]) => {
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
    },
    [builtInTargets],
  );

  const removeTarget = useCallback((id: string) => {
    setUserTargets((current) => current.filter((target) => target.id !== id));
    setActiveTargetIds((current) =>
      current.filter((targetId) => targetId !== id),
    );
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
      const isEditingText =
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          (active as HTMLElement).isContentEditable);

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
          activeBands={peq.filters.filter((filter) => filter.enabled).length}
          maxBands={maxFilterBands}
          preampDb={peq.global_gain}
          supportsRamApply={supportsRamApply}
          firmwareVersion={firmwareVersion}
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
                {showGraphPreview && (
                  <section className="mobile-graph-preview" aria-hidden="true">
                    <EqGraph
                      peq={peq}
                      committedPeq={lastPushedPeq}
                      selectedMeasurementId={selectedMeasurementId}
                      measurements={measurements}
                      targets={activeTargets}
                      viewMode={graphViewMode}
                      theme={resolvedTheme}
                    />
                  </section>
                )}
                <section className="graph-card">
                  <EqGraph
                    peq={peq}
                    committedPeq={lastPushedPeq}
                    selectedMeasurementId={selectedMeasurementId}
                    measurements={measurements}
                    targets={activeTargets}
                    viewMode={graphViewMode}
                    theme={resolvedTheme}
                  />
                </section>
                <Preamp
                  value={peq.global_gain}
                  resetValue={lastPushedPeq?.global_gain}
                  onStartChange={handleStartChange}
                  onChange={(global_gain) => {
                    flashGraphPreview();
                    setDirty(true);
                    setPeq((previous) => ({ ...previous, global_gain }));
                  }}
                />
                <Bands
                  peq={peq}
                  committedPeq={lastPushedPeq}
                  maxBands={maxFilterBands}
                  onFilterChange={updateFilter}
                  onStartChange={handleStartChange}
                  activeBandIndex={activeBandIndex}
                  onActiveBandChange={setActiveBandIndex}
                  snapToIso={snapToIso}
                />
              </section>
            )}
            {activeTab === "tuning" && (
              <section className="left-pane">
                <section className="graph-card">
                  <EqGraph
                    peq={peq}
                    committedPeq={lastPushedPeq}
                    selectedMeasurementId={selectedMeasurementId}
                    measurements={measurements}
                    targets={activeTargets}
                    viewMode={graphViewMode}
                    theme={resolvedTheme}
                  />
                </section>

                <details className="tuning-card disclosure-card" open>
                  <summary className="tuning-card-header">
                    <Icon>track_changes</Icon>
                    <strong>Targets</strong>
                  </summary>
                  <div className="tuning-card-body tuning-card-body-flush">
                    <TargetSelector
                      targets={allTargets}
                      activeTargetIds={activeTargetIds}
                      onToggleTarget={toggleTarget}
                      onAddTarget={addTarget}
                      onRemoveTarget={removeTarget}
                      setStatus={setStatus}
                    />
                  </div>
                </details>

                <details className="tuning-card disclosure-card" open>
                  <summary className="tuning-card-header">
                    <Icon>auto_awesome</Icon>
                    <strong>AutoEQ (Tuning Assistant)</strong>
                  </summary>
                  <div className="tuning-card-body">
                    <AutoEqTab
                      measurements={measurements}
                      allTargets={allTargets}
                      onImportPEQ={importPeq}
                      setStatus={setStatus}
                    />
                  </div>
                </details>

                <details className="tuning-card disclosure-card">
                  <summary className="tuning-card-header">
                    <Icon>analytics</Icon>
                    <strong>Measurement Traces</strong>
                  </summary>
                  <div className="tuning-card-body">
                    <MeasureTab
                      measurements={measurements}
                      onAddMeasurement={addMeasurement}
                      onRemoveMeasurement={removeMeasurement}
                      onToggleMeasurement={toggleMeasurement}
                      onClearMeasurements={clearMeasurements}
                      setStatus={setStatus}
                      enableOnlineMeasurements={enableOnlineMeasurements}
                      onEnableOnlineMeasurementsChange={
                        handleEnableOnlineMeasurementsChange
                      }
                    />
                  </div>
                </details>
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
                onApplyProfile={supportsRamApply ? applyProfileToRam : undefined}
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
                onSelectedMeasurementChange={setSelectedMeasurementId}
                canUndo={undoStack.length > 0}
                canRedo={redoStack.length > 0}
                onUndo={undo}
                onRedo={redo}
                availableTabs={["Preset", "Import"]}
                defaultTab="Preset"
                settings={settings}
                onSettingChange={updateSetting}
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
                onApplyProfile={supportsRamApply ? applyProfileToRam : undefined}
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
                onSelectedMeasurementChange={setSelectedMeasurementId}
                canUndo={undoStack.length > 0}
                canRedo={redoStack.length > 0}
                onUndo={undo}
                onRedo={redo}
                availableTabs={["Settings"]}
                defaultTab="Settings"
                showActions={false}
                graphViewMode={graphViewMode}
                onGraphViewModeChange={setGraphViewMode}
                settings={settings}
                onSettingChange={updateSetting}
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
                committedPeq={lastPushedPeq}
                selectedMeasurementId={selectedMeasurementId}
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
              resetValue={lastPushedPeq?.global_gain}
              onStartChange={handleStartChange}
              onChange={(global_gain) => {
                setDirty(true);
                setPeq((previous) => ({ ...previous, global_gain }));
              }}
            />
            <Bands
              peq={peq}
              committedPeq={lastPushedPeq}
              maxBands={maxFilterBands}
              onFilterChange={updateFilter}
              onStartChange={handleStartChange}
              activeBandIndex={activeBandIndex}
              onActiveBandChange={setActiveBandIndex}
              snapToIso={snapToIso}
            />
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
            onApplyProfile={supportsRamApply ? applyProfileToRam : undefined}
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
            onSelectedMeasurementChange={setSelectedMeasurementId}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            onUndo={undo}
            onRedo={redo}
            graphViewMode={graphViewMode}
            onGraphViewModeChange={setGraphViewMode}
            enableOnlineMeasurements={enableOnlineMeasurements}
            onEnableOnlineMeasurementsChange={
              handleEnableOnlineMeasurementsChange
            }
            settings={settings}
            onSettingChange={updateSetting}
          />
        </main>
      )}
      {isReconnecting && (
        <div className="reconnecting-overlay">
          <div className="reconnecting-card">
            <div className="reconnecting-spinner"></div>
            <h3>Connection Lost</h3>
            <p>
              Attempting to automatically reconnect to{" "}
              <strong>{connectedDeviceName}</strong>...
            </p>
            <button
              className="btn"
              onClick={() => {
                setConnected(false);
                setIsReconnecting(false);
                setStatus("Disconnected");
              }}
              style={{
                marginTop: "8px",
                padding: "8px 16px",
                cursor: "pointer",
                background: "var(--surface-soft)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontWeight: 600,
              }}
            >
              Cancel & Return to Device Selection
            </button>
          </div>
        </div>
      )}
      <ToastContainer
        toasts={toasts}
        onClose={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  );
}

export default App;
