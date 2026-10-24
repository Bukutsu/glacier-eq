import { MelodyBanks } from "@/features/device/components/MelodyBanks";
import { useMelodyWorkspace } from "@/features/device/hooks/useMelodyWorkspace";
import {
  MelodySaveDialog,
  useMelodySaveDialog,
} from "@/features/device/components/MelodySaveDialog";
import "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useDeviceState } from "@/features/device/hooks/useDeviceState";
import { useEqEditor } from "@/features/eq/hooks/useEqEditor";
import { useGraphPreview } from "@/features/eq/hooks/useGraphPreview";
import { useDeviceSession } from "@/features/device/hooks/useDeviceSession";
import { useLiveApply } from "@/features/device/hooks/useLiveApply";
import { useAppSettings } from "@/features/settings/hooks/useAppSettings";
import { useAppUpdate } from "@/features/settings/hooks/useAppUpdate";
import { useAppFeedback } from "@/app/hooks/useAppFeedback";
import { useEditorShortcuts } from "@/features/eq/hooks/useEditorShortcuts";
import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { invoke } from "@/lib/rpc";
import { createExternalLinkClickHandler } from "@/lib/externalLinks";
import { Bands } from "@/features/eq/components/Bands";
import { DeviceChooser } from "@/features/device/components/DeviceChooser";
import { EqGraph, graphHasLegend } from "@/features/eq/components/EqGraph";
import { EqCurves } from "@/features/eq/components/EqCurves";
import { Header } from "@/app/components/Header";
import { exportEqFile } from "@/features/eq/lib/exportEq";
import { DraftRecovery } from "@/features/eq/components/DraftRecovery";
import {
  DraftRestoredNotice,
  MobileDraftRecovery,
} from "@/features/eq/components/MobileDraftRecovery";
import { CompareHoldButton } from "@/features/device/components/CompareHoldButton";
import { createBypassCompare } from "@/features/device/operations/compareBypass";
import { loadProfile } from "@/features/profiles/lib/loadProfile";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Preamp } from "@/features/eq/components/Preamp";
import {
  MOBILE_TABS,
  parseWorkspacePath,
  workspacePath,
  type DeviceSection,
  type MobileTab,
  type ToolsTab,
} from "@/lib/tabs";
import {
  ConfirmDialogHost,
  confirmDialog,
} from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { isBalanceNavigation, MODAL_HISTORY_KEY } from "@/lib/modalHistory";
import { SidebarDevice } from "@/features/device/components/SidebarDevice";
import {
  isDevDummyDevice,
  writeDevDummyPeq,
} from "@/features/device/lib/devDevice";
import {
  DEFAULT_PROFILE_NAME,
  formatDb,
  peqEquals,
} from "@/features/eq/lib/peq";
import { isTauri } from "@/lib/platform";

import type {
  DeviceInfo,
  GraphViewMode,
  MeasurementTrace,
  PEQData,
  Profile,
  TargetTrace,
} from "@/types";

import { DebugEqBanner } from "@/features/diagnostics/components/DebugEqBanner";

import { useIsMobile } from "@/hooks/useIsMobile";
import { useTraces } from "@/features/traces/hooks/useTraces";

import { useAndroidKeyboardViewport } from "@/hooks/useAndroidKeyboardViewport";

import { profileIdentityKey } from "@/features/profiles/lib/profileIdentity";
import { readLocalStorage } from "@/lib/safeStorage";

import { DeviceView } from "@/features/device/components/DeviceView";
import { SettingsView } from "@/features/settings/components/SettingsView";

const EMPTY_MEASUREMENTS: MeasurementTrace[] = [];
const EMPTY_TARGETS: TargetTrace[] = [];

declare global {
  interface Window {
    AndroidNotifier?: {
      showToast: (message: string) => void;
    };
  }
}

const LazyMobileProfilesView = lazy(() =>
  import("@/features/profiles/components/MobileProfilesView").then(
    ({ MobileProfilesView }) => ({ default: MobileProfilesView }),
  ),
);
const LazyToolsPanel = lazy(() =>
  import("@/app/components/ToolsPanel").then(({ ToolsPanel }) => ({
    default: ToolsPanel,
  })),
);
const LazyTuningPanel = lazy(() =>
  import("@/features/tuning/components/TuningPanel").then(
    ({ TuningPanel }) => ({ default: TuningPanel }),
  ),
);
const LazyDiagnosticsPanel = lazy(() =>
  import("@/features/diagnostics/components/DiagnosticsPanel").then(
    ({ DiagnosticsPanel }) => ({ default: DiagnosticsPanel }),
  ),
);

function ToolLoadingFallback() {
  const { t } = useTranslation("shell");
  return <div aria-busy="true" aria-label={t("workspace.loading")} />;
}

function MobileProfilesView(
  props: ComponentProps<typeof LazyMobileProfilesView>,
) {
  return (
    <Suspense fallback={<ToolLoadingFallback />}>
      <LazyMobileProfilesView {...props} />
    </Suspense>
  );
}

function ToolsPanel(props: ComponentProps<typeof LazyToolsPanel>) {
  return (
    <Suspense fallback={<ToolLoadingFallback />}>
      <LazyToolsPanel {...props} />
    </Suspense>
  );
}

function TuningPanel(props: ComponentProps<typeof LazyTuningPanel>) {
  return (
    <Suspense fallback={<ToolLoadingFallback />}>
      <LazyTuningPanel {...props} />
    </Suspense>
  );
}

function DiagnosticsPanel() {
  return (
    <Suspense fallback={<ToolLoadingFallback />}>
      <LazyDiagnosticsPanel />
    </Suspense>
  );
}

