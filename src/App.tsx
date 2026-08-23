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
import { ConfirmDialogHost, confirmDialog } from "./components/ConfirmDialog";
import { Modal } from "./components/Modal";
import { DESKTOP_TABS, MOBILE_TABS, type MobileTab, type ToolsTab } from "./lib/tabs";
import { UnifiedTracesList } from "./components/UnifiedTraces";
import {
  DEV_DUMMY_DEVICE,
  buildDevDummyPeq,
  isDevDummyDevice,
} from "./lib/devDevice";
import { buildDefaultState, DEFAULT_PROFILE_NAME, normalizePeq, peqEquals } from "./lib/peq";
import { isTauri } from "./lib/platform";
import { isDisconnectionError } from "./lib/errors";
import {
  asyncContextEquals,
  parseDeviceDisconnectedPayload,
  type AsyncContext,
} from "./lib/asyncContext";
import { parseAutoEqResult } from "./lib/parsedAutoEq";
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
  dsp_sample_rate: 96000,
  integer_preamp: false,
};
const DEFAULT_SETTINGS: AppSettings = {
  auto_pull_on_connect: true,
  skip_push_verification: false,
  theme: "auto",
  snap_to_iso_frequencies: true,
  floating_graph_preview: true,
};

declare global {
  interface Window {
    AndroidNotifier?: {
      showToast: (message: string) => void;
    };
  }
}

