import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, listen, emit } from "./lib/rpc";
import { Bands } from "./components/Bands";
import { DeviceChooser } from "./components/DeviceChooser";
import { EqGraph } from "./components/EqGraph";
import { Header } from "./components/Header";
import { Icon } from "./components/Icon";
import { Preamp } from "./components/Preamp";
import { TargetSelector } from "./components/TargetSelector";
import { ToolsPanel, MeasureTab, AutoEqTab, DiagnosticsPanel } from "./components/ToolsPanel";
import {
  DEV_DUMMY_DEVICE,
  buildDevDummyPeq,
  isDevDummyDevice,
} from "./lib/devDevice";
import {
  makeMeasurementName,
  nextMeasurementColor,
  normalizeMeasurementPoints,
  parseMeasurementText,
} from "./lib/measurements";
import {
  getBuiltInTargets,
  makeTargetName,
  resolveTargetColor,
} from "./lib/targetReferences";
import { buildDefaultState, normalizePeq, peqEquals } from "./lib/peq";
import { isTauri } from "./lib/platform";
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

const ANDROID_TOAST_DEDUPE_MS = 2000;
const DEFAULT_PROFILE_NAME = "Default EQ";
const DEFAULT_SETTINGS: AppSettings = {
  auto_pull_on_connect: true,
  skip_push_verification: false,
  theme: "tokyo-night",
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

function loadPersistedJson<T>(key: string): T | null {
  try {
    const saved = window.localStorage.getItem(key);
    return saved ? JSON.parse(saved) as T : null;
  } catch {
    return null;
  }
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
  "--blue",
  "--green",
  "--orange",
  "--yellow",
  "--red",
  "--purple",
  "--teal",
  "--dark-cyan",
  "--bright-cyan",
  "--terminal-black",
  "--text-alt",
  "--btn-filled-bg",
  "--btn-filled-text",
  "--tab-active-pill",
  "--tab-active-icon",
] as const;

const clearAndroidDynamicColors = () => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  ANDROID_DYNAMIC_COLOR_VARS.forEach((name) => {
    root.style.removeProperty(name);
    root.style.removeProperty(`${name}-rgb`);
  });
};