// Phones get four tabs: Device lives at the top of Settings.
const MOBILE_BAR_TABS = MOBILE_TABS.filter(({ id }) => id !== "device");
const mobileBarTab = (tab: MobileTab): MobileTab =>
  tab === "device" ? "settings" : tab;

const TOOL_TAB_BY_WORKSPACE: Record<MobileTab, ToolsTab | null> = {
  eq: null,
  tuning: "Tuning",
  profiles: "Preset",
  device: "Device",
  settings: "Settings",
};

function App() {
  const { t } = useTranslation("shell");
  const { t: libraryT } = useTranslation("library");
  const location = useLocation();

  const navigate = useNavigate();

  const {
    tab: activeTab,
    deviceSection,
    settingsSection,
  } = parseWorkspacePath(location.pathname);

  const isMobile = useIsMobile();

  const isAndroid =
    typeof navigator !== "undefined" &&
    (document.body.classList.contains("is-android") ||
      /android/i.test(navigator.userAgent) ||
      typeof window.AndroidNotifier !== "undefined");

  const activeTabRef = useRef(activeTab);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const [graphCollapsed, setGraphCollapsed] = useState(false);

  const [showGraph, setShowGraph] = useState(true);

  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [bankSwitching, setBankSwitching] = useState(false);
  const editingMelodyBank = useRef<number | null>(null);

  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);

  const [legendOpen, setLegendOpen] = useState(false);

  // Set when the app put an unfinished EQ back by itself (mobile only).
  const [draftRestored, setDraftRestored] = useState(false);
  const [autoRestoreDone, setAutoRestoreDone] = useState(false);
  const autoRestoreTriedRef = useRef(false);

  const mainScrollRef = useRef<HTMLElement | null>(null);

  const mobileScrollRef = useRef<HTMLElement | null>(null);

  const mobileGraphRef = useRef<HTMLElement | null>(null);

  const mobileWorkspacePathsRef = useRef<Partial<Record<MobileTab, string>>>(
    {},
  );

  const mobileScrollPositionsRef = useRef<Record<MobileTab, number>>({
    eq: 0,
    tuning: 0,
    profiles: 0,
    device: 0,
    settings: 0,
  });

  const device = useDeviceState();
  const {
    reconnectEffectGenerationRef,
    ambiguousReconnectRef,
    devices,
    selectedDevice,
    setSelectedDevice,
    connected,
    setIsReconnecting,
    connectedDeviceName,
    firmwareVersion,
    isBusy: deviceBusy,
    progress,
    eqOperationInFlightRef,
    lastPushedPeq,
    selectedDeviceInfo,
    reconnecting,
    capabilities,
    hardwareEq,
    maxFilterBands,
    supportsRamApply,
  } = device;
  const isBusy = deviceBusy || bankSwitching;
  const feedback = useAppFeedback(device.quietReconnectRef);
  const {
    status,
    showToast,
    persistUiPreference,
    setStatus,
    reportStatus,
    reportLoss,
  } = feedback;
  const { settings, snapToIso, resolvedTheme, updateSetting } = useAppSettings(
    feedback.showToast,
  );
  const preview = useGraphPreview({
    showGraph,
    graphCollapsed,
    mobileScrollRef,
    floatingGraphPreview: settings.floating_graph_preview,
  });
  const { showGraphPreview, handlePreviewClick } = preview;
  const editor = useEqEditor(device, preview, feedback.setStatus);
  const {
    peq,
    peqRef,
    dirty,
    activeBandIndex,
    setActiveBandIndex,
    handleStartChange,
    handleEndChange,
    handlePreampStartChange,
    draftInvalid,
    pendingDraft,
    resolveDraft,
    recoveryPending,
    profiles,
    selectedPreset,
    profileSearch,
    setProfileSearch,
    newProfileName,
    setNewProfileName,
    reloadProfiles,
    saveProfile,
    deleteProfile,
    renameProfile,
    openProfilesDir,
    applyProfile,
    importPeq,
    runProfileMutation,
    restoreDraft,
    discardRestoredDraft,
    undo,
    redo,
    getAsyncContext,
    updateFilter,
    handleFilterChangeNoPreview,
    reset,
    canUndoHistory,
    canRedoHistory,
    handlePreampChange,
  } = editor;
  const melodySave = useMelodySaveDialog(
    `${connected}:${device.connectedPathRef.current}:${device.connectedSessionIdRef.current}:${selectedDeviceInfo?.profile_name ?? ""}`,
  );
  const {
    connectPrimary,
    scanDevices,
    recoverDeviceRead,
    pullEq,
    connectDevice,
    handleExpectedDisconnect,
    resetDeviceEq: resetDeviceEqRaw,
    runDeviceMaintenance,
    handlePreviewChange,
    handleUdevInstalled,
    pushEq,
    applyProfileToRam,
    disconnectDevice,
  } = useDeviceSession(device, editor, {
    chooseUserBank: (request) =>
      editingMelodyBank.current !== null
        ? Promise.resolve({
            slot: editingMelodyBank.current,
            confirmed: false,
          })
        : melodySave.choose(request),
    settings,
    isMobile,
    isAndroid,
    reportStatus,
    reportLoss,
    setStatus,
    setShowDeviceModal,
  });
  const melodyWorkspace = useMelodyWorkspace({
    device,
    editor,
    push: pushEq,
    runMaintenance: runDeviceMaintenance,
    setStatus,
    onSwitchingChange: setBankSwitching,
    editingBank: editingMelodyBank,
  });
  const pushEqToDac = async () => {
    if (melodyWorkspace.available) await melodyWorkspace.pauseLiveForWrite();
    await pushEq();
  };
  const resetDeviceEq = async () => {
    if (melodyWorkspace.available && melodyWorkspace.bank === null) {
      setStatus(t("melodyBanks.chooseFirst", { ns: "device" }), "info");
      return;
    }
    if (
      melodyWorkspace.available &&
      !(await melodyWorkspace.beforeExternalChange())
    )
      return;
    await resetDeviceEqRaw();
  };
  const dacBanks = melodyWorkspace.available ? (
    <MelodyBanks
      path={selectedDevice}
      workspace={melodyWorkspace}
      isBusy={isBusy}
      runMaintenance={runDeviceMaintenance}
      onSaveEditor={melodyWorkspace.saveEditorToBank}
      slots={selectedDeviceInfo?.user_eq_slots ?? []}
      isMelody={selectedDeviceInfo?.controls === "melody"}
    />
  ) : undefined;
  useEditorShortcuts({
    undo,
    redo,
    saveProfile,
    reset,
    pullEq,
    pushEq: pushEqToDac,
    isBusy,
    eqOperationInFlightRef,
    recoveryPending,
  });
  const liveApplySupported =
    connected && supportsRamApply && !melodyWorkspace.experimental;
  const liveApplyActive = liveApplySupported && settings.live_apply;
  const isSimulated = isDevDummyDevice(selectedDevice);
  // Other models autosave through live apply. Melody only previews to RAM;
  // its persistent User-bank write remains an explicit action.
  const liveSaves = liveApplyActive && hardwareEq && !isSimulated;
  // Compared with the DAC's stored EQ, not the loaded profile, so loading a
  // profile counts as a change. `dirty` only covers a DAC that was never read.
  const unsavedOnDac = lastPushedPeq ? !peqEquals(peq, lastPushedPeq) : dirty;
  const deviceMatchesEditor = lastPushedPeq
    ? peqEquals(peq, lastPushedPeq)
    : null;
  useLiveApply({
    active: liveApplyActive,
    scopeKey: `${connected}:${device.connectedPathRef.current}:${device.connectedSessionIdRef.current}`,
    peq,
    unsaved: unsavedOnDac,
    lastPushedPeq,
    capabilities,
    busyRef: eqOperationInFlightRef,
    save: () => pushEq({ quiet: true }),
    reportError: (message) =>
      reportStatus({
        level: "Error",
        message,
        toastType: "error",
        source: "UI",
      }),
  });

  // Phones put an unfinished EQ back without asking; a notice offers Discard.
  // An unreadable draft, or one that cannot load now, keeps the full card.
  useEffect(() => {
    if (
      !isMobile ||
      autoRestoreTriedRef.current ||
      !pendingDraft ||
      draftInvalid
    )
      return;
    autoRestoreTriedRef.current = true;
    void restoreDraft().then((restored) => {
      setDraftRestored(restored);
      setAutoRestoreDone(true);
    });
  }, [isMobile, pendingDraft, draftInvalid]);

  useEffect(() => {
    if (draftRestored && (!dirty || connected)) setDraftRestored(false);
  }, [draftRestored, dirty, connected]);

  // The band picker pins under the pinned graph, so it needs that height.
  useEffect(() => {
    const graph = mobileGraphRef.current;
    const workspace = mobileScrollRef.current;
    if (!graph || !workspace || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      /* eslint-disable i18next/no-literal-string -- CSS property, not UI text. */
      workspace.style.setProperty(
        "--mobile-graph-height",
        `${graph.offsetHeight}px`,
      );
      /* eslint-enable i18next/no-literal-string */
    });
    observer.observe(graph);
    return () => observer.disconnect();
  }, [isMobile, activeTab, showGraph]);

  // A/B needs to know what the DAC plays: the editor under live apply, the
  // stored EQ otherwise. Without either it would guess, so it is hidden.
  const comparePlaying: PEQData | null = liveApplyActive ? peq : lastPushedPeq;
  const canCompare =
    connected &&
    hardwareEq &&
    supportsRamApply &&
    !melodyWorkspace.experimental &&
    comparePlaying !== null;
  const compareStateRef = useRef({
    playing: comparePlaying,
    capabilities,
    busy: false,
    path: selectedDevice,
  });
  compareStateRef.current = {
    playing: comparePlaying,
    capabilities,
    busy: isBusy || eqOperationInFlightRef.current,
    path: selectedDevice,
  };
  const bypassCompare = useMemo(
    () =>
      createBypassCompare({
        apply: async (next) => {
          const { path } = compareStateRef.current;
          if (isDevDummyDevice(path)) writeDevDummyPeq(path, next, false);
          else await invoke("live_apply_eq_state", { peq: next });
        },
        getState: () => {
          const { playing, capabilities, busy } = compareStateRef.current;
          return { playing: playing ?? peqRef.current, capabilities, busy };
        },
        reportError: (error) =>
          reportStatus({
            level: "Error",
            message: t("compare.failed", { error: String(error) }),
            toastType: "error",
            source: "UI",
          }),
      }),
    [reportStatus, t],
  );

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
    selectMeasurementOnly,
    toggleTarget,
    selectTargetOnly,
    addTarget,
    removeTarget,
  } = useTraces(showToast);

  const [graphViewMode, setGraphViewMode] = useState<GraphViewMode>(() =>
    readLocalStorage("glacier-graph-view-mode") === "level" ? "level" : "shape",
  );

  useEffect(() => {
    persistUiPreference("glacier-graph-view-mode", graphViewMode);
  }, [graphViewMode, persistUiPreference]);

  useAndroidKeyboardViewport();

  // Supported desktop builds look for a newer release once per launch.
  useEffect(() => {
    void useAppUpdate.getState().checkOnLaunch();
  }, []);

  // Open external links in default browser instead of dropping them in Tauri webviews
  useEffect(() => {
    const handleGlobalClick = createExternalLinkClickHandler();

    document.addEventListener("click", handleGlobalClick);
    return () => {
      document.removeEventListener("click", handleGlobalClick);
    };
  }, []);

  // Global uncaught error and promise rejection logger
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      // eslint-disable-next-line i18next/no-literal-string -- Raw diagnostics stay language-independent.
      const msg = `Uncaught error: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`;
      invoke("add_diagnostic_event", {
        level: "Error",
        source: "UI",
        message: msg,
      }).catch((err) => console.error("Failed to log uncaught error:", err));
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reasonStr =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason);
      // eslint-disable-next-line i18next/no-literal-string -- Raw diagnostics stay language-independent.
      const msg = `Unhandled rejection: ${reasonStr}`;
      invoke("add_diagnostic_event", {
        level: "Error",
        source: "UI",
        message: msg,
      }).catch((err) =>
        console.error("Failed to log unhandled rejection:", err),
      );
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  const graphEditorProps = useMemo(
    () => ({
      capabilities,
      activeBandIndex,
      onActiveBandChange: setActiveBandIndex,
      onStartChange: handleStartChange,
      onFilterChange: handleFilterChangeNoPreview,
      snapToIso,
    }),
    [
      capabilities,
      activeBandIndex,
      setActiveBandIndex,
      handleStartChange,
      handleFilterChangeNoPreview,
      snapToIso,
    ],
  );

  useEffect(() => {
    if (!isMobile) return;
    const frame = window.requestAnimationFrame(() => {
      mobileScrollRef.current?.scrollTo({
        top: mobileScrollPositionsRef.current[activeTab],
        behavior: "auto",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, isMobile]);

  // React Router owns workspace history. Modal.tsx handles nested modal
  // sentinels; this listener only cleans up route-level overlays when a Back
  // event has already left the modal stack.
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      // Closing a modal balances the sentinel it pushed, and that navigation
      // lands on the base state, which carries no modal key. Treating it as a
      // Back tore down every overlay, including a dialog the user had opened
      // while the balance was still in flight.
      if (isBalanceNavigation(event)) return;
      const state = event.state;
      if (
        typeof state === "object" &&
        state !== null &&
        MODAL_HISTORY_KEY in state
      )
        return;
      reconnectEffectGenerationRef.current += 1;
      ambiguousReconnectRef.current = false;
      setIsReconnecting(false);
      setShowDeviceModal(false);
      setShowDiagnosticsModal(false);
      mobileScrollPositionsRef.current[activeTabRef.current] =
        mobileScrollRef.current?.scrollTop ?? 0;
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleSelectWorkspaceTab = useCallback(
    (id: MobileTab) => {
      // On phones Device is part of the Settings tab, so they share a place.
      const currentTab = isMobile
        ? mobileBarTab(activeTabRef.current)
        : activeTabRef.current;
      const scrollEl = mobileScrollRef.current;
      if (currentTab === id) {
        scrollEl?.scrollTo({
          top: 0,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
        });
        mobileScrollPositionsRef.current[activeTabRef.current] = 0;
        return;
      }

      mobileScrollPositionsRef.current[activeTabRef.current] =
        scrollEl?.scrollTop ?? 0;
      mobileWorkspacePathsRef.current[currentTab] = location.pathname;
      navigate(mobileWorkspacePathsRef.current[id] ?? workspacePath(id));
    },
    [navigate, location.pathname, isMobile],
  );

  const handleOpenDeviceModal = useCallback(() => {
    setShowDeviceModal(true);
  }, []);

  const handleCloseDeviceModal = useCallback(() => {
    ambiguousReconnectRef.current = false;
    setShowDeviceModal(false);
  }, []);

  const handleOpenDiagnosticsModal = useCallback(() => {
    setShowDiagnosticsModal(true);
  }, []);

  const handleCloseDiagnosticsModal = useCallback(() => {
    setShowDiagnosticsModal(false);
  }, []);

  const handleConnectDevice = useCallback(
    async (targetPath?: string, target?: DeviceInfo) => {
      if (await connectDevice(targetPath, target)) {
        handleCloseDeviceModal();
      }
    },
    [connectDevice, handleCloseDeviceModal],
  );

  const handleToggleGraphCollapsed = useCallback(() => {
    setGraphCollapsed((v) => !v);
  }, []);

  const handleExportEq = useCallback(
    () => exportEqFile(peq, selectedPreset, setStatus),
    [peq, selectedPreset, setStatus],
  );

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
    onApplyProfile:
      connected && supportsRamApply && !melodyWorkspace.experimental
        ? applyProfileToRam
        : undefined,
    onReloadProfiles: reloadProfiles,
    onOpenProfilesDir: isTauri() && !isAndroid ? openProfilesDir : undefined,
    profilesOnDisk: isTauri(),
    onReset: reset,
    onSave: saveProfile,
    onDelete: deleteProfile,
    onRename: renameProfile,
    setStatus,
    settings,
    onSettingChange: updateSetting,
    onOpenDiagnostics: handleOpenDiagnosticsModal,
    isSimulated: isDevDummyDevice(selectedDevice),
    dspSampleRate: capabilities.dsp_sample_rate,
    getAsyncContext,
    runProfileMutation,
    onUdevInstalled: handleUdevInstalled,
    liveApplySupported,
    deviceInfo: selectedDeviceInfo,
    capabilities,
    firmwareVersion,
    onPreviewChange: handlePreviewChange,
    onExpectedDisconnect: handleExpectedDisconnect,
  };

  // Shared EQ/tuning graph; editing props only attach in the EQ workspace.
  // The band the mobile editor shows; Bands falls back to the first one.
  const editorBands = peq.filters
    .slice(0, capabilities.num_bands)
    .filter((filter) => filter.enabled);
  const shownBandIndex =
    editorBands.find((filter) => filter.index === activeBandIndex)?.index ??
    editorBands[0]?.index ??
    null;

  // Phones draw only the edited band's own curve (none while tuning), and a
  // tap near a dot selects that band. Desktop keeps every curve and drags.
  const graphElement = ({
    withEditor = false,
    focusBand = false,
    legend,
  }: {
    withEditor?: boolean;
    focusBand?: boolean;
    legend?: boolean;
  } = {}) => (
    <EqGraph
      capabilities={capabilities}
      peq={peq}
      committedPeq={lastPushedPeq}
      selectedMeasurementId={selectedMeasurementId}
      measurements={measurements}
      targets={activeTargets}
      viewMode={graphViewMode}
      theme={resolvedTheme}
      activeBandIndex={focusBand ? shownBandIndex : undefined}
      bandCurves={isMobile ? (focusBand ? "active" : "none") : "all"}
      onBandTap={
        isMobile && focusBand && withEditor && !recoveryPending
          ? setActiveBandIndex
          : undefined
      }
      legendOpen={legend}
      {...(withEditor && !isMobile && !recoveryPending ? graphEditorProps : {})}
    />
  );
  const showLegendToggle = graphHasLegend(
    peq,
    lastPushedPeq,
    measurements,
    activeTargets,
  );

  const handleUseProfileOnDac = async (profile: Profile) => {
    const alreadySelected =
      profileIdentityKey(selectedPreset) === profileIdentityKey(profile.name);
    let loaded = alreadySelected && !dirty;
    if (!loaded) {
      await loadProfile({
        profile,
        selectedPreset,
        dirty: dirty || Boolean(melodyWorkspace.editorState?.unsaved),
        getAsyncContext,
        confirm: confirmDialog,
        onSelectProfile: (next) => {
          applyProfile(next);
          loaded = true;
        },
      });
    }
    // applyProfile updates the editor ref before the write starts.
    if (loaded) await pushEqToDac();
  };

  const profilePreview = showGraph ? (
    <EqGraph
      capabilities={capabilities}
      peq={peq}
      measurements={EMPTY_MEASUREMENTS}
      targets={EMPTY_TARGETS}
      theme={resolvedTheme}
      viewMode={graphViewMode}
    />
  ) : undefined;

  const preampControls = (
    <Preamp
      value={peq.global_gain}
      resetValue={lastPushedPeq?.global_gain}
      range={capabilities.global_gain_range}
      integerMode={capabilities.integer_preamp}
      onStartChange={handlePreampStartChange}
      onEndChange={handleEndChange}
      onChange={handlePreampChange}
      disabled={isBusy || eqOperationInFlightRef.current || recoveryPending}
    />
  );

  const bandControls = (
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
      disabled={isBusy || eqOperationInFlightRef.current || recoveryPending}
      isMobile={isMobile}
    />
  );

  const editorControls = (
    <>
      {preampControls}
      {bandControls}
    </>
  );

  const draftRecovery =
    !isMobile && recoveryPending ? (
      <DraftRecovery
        invalid={draftInvalid}
        connected={connected}
        isBusy={isBusy}
        onRestore={restoreDraft}
        onDiscard={resolveDraft}
      />
    ) : null;

  const eqCurves = (
    <EqCurves
      measurements={measurements}
      allTargets={allTargets}
      activeTargetIds={activeTargetIds}
      onToggleMeasurement={toggleMeasurement}
      onRemoveMeasurement={removeMeasurement}
      onToggleTarget={toggleTarget}
      onRemoveTarget={removeTarget}
      onAddMeasurement={addMeasurement}
      onAddTarget={addTarget}
      setStatus={setStatus}
    />
  );

  const desktopConfigPage = !isMobile
    ? activeTab === "device"
      ? "device"
      : activeTab === "settings"
        ? "settings"
        : undefined
    : undefined;

  const mobilePageTitle =
    activeTab === "eq"
      ? selectedPreset
      : (MOBILE_TABS.find((tab) => tab.id === activeTab)?.label ??
        selectedPreset);

  const melodySaveLabel =
    melodyWorkspace.bank === null
      ? undefined
      : libraryT("profilesView.writeToUser", {
          number:
            (selectedDeviceInfo?.user_eq_slots.indexOf(melodyWorkspace.bank) ??
              -1) + 1,
        });

  // Other tabs hide the header, so the unsaved state and Save follow there.
  const showSaveBar =
    isMobile &&
    activeTab !== "eq" &&
    connected &&
    !isBusy &&
    hardwareEq &&
    !liveSaves &&
    deviceMatchesEditor === false &&
    !recoveryPending;

  const deviceView = (section: DeviceSection) => (
    <DeviceView
      key={`${connected ? "connected" : "offline"}:${selectedDevice}`}
      connected={connected}
      isBusy={isBusy}
      isSimulated={isSimulated}
      deviceInfo={selectedDeviceInfo}
      capabilities={capabilities}
      firmwareVersion={firmwareVersion}
      section={section}
      setStatus={setStatus}
      onPull={hardwareEq ? pullEq : undefined}
      onOpenConnectModal={connectPrimary}
      onChooseDevice={handleOpenDeviceModal}
      onDisconnect={connected ? disconnectDevice : undefined}
      onPreviewChange={handlePreviewChange}
      onExpectedDisconnect={handleExpectedDisconnect}
      onReadFailure={recoverDeviceRead}
      onResetEq={
        melodyWorkspace.available && melodyWorkspace.bank === null
          ? undefined
          : resetDeviceEq
      }
      resetSlot={melodyWorkspace.bank ?? undefined}
      onHardwareEqChanged={melodyWorkspace.invalidate}
      onBeforePresetChange={melodyWorkspace.beforeExternalChange}
      runMaintenance={runDeviceMaintenance}
    />
  );

  const workspaceHeader = (
    <Header
      connected={connected}
      reconnecting={reconnecting}
      isSimulated={isDevDummyDevice(selectedDevice)}
      isBusy={isBusy}
      progress={progress}
      profile={selectedPreset}
      profileDirty={dirty}
      profileSaved={profiles.some(
        (profile) =>
          profile.modified != null &&
          profileIdentityKey(profile.name) ===
            profileIdentityKey(selectedPreset),
      )}
      deviceMatchesEditor={deviceMatchesEditor}
      profileEdited={
        dirty &&
        profiles.some(
          (profile) =>
            (profile.modified != null ||
              profileIdentityKey(profile.name) ===
                profileIdentityKey(DEFAULT_PROFILE_NAME)) &&
            profileIdentityKey(profile.name) ===
              profileIdentityKey(selectedPreset),
        )
      }
      hardwareEq={hardwareEq}
      canUndo={canUndoHistory}
      canRedo={canRedoHistory}
      onUndo={undo}
      onRedo={redo}
      onPull={pullEq}
      onPush={pushEqToDac}
      saveLabel={melodySaveLabel}
      liveApply={liveApplyActive || melodyWorkspace.active}
      liveApplySaves={liveApplyActive}
      onExportEq={handleExportEq}
      onDisconnect={disconnectDevice}
      onConnectClick={connectPrimary}
      configPage={desktopConfigPage}
      pageTitle={
        isMobile
          ? mobilePageTitle
          : activeTab === "profiles"
            ? t("navigation.profiles")
            : undefined
      }
      mobile={isMobile}
      compact={isMobile && activeTab !== "eq" && !isBusy}
      draftRecovery={draftRecovery}
    />
  );

  return (
    <div id="app">
      <a
        className="skip-link"
        href="#workspace-content"
        onClick={(event) => {
          // HashRouter owns the URL fragment. Move focus without changing routes.
          event.preventDefault();
          document.getElementById("workspace-content")?.focus();
        }}
      >
        {t("workspace.skip")}
      </a>
      <DebugEqBanner />
      {isMobile && workspaceHeader}
      {isMobile ? (
        <>
          <main
            id="workspace-content"
            tabIndex={-1}
            ref={mobileScrollRef}
            className={`workspace mobile-workspace${showSaveBar ? " has-save-bar" : ""}`}
            aria-label={mobilePageTitle}
          >
            {activeTab !== "eq" && (
              <h1 className="visually-hidden">{mobilePageTitle}</h1>
            )}
            {recoveryPending && (draftInvalid || autoRestoreDone) && (
              <MobileDraftRecovery
                invalid={draftInvalid}
                connected={connected}
                isBusy={isBusy}
                onRestore={restoreDraft}
                onDiscard={resolveDraft}
              />
            )}
            {draftRestored && (
              <DraftRestoredNotice
                isBusy={isBusy}
                onKeep={() => setDraftRestored(false)}
                onDiscard={() => {
                  discardRestoredDraft();
                  setDraftRestored(false);
                }}
              />
            )}
            {showGraph && (activeTab === "eq" || activeTab === "tuning") && (
              <section
                ref={mobileGraphRef}
                className={`mobile-graph-container mobile-graph-${activeTab} ${graphCollapsed ? "collapsed" : ""}`}
              >
                <div
                  className="graph-card"
                  inert={graphCollapsed ? true : undefined}
                  aria-hidden={graphCollapsed}
                >
                  {graphElement({
                    withEditor: activeTab === "eq",
                    focusBand: activeTab === "eq",
                    legend: legendOpen,
                  })}
                </div>
                {/* Curves live under the plot so they never cover the data. */}
                <div className="graph-toolbar">
                  {((showLegendToggle && !graphCollapsed) || canCompare) && (
                    <div className="graph-toolbar-actions">
                      {showLegendToggle && !graphCollapsed && (
                        <button
                          type="button"
                          className={`graph-legend-btn${legendOpen ? " active" : ""}`}
                          aria-pressed={legendOpen}
                          aria-label={t("graph.legend")}
                          title={t("graph.legend")}
                          onClick={() => setLegendOpen((open) => !open)}
                        >
                          <Icon name="legend_toggle" />
                        </button>
                      )}
                      {canCompare && (
                        <CompareHoldButton
                          disabled={isBusy}
                          onStart={() => void bypassCompare.start()}
                          onEnd={() => void bypassCompare.end()}
                        />
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    className="graph-collapse-btn"
                    onClick={handleToggleGraphCollapsed}
                    aria-expanded={!graphCollapsed}
                    aria-label={
                      graphCollapsed
                        ? t("graph.showResponse")
                        : t("graph.hideResponse")
                    }
                  >
                    <span>
                      {graphCollapsed ? t("graph.show") : t("graph.hide")}
                    </span>
                    <Icon
                      name={graphCollapsed ? "expand_more" : "expand_less"}
                    />
                  </button>
                  {eqCurves}
                </div>
              </section>
            )}
            {showGraph && activeTab === "eq" && (
              <div
                className={`mobile-graph-preview ${showGraphPreview ? "visible" : ""}`}
                onClick={handlePreviewClick}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  handlePreviewClick();
                }}
                role="button"
                tabIndex={showGraphPreview ? 0 : -1}
                aria-label={t("graph.scroll")}
                aria-hidden={!showGraphPreview}
                inert={!showGraphPreview ? true : undefined}
              >
                <div
                  className="graph-card"
                  style={{
                    height: "100%",
                    padding: 0,
                    border: "none",
                    background: "transparent",
                  }}
                >
                  {graphElement({ focusBand: true, legend: false })}
                </div>
              </div>
            )}
            <div className="mobile-content-area">
              {activeTab === "eq" && (
                <section className="left-pane">
                  {bandControls}
                  <details className="mobile-preamp-details">
                    <summary>
                      <span>{t("workspace.preamp")}</span>
                      <span>
                        {formatDb(peq.global_gain)} <Icon name="expand_more" />
                      </span>
                    </summary>
                    {preampControls}
                  </details>
                </section>
              )}
              {activeTab === "profiles" && (
                <section className="mobile-profile-pane">
                  <MobileProfilesView
                    {...mobileToolsPanelProps}
                    dacBanks={dacBanks}
                    dacEditor={melodyWorkspace.editorState}
                    onSaveEditorToDacBank={melodyWorkspace.saveEditorToBank}
                    dirty={dirty}
                    isBusy={isBusy || recoveryPending}
                    preview={profilePreview}
                    onReviewEq={() => handleSelectWorkspaceTab("eq")}
                    onUseOnDac={
                      connected && hardwareEq
                        ? handleUseProfileOnDac
                        : undefined
                    }
                  />
                </section>
              )}
              {activeTab === "tuning" && (
                <section className="left-pane">
                  <TuningPanel
                    liveApply={liveApplyActive || melodyWorkspace.active}
                    measurements={measurements}
                    allTargets={allTargets}
                    activeTargetIds={activeTargetIds}
                    onImportPEQ={importPeq}
                    setStatus={setStatus}
                    onAddMeasurement={addMeasurement}
                    onAddTarget={addTarget}
                    onSelectedMeasurementChange={setSelectedMeasurementId}
                    onSelectMeasurementOnly={selectMeasurementOnly}
                    onSelectTargetOnly={selectTargetOnly}
                    maxBands={maxFilterBands}
                    dspSampleRate={capabilities.dsp_sample_rate}
                    getAsyncContext={getAsyncContext}
                  />
                </section>
              )}
              {activeTab === "settings" && settingsSection === "root" && (
                <section className="left-pane">{deviceView("root")}</section>
              )}
              {activeTab === "settings" && (
                <section className="left-pane">
                  <SettingsView
                    settings={settings}
                    onSettingChange={updateSetting}
                    section={settingsSection}
                    graphViewMode={graphViewMode}
                    onGraphViewModeChange={setGraphViewMode}
                    onOpenDiagnostics={handleOpenDiagnosticsModal}
                    showGraph={showGraph}
                    onShowGraphChange={setShowGraph}
                    setStatus={setStatus}
                    onUdevInstalled={handleUdevInstalled}
                    liveApplySupported={liveApplySupported}
                  />
                </section>
              )}
              {/* Device's root page is the top of the Settings tab. */}
              {activeTab === "device" && deviceSection === "root" && (
                <Navigate to={workspacePath("settings")} replace />
              )}
              {activeTab === "device" && deviceSection !== "root" && (
                <section className="left-pane">
                  {deviceView(deviceSection)}
                </section>
              )}
            </div>
            {showSaveBar && (
              <div className="mobile-save-bar" role="status">
                <span>{t("header.notSaved")}</span>
                <Button
                  variant="primary"
                  disabled={isBusy}
                  title={t("header.saveHelp")}
                  onClick={() => void pushEqToDac()}
                >
                  <Icon name="save" /> {melodySaveLabel ?? t("header.save")}
                </Button>
              </div>
            )}
            <nav
              className="mobile-tab-bar"
              aria-label={t("navigation.primary")}
            >
              {MOBILE_BAR_TABS.map(({ id, icon, label }) => (
                <Link
                  key={id}
                  to={workspacePath(id)}
                  className={`mobile-tab-item ${mobileBarTab(activeTab) === id ? "active" : ""}`}
                  aria-current={
                    mobileBarTab(activeTab) === id ? "page" : undefined
                  }
                  onClick={(event) => {
                    if (
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    handleSelectWorkspaceTab(id);
                  }}
                >
                  <div className="mobile-tab-icon-wrapper">
                    <Icon name={icon} />
                  </div>
                  <span>{label}</span>
                </Link>
              ))}
            </nav>
          </main>
        </>
      ) : (
        <main
          className={`workspace desktop-workspace desktop-view-${activeTab}`}
          aria-label={t("workspace.label")}
        >
          <aside className="desktop-sidebar">
            <Link
              className="desktop-brand"
              to={workspacePath("eq")}
              aria-label={t("workspace.home")}
            >
              <span>Glacier EQ</span>
            </Link>
            <nav
              className="desktop-sidebar-nav"
              aria-label={t("navigation.primary")}
            >
              {MOBILE_TABS.map(({ id, icon, label }) => (
                <Fragment key={id}>
                  {id === "device" && (
                    <div
                      className="desktop-sidebar-divider"
                      role="separator"
                      aria-orientation="horizontal"
                    />
                  )}
                  <Link
                    to={workspacePath(id)}
                    className={`desktop-sidebar-item ${activeTab === id ? "active" : ""}`}
                    aria-current={activeTab === id ? "page" : undefined}
                    onClick={(event) => {
                      if (
                        event.button !== 0 ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                      )
                        return;
                      event.preventDefault();
                      handleSelectWorkspaceTab(id);
                    }}
                  >
                    <Icon name={icon} />
                    <span>{label}</span>
                  </Link>
                </Fragment>
              ))}
            </nav>
            <SidebarDevice
              connected={connected}
              reconnecting={reconnecting}
              reconnectingName={connectedDeviceName}
              isSimulated={isDevDummyDevice(selectedDevice)}
              deviceInfo={selectedDeviceInfo}
              to={workspacePath("device")}
              onOpen={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                handleSelectWorkspaceTab("device");
              }}
            />
          </aside>
          <div className="desktop-content">
            {workspaceHeader}
            {activeTab !== "profiles" && (
              <section
                id={
                  activeTab === "eq" ? "workspace-content" : "main-scroll-pane"
                }
                tabIndex={-1}
                aria-label={t("workspace.editor")}
                className="left-pane"
                ref={mainScrollRef}
              >
                {showGraph &&
                  (activeTab === "eq" || activeTab === "tuning") && (
                    <section className="graph-card">
                      <div className="graph-toolbar">
                        {canCompare && activeTab === "eq" && (
                          <CompareHoldButton
                            disabled={isBusy}
                            onStart={() => void bypassCompare.start()}
                            onEnd={() => void bypassCompare.end()}
                          />
                        )}
                        {eqCurves}
                      </div>
                      {graphElement({ withEditor: activeTab === "eq" })}
                    </section>
                  )}
                {activeTab === "eq" && editorControls}
              </section>
            )}
            {activeTab !== "eq" && (
              <ToolsPanel
                peq={peq}
                maxBands={maxFilterBands}
                dspSampleRate={capabilities.dsp_sample_rate}
                onImportPEQ={importPeq}
                dacBanks={dacBanks}
                dacEditor={melodyWorkspace.editorState}
                onSaveEditorToDacBank={melodyWorkspace.saveEditorToBank}
                liveApply={liveApplyActive || melodyWorkspace.active}
                profilePreview={
                  activeTab === "profiles" ? profilePreview : undefined
                }
                onPull={connected && hardwareEq ? pullEq : undefined}
                dirty={dirty}
                profiles={profiles}
                selectedPreset={selectedPreset}
                profileSearch={profileSearch}
                setProfileSearch={setProfileSearch}
                newProfileName={newProfileName}
                setNewProfileName={setNewProfileName}
                onSelectProfile={applyProfile}
                onApplyProfile={
                  connected && supportsRamApply && !melodyWorkspace.experimental
                    ? applyProfileToRam
                    : undefined
                }
                onUseOnDac={
                  connected && hardwareEq ? handleUseProfileOnDac : undefined
                }
                onReloadProfiles={reloadProfiles}
                onOpenProfilesDir={
                  isTauri() && !isAndroid ? openProfilesDir : undefined
                }
                profilesOnDisk={isTauri()}
                onReset={reset}
                onSave={saveProfile}
                onDelete={deleteProfile}
                onRename={renameProfile}
                setStatus={setStatus}
                measurements={measurements}
                allTargets={allTargets}
                activeTargetIds={activeTargetIds}
                onAddMeasurement={addMeasurement}
                onSelectedMeasurementChange={setSelectedMeasurementId}
                onSelectMeasurementOnly={selectMeasurementOnly}
                onSelectTargetOnly={selectTargetOnly}
                graphViewMode={graphViewMode}
                onGraphViewModeChange={setGraphViewMode}
                settings={settings}
                onSettingChange={updateSetting}
                onAddTarget={addTarget}
                connected={connected}
                isBusy={isBusy}
                isSimulated={isDevDummyDevice(selectedDevice)}
                activeTab={TOOL_TAB_BY_WORKSPACE[activeTab] ?? "Preset"}
                onOpenConnectModal={connectPrimary}
                onChooseDevice={handleOpenDeviceModal}
                onOpenDiagnostics={handleOpenDiagnosticsModal}
                showGraph={showGraph}
                onShowGraphChange={setShowGraph}
                getAsyncContext={getAsyncContext}
                runProfileMutation={runProfileMutation}
                onUdevInstalled={handleUdevInstalled}
                liveApplySupported={liveApplySupported}
                deviceInfo={selectedDeviceInfo}
                capabilities={capabilities}
                firmwareVersion={firmwareVersion}
                deviceSection={deviceSection}
                settingsSection={settingsSection}
                onDisconnect={connected ? disconnectDevice : undefined}
                onPreviewChange={handlePreviewChange}
                onExpectedDisconnect={handleExpectedDisconnect}
                onReadFailure={recoverDeviceRead}
                onResetEq={
                  melodyWorkspace.available && melodyWorkspace.bank === null
                    ? undefined
                    : resetDeviceEq
                }
                resetSlot={melodyWorkspace.bank ?? undefined}
                onHardwareEqChanged={melodyWorkspace.invalidate}
                onBeforePresetChange={melodyWorkspace.beforeExternalChange}
                runMaintenance={runDeviceMaintenance}
              />
            )}
          </div>
        </main>
      )}
      {melodySave.request && (
        <MelodySaveDialog
          request={melodySave.request}
          runMaintenance={runDeviceMaintenance}
          onFinish={melodySave.finish}
        />
      )}
      {showDeviceModal && (
        <Modal
          title={t("actions.connect")}
          className="device-modal"
          onClose={handleCloseDeviceModal}
        >
          <div className="modal-body">
            <DeviceChooser
              devices={devices}
              onScan={scanDevices}
              onConnect={handleConnectDevice}
              selectedDevice={selectedDevice}
              setSelectedDevice={setSelectedDevice}
              connected={connected}
              status={status}
              isBusy={isBusy}
            />
          </div>
        </Modal>
      )}
      {showDiagnosticsModal && (
        <Modal
          title={t("navigation.diagnostics")}
          className="wide"
          onClose={handleCloseDiagnosticsModal}
          style={{
            width: "min(800px, 94vw)",
            height: "75vh",
            maxHeight: "75vh",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <DiagnosticsPanel />
          </div>
        </Modal>
      )}
      <ConfirmDialogHost />
    </div>
  );
}

export default App;
