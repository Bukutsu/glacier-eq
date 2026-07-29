import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, listen, emit, sleep } from "./lib/rpc";
import { Bands } from "./components/Bands";
import { DeviceChooser } from "./components/DeviceChooser";
import { EqGraph } from "./components/EqGraph";
import { Header } from "./components/Header";
import { Icon } from "./components/Icon";
import { CustomScrollbar } from "./components/CustomScrollbar";
import { Preamp } from "./components/Preamp";
import { ToolsPanel, AutoEqTab, DiagnosticsPanel } from "./components/ToolsPanel";
import { AddTraceModal } from "./components/AddTraceModal";
import { Collapsible } from "./components/Collapsible";
import { Modal } from "./components/Modal";
import { DESKTOP_TABS, MOBILE_TABS, type MobileTab } from "./lib/tabs";
import { UnifiedTracesList } from "./components/UnifiedTraces";
import {
  DEV_DUMMY_DEVICE,
  buildDevDummyPeq,
  isDevDummyDevice,
} from "./lib/devDevice";
import { buildDefaultState, normalizePeq, peqEquals } from "./lib/peq";
import { isTauri } from "./lib/platform";
import { isDisconnectionError } from "./lib/errors";
import type {
  DeviceCapabilities,
  DeviceInfo,
  Filter,
  GraphViewMode,
  PEQData,
  Profile,
  OperationProgress,
  AppSettings,
} from "./types";
import { ToastContainer, type Toast } from "./components/Toast";
import { useThemeSync } from "./hooks/useThemeSync";
import { useTraces } from "./hooks/useTraces";

const ANDROID_TOAST_DEDUPE_MS = 2000;
// Offline editor fallback. Must stay in sync with glacier-core
// `DESKTOP_DAC_CAPS` (glacier-core/src/device/capabilities.rs); there is no
// wasm export exposing it, so this constant is the TS-side mirror.
const OFFLINE_EDITOR_CAPABILITIES: DeviceCapabilities = {
  num_bands: 10,
  global_gain_range: [-16, 6],
  band_gain_range: [-10, 10],
  freq_range: [20, 20000],
  q_range: [0.1, 20],
  supported_filter_types: ["Peak", "HighShelf", "LowShelf", "HighPass", "LowPass"],
  supports_per_band_enable: true,
  supports_ram_apply: false,
  integer_preamp: false,
};
export const DEFAULT_PROFILE_NAME = "Default EQ";
const DEFAULT_SETTINGS: AppSettings = {
  auto_pull_on_connect: true,
  skip_push_verification: false,
  theme: "tokyo-night",
  snap_to_iso_frequencies: true,
};

declare global {
  interface Window {
    AndroidNotifier?: {
      showToast: (message: string) => void;
    };
  }
}

const MOBILE_QUERY = "(max-width: 850px)";
const DEVICE_ONBOARDING_KEY = "glacier-device-onboarding-seen";