const MOBILE_QUERY = "(max-width: 850px), ((max-height: 540px) and (pointer: coarse))";
const DEVICE_ONBOARDING_KEY = "glacier-device-onboarding-seen";
const EDITOR_HINT_KEY = "glacier-editor-hint-dismissed";


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
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const [showGraph, setShowGraph] = useState(true);
  const [toolsTab, setToolsTab] = useState<ToolsTab>("Preset");
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);
  const [showAddTrace, setShowAddTrace] = useState(false);
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const mobileScrollRef = useRef<HTMLElement | null>(null);
  const reconnectCancelRef = useRef<HTMLButtonElement>(null);
  const reconnectEffectGenerationRef = useRef(0);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const listener = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  const settingsSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const theme = settings.theme;
  const snapToIso = settings.snap_to_iso_frequencies;
  const resolvedTheme = useThemeSync(theme);

  const updateSetting = useCallback(<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    // Compute and persist outside the updater: updaters must be pure and are
    // double-invoked under StrictMode, which duplicated the IPC write.
    const updated = { ...settingsRef.current, [key]: value };
    settingsRef.current = updated;
    setSettings(updated);
    settingsSaveQueueRef.current = settingsSaveQueueRef.current
      .then(() => invoke<void>("save_settings", { settings: updated }))
      .catch((err: unknown) => {
        console.error("Failed to save settings:", err);
      });
  }, []);

  useEffect(() => {
    invoke<AppSettings>("get_settings")
      .then((settings) => {
        // A user change may land during the load window; don't clobber it with
        // the late IPC response.
        if (settingsRef.current !== DEFAULT_SETTINGS) return;
        const merged = { ...DEFAULT_SETTINGS, ...settings };
        settingsRef.current = merged;
        setSettings(merged);
      })
      .catch((err) => {
        console.error("Failed to load initial settings:", err);
      });
  }, []);

  const [peq, setPeq] = useState<PEQData>(buildDefaultState);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const selectedDeviceRef = useRef(selectedDevice);
  selectedDeviceRef.current = selectedDevice;
  const [connected, setConnectedState] = useState(false);
  const connectedRef = useRef(false);
  const connectedPathRef = useRef<string | null>(null);
  const connectionGenerationRef = useRef(0);
  const handledDisconnectGenerationRef = useRef<number | null>(null);
  const setConnected = useCallback((nextConnected: boolean, path: string | null = null) => {
    const nextPath = nextConnected ? path : null;
    if (
      connectedRef.current !== nextConnected ||
      connectedPathRef.current !== nextPath
    ) {
      connectionGenerationRef.current += 1;
    }
    connectedRef.current = nextConnected;
    connectedPathRef.current = nextPath;
    setConnectedState(nextConnected);
  }, []);
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
      if (message === "Ready" || !message.trim()) return;

      // Classify by content first, so error messages passed with the default
      // "info" type are still treated (and shown) as errors.
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

      // Automatically log all toast notifications to the diagnostics board.
      const diagLevel = toastType === "error" ? "Error" : "Info";
      invoke("add_diagnostic_event", {
        level: diagLevel,
        source: "UI",
        message: `Notification: ${message}`,
      }).catch((err) => console.error("Failed to log diagnostic from toast:", err));

      // On Android, transient info/success is handled by the native toast;
      // errors are also rendered persistently so they are not lost.
      if (isAndroid && toastType !== "error") return;

      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => {
        // Dedupe: don't stack identical messages.
        if (prev.some((t) => t.message === message)) return prev;
        return [...prev, { id, message, type: toastType }];
      });

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
  const selectedPresetRef = useRef(selectedPreset);
  selectedPresetRef.current = selectedPreset;
  const [profileSearch, setProfileSearch] = useState("");
  const profileSearchRef = useRef(profileSearch);
  profileSearchRef.current = profileSearch;
  const [newProfileName, setNewProfileName] = useState("");
  const newProfileNameRef = useRef(newProfileName);
  newProfileNameRef.current = newProfileName;
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
  const peqRef = useRef(peq);
  peqRef.current = peq;
  const editorCleanPeqRef = useRef(peq);
  // Bumped whenever the editor PEQ actually changes, so async completions
  // (pulls, imports, pushes) can detect edits that happened while they ran.
  const editorRevisionRef = useRef(0);
  const noteEditorMutation = useCallback(() => {
    editorRevisionRef.current += 1;
  }, []);
  const eqOperationInFlightRef = useRef(false);
  const [lastPushedPeq, setLastPushedPeq] = useState<PEQData | null>(null);
  const [activeBandIndex, setActiveBandIndex] = useState<number | null>(null);
  const [editorHintDismissed, setEditorHintDismissed] = useState(
    () => window.localStorage.getItem(EDITOR_HINT_KEY) === "true",
  );

  useEffect(() => {
    window.localStorage.setItem("glacier-graph-view-mode", graphViewMode);
  }, [graphViewMode]);

  const [undoStack, setUndoStack] = useState<PEQData[]>([]);
  const [redoStack, setRedoStack] = useState<PEQData[]>([]);
  const undoStackRef = useRef(undoStack);
  const redoStackRef = useRef(redoStack);
  // PEQ state captured at undo time; redo() refuses unless the current state
  // still matches it.
  const redoBaseRef = useRef<PEQData | null>(null);

  useEffect(() => {
    undoStackRef.current = undoStack;
  }, [undoStack]);

  useEffect(() => {
    redoStackRef.current = redoStack;
  }, [redoStack]);

  useEffect(() => {
    const redoBase = redoBaseRef.current;
    if (
      redoStackRef.current.length === 0 ||
      (redoBase && peqEquals(peq, redoBase))
    ) {
      return;
    }
    redoStackRef.current = [];
    redoBaseRef.current = null;
    setRedoStack([]);
  }, [peq]);

  const pushToUndoStack = useCallback((currentPeq: PEQData) => {
    const stack = undoStackRef.current;
    if (stack.length > 0 && peqEquals(stack[stack.length - 1], currentPeq)) {
      // No change since the last snapshot — nothing to push. Redo validity is
      // enforced separately in redo(), which checks that the PEQ still sits
      // where the last undo left it.
      return;
    }
    const sittingAtRedoBase =
      redoStackRef.current.length > 0 &&
      redoBaseRef.current &&
      peqEquals(currentPeq, redoBaseRef.current);
    if (!sittingAtRedoBase) {
      setRedoStack([]);
    }
    // Record the snapshot even when sitting at the redo base (undo left the
    // stack empty): without it, an edit made after that undo could never be
    // undone. Redo history survives until a real edit lands away from the
    // base, and redo() re-validates the base on every attempt.
    setUndoStack((prev) => {
      const next = [...prev, currentPeq];
      if (next.length > 50) {
        next.shift();
      }
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    // Gesture-start snapshots can match the current state when no edit
    // followed (focus-only gestures); skipping them keeps Ctrl+Z from
    // silently doing nothing.
    let idx = undoStack.length - 1;
    while (idx >= 0 && peqEquals(undoStack[idx], peqRef.current)) {
      idx -= 1;
    }
    if (idx < 0) return;
    const prev = undoStack[idx];
    setUndoStack(undoStack.slice(0, idx));
    setRedoStack((stack) => [...stack, peqRef.current]);
    redoBaseRef.current = prev;
    setPeq(prev);
    noteEditorMutation();
    setDirty(!peqEquals(prev, editorCleanPeqRef.current));
  }, [undoStack, noteEditorMutation]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    // A redo entry is only valid while the PEQ still sits exactly where the
    // last undo left it: a no-op gesture must not wipe redo, but any real
    // edit after an undo invalidates the abandoned future.
    const base = redoBaseRef.current;
    if (!base || !peqEquals(peqRef.current, base)) {
      setRedoStack([]);
      return;
    }
    const next = redoStack[redoStack.length - 1];
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, peqRef.current]);
    // Multi-level redo: each redo re-bases on the state it restores, so the
    // next redo validates against it instead of the stale original base.
    redoBaseRef.current = next;
    setPeq(next);
    noteEditorMutation();
    setDirty(!peqEquals(next, editorCleanPeqRef.current));
  }, [redoStack, noteEditorMutation]);

  const [showGraphPreview, setShowGraphPreview] = useState(false);
  const graphPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAdjustingRef = useRef(false);

  const clearPreviewTimer = useCallback(() => {
    if (graphPreviewTimer.current) {
      clearTimeout(graphPreviewTimer.current);
      graphPreviewTimer.current = null;
    }
  }, []);

  const startGraphPreview = useCallback(() => {
    if (settings.floating_graph_preview === false) return;
    const scrollEl = mobileScrollRef.current;
    if (scrollEl && !graphCollapsed && scrollEl.scrollTop < 180) {
      return;
    }
    clearPreviewTimer();
    isAdjustingRef.current = true;
    setShowGraphPreview(true);
  }, [settings.floating_graph_preview, graphCollapsed, clearPreviewTimer]);

  const schedulePreviewDismiss = useCallback((delay = 1500) => {
    clearPreviewTimer();
    isAdjustingRef.current = false;
    graphPreviewTimer.current = setTimeout(() => {
      if (!isAdjustingRef.current) {
        setShowGraphPreview(false);
      }
    }, delay);
  }, [clearPreviewTimer]);

  // Cleanup on unmount
  useEffect(() => clearPreviewTimer, [clearPreviewTimer]);

  // Instantly dismiss preview when tapping on empty space
  useEffect(() => {
    if (!showGraphPreview) return;
    const handleTapToDismiss = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("input, select, button, .control-slider, .eq-filter-handle, .mobile-graph-preview")) {
        return;
      }
      clearPreviewTimer();
      isAdjustingRef.current = false;
      setShowGraphPreview(false);
    };

    window.addEventListener("pointerdown", handleTapToDismiss, { capture: true, passive: true });
    return () => {
      window.removeEventListener("pointerdown", handleTapToDismiss, { capture: true });
    };
  }, [showGraphPreview, clearPreviewTimer]);

  const handleStartChange = useCallback(() => {
    startGraphPreview();
    pushToUndoStack(peqRef.current);
  }, [startGraphPreview, pushToUndoStack]);

  const handleEndChange = useCallback(() => {
    schedulePreviewDismiss(1500);
  }, [schedulePreviewDismiss]);

  const handlePreviewClick = useCallback(() => {
    mobileScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    clearPreviewTimer();
    isAdjustingRef.current = false;
    setShowGraphPreview(false);
  }, [clearPreviewTimer]);

  const handlePreampStartChange = useCallback(() => {
    // Preamp is positioned directly below the graph; never trigger the floating preview
    pushToUndoStack(peqRef.current);
  }, [pushToUndoStack]);

  const selectedDeviceInfo = useMemo(
    () => devices.find((device) => device.path === selectedDevice),
    [devices, selectedDevice],
  );
  const selectedCapabilities = selectedDeviceInfo ?? OFFLINE_EDITOR_CAPABILITIES;
  const capabilities = connected ? selectedCapabilities : OFFLINE_EDITOR_CAPABILITIES;
  const deviceName = selectedDeviceInfo?.profile_name || selectedDeviceInfo?.product_string || "Supported DAC";
  const maxFilterBands = capabilities.num_bands;
  const supportsRamApply = capabilities.supports_ram_apply;

  // Validates a set/apply_eq_state response before trusting it as the
  // committed device state.
  const parseStoredPeqResponse = (value: unknown): PEQData => {
    if (
      typeof value !== "object" ||
      value === null ||
      !Array.isArray((value as { filters?: unknown }).filters) ||
      typeof (value as { global_gain?: unknown }).global_gain !== "number" ||
      !Number.isFinite((value as { global_gain: number }).global_gain)
    ) {
      throw new Error("Device returned an invalid EQ state");
    }
    const peq = value as PEQData;
    for (const filter of peq.filters) {
      if (
        typeof filter.gain !== "number" || !Number.isFinite(filter.gain) ||
        typeof filter.q !== "number" || !Number.isFinite(filter.q) || filter.q <= 0 ||
        typeof filter.freq !== "number" || !(filter.freq > 0)
      ) {
        throw new Error("Device returned an invalid EQ state");
      }
    }
    return peq;
  };

  const getAsyncContext = useCallback((): AsyncContext => ({
    editorRevision: editorRevisionRef.current,
    connectionRevision: connectionGenerationRef.current,
  }), []);

  // All profile save/delete/import-save work runs through this queue in user
  // request order. `current` is false when a newer mutation was requested
  // while the task ran, so stale completions never update profiles or editor.
  const profileMutationQueueRef = useRef(Promise.resolve());
  const profileMutationTicketRef = useRef(0);
  const runProfileMutation = useCallback(
    async <T,>(task: () => Promise<T>): Promise<{ value: T; current: boolean }> => {
      const ticket = ++profileMutationTicketRef.current;
      const run = profileMutationQueueRef.current.then(async () => {
        const value = await task();
        return { value, current: profileMutationTicketRef.current === ticket };
      });
      profileMutationQueueRef.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    [],
  );

  const selectMatchingProfile = useCallback(
    async (data: PEQData, fallback: string) => {
      const match = await invoke<string | null>("match_profile_name", { peq: data });
      const name = match ?? fallback;
      setSelectedPreset(name);
      setProfileSearch("");
      setNewProfileName("");
      return name;
    },
    [],
  );

  const applyProfile = useCallback(
    (profile: Profile) => {
      pushToUndoStack(peqRef.current);
      const data = normalizePeq(profile.data, { enableLoadedFilters: true, integerPreamp: capabilities.integer_preamp, capabilities });
      setPeq(data);
      setSelectedPreset(profile.name);
      setProfileSearch("");
      setNewProfileName("");
      editorCleanPeqRef.current = data;
      noteEditorMutation();
      setDirty(false);
    },
    [pushToUndoStack, capabilities, noteEditorMutation],
  );

  const importPeq = useCallback(
    (data: PEQData, name: string, isSaved: boolean) => {
      pushToUndoStack(peqRef.current);
      const normalized = normalizePeq(data, { enableLoadedFilters: true, integerPreamp: capabilities.integer_preamp, capabilities });
      setPeq(normalized);
      setSelectedPreset(name);
      setProfileSearch("");
      setNewProfileName(name);
      if (isSaved) editorCleanPeqRef.current = normalized;
      noteEditorMutation();
      setDirty(!isSaved);
    },
    [pushToUndoStack, capabilities, noteEditorMutation],
  );

  const withSyntheticDefault = (raw: Profile[]): Profile[] => [
    { name: DEFAULT_PROFILE_NAME, data: buildDefaultState(), modified: null },
    ...raw,
  ];

  const profileLoadGenerationRef = useRef(0);
  const loadProfiles = useCallback(async () => {
    const generation = ++profileLoadGenerationRef.current;
    try {
      const loadedProfiles = await invoke<Profile[]>("list_profiles");
      if (generation !== profileLoadGenerationRef.current) return;
      setProfiles(withSyntheticDefault(loadedProfiles));
    } catch (error) {
      if (generation !== profileLoadGenerationRef.current) return;
      setStatus(`Failed to load profiles: ${error}`);
    }
  }, [setStatus]);

  // Auto-refresh profiles when window gains focus or tab becomes visible (catches external file changes)
  useEffect(() => {
    const handleFocus = () => loadProfiles();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") loadProfiles();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadProfiles]);

  // Drag-and-drop .txt file import
  const dropRequestRef = useRef(0);
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
        setStatus("Only .txt AutoEQ files can be dropped here");
        return;
      }
      // Only the newest drop may land, and only onto the editor/connection
      // context it started with; anything else raced a newer user action.
      const request = ++dropRequestRef.current;
      const context = getAsyncContext();
      try {
        if (file.size > 1_048_576) throw new Error("File exceeds the 1 MiB limit");
        const text = await file.text();
        if (request !== dropRequestRef.current || !asyncContextEquals(context, getAsyncContext())) return;
        const rawResult = await invoke<unknown>("parse_autoeq", { text });
        if (request !== dropRequestRef.current || !asyncContextEquals(context, getAsyncContext())) return;
        const result = parseAutoEqResult(rawResult);
        const name = result.headphone_name || file.name.replace(/\.[^/.]+$/, "");
        importPeq(result.peq, name, false);
        const adjustments = result.warnings.length === 1
          ? "1 adjustment"
          : `${result.warnings.length} adjustments`;
        setStatus(
          result.warnings.length > 0
            ? `Imported "${name}" with ${adjustments}`
            : `Imported "${name}"`
        );
      } catch (err) {
        if (request === dropRequestRef.current) {
          setStatus(`Failed to import dropped file: ${err}`);
        }
      }
    };
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, [importPeq, getAsyncContext]);

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
          ? `Found ${list.length} device${list.length === 1 ? "" : "s"}`
          : "No compatible DACs found",
      );
    } catch (error) {
      if (import.meta.env.DEV) {
        setDevices([DEV_DUMMY_DEVICE]);
        setSelectedDevice(DEV_DUMMY_DEVICE.path);
        setStatus("Hardware scan failed; using dummy DAC for dev review");
        return;
      }
      setStatus(`Failed to scan for devices: ${error}`);
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
      listen<T>(event, callback)
        .then((fn) => {
          if (active) unlistenFns.push(fn);
          else try { fn(); } catch {}
        })
        .catch((error) => {
          if (active) console.error(`Failed to listen for ${event}:`, error);
        });
    };

    addListener<OperationProgress>("operation-progress", (event) => {
      setProgress(event.payload);
    });

    const handleDeviceDisconnected = (event: { payload: unknown }) => {
      const activePath = connectedPathRef.current;
      const payload = parseDeviceDisconnectedPayload(event.payload, activePath);
      const connectionGeneration = connectionGenerationRef.current;
      if (
        payload === null ||
        payload.path !== activePath ||
        isDevDummyDevice(activePath ?? "") ||
        !connectedRef.current ||
        handledDisconnectGenerationRef.current === connectionGeneration
      ) {
        return;
      }
      handledDisconnectGenerationRef.current = connectionGeneration;
      setConnected(false);
      invoke("disconnect_device", { expectedPath: payload.path }).catch(() => {});
      setIsReconnecting(true);
      setLastPushedPeq(null);
      setFirmwareVersion(null);
      reportStatus("Error", `Lost connection to device (unplugged): ${payload.name}`, "error", "Device", "Reconnecting...");
    };

    addListener<unknown>("device-disconnected", handleDeviceDisconnected);

    if (isTauri() && isAndroid) {
      import("@tauri-apps/api/core")
        .then(({ addPluginListener }) =>
          addPluginListener<unknown>("hid", "device-disconnected", (payload) =>
            handleDeviceDisconnected({ payload }),
          ),
        )
        .then((listener) => {
          const unlisten = () => {
            listener.unregister().catch(() => {});
          };
          if (active) unlistenFns.push(unlisten);
          else unlisten();
        })
        .catch((error) => console.error("Failed to listen for Android HID disconnects:", error));
    }

    return () => {
      active = false;
      unlistenFns.forEach((fn) => {
        try { fn(); } catch {}
      });
    };
  }, [isAndroid, reportStatus]);

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
    if (!isTauri() || isAndroid || !connected || !selectedDevice || isDevDummyDevice(selectedDevice) || isBusy) return;

    let active = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const schedulePoll = () => {
      if (!active) return;
      timerId = setTimeout(runPoll, 1500);
    };
    const runPoll = async () => {
      try {
        const scannedDevices = await invoke<DeviceInfo[]>("list_devices");
        if (!active) return;
        if (scannedDevices.some((device) => device.path === selectedDevice)) {
          schedulePoll();
          return;
        }
        try {
          await invoke("disconnect_device", { expectedPath: selectedDevice });
        } catch (error) {
          if (!active) return;
          console.error("Failed to close disconnected device:", error);
        }
        if (!active) return;
        setConnected(false);
        setIsReconnecting(true);
        setLastPushedPeq(null);
        setFirmwareVersion(null);
        reportStatus("Error", "Lost connection to device", "error", "Device", "Reconnecting...");
      } catch {
        schedulePoll();
      }
    };

    schedulePoll();
    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [connected, isAndroid, selectedDevice, isBusy, reportStatus]);

  const loadFirmwareVersion = useCallback(async (
    targetPath: string,
    expectedConnectionGeneration: number,
  ) => {
    const isCurrentConnection = () =>
      connectionGenerationRef.current === expectedConnectionGeneration &&
      connectedPathRef.current === targetPath;
    if (isDevDummyDevice(targetPath)) {
      if (isCurrentConnection()) setFirmwareVersion("DEV");
      return;
    }
    try {
      const version = await invoke<string | null>("get_firmware_version");
      if (isCurrentConnection()) setFirmwareVersion(version);
    } catch (error) {
      if (!isCurrentConnection()) return;
      setFirmwareVersion(null);
      console.error("Failed to read firmware version:", error);
    }
  }, []);

  // Poll for reconnection when disconnected (paused when app is in background or using dummy device)
  useEffect(() => {
    const generation = ++reconnectEffectGenerationRef.current;
    if (!isReconnecting || !connectedDeviceName || isDevDummyDevice(selectedDevice)) return;

    let active = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const isCurrent = () =>
      active && reconnectEffectGenerationRef.current === generation;

    const schedulePoll = (delayMs: number) => {
      if (!isCurrent()) return;
      if (timerId) clearTimeout(timerId);
      if (document.visibilityState === "hidden") return;
      timerId = setTimeout(runPoll, delayMs);
    };

    // Guards against overlap: visibilitychange fires runPoll directly while
    // a scheduled poll may still be in flight.
    let polling = false;
    const runPoll = async () => {
      if (!isCurrent() || polling || document.visibilityState === "hidden") return;
      polling = true;
      try {
        const realDevices = await invoke<DeviceInfo[]>("list_devices");
        if (!isCurrent()) return;
        const deviceList = import.meta.env.DEV
          ? [...realDevices, DEV_DUMMY_DEVICE]
          : realDevices;
        setDevices(deviceList);
        const found = realDevices.find(
          (d) =>
            d.profile_name === connectedDeviceName ||
            d.product_string === connectedDeviceName
        );
        if (found && isCurrent()) {
          reportStatus("Info", `Device found: ${connectedDeviceName}. Reconnecting...`, null, "Device", "Device found. Reconnecting...");
          try {
            await invoke("connect_device", { path: found.path });
            if (!isCurrent()) {
              await invoke("disconnect_device", { expectedPath: found.path }).catch(() => {});
              return;
            }

            selectedDeviceRef.current = found.path;
            setSelectedDevice(found.path);
            setConnected(true, found.path);
            setLastPushedPeq(null);
            const connectionGeneration = connectionGenerationRef.current;
            await loadFirmwareVersion(found.path, connectionGeneration);
            if (!isCurrent() || connectionGenerationRef.current !== connectionGeneration) return;
            setIsReconnecting(false);
            reportStatus("Info", `Reconnected to ${connectedDeviceName} without changing its EQ`, "success", "Device", "Ready");
            return;
          } catch (err) {
            if (!isCurrent()) return;
            try {
              await invoke("disconnect_device", { expectedPath: found.path });
            } catch {}
            if (!isCurrent()) return;
            reportStatus("Warn", `Reconnect attempt failed: ${err}. Retrying...`, null, "Device", "Reconnecting...");
          }
        }
      } catch (error) {
        if (isCurrent()) console.error("Auto-reconnect poll error:", error);
      } finally {
        polling = false;
      }

      schedulePoll(1500);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && isCurrent()) {
        runPoll();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    schedulePoll(1000);

    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isReconnecting, connectedDeviceName, selectedDevice, loadFirmwareVersion, reportStatus]);

  const pullEq = useCallback(async (afterConnect = false) => {
    if (!connected && !afterConnect) {
      setStatus("Connect a DAC before reading its EQ.");
      return;
    }
    if (eqOperationInFlightRef.current) return;
    if (dirty && !(await confirmDialog({
      title: "Discard changes?",
      message: "Reading the EQ from the DAC will replace the current unsaved profile changes.",
      confirmLabel: "Discard and read",
    }))) return;
    eqOperationInFlightRef.current = true;
    setProgress(null);
    setIsBusy(true);
    // A pull must not land on an editor/connection state that changed while
    // the device read or profile match ran; the undo snapshot is deferred
    // until the result is known to be current.
    const context = getAsyncContext();
    const isCurrentPull = () => asyncContextEquals(context, getAsyncContext());
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
        setProgress({ message: "Read complete", percentage: 100 });
        await sleep(400);
        data = buildDevDummyPeq();
      } else {
        data = await invoke<PEQData>("get_eq_state");
        await sleep(400);
      }
      if (!isCurrentPull()) return;
      pushToUndoStack(peqRef.current);
      const normalized = normalizePeq(data, { integerPreamp: selectedCapabilities.integer_preamp, capabilities: selectedCapabilities });
      setPeq(normalized);
      noteEditorMutation();
      setLastPushedPeq(normalized);
      const matchedProfile = await selectMatchingProfile(normalized, "Pulled from device");
      if (!isCurrentPull()) return;
      if (matchedProfile !== "Pulled from device") {
        editorCleanPeqRef.current = normalized;
      }
      setDirty(matchedProfile === "Pulled from device");
      emit("device-pull").catch((err) => console.error("Failed to emit device-pull:", err));
      reportStatus(
        "Info",
        isDevDummyDevice(selectedDevice)
          ? "Loaded dummy DAC EQ"
          : "Loaded EQ from DAC",
        "success",
        "UI"
      );
    } catch (error) {
      if (isDisconnectionError(error)) {
        setIsReconnecting(true);
        reportStatus("Error", `Failed to read from DAC (disconnected): ${error}`, "error", "HID", "Reconnecting...");
      } else {
        reportStatus("Error", `Failed to read from DAC: ${error}`, "error", "UI");
      }
    } finally {
      eqOperationInFlightRef.current = false;
      setIsBusy(false);
      setProgress(null);
    }
  }, [connected, dirty, pushToUndoStack, selectedDevice, selectedCapabilities, reportStatus, setStatus, getAsyncContext, noteEditorMutation]);

  const connectDevice = useCallback(async (): Promise<boolean> => {
    if (!selectedDevice) return false;
    setIsBusy(true);
    try {
      if (isDevDummyDevice(selectedDevice)) {
        setConnected(true, selectedDevice);
        setLastPushedPeq(null);
        setConnectedDeviceName("Glacier Dummy DAC");
        reportStatus("Info", "Connected to dummy DAC", "success", "UI", "Connected to dummy DAC");
        await pullEq(true);
        await loadFirmwareVersion(selectedDevice, connectionGenerationRef.current);
        return true;
      }

      await invoke("connect_device", { path: selectedDevice });
      setConnected(true, selectedDevice);
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
          noteEditorMutation();
          setDirty(!peqEquals(constrained, editorCleanPeqRef.current));
          reportStatus("Info", "Editor adjusted to this DAC's supported ranges", "info", "Device");
        }
      }
      await loadFirmwareVersion(selectedDevice, connectionGenerationRef.current);
      return true;
    } catch (error) {
      setConnected(false);
      setLastPushedPeq(null);
      if (isDisconnectionError(error)) {
        reportStatus("Error", `Failed to connect (disconnected): ${error}`, "error", "UI", "Device disconnected");
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
          reportStatus("Error", `Failed to connect: ${error}`, "error", "UI");
        }
      }
      return false;
    } finally {
      setIsBusy(false);
    }
  }, [selectedDevice, pullEq, selectedDeviceInfo, selectedCapabilities, pushToUndoStack, loadFirmwareVersion, reportStatus, settings.auto_pull_on_connect, noteEditorMutation]);

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
    const bandCount = activeBands === 1 ? "band" : "bands";
    if (!(await confirmDialog({
      title: "Write to DAC?",
      message: `Write ${activeBands} ${bandCount} and ${snapshot.global_gain.toFixed(1)} dB preamp to the DAC? This stores the EQ on the device.`,
      confirmLabel: "Write DAC",
      danger: true,
    }))) return;
    eqOperationInFlightRef.current = true;
    setProgress(null);
    setIsBusy(true);
    let committedPeq: PEQData | null = null;
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
        setProgress({ message: "Write complete", percentage: 100 });
        await sleep(400);
      } else {
        // set_eq_state returns the PEQ actually committed (quantized to the
        // protocol), not necessarily the request.
        const context = getAsyncContext();
        const committed = await invoke<unknown>("set_eq_state", { peq: snapshot });
        committedPeq = parseStoredPeqResponse(committed);
        await sleep(400);
        // Adopt the quantized device state into the editor only when nobody
        // edited or reconnected during the write.
        if (!peqEquals(committedPeq, snapshot) && asyncContextEquals(context, getAsyncContext())) {
          pushToUndoStack(peqRef.current);
          setPeq(committedPeq);
          noteEditorMutation();
        }
      }
      setLastPushedPeq(committedPeq ?? snapshot);
      reportStatus(
        "Info",
        isDevDummyDevice(selectedDevice)
          ? "Dummy DAC write simulated"
          : "Saved EQ to DAC",
        "success",
        "UI"
      );
    } catch (error) {
      if (!isDevDummyDevice(selectedDevice) && isDisconnectionError(error)) {
        setIsReconnecting(true);
        reportStatus("Error", `Failed to write to DAC (disconnected): ${error}`, "error", "HID", "Reconnecting...");
      } else {
        reportStatus("Error", `Failed to write to DAC: ${error}`, "error", "UI");
      }
    } finally {
      eqOperationInFlightRef.current = false;
      setIsBusy(false);
      setProgress(null);
    }
  }, [connected, selectedDevice, selectedCapabilities, reportStatus, setStatus, getAsyncContext, noteEditorMutation, pushToUndoStack]);

  const applyProfileToRam = useCallback(
    async (profile: Profile) => {
      if (eqOperationInFlightRef.current) return;
      if (dirty && !(await confirmDialog({
        title: "Discard changes?",
        message: "Applying this profile will replace the current unsaved profile changes.",
        confirmLabel: "Discard and apply",
      }))) return;
      eqOperationInFlightRef.current = true;
      const data = normalizePeq(profile.data, { enableLoadedFilters: true, integerPreamp: capabilities.integer_preamp, capabilities });
      pushToUndoStack(peqRef.current);
      setPeq(data);
      noteEditorMutation();
      setSelectedPreset(profile.name);
      setProfileSearch("");
      setNewProfileName("");
      editorCleanPeqRef.current = data;
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
          // apply_eq_state returns the normalized state written to RAM.
          const applied = parseStoredPeqResponse(await invoke<unknown>("apply_eq_state", { peq: data }));
          await sleep(300);
          setLastPushedPeq(applied);
        }
        if (isDevDummyDevice(selectedDevice)) {
          setLastPushedPeq(data);
        }
        reportStatus(
          "Info",
          isDevDummyDevice(selectedDevice)
            ? "Dummy DAC apply simulated"
            : `Temporarily applied ${profile.name} to DAC`,
          "success",
          "UI"
        );
      } catch (error) {
        if (!isDevDummyDevice(selectedDevice) && isDisconnectionError(error)) {
          setIsReconnecting(true);
          reportStatus("Error", `Failed to apply EQ (disconnected): ${error}`, "error", "HID", "Reconnecting...");
        } else {
          reportStatus("Error", `Failed to apply EQ: ${error}`, "error", "UI");
        }
      } finally {
        eqOperationInFlightRef.current = false;
        setIsBusy(false);
        setProgress(null);
      }
    },
    [dirty, pushToUndoStack, selectedDevice, capabilities, reportStatus, noteEditorMutation],
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
      reportStatus("Info", "Disconnected from device", null, "UI", "Disconnected");
    } catch (error) {
      reportStatus("Error", `Failed to disconnect: ${error}`, "error", "UI");
    } finally {
      setIsBusy(false);
    }
  }, [selectedDevice, reportStatus]);

  const saveProfile = useCallback(async () => {
    const savedPeq = peqRef.current;
    const savedContext = {
      selectedPreset: selectedPresetRef.current,
      profileSearch: profileSearchRef.current,
      newProfileName: newProfileNameRef.current,
    };
    const name = savedContext.newProfileName.trim() || savedContext.selectedPreset;
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
    if (exists && !(await confirmDialog({
      title: "Overwrite profile?",
      message: `A profile named "${name}" already exists. Saving will replace it.`,
      confirmLabel: "Overwrite",
      danger: true,
    }))) return;

    try {
      await invoke("save_profile", { name, peq: savedPeq });
      await loadProfiles();
      const contextStillCurrent =
        peqEquals(peqRef.current, savedPeq) &&
        selectedPresetRef.current === savedContext.selectedPreset &&
        profileSearchRef.current === savedContext.profileSearch &&
        newProfileNameRef.current === savedContext.newProfileName;
      if (contextStillCurrent) {
        setSelectedPreset(name);
        setProfileSearch("");
        setNewProfileName("");
        editorCleanPeqRef.current = savedPeq;
        setDirty(false);
      }
      setStatus("Profile saved");
    } catch (error) {
      setStatus(`Failed to save profile: ${error}`);
    }
  }, [profiles, loadProfiles, setStatus]);

  const deleteSelectedProfile = useCallback(async () => {
    const deletedName = selectedPresetRef.current;
    if (deletedName === DEFAULT_PROFILE_NAME) return;
    const editorSnapshot = peqRef.current;
    const deletedContext = {
      profileSearch: profileSearchRef.current,
      newProfileName: newProfileNameRef.current,
    };
    if (!(await confirmDialog({
      title: "Delete profile?",
      message: `Delete profile "${deletedName}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    }))) return;

    try {
      await invoke("delete_profile", { name: deletedName });
      await loadProfiles();
      const contextStillCurrent =
        selectedPresetRef.current === deletedName &&
        peqEquals(peqRef.current, editorSnapshot) &&
        profileSearchRef.current === deletedContext.profileSearch &&
        newProfileNameRef.current === deletedContext.newProfileName;
      if (contextStillCurrent) {
        pushToUndoStack(editorSnapshot);
        setSelectedPreset(DEFAULT_PROFILE_NAME);
        setProfileSearch("");
        setNewProfileName("");
        const defaultPeq = buildDefaultState();
        setPeq(defaultPeq);
        editorCleanPeqRef.current = defaultPeq;
        setDirty(false);
      }
      setStatus("Profile deleted");
    } catch (error) {
      setStatus(`Failed to delete profile: ${error}`);
    }
  }, [loadProfiles, pushToUndoStack, setStatus, runProfileMutation]);

  const openProfilesDir = useCallback(async () => {
    try {
      await invoke("open_profiles_dir");
    } catch (error) {
      setStatus(`Failed to open profiles folder: ${error}`);
    }
  }, []);

  const updateFilter = useCallback((index: number, updated: Filter, showPreview = true) => {
    setActiveBandIndex(index);
    if (showPreview) startGraphPreview();
    setPeq((previous) => {
      const filters = [...previous.filters];
      filters[index] = updated;
      return { ...previous, filters };
    });
    noteEditorMutation();
    // A no-op edit or one restored exactly to the clean baseline must not
    // mark the profile dirty.
    setDirty(!peqEquals({ ...peqRef.current, filters: peqRef.current.filters.map((f, i) => i === index ? updated : f) }, editorCleanPeqRef.current));
  }, [startGraphPreview, noteEditorMutation]);

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
    if (!(await confirmDialog({
      title: "Reset EQ?",
      message: "Reset all filters to 0 dB and preamp to 0 dB?",
      confirmLabel: "Reset",
      danger: true,
    }))) return;
    pushToUndoStack(peqRef.current);
    const defaultPeq = buildDefaultState();
    setPeq(defaultPeq);
    noteEditorMutation();
    setSelectedPreset(DEFAULT_PROFILE_NAME);
    setDirty(!peqEquals(defaultPeq, editorCleanPeqRef.current));
  }, [pushToUndoStack, noteEditorMutation]);

  // Android back button / popstate handling for modal and overlay dismissal & tab navigation
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      setShowDeviceModal(false);
      setShowDiagnosticsModal(false);
      setShowAddTrace(false);

      if (event.state?.tab) {
        setActiveTab(event.state.tab);
      } else if (!event.state?.modal) {
        setActiveTab("eq");
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleSelectMobileTab = useCallback((id: MobileTab) => {
    setActiveTab((prev) => (prev === id ? prev : id));
    // History side effect stays out of the updater: StrictMode double-invokes
    // updaters, which pushed duplicate history entries.
    if (id !== "eq" && activeTabRef.current !== id) {
      window.history.pushState({ tab: id }, "");
    }
  }, []);

  const handleOpenDeviceModal = useCallback(() => {
    window.history.pushState({ modal: "device" }, "");
    setShowDeviceModal(true);
  }, []);
  const handleCloseDeviceModal = useCallback(() => {
    window.localStorage.setItem(DEVICE_ONBOARDING_KEY, "true");
    if (window.history.state?.modal === "device") {
      window.history.back();
    }
    setShowDeviceModal(false);
  }, []);
  const handleOpenDiagnosticsModal = useCallback(() => {
    window.history.pushState({ modal: "diagnostics" }, "");
    setShowDiagnosticsModal(true);
  }, []);
  const handleCloseDiagnosticsModal = useCallback(() => {
    if (window.history.state?.modal === "diagnostics") {
      window.history.back();
    }
    setShowDiagnosticsModal(false);
  }, []);
  const handleShowAddTrace = useCallback(() => {
    window.history.pushState({ modal: "add-trace" }, "");
    setShowAddTrace(true);
  }, []);
  const handleCloseAddTrace = useCallback(() => {
    if (window.history.state?.modal === "add-trace") {
      window.history.back();
    }
    setShowAddTrace(false);
  }, []);
  const handleCloseToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const handlePreampChange = useCallback((global_gain: number) => {
    const next = { ...peqRef.current, global_gain };
    setPeq(next);
    noteEditorMutation();
    setDirty(!peqEquals(next, editorCleanPeqRef.current));
  }, [noteEditorMutation]);
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
      // Prevent global shortcuts while modals or alerts are active
      if (document.querySelector("dialog[open], .reconnecting-overlay")) {
        return;
      }

      const active = document.activeElement;
      const isEditingText =
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT" ||
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

  // Shared props for the mobile ToolsPanel instances; each mobile tab only
  // overrides the tab selection and per-tab extras below. Tuning-only props
  // (curves, targets, bands) are omitted: mobile renders its own tuning panel.
  const mobileToolsPanelProps = {
    peq,
    onImportPEQ: importPeq,
    onPull: pullEq,
    profiles,
    selectedPreset,
    profileSearch,
    setProfileSearch,
    newProfileName,
    setNewProfileName,
    onSelectProfile: applyProfile,
    onApplyProfile: connected && supportsRamApply ? applyProfileToRam : undefined,
    onReloadProfiles: loadProfiles,
    onOpenProfilesDir: openProfilesDir,
    hideProfileFolderButton: isAndroid,
    onReset: reset,
    onSave: saveProfile,
    onDelete: deleteSelectedProfile,
    setStatus,
    settings,
    onSettingChange: updateSetting,
    onOpenDiagnostics: handleOpenDiagnosticsModal,
    isSimulated: isDevDummyDevice(selectedDevice),
    dspSampleRate: capabilities.dsp_sample_rate,
    getAsyncContext,
    runProfileMutation,
  };
  // One graph element for all four render sites; the editor props (drag/
  // wheel/keyboard editing) are only attached where the graph is editable.
  const graphElement = (withEditor: boolean, highlightActiveBand: boolean = false) => (
    <EqGraph
      peq={peq}
      committedPeq={lastPushedPeq}
      selectedMeasurementId={selectedMeasurementId}
      measurements={measurements}
      targets={activeTargets}
      viewMode={graphViewMode}
      theme={resolvedTheme}
      activeBandIndex={highlightActiveBand ? activeBandIndex : undefined}
      {...(withEditor ? graphEditorProps : {})}
    />
  );

  // Preamp + band rows are identical in the mobile EQ tab and the desktop pane.
  const editorControls = (
    <>
      <Preamp
        value={peq.global_gain}
        resetValue={lastPushedPeq?.global_gain}
        range={capabilities.global_gain_range}
        integerMode={capabilities.integer_preamp}
        onStartChange={handlePreampStartChange}
        onChange={handlePreampChange}
      />
      <Bands
        peq={peq}
        committedPeq={lastPushedPeq}
        capabilities={capabilities}
        onFilterChange={updateFilter}
        onStartChange={handleStartChange}
        onEndChange={handleEndChange}
        activeBandIndex={activeBandIndex}
        onActiveBandChange={setActiveBandIndex}
        snapToIso={snapToIso}
      />
    </>
  );


  const editorHint = !connected && !editorHintDismissed ? (
    <div className="editor-empty-hint" role="status">
      <Icon>info</Icon>
      <span className="editor-empty-hint-text">
        No DAC connected — edit freely, or connect to push EQ and read the device state.
      </span>
      <button
        type="button"
        aria-label="Dismiss hint"
        onClick={() => {
          window.localStorage.setItem(EDITOR_HINT_KEY, "true");
          setEditorHintDismissed(true);
        }}
      >
        <Icon>close</Icon>
      </button>
    </div>
  ) : null;


  useEffect(() => {
    if (isReconnecting) {
      reconnectCancelRef.current?.focus();
    }
  }, [isReconnecting]);

  return (
    <div id="app">
      {!(isAndroid && activeTab === "settings") && (
        <Header
          inert={isReconnecting ? true : undefined}
          connected={connected}
          isSimulated={isDevDummyDevice(selectedDevice)}
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
        <main ref={mobileScrollRef} className="workspace mobile-workspace" inert={isReconnecting ? true : undefined}>
          {(activeTab === "eq" || (activeTab === "tuning" && (measurements.some((trace) => trace.visible) || activeTargets.length > 0))) && (
            <section className={`mobile-graph-container mobile-graph-${activeTab} ${graphCollapsed ? "collapsed" : ""}`}>
              <div className="graph-card">
                {graphElement(activeTab === "eq")}
              </div>
              <button
                type="button"
                className="graph-collapse-btn"
                onClick={handleToggleGraphCollapsed}
                aria-expanded={!graphCollapsed}
                aria-label={graphCollapsed ? "Expand graph" : "Collapse graph"}
              >
                <Icon>{graphCollapsed ? "expand_more" : "expand_less"}</Icon>
              </button>
            </section>
          )}
          {activeTab === "eq" && (
            <div
              className={`mobile-graph-preview ${showGraphPreview ? "visible" : ""}`}
              onClick={handlePreviewClick}
              role="button"
              tabIndex={showGraphPreview ? 0 : -1}
              aria-label="Scroll back to top graph"
            >
              <div className="graph-card" style={{ height: "100%", padding: 0, border: "none", background: "transparent" }}>
                {graphElement(false, true)}
              </div>
            </div>
          )}
          <div className="mobile-content-area">
            {activeTab === "eq" && (
              <section className="left-pane">
                {editorHint}
                {editorControls}
              </section>
            )}
            {activeTab === "tuning" && (
              <section className="left-pane">
                <Collapsible title="Traces & Targets" icon="analytics" className="tuning-card">
                  <div className="curves-tab">
                    <div className="curves-actions">
                      <button className="btn add-trace-btn" onClick={handleShowAddTrace}>
                        <Icon>add</Icon>
                        <span>Add Trace</span>
                      </button>
                      {measurements.length > 0 && (
                        <button className="tool-link-button danger" onClick={clearMeasurements}>
                          Clear all
                        </button>
                      )}
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
                  </div>
                  {showAddTrace && (
                    <AddTraceModal
                      onClose={handleCloseAddTrace}
                      onAddMeasurement={addMeasurement}
                      onAddTarget={addTarget}
                      setStatus={setStatus}
                    />
                  )}
                </Collapsible>

                <Collapsible title="AutoEQ" icon="auto_awesome" className="tuning-card">
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
                    dspSampleRate={capabilities.dsp_sample_rate}
                    getAsyncContext={getAsyncContext}
                  />
                </Collapsible>
              </section>
            )}
            {activeTab === "profiles" && (
              <section className="left-pane">
                <ToolsPanel
                  {...mobileToolsPanelProps}
                  dirty={dirty}
                  availableTabs={["Preset", "Import"]}
                  defaultTab="Preset"
                />
              </section>
            )}
            {activeTab === "settings" && (
              <section className="left-pane">
                <ToolsPanel
                  {...mobileToolsPanelProps}
                  availableTabs={["Settings"]}
                  defaultTab="Settings"
                  showActions={false}
                  graphViewMode={graphViewMode}
                  onGraphViewModeChange={setGraphViewMode}
                />
              </section>
            )}
            {activeTab === "device" && (
              <section className="left-pane">
                <ToolsPanel
                  {...mobileToolsPanelProps}
                  availableTabs={["Device"]}
                  defaultTab="Device"
                  showActions={false}
                  connected={connected}
                  onOpenConnectModal={handleOpenDeviceModal}
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
                onClick={() => handleSelectMobileTab(id)}
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
        <main className="workspace" inert={isReconnecting ? true : undefined}>
          <section
            id="main-scroll-pane"
            className="left-pane custom-scroll-pane"
            ref={mainScrollRef}
          >
            {editorHint}
            {showGraph && (
            <section className="graph-card">
              {graphElement(true)}
            </section>
            )}
            {editorControls}
            <CustomScrollbar targetRef={mainScrollRef} />
          </section>
          <ToolsPanel
            peq={peq}
            maxBands={maxFilterBands}
            dspSampleRate={capabilities.dsp_sample_rate}
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
            graphViewMode={graphViewMode}
            onGraphViewModeChange={setGraphViewMode}
            settings={settings}
            onSettingChange={updateSetting}
            availableTabs={DESKTOP_TABS.map((t) => t.id)}
            onToggleTarget={toggleTarget}
            onRemoveTarget={removeTarget}
            onAddTarget={addTarget}
            connected={connected}
            isSimulated={isDevDummyDevice(selectedDevice)}
            activeTab={toolsTab}
            onActiveTabChange={setToolsTab}
            onOpenConnectModal={handleOpenDeviceModal}
            onOpenDiagnostics={handleOpenDiagnosticsModal}
            showGraph={showGraph}
            onShowGraphChange={setShowGraph}
            getAsyncContext={getAsyncContext}
            runProfileMutation={runProfileMutation}
          />
        </main>
      )}
      {isReconnecting && (
        <div
          className="reconnecting-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-label="Connection lost"
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault();
              reconnectCancelRef.current?.focus();
            } else if (e.key === "Escape") {
              e.preventDefault();
              handleCancelReconnection();
            }
          }}
        >
          <div className="reconnecting-card">
            <div className="reconnecting-spinner"></div>
            <h3>Connection lost</h3>
            <p>
              Attempting to automatically reconnect to{" "}
              <strong>{connectedDeviceName}</strong>...
            </p>
            <button
              ref={reconnectCancelRef}
              className="btn"
              autoFocus
              onClick={handleCancelReconnection}
              style={{
                marginTop: "8px",
                padding: "8px 16px",
                cursor: "pointer",
                background: "var(--surface-soft)",
                border: "1px solid var(--line-soft)",
                color: "var(--text)",
                fontWeight: 600,
              }}
            >
              Cancel and return to device selection
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
      <ConfirmDialogHost />
    </div>
  );
}

export default App;