const applyAndroidDynamicColors = async (prefersDark: boolean) => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    const { M3 } = await import("tauri-plugin-m3");
    const tokens = await M3.getColors(prefersDark ? "dark" : "light");
    if (!tokens || Object.keys(tokens).length === 0) return;
    const colors = tokens as Record<string, string | undefined>;

    const root = document.documentElement;

    const hexToRgb = (hex: string) => {
      const match = hex.replace("#", "").slice(0, 6).match(/.{1,2}/g);
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

    const role = (...names: string[]) =>
      names.map((name) => colors[name]).find(Boolean);
    const fallback = (dark: string, light: string) => prefersDark ? dark : light;
    const primary = role("primary") || fallback("#a0d1bc", "#006c4f");
    const secondary = role("secondary") || primary;
    const tertiary = role("tertiary") || secondary;
    const outline = role("outline", "outlineVariant") || fallback("#8a938b", "#73796f");
    const primaryContainer = role("primaryContainer") || fallback("#00513f", "#8df8ca");
    const secondaryContainer = role("secondaryContainer") || primaryContainer;
    const tertiaryContainer = role("tertiaryContainer") || secondaryContainer;
    const onPrimaryContainer = role("onPrimaryContainer") || fallback("#bff2d6", "#002116");

    [
      ["--bg", role("surfaceDim", "surface") || fallback("#101510", "#f8fbf4")],
      ["--bg-dark", role("surfaceContainer", "surfaceContainerLow") || fallback("#1c211c", "#edf2ea")],
      ["--bg-darker", role("surface", "surfaceDim") || fallback("#101510", "#e9eee6")],
      ["--panel", role("surfaceContainerLow", "surfaceContainer") || fallback("#191e19", "#f1f5ee")],
      ["--surface-soft", role("surfaceContainerHigh", "surfaceContainer") || fallback("#262b26", "#e2e7df")],
      ["--surface", role("surfaceContainerHighest", "surfaceContainerHigh") || fallback("#303630", "#dce2d9")],
      ["--text", role("onSurface") || fallback("#e0e4dc", "#191d19")],
      ["--muted", role("onSurfaceVariant") || fallback("#c0c9be", "#424940")],
      ["--comment", outline],
      ["--cyan", primary],
      ["--blue", primary],
      ["--green", tertiary],
      ["--orange", secondary],
      ["--yellow", tertiaryContainer],
      ["--red", role("error") || fallback("#ffb4ab", "#ba1a1a")],
      ["--purple", secondary],
      ["--teal", tertiary],
      ["--dark-cyan", secondary],
      ["--bright-cyan", onPrimaryContainer],
      ["--terminal-black", outline],
      ["--text-alt", role("onSurfaceVariant") || fallback("#c0c9be", "#424940")],
      ["--btn-filled-bg", primary],
      ["--btn-filled-text", role("onPrimary") || fallback("#073822", "#ffffff")],
      ["--tab-active-pill", secondaryContainer],
      ["--tab-active-icon", role("onSecondaryContainer") || onPrimaryContainer],
    ].forEach(([name, value]) => setVar(name, value));

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
    "eq" | "tuning" | "profiles" | "device" | "settings"
  >("eq");
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const [toolsTab, setToolsTab] = useState<any>("Preset");
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const listener = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const [settings, setSettings] = useState<AppSettings>(() =>
    isAndroid
      ? { ...DEFAULT_SETTINGS, theme: "auto" }
      : DEFAULT_SETTINGS,
  );
  const theme = settings.theme;
  const enableOnlineMeasurements = settings.enable_online_measurements;
  const snapToIso = settings.snap_to_iso_frequencies;
  const [resolvedTheme, setResolvedTheme] = useState("tokyo-night");

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
        if (isAndroid) {
          await applyAndroidDynamicColors(prefersDark);
          resolved = prefersDark ? "material-dark" : "material-light";
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
        if (!isAndroid) {
          resolved = prefersDark ? "tokyo-night" : "catppuccin-latte";
        }
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
      const lowerMessage = message.toLowerCase();
      if (
        lowerMessage.includes("failed") ||
        lowerMessage.includes("error")
      ) {
        toastType = "error";
      } else if (
        lowerMessage.includes("successful") ||
        lowerMessage.includes("synced") ||
        lowerMessage.includes("loaded") ||
        lowerMessage.includes("parsed") ||
        lowerMessage.includes("deleted") ||
        lowerMessage.includes("saved")
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

  const measurementFileInputRef = useRef<HTMLInputElement>(null);
  const targetFileInputRef = useRef<HTMLInputElement>(null);

  const handleImportMeasurementFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setStatus("Measurement import failed: choose a .csv or .txt file.");
      event.target.value = "";
      return;
    }
    try {
      const text = await file.text();
      const points = parseMeasurementText(text);
      const name = file.name.replace(/\.[^/.]+$/, "");
      addMeasurement(name, points);
      setStatus(`Loaded measurement: ${name} (${points.length} points)`);
    } catch (error) {
      setStatus(`Measurement import failed: ${error}`);
    }
    event.target.value = "";
  };



  const handleImportTargetFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setStatus("Target import failed: choose a .csv or .txt file.");
      event.target.value = "";
      return;
    }
    try {
      const text = await file.text();
      const points = parseMeasurementText(text);
      const name = file.name.replace(/\.[^/.]+$/, "");
      addTarget(name, points);
      setStatus(`Loaded target: ${name} (${points.length} points)`);
    } catch (error) {
      setStatus(`Target import failed: ${error}`);
    }
    event.target.value = "";
  };

  useEffect(() => {
    peqRef.current = peq;
  }, [peq]);

  useEffect(() => {
    const saved = loadPersistedJson<any[]>("glacier-measurements");
    if (!Array.isArray(saved)) return;

    setMeasurements(
      saved
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
        })),
    );
  }, []);

  usePersistedJson("glacier-measurements", measurements, 300);

  useEffect(() => {
    const savedTargets = loadPersistedJson<any[]>("glacier-user-targets");
    if (Array.isArray(savedTargets)) {
      setUserTargets(
        savedTargets
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

    const savedActiveIds = loadPersistedJson<any[]>("glacier-active-targets");
    if (
      Array.isArray(savedActiveIds) &&
      savedActiveIds.every((id) => typeof id === "string")
    ) {
      setActiveTargetIds(savedActiveIds);
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

  const flashGraphPreview = useCallback(() => {}, []);

  const handleStartChange = useCallback(() => {
    flashGraphPreview();
    pushToUndoStack(peqRef.current);
  }, [flashGraphPreview, pushToUndoStack]);

  useEffect(() => {
    selectedPresetRef.current = selectedPreset;
  }, [selectedPreset]);

  const selectedDeviceInfo = useMemo(
    () => devices.find((device) => device.path === selectedDevice),
    [devices, selectedDevice],
  );
  const deviceName = selectedDeviceInfo?.profile_name || selectedDeviceInfo?.product_string || "Supported DAC";
  const maxFilterBands = selectedDeviceInfo?.num_bands ?? peq.filters.length;
  const supportsRamApply = selectedDeviceInfo?.supports_ram_apply === true;

  const selectMatchingProfile = useCallback(
    async (data: PEQData, fallback: string) => {
      const match = await invoke<string | null>("match_profile_name", { peq: data });
      const name = match ?? fallback;
      selectedPresetRef.current = name;
      setSelectedPreset(name);
      return name;
    },
    [],
  );

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
    let active = true;
    const unlistenFns: (() => void)[] = [];

    const addListener = <T,>(event: string, callback: (event: { payload: T }) => void) => {
      listen<T>(event, callback).then((fn) => {
        if (active) unlistenFns.push(fn);
        else try { fn(); } catch {}
      });
    };

    addListener<OperationProgress>("operation-progress", (event) => {
      setProgress(event.payload);
    });

    addListener<string>("device-disconnected", (event) => {
      setIsReconnecting(true);
      setFirmwareVersion(null);
      reportStatus("Error", `Connection lost to device (unplugged): ${event.payload}`, "error", "Device", "Reconnecting...");
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
      await selectMatchingProfile(normalized, "Pulled from device");
      setDirty(false);
      emit("device-pull").catch((err) => console.error("Failed to emit device-pull:", err));
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
      if (selectedDeviceInfo) {
        devName = selectedDeviceInfo.profile_name ?? selectedDeviceInfo.product_string ?? "";
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
        const errorMsg = String(error);
        if (errorMsg.includes("NotAllowedError") && !isTauri()) {
          reportStatus(
            "Error",
            "Connection failed: Linux permissions error. You need to configure a udev rule to allow WebHID access to this DAC. See the project README for instructions.",
            "error",
            "UI"
          );
        } else {
          reportStatus("Error", `Connection failed: ${error}`, "error", "UI");
        }
      }
    } finally {
      setIsBusy(false);
    }
  }, [selectedDevice, pullEq, selectedDeviceInfo, loadFirmwareVersion, reportStatus, settings.auto_pull_on_connect]);

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
      const pushed = peqRef.current;
      setLastPushedPeq(pushed);
      await selectMatchingProfile(pushed, selectedPresetRef.current);
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
  }, [peq, selectedDevice, reportStatus, selectMatchingProfile]);

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
  }, [selectedDevice, reportStatus, selectMatchingProfile]);

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
          color: resolveTargetColor(builtInTargets.length + current.length),
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
        const key = e.key.toLowerCase();
        if (isEditingText) {
          if (key === "s") {
            e.preventDefault();
            undoRedoRef.current.save();
          } else if (e.shiftKey && key === "r") {
            e.preventDefault();
            undoRedoRef.current.reset();
          } else if (key === "r") {
            e.preventDefault();
            undoRedoRef.current.pull();
          }
          return;
        }

        if (e.shiftKey && key === "z") {
          e.preventDefault();
          undoRedoRef.current.redo();
        } else if (key === "z") {
          e.preventDefault();
          undoRedoRef.current.undo();
        } else if (key === "y") {
          e.preventDefault();
          undoRedoRef.current.redo();
        } else if (key === "s") {
          e.preventDefault();
          undoRedoRef.current.save();
        } else if (e.shiftKey && key === "r") {
          e.preventDefault();
          undoRedoRef.current.reset();
        } else if (key === "r") {
          e.preventDefault();
          undoRedoRef.current.pull();
        } else if (key === "enter") {
          e.preventDefault();
          undoRedoRef.current.push();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const isScrollableOverflow = (overflow: string) =>
      overflow === "auto" || overflow === "scroll" || overflow === "overlay";

    function getScrollElement(element: HTMLElement): HTMLElement {
      if (element === document.body || element === document.documentElement) {
        return (document.scrollingElement as HTMLElement | null) || document.documentElement;
      }
      return element;
    }

    function canScroll(element: HTMLElement, scrollElement: HTMLElement, axis: "x" | "y") {
      const style = window.getComputedStyle(element);
      return axis === "y"
        ? isScrollableOverflow(style.overflowY) && scrollElement.scrollHeight > scrollElement.clientHeight
        : isScrollableOverflow(style.overflowX) && scrollElement.scrollWidth > scrollElement.clientWidth;
    }

    function findWheelTarget(
      element: HTMLElement | null,
      deltaX: number,
      deltaY: number,
    ): { element: HTMLElement; deltaX: number; deltaY: number } | null {
      let parent = element;
      while (parent) {
        const scrollElement = getScrollElement(parent);
        const canScrollY = deltaY !== 0 && canScroll(parent, scrollElement, "y");
        const canScrollX = deltaX !== 0 && canScroll(parent, scrollElement, "x");

        if (canScrollY || canScrollX) {
          return {
            element: scrollElement,
            deltaX: canScrollX ? deltaX : 0,
            deltaY: canScrollY ? deltaY : 0,
          };
        }

        if (deltaY !== 0 && canScroll(parent, scrollElement, "x")) {
          return { element: scrollElement, deltaX: deltaY, deltaY: 0 };
        }

        if (parent === document.body) return null;
        parent = parent.parentElement;
      }
      return null;
    }

    const handleGlobalWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const workspace = target.closest(".workspace") || target.closest("#app");
      if (!workspace) return;

      const wheelTarget = findWheelTarget(target, e.deltaX, e.deltaY);
      if (!wheelTarget) return;

      let deltaY = wheelTarget.deltaY;
      let deltaX = wheelTarget.deltaX;
      if (e.deltaMode === 1) {
        deltaY *= 20;
        deltaX *= 20;
      } else if (e.deltaMode === 2) {
        deltaY *= wheelTarget.element.clientHeight;
        deltaX *= wheelTarget.element.clientWidth;
      }

      const beforeTop = wheelTarget.element.scrollTop;
      const beforeLeft = wheelTarget.element.scrollLeft;

      wheelTarget.element.scrollTop += deltaY;
      wheelTarget.element.scrollLeft += deltaX;

      if (
        wheelTarget.element.scrollTop !== beforeTop ||
        wheelTarget.element.scrollLeft !== beforeLeft
      ) {
        e.preventDefault();
      }
    };

    window.addEventListener("wheel", handleGlobalWheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener("wheel", handleGlobalWheel, { capture: true });
    };
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
          onConnectClick={() => setShowDeviceModal(true)}
        />
      )}
      {isMobile ? (
        <main className="workspace mobile-workspace">
          {["eq", "tuning", "profiles"].includes(activeTab) && (
            <section className={`mobile-graph-container ${graphCollapsed ? "collapsed" : ""}`}>
              <div className="graph-card">
                <EqGraph
                  peq={peq}
                  committedPeq={lastPushedPeq}
                  selectedMeasurementId={selectedMeasurementId}
                  measurements={measurements}
                  targets={activeTargets}
                  viewMode={graphViewMode}
                  theme={resolvedTheme}
                />
              </div>
              <button
                type="button"
                className="graph-collapse-btn"
                onClick={() => setGraphCollapsed(!graphCollapsed)}
                aria-label={graphCollapsed ? "Expand graph" : "Collapse graph"}
              >
                <Icon>{graphCollapsed ? "expand_more" : "expand_less"}</Icon>
              </button>
            </section>
          )}
          <div className="mobile-content-area">
            {activeTab === "eq" && (
              <section className="left-pane">
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
                <details className="tuning-card disclosure-card" open>
                  <summary className="tuning-card-header">
                    <Icon>analytics</Icon>
                    <strong>Traces & Targets</strong>
                  </summary>
                  <div className="tuning-card-body">
                    <input
                      ref={measurementFileInputRef}
                      type="file"
                      style={{ display: "none" }}
                      accept=".txt,.csv,text/plain,text/csv"
                      onChange={handleImportMeasurementFile}
                    />
                    <input
                      ref={targetFileInputRef}
                      type="file"
                      style={{ display: "none" }}
                      accept=".txt,.csv,text/plain,text/csv"
                      onChange={handleImportTargetFile}
                    />
                    <div className="transfer-actions unified-curves-import-grid">
                      <button className="icon-action" onClick={() => measurementFileInputRef.current?.click()}>
                        <Icon>playlist_add</Icon>
                        <span>Add Measurement</span>
                      </button>
                      <button className="icon-action" onClick={() => targetFileInputRef.current?.click()}>
                        <Icon>add_box</Icon>
                        <span>Add Target</span>
                      </button>
                    </div>
                    <div className="traces-targets-merged">
                      <div className="traces-section">
                        <div className="traces-section-title">
                          <Icon>query_stats</Icon>
                          <span>Measurement Traces</span>
                        </div>
                        <MeasureTab
                          measurements={measurements}
                          onRemoveMeasurement={removeMeasurement}
                          onToggleMeasurement={toggleMeasurement}
                          onClearMeasurements={clearMeasurements}
                          settings={settings}
                          onAddMeasurement={addMeasurement}
                          setStatus={setStatus}
                        />
                      </div>
                      
                      <div className="traces-divider" />

                      <div className="traces-section">
                        <div className="traces-section-title">
                          <Icon>track_changes</Icon>
                          <span>Target Curves</span>
                        </div>
                        <TargetSelector
                          targets={allTargets}
                          activeTargetIds={activeTargetIds}
                          onToggleTarget={toggleTarget}
                          onRemoveTarget={removeTarget}
                        />
                      </div>
                    </div>
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
                      activeTargetIds={activeTargetIds}
                      onImportPEQ={importPeq}
                      setStatus={setStatus}
                      onToggleMeasurement={toggleMeasurement}
                      onToggleTarget={toggleTarget}
                      onSelectedMeasurementChange={setSelectedMeasurementId}
                    />
                  </div>
                </details>
              </section>
            )}
            {activeTab === "profiles" && (
              <section className="left-pane">
                <ToolsPanel
                  peq={peq}
                  onImportPEQ={importPeq}
                  onPull={pullEq}
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
                  hideProfileFolderButton={isAndroid}
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
                  allTargets={allTargets}
                  activeTargetIds={activeTargetIds}
                  settings={settings}
                  onSettingChange={updateSetting}
                  onOpenDiagnostics={() => setShowDiagnosticsModal(true)}
                />
              </section>
            )}
            {activeTab === "settings" && (
              <section className="left-pane">
                <ToolsPanel
                  peq={peq}
                  onImportPEQ={importPeq}
                  onPull={pullEq}
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
                  hideProfileFolderButton={isAndroid}
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
                  allTargets={allTargets}
                  activeTargetIds={activeTargetIds}
                  settings={settings}
                  onSettingChange={updateSetting}
                  onOpenDiagnostics={() => setShowDiagnosticsModal(true)}
                />
              </section>
            )}
            {activeTab === "device" && (
              <section className="left-pane">
                <ToolsPanel
                  peq={peq}
                  onImportPEQ={importPeq}
                  onPull={pullEq}
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
                  hideProfileFolderButton={isAndroid}
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
                  availableTabs={["Device"]}
                  defaultTab="Device"
                  showActions={false}
                  allTargets={allTargets}
                  activeTargetIds={activeTargetIds}
                  settings={settings}
                  onSettingChange={updateSetting}
                  connected={connected}
                  devices={devices}
                  selectedDevice={selectedDevice}
                  setSelectedDevice={setSelectedDevice}
                  onScan={scanDevices}
                  onConnect={connectDevice}
                  onDisconnect={disconnectDevice}
                  connectionStatus={status}
                  isBusy={isBusy}
                  onOpenConnectModal={() => setShowDeviceModal(true)}
                  onOpenDiagnostics={() => setShowDiagnosticsModal(true)}
                />
              </section>
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
              className={`mobile-tab-item ${activeTab === "device" ? "active" : ""}`}
              onClick={() => setActiveTab("device")}
            >
              <div className="mobile-tab-icon-wrapper">
                <Icon>memory</Icon>
              </div>
              <span>DSP</span>
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
          <input
            ref={measurementFileInputRef}
            type="file"
            style={{ display: "none" }}
            accept=".txt,.csv,text/plain,text/csv"
            onChange={handleImportMeasurementFile}
          />
          <input
            ref={targetFileInputRef}
            type="file"
            style={{ display: "none" }}
            accept=".txt,.csv,text/plain,text/csv"
            onChange={handleImportTargetFile}
          />
          <ToolsPanel
            peq={peq}
            onImportPEQ={importPeq}
            onPull={pullEq}
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
            hideProfileFolderButton={isAndroid}
            onReset={reset}
            onSave={saveProfile}
            onDelete={deleteSelectedProfile}
            setStatus={setStatus}
            measurements={measurements}
            allTargets={allTargets}
            activeTargetIds={activeTargetIds}
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
            availableTabs={["Preset", "Import", "AutoEQ", "Curves", "Device", "Settings"]}
            onToggleTarget={toggleTarget}
            onRemoveTarget={removeTarget}
            onAddMeasurementFile={() => measurementFileInputRef.current?.click()}
            onAddTargetFile={() => targetFileInputRef.current?.click()}
            connected={connected}
            devices={devices}
            selectedDevice={selectedDevice}
            setSelectedDevice={setSelectedDevice}
            onScan={scanDevices}
            onConnect={connectDevice}
            onDisconnect={disconnectDevice}
            connectionStatus={status}
            isBusy={isBusy}
            activeTab={toolsTab}
            onActiveTabChange={setToolsTab}
            onOpenConnectModal={() => setShowDeviceModal(true)}
            onOpenDiagnostics={() => setShowDiagnosticsModal(true)}
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
      {showDeviceModal && (
        <div className="modal-overlay" onClick={() => setShowDeviceModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Connect Device</h2>
              <button className="modal-close-btn" onClick={() => setShowDeviceModal(false)} aria-label="Close">
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>close</span>
              </button>
            </div>
            <div className="modal-body">
              <DeviceChooser
                devices={devices}
                onScan={scanDevices}
                onConnect={async () => {
                  await connectDevice();
                  setShowDeviceModal(false);
                }}
                selectedDevice={selectedDevice}
                setSelectedDevice={setSelectedDevice}
                status={status}
                isBusy={isBusy}
                inline
              />
            </div>
          </div>
        </div>
      )}
      {showDiagnosticsModal && (
        <div className="modal-overlay" onClick={() => setShowDiagnosticsModal(false)}>
          <div
            className="modal-content wide"
            style={{
              width: "min(800px, 94vw)",
              height: "75vh",
              maxHeight: "75vh",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>System Diagnostics</h2>
              <button className="modal-close-btn" onClick={() => setShowDiagnosticsModal(false)} aria-label="Close">
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>close</span>
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <DiagnosticsPanel />
            </div>
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