function App() {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia(MOBILE_QUERY).matches,
  );
  const isAndroid =
    typeof navigator !== "undefined" &&
    (document.body.classList.contains("is-android") ||
      /android/i.test(navigator.userAgent) ||
      typeof window.AndroidNotifier !== "undefined");
  const [activeTab, setActiveTab] = useState<MobileTab>("eq");
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const [showGraph, setShowGraph] = useState(true);
  const [toolsTab, setToolsTab] = useState<any>("Preset");
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);
  const [showAddTrace, setShowAddTrace] = useState(false);
  const mainScrollRef = useRef<HTMLElement | null>(null);

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
  const snapToIso = settings.snap_to_iso_frequencies;
  const resolvedTheme = useThemeSync(theme);

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
        lowerMessage.includes("error") ||
        lowerMessage.includes("unable") ||
        lowerMessage.includes("invalid") ||
        lowerMessage.includes("permission") ||
        lowerMessage.includes("not allowed") ||
        lowerMessage.includes("please enter")
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

      if (toastType !== "error") {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 4000);
      }
    },
    [isAndroid],
  );

  const setStatus = useCallback(
    (message: string) => {
      setStatusState(message);
      showToast(message);
    },
    [showToast],
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
  const {
    measurements,
    allTargets,
    activeTargetIds,
    activeTargets,
    selectedMeasurementId,
    setSelectedMeasurementId,
    addMeasurement,
    removeMeasurement,
    toggleMeasurement,
    clearMeasurements,
    toggleTarget,
    addTarget,
    removeTarget,
  } = useTraces(showToast);
  const [graphViewMode, setGraphViewMode] = useState<GraphViewMode>(() =>
    window.localStorage.getItem("glacier-graph-view-mode") === "level"
      ? "level"
      : "shape",
  );
  const [dirty, setDirty] = useState(false);
  const selectedPresetRef = useRef(selectedPreset);
  const peqRef = useRef(peq);
  const eqOperationInFlightRef = useRef(false);
  const [lastPushedPeq, setLastPushedPeq] = useState<PEQData | null>(null);
  const [activeBandIndex, setActiveBandIndex] = useState<number | null>(null);
  const [isScrolledDown, setIsScrolledDown] = useState(false);

  useEffect(() => {
    peqRef.current = peq;
  }, [peq]);

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

  const [showGraphPreview, setShowGraphPreview] = useState(false);
  const graphPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPreviewTimer = useCallback(() => {
    if (graphPreviewTimer.current) {
      clearTimeout(graphPreviewTimer.current);
      graphPreviewTimer.current = null;
    }
  }, []);

  const flashGraphPreview = useCallback(() => {
    setShowGraphPreview(true);
    clearPreviewTimer();
    graphPreviewTimer.current = setTimeout(() => setShowGraphPreview(false), 2000);
  }, [clearPreviewTimer]);

  // Cleanup on unmount
  useEffect(() => clearPreviewTimer, [clearPreviewTimer]);

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
  const selectedCapabilities = selectedDeviceInfo ?? OFFLINE_EDITOR_CAPABILITIES;
  const capabilities = connected ? selectedCapabilities : OFFLINE_EDITOR_CAPABILITIES;
  const deviceName = selectedDeviceInfo?.profile_name || selectedDeviceInfo?.product_string || "Supported DAC";
  const maxFilterBands = capabilities.num_bands;
  const supportsRamApply = capabilities.supports_ram_apply;

  const selectMatchingProfile = useCallback(
    async (data: PEQData, fallback: string) => {
      const match = await invoke<string | null>("match_profile_name", { peq: data });
      const name = match ?? fallback;
      selectedPresetRef.current = name;
      setSelectedPreset(name);
      setProfileSearch("");
      setNewProfileName("");
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
      const data = normalizePeq(profile.data, { enableLoadedFilters: true, integerPreamp: capabilities.integer_preamp, capabilities });
      selectedPresetRef.current = profile.name;
      setPeq(data);
      setSelectedPreset(profile.name);
      setProfileSearch("");
      setNewProfileName("");
      setDirty(false);
    },
    [pushToUndoStack, capabilities],
  );

  const importPeq = useCallback(
    (data: PEQData, name: string, isSaved: boolean) => {
      pushToUndoStack(peqRef.current);
      const normalized = normalizePeq(data, { enableLoadedFilters: true, integerPreamp: capabilities.integer_preamp, capabilities });
      setPeq(normalized);
      setSelectedPreset(name);
      setProfileSearch("");
      setNewProfileName(name);
      setDirty(!isSaved);
    },
    [pushToUndoStack, capabilities],
  );

  const withSyntheticDefault = (raw: Profile[]): Profile[] => [
    { name: DEFAULT_PROFILE_NAME, data: buildDefaultState(), modified: null },
    ...raw,
  ];

  const loadProfiles = useCallback(async () => {
    try {
      setProfiles(withSyntheticDefault(await invoke<Profile[]>("list_profiles")));
    } catch (error) {
      setStatus(`Profile load failed: ${error}`);
    }
  }, []);

  // Auto-refresh profiles when window gains focus (catches external file changes)
  useEffect(() => {
    const handleFocus = () => loadProfiles();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadProfiles]);

  // Drag-and-drop .txt file import
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      if (!file.name.endsWith(".txt")) {
        setStatus("Drop .txt AutoEQ files only");
        return;
      }
      try {
        const text = await file.text();
        const result = await invoke<{ peq: PEQData; headphone_name: string | null; warnings: string[] }>("parse_autoeq", { text });
        const name = result.headphone_name || file.name.replace(/\.[^/.]+$/, "");
        importPeq(result.peq, name, false);
        setStatus(
          result.warnings.length > 0
            ? `Imported "${name}" with ${result.warnings.length} adjustment(s)`
            : `Imported "${name}"`
        );
      } catch (err) {
        setStatus(`Drop import failed: ${err}`);
      }
    };
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, [importPeq]);

  const scanDevices = useCallback(async () => {
    setIsBusy(true);
    setStatusState("Scanning for devices...");
    try {
      const realDevices = await invoke<DeviceInfo[]>("list_devices");
      const list = import.meta.env.DEV
        ? [...realDevices, DEV_DUMMY_DEVICE]
        : realDevices;
      setDevices(list);
      setSelectedDevice((current) =>
        list.some((device) => device.path === current)
          ? current
          : list[0]?.path ?? "",
      );
      setStatusState(
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
      if (window.localStorage.getItem(DEVICE_ONBOARDING_KEY) !== "true") {
        setShowDeviceModal(true);
      }
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
      setConnected(false);
      setIsReconnecting(true);
      setLastPushedPeq(null);
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

  // Desktop HID does not emit a detach event, so detect the device disappearing.
  useEffect(() => {
    if (!isTauri() || isAndroid || !connected || !selectedDevice || isBusy) return;

    const timerId = setInterval(async () => {
      try {
        const devices = await invoke<DeviceInfo[]>("list_devices");
        if (!devices.some((device) => device.path === selectedDevice)) {
          setConnected(false);
          setIsReconnecting(true);
          setLastPushedPeq(null);
          setFirmwareVersion(null);
          reportStatus("Error", "Connection lost to device", "error", "Device", "Reconnecting...");
        }
      } catch {}
    }, 1500);

    return () => clearInterval(timerId);
  }, [connected, isAndroid, selectedDevice, isBusy, reportStatus]);

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

            if (active) {
              setSelectedDevice(found.path);
              setConnected(true);
              setIsReconnecting(false);
              setLastPushedPeq(null);
              await loadFirmwareVersion();
              reportStatus("Info", `Successfully reconnected to ${connectedDeviceName} without changing its EQ`, "success", "Device", "Ready");
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

  const pullEq = useCallback(async (afterConnect = false) => {
    if (!connected && !afterConnect) {
      setStatus("Connect a DAC before reading its EQ.");
      return;
    }
    if (eqOperationInFlightRef.current) return;
    if (dirty && !window.confirm("Discard unsaved profile changes and read EQ from the DAC?")) return;
    eqOperationInFlightRef.current = true;
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
      const normalized = normalizePeq(data, { integerPreamp: selectedCapabilities.integer_preamp, capabilities: selectedCapabilities });
      setPeq(normalized);
      setLastPushedPeq(normalized);
      const matchedProfile = await selectMatchingProfile(normalized, "Pulled from device");
      setDirty(matchedProfile === "Pulled from device");
      emit("device-pull").catch((err) => console.error("Failed to emit device-pull:", err));
      reportStatus(
        "Info",
        isDevDummyDevice(selectedDevice)
          ? "Loaded dummy DAC EQ"
          : "Read from DAC successful",
        "success",
        "UI"
      );
    } catch (error) {
      if (isDisconnectionError(error)) {
        setIsReconnecting(true);
        reportStatus("Error", `Read failed (disconnected): ${error}`, "error", "HID", "Reconnecting...");
      } else {
        reportStatus("Error", `Read from DAC failed: ${error}`, "error", "UI");
      }
    } finally {
      eqOperationInFlightRef.current = false;
      setIsBusy(false);
      setProgress(null);
    }
  }, [connected, dirty, pushToUndoStack, selectedDevice, selectedCapabilities, reportStatus, setStatus]);

  const connectDevice = useCallback(async (): Promise<boolean> => {
    if (!selectedDevice) return false;
    setIsBusy(true);
    try {
      if (isDevDummyDevice(selectedDevice)) {
        setConnected(true);
        setLastPushedPeq(null);
        setConnectedDeviceName("Glacier Dummy DAC");
        reportStatus("Info", "Connected to dummy DAC", "success", "UI", "Connected to dummy DAC");
        await pullEq(true);
        await loadFirmwareVersion();
        return true;
      }

      await invoke("connect_device", { path: selectedDevice });
      setConnected(true);
      setLastPushedPeq(null);
      
      let devName = "";
      if (selectedDeviceInfo) {
        devName = selectedDeviceInfo.profile_name ?? selectedDeviceInfo.product_string ?? "";
        setConnectedDeviceName(devName);
      }
      
      reportStatus("Info", `Connected to device: ${devName}`, "success", "UI", "Ready");

      if (settings.auto_pull_on_connect) {
        await pullEq(true);
      } else {
        const constrained = normalizePeq(peqRef.current, {
          integerPreamp: selectedCapabilities.integer_preamp,
          capabilities: selectedCapabilities,
        });
        if (!peqEquals(constrained, peqRef.current)) {
          pushToUndoStack(peqRef.current);
          setPeq(constrained);
          setDirty(true);
          reportStatus("Info", "Editor adjusted to this DAC's supported ranges", "info", "Device");
        }
      }
      await loadFirmwareVersion();
      return true;
    } catch (error) {
      setConnected(false);
      setLastPushedPeq(null);
      if (isDisconnectionError(error)) {
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
      return false;
    } finally {
      setIsBusy(false);
    }
  }, [selectedDevice, pullEq, selectedDeviceInfo, selectedCapabilities, pushToUndoStack, loadFirmwareVersion, reportStatus, settings.auto_pull_on_connect]);

  const pushEq = useCallback(async () => {
    if (!connected) {
      setStatus("Connect a DAC before writing EQ.");
      return;
    }
    if (eqOperationInFlightRef.current) return;
    const snapshot = normalizePeq(peqRef.current, {
      integerPreamp: selectedCapabilities.integer_preamp,
      capabilities: selectedCapabilities,
    });
    const activeBands = snapshot.filters.filter((f) => f.enabled).length;
    if (!window.confirm(`Write ${activeBands} band(s) and ${snapshot.global_gain.toFixed(1)} dB preamp to the DAC? This stores the EQ on the device.`)) return;
    eqOperationInFlightRef.current = true;
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
        setProgress({ message: "Write successful", percentage: 100 });
        await sleep(400);
      } else {
        await invoke("set_eq_state", { peq: snapshot });
        await sleep(400);
      }
      setLastPushedPeq(snapshot);
      reportStatus(
        "Info",
        isDevDummyDevice(selectedDevice)
          ? "Dummy DAC write simulated"
          : "Write to DAC successful",
        "success",
        "UI"
      );
    } catch (error) {
      if (isDisconnectionError(error)) {
        setIsReconnecting(true);
        reportStatus("Error", `Write failed (disconnected): ${error}`, "error", "HID", "Reconnecting...");
      } else {
        reportStatus("Error", `Write to DAC failed: ${error}`, "error", "UI");
      }
    } finally {
      eqOperationInFlightRef.current = false;
      setIsBusy(false);
      setProgress(null);
    }
  }, [connected, selectedDevice, selectedCapabilities, reportStatus, setStatus]);

  const applyProfileToRam = useCallback(
    async (profile: Profile) => {
      if (eqOperationInFlightRef.current) return;
      if (dirty && !window.confirm("Discard unsaved profile changes and apply this profile?")) return;
      eqOperationInFlightRef.current = true;
      const data = normalizePeq(profile.data, { enableLoadedFilters: true, integerPreamp: capabilities.integer_preamp, capabilities });
      pushToUndoStack(peqRef.current);
      selectedPresetRef.current = profile.name;
      setPeq(data);
      setSelectedPreset(profile.name);
      setProfileSearch("");
      setNewProfileName("");
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
            : `Temporarily applied ${profile.name} to DAC`,
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
        eqOperationInFlightRef.current = false;
        setIsBusy(false);
        setProgress(null);
      }
    },
    [dirty, pushToUndoStack, selectedDevice, capabilities, reportStatus],
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
      setLastPushedPeq(null);
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

    const exists = profiles.some(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    );
    if (exists && !window.confirm(`Overwrite profile "${name}"?`)) return;

    try {
      await invoke("save_profile", { name, peq });
      selectedPresetRef.current = name;
      setSelectedPreset(name);
      setProfileSearch("");
      setNewProfileName("");
      setDirty(false);
      setProfiles(withSyntheticDefault(await invoke<Profile[]>("list_profiles")));
      setStatus("Profile saved");
    } catch (error) {
      setStatus(`Save failed: ${error}`);
    }
  }, [loadProfiles, newProfileName, peq, profiles, selectedPreset]);

  const deleteSelectedProfile = useCallback(async () => {
    if (selectedPreset === DEFAULT_PROFILE_NAME) return;
    if (!window.confirm(`Delete profile "${selectedPreset}"?`)) return;

    try {
      await invoke("delete_profile", { name: selectedPreset });
      selectedPresetRef.current = DEFAULT_PROFILE_NAME;
      setSelectedPreset(DEFAULT_PROFILE_NAME);
      setProfileSearch("");
      setNewProfileName("");
      setPeq(buildDefaultState());
      setProfiles(withSyntheticDefault(await invoke<Profile[]>("list_profiles")));
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

  const updateFilter = useCallback((index: number, updated: Filter, showPreview = true) => {
    setActiveBandIndex(index);
    if (showPreview) flashGraphPreview();
    setDirty(true);
    setPeq((previous) => {
      const filters = [...previous.filters];
      filters[index] = updated;
      return { ...previous, filters };
    });
  }, [flashGraphPreview]);

  const handleFilterChangeNoPreview = useCallback(
    (index: number, filter: Filter) => updateFilter(index, filter, false),
    [updateFilter],
  );

  const graphEditorProps = useMemo(() => ({
    capabilities,
    activeBandIndex,
    onActiveBandChange: setActiveBandIndex,
    onStartChange: handleStartChange,
    onFilterChange: handleFilterChangeNoPreview,
    snapToIso,
  }), [capabilities, activeBandIndex, setActiveBandIndex, handleStartChange, handleFilterChangeNoPreview, snapToIso]);

  const reset = useCallback(async () => {
    if (!window.confirm("Reset all filters to 0 dB?")) return;
    pushToUndoStack(peqRef.current);
    selectedPresetRef.current = DEFAULT_PROFILE_NAME;
    setPeq(buildDefaultState());
    setSelectedPreset(DEFAULT_PROFILE_NAME);
    setDirty(true);
  }, [pushToUndoStack]);

  const handleOpenDeviceModal = useCallback(() => setShowDeviceModal(true), []);
  const handleCloseDeviceModal = useCallback(() => {
    window.localStorage.setItem(DEVICE_ONBOARDING_KEY, "true");
    setShowDeviceModal(false);
  }, []);
  const handleOpenDiagnosticsModal = useCallback(() => setShowDiagnosticsModal(true), []);
  const handleCloseDiagnosticsModal = useCallback(() => setShowDiagnosticsModal(false), []);
  const handleShowAddTrace = useCallback(() => setShowAddTrace(true), []);
  const handleCloseAddTrace = useCallback(() => setShowAddTrace(false), []);
  const handleCloseToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const handlePreampChange = useCallback((global_gain: number) => {
    flashGraphPreview();
    setDirty(true);
    setPeq((previous) => ({ ...previous, global_gain }));
  }, [flashGraphPreview]);
  const handleConnectDevice = useCallback(async () => {
    if (await connectDevice()) {
      window.localStorage.setItem(DEVICE_ONBOARDING_KEY, "true");
      setShowDeviceModal(false);
    }
  }, [connectDevice]);
  const handleToggleGraphCollapsed = useCallback(() => {
    setGraphCollapsed((v) => !v);
  }, []);
  const handleCancelReconnection = useCallback(() => {
    setConnected(false);
    setIsReconnecting(false);
    setLastPushedPeq(null);
    setShowDeviceModal(true);
    setStatus("Disconnected");
  }, [setStatus]);
  const handleMainScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    setIsScrolledDown(e.currentTarget.scrollTop > 150);
    setShowGraphPreview(false);
    clearPreviewTimer();
  }, [clearPreviewTimer]);

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
      const isCustomScroll = element.classList.contains("custom-scroll-pane");
      return axis === "y"
        ? (isScrollableOverflow(style.overflowY) || isCustomScroll) && scrollElement.scrollHeight > scrollElement.clientHeight
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
      if (!target || target.closest(".eq-filter-handle")) return;

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
          profileDirty={dirty}
          deviceMatchesEditor={lastPushedPeq ? peqEquals(peq, lastPushedPeq) : null}
          activeBands={peq.filters.slice(0, maxFilterBands).filter((filter) => filter.enabled).length}
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
          onConnectClick={handleOpenDeviceModal}
        />
      )}
      {isMobile ? (
        <main className="workspace mobile-workspace">
          {(activeTab === "eq" || (activeTab === "tuning" && (measurements.some((trace) => trace.visible) || activeTargets.length > 0))) && (
            <section className={`mobile-graph-container mobile-graph-${activeTab} ${graphCollapsed ? "collapsed" : ""}`}>
              <div className="graph-card">
                <EqGraph
                  peq={peq}
                  committedPeq={lastPushedPeq}
                  selectedMeasurementId={selectedMeasurementId}
                  measurements={measurements}
                  targets={activeTargets}
                  viewMode={graphViewMode}
                  theme={resolvedTheme}
                  {...(activeTab === "eq" ? graphEditorProps : {})}
                />
              </div>
              <button
                type="button"
                className="graph-collapse-btn"
                onClick={handleToggleGraphCollapsed}
                aria-label={graphCollapsed ? "Expand graph" : "Collapse graph"}
              >
                <Icon>{graphCollapsed ? "expand_more" : "expand_less"}</Icon>
              </button>
            </section>
          )}
          {showGraphPreview && activeTab === "eq" && (
            <div className="mobile-graph-preview">
              <div className="graph-card" style={{ height: "100%", padding: 0, border: "none", background: "transparent" }}>
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
            </div>
          )}
          <div className="mobile-content-area">
            {activeTab === "eq" && (
              <section className="left-pane">
                <Preamp
                  value={peq.global_gain}
                  resetValue={lastPushedPeq?.global_gain}
                  range={capabilities.global_gain_range}
                  integerMode={capabilities.integer_preamp}
                  onStartChange={handleStartChange}
                  onChange={handlePreampChange}
                />
                <Bands
                  peq={peq}
                  committedPeq={lastPushedPeq}
                  capabilities={capabilities}
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
                <Collapsible title="Traces & Targets" icon="analytics" className="tuning-card">
                  <button className="btn add-trace-btn" onClick={handleShowAddTrace}>
                    <Icon>add</Icon>
                    <span>Add Trace</span>
                  </button>
                  <section className="tool-card">
                    <div className="tool-card-head">
                      <strong>Loaded Traces</strong>
                    </div>
                    <UnifiedTracesList
                      measurements={measurements}
                      allTargets={allTargets}
                      activeTargetIds={activeTargetIds}
                      onToggleMeasurement={toggleMeasurement}
                      onRemoveMeasurement={removeMeasurement}
                      onToggleTarget={toggleTarget}
                      onRemoveTarget={removeTarget}
                    />
                    {measurements.length > 0 && (
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "4px" }}>
                        <button className="tool-link-button danger" onClick={clearMeasurements}>
                          Clear All Loaded
                        </button>
                      </div>
                    )}
                  </section>
                  {showAddTrace && (
                    <AddTraceModal
                      onClose={handleCloseAddTrace}
                      onAddMeasurement={addMeasurement}
                      onAddTarget={addTarget}
                      setStatus={setStatus}
                    />
                  )}
                </Collapsible>

                <Collapsible title="AutoEQ (Tuning Assistant)" icon="auto_awesome" className="tuning-card">
                  <AutoEqTab
                    measurements={measurements}
                    allTargets={allTargets}
                    activeTargetIds={activeTargetIds}
                    onImportPEQ={importPeq}
                    setStatus={setStatus}
                    onToggleMeasurement={toggleMeasurement}
                    onToggleTarget={toggleTarget}
                    onSelectedMeasurementChange={setSelectedMeasurementId}
                    maxBands={maxFilterBands}
                  />
                </Collapsible>
              </section>
            )}
            {activeTab === "profiles" && (
              <section className="left-pane">
                <ToolsPanel
                  peq={peq}
                  maxBands={maxFilterBands}
                  onImportPEQ={importPeq}
                  onPull={pullEq}
                  dirty={dirty}
                  profiles={profiles}
                  selectedPreset={selectedPreset}
                  profileSearch={profileSearch}
                  setProfileSearch={setProfileSearch}
                  newProfileName={newProfileName}
                  setNewProfileName={setNewProfileName}
                  onSelectProfile={applyProfile}
                  onApplyProfile={connected && supportsRamApply ? applyProfileToRam : undefined}
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
                  onOpenDiagnostics={handleOpenDiagnosticsModal}
                />
              </section>
            )}
            {activeTab === "settings" && (
              <section className="left-pane">
                <ToolsPanel
                  peq={peq}
                  maxBands={maxFilterBands}
                  onImportPEQ={importPeq}
                  onPull={pullEq}
                  profiles={profiles}
                  selectedPreset={selectedPreset}
                  profileSearch={profileSearch}
                  setProfileSearch={setProfileSearch}
                  newProfileName={newProfileName}
                  setNewProfileName={setNewProfileName}
                  onSelectProfile={applyProfile}
                  onApplyProfile={connected && supportsRamApply ? applyProfileToRam : undefined}
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
                  onOpenDiagnostics={handleOpenDiagnosticsModal}
                />
              </section>
            )}
            {activeTab === "device" && (
              <section className="left-pane">
                <ToolsPanel
                  peq={peq}
                  maxBands={maxFilterBands}
                  onImportPEQ={importPeq}
                  onPull={pullEq}
                  profiles={profiles}
                  selectedPreset={selectedPreset}
                  profileSearch={profileSearch}
                  setProfileSearch={setProfileSearch}
                  newProfileName={newProfileName}
                  setNewProfileName={setNewProfileName}
                  onSelectProfile={applyProfile}
                  onApplyProfile={connected && supportsRamApply ? applyProfileToRam : undefined}
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
                  onOpenConnectModal={handleOpenDeviceModal}
                  onOpenDiagnostics={handleOpenDiagnosticsModal}
                />
              </section>
            )}
          </div>
          <nav className="mobile-tab-bar" aria-label="Primary navigation">
            {MOBILE_TABS.map(({ id, icon, label }) => (
              <button
                key={id}
                type="button"
                className={`mobile-tab-item ${activeTab === id ? "active" : ""}`}
                aria-current={activeTab === id ? "page" : undefined}
                onClick={() => setActiveTab(id)}
              >
                <div className="mobile-tab-icon-wrapper">
                  <Icon>{icon}</Icon>
                </div>
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </main>
      ) : (
        <main className="workspace">
          {showGraphPreview && isScrolledDown && (
            <div className="desktop-graph-preview-wrapper">
              <div className="desktop-graph-preview-overlay">
                <div className="graph-card" style={{ height: "100%", padding: 0, border: "none", background: "transparent" }}>
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
              </div>
            </div>
          )}
          <section
            id="main-scroll-pane"
            className="left-pane custom-scroll-pane"
            ref={mainScrollRef}
            onScroll={handleMainScroll}
          >
            {showGraph && (
            <section className="graph-card">
              <EqGraph
                peq={peq}
                committedPeq={lastPushedPeq}
                selectedMeasurementId={selectedMeasurementId}
                measurements={measurements}
                targets={activeTargets}
                viewMode={graphViewMode}
                theme={resolvedTheme}
                {...graphEditorProps}
              />
            </section>
            )}
            <Preamp
              value={peq.global_gain}
              resetValue={lastPushedPeq?.global_gain}
              range={capabilities.global_gain_range}
              integerMode={capabilities.integer_preamp}
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
              capabilities={capabilities}
              onFilterChange={updateFilter}
              onStartChange={handleStartChange}
              activeBandIndex={activeBandIndex}
              onActiveBandChange={setActiveBandIndex}
              snapToIso={snapToIso}
            />
            <CustomScrollbar targetRef={mainScrollRef} />
          </section>
          <ToolsPanel
            peq={peq}
            maxBands={maxFilterBands}
            onImportPEQ={importPeq}
            onPull={pullEq}
            dirty={dirty}
            profiles={profiles}
            selectedPreset={selectedPreset}
            profileSearch={profileSearch}
            setProfileSearch={setProfileSearch}
            newProfileName={newProfileName}
            setNewProfileName={setNewProfileName}
            onSelectProfile={applyProfile}
            onApplyProfile={connected && supportsRamApply ? applyProfileToRam : undefined}
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
            settings={settings}
            onSettingChange={updateSetting}
            availableTabs={DESKTOP_TABS.map((t) => t.id)}
            onToggleTarget={toggleTarget}
            onRemoveTarget={removeTarget}
            onAddTarget={addTarget}
            connected={connected}
            activeTab={toolsTab}
            onActiveTabChange={setToolsTab}
            onOpenConnectModal={handleOpenDeviceModal}
            onOpenDiagnostics={handleOpenDiagnosticsModal}
            showGraph={showGraph}
            onShowGraphChange={setShowGraph}
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
              onClick={handleCancelReconnection}
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
        <Modal
          title="Connect Device"
          onClose={handleCloseDeviceModal}
        >
          <div className="modal-body">
            <DeviceChooser
              devices={devices}
              onScan={scanDevices}
              onConnect={handleConnectDevice}
              selectedDevice={selectedDevice}
              setSelectedDevice={setSelectedDevice}
              status={status}
              isBusy={isBusy}
            />
          </div>
        </Modal>
      )}
      {showDiagnosticsModal && (
        <Modal
          title="System Diagnostics"
          className="wide"
          onClose={handleCloseDiagnosticsModal}
          style={{
            width: "min(800px, 94vw)",
            height: "75vh",
            maxHeight: "75vh",
            overflow: "hidden",
          }}
        >
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <DiagnosticsPanel />
          </div>
        </Modal>
      )}
      <ToastContainer
        toasts={toasts}
        onClose={handleCloseToast}
      />
    </div>
  );
}

export default App;
