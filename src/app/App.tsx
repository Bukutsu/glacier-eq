import "@/lib/i18n";
import { Trans, useTranslation } from "react-i18next";
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
import { Link, useLocation, useNavigate } from "react-router";
import { invoke } from "@/lib/rpc";
import { createExternalLinkClickHandler } from "@/lib/externalLinks";
import { Bands } from "@/features/eq/components/Bands";
import { DeviceChooser } from "@/features/device/components/DeviceChooser";
import { EqGraph } from "@/features/eq/components/EqGraph";
import { EqCurves } from "@/features/eq/components/EqCurves";
import { Header } from "@/app/components/Header";
import { exportEqFile } from "@/features/eq/lib/exportEq";
import { DraftRecovery } from "@/features/eq/components/DraftRecovery";
import { MobileDraftRecovery } from "@/features/eq/components/MobileDraftRecovery";
import { Icon } from "@/components/ui/Icon";
import { Preamp } from "@/features/eq/components/Preamp";
import {
  MOBILE_TABS,
  parseWorkspacePath,
  workspacePath,
  type MobileTab,
  type ToolsTab,
} from "@/lib/tabs";
import { ConfirmDialogHost } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { isBalanceNavigation, MODAL_HISTORY_KEY } from "@/lib/modalHistory";
import { SidebarDevice } from "@/features/device/components/SidebarDevice";
import { isDevDummyDevice } from "@/features/device/lib/devDevice";
import { formatDb, peqEquals } from "@/features/eq/lib/peq";
import { isTauri } from "@/lib/platform";

import type {
  DeviceInfo,
  GraphViewMode,
  MeasurementTrace,
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

const TOOL_TAB_BY_WORKSPACE: Record<MobileTab, ToolsTab | null> = {
  eq: null,
  tuning: "Tuning",
  profiles: "Preset",
  device: "Device",
  settings: "Settings",
};

function App() {
  const { t } = useTranslation("shell");
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

  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);

  const mainScrollRef = useRef<HTMLElement | null>(null);

  const mobileScrollRef = useRef<HTMLElement | null>(null);

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

  const reconnectCancelRef = useRef<HTMLButtonElement>(null);

  const device = useDeviceState();
  const {
    reconnectEffectGenerationRef,
    manualDisconnectRef,
    expectedRestartUntilRef,
    ambiguousReconnectRef,
    lastConnectedNameRef,
    devices,
    selectedDevice,
    setSelectedDevice,
    connected,
    setConnected,
    setIsReconnecting,
    connectedDeviceName,
    setConnectedDeviceName,
    firmwareVersion,
    isBusy,
    progress,
    eqOperationInFlightRef,
    lastPushedPeq,
    setLastPushedPeq,
    selectedDeviceInfo,
    showReconnectOverlay,
    capabilities,
    hardwareEq,
    maxFilterBands,
    supportsRamApply,
  } = device;
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
    dirty,
    activeBandIndex,
    setActiveBandIndex,
    handleStartChange,
    handleEndChange,
    handlePreampStartChange,
    draftInvalid,
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
  const {
    scanDevices,
    recoverDeviceRead,
    pullEq,
    connectDevice,
    handleExpectedDisconnect,
    resetDeviceEq,
    runDeviceMaintenance,
    handlePreviewChange,
    handleUdevInstalled,
    pushEq,
    applyProfileToRam,
    disconnectDevice,
  } = useDeviceSession(device, editor, {
    settings,
    isMobile,
    isAndroid,
    reportStatus,
    reportLoss,
    setStatus,
    setShowDeviceModal,
  });
  useEditorShortcuts({
    undo,
    redo,
    saveProfile,
    reset,
    pullEq,
    pushEq,
    isBusy,
    eqOperationInFlightRef,
    recoveryPending,
  });
  const liveApplySupported = connected && supportsRamApply;
  // Compared with the DAC's stored EQ, not the loaded profile, so loading a
  // profile counts as a change. `dirty` only covers a DAC that was never read.
  const unsavedOnDac = lastPushedPeq ? !peqEquals(peq, lastPushedPeq) : dirty;
  useLiveApply({
    active: liveApplySupported && settings.live_apply,
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
      const currentTab = activeTabRef.current;
      const scrollEl = mobileScrollRef.current;
      if (currentTab === id) {
        scrollEl?.scrollTo({
          top: 0,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
        });
        mobileScrollPositionsRef.current[id] = 0;
        return;
      }

      mobileScrollPositionsRef.current[currentTab] = scrollEl?.scrollTop ?? 0;
      mobileWorkspacePathsRef.current[currentTab] = location.pathname;
      navigate(mobileWorkspacePathsRef.current[id] ?? workspacePath(id));
    },
    [navigate, location.pathname],
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

  const handleCancelReconnection = useCallback(() => {
    manualDisconnectRef.current = true;
    ambiguousReconnectRef.current = false;
    reconnectEffectGenerationRef.current += 1;
    setConnectedDeviceName("");
    lastConnectedNameRef.current = "";
    setConnected(false);
    setIsReconnecting(false);
    setLastPushedPeq(null);
    setShowDeviceModal(true);
    setStatus(t("connection.disconnected"));
  }, [setConnected, setStatus, t]);

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
      connected && supportsRamApply ? applyProfileToRam : undefined,
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
  const graphElement = (
    withEditor: boolean,
    highlightActiveBand: boolean = false,
  ) => (
    <EqGraph
      capabilities={capabilities}
      peq={peq}
      committedPeq={lastPushedPeq}
      selectedMeasurementId={selectedMeasurementId}
      measurements={measurements}
      targets={activeTargets}
      viewMode={graphViewMode}
      theme={resolvedTheme}
      activeBandIndex={highlightActiveBand ? activeBandIndex : undefined}
      {...(withEditor && !isMobile && !recoveryPending ? graphEditorProps : {})}
    />
  );

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

  useEffect(() => {
    if (showReconnectOverlay) {
      reconnectCancelRef.current?.focus();
    }
  }, [showReconnectOverlay]);

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

  const workspaceHeader = (
    <Header
      inert={showReconnectOverlay ? true : undefined}
      connected={connected}
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
      deviceMatchesEditor={lastPushedPeq ? peqEquals(peq, lastPushedPeq) : null}
      hardwareEq={hardwareEq}
      canUndo={canUndoHistory}
      canRedo={canRedoHistory}
      onUndo={undo}
      onRedo={redo}
      onPull={pullEq}
      onPush={pushEq}
      liveApply={liveApplySupported && settings.live_apply}
      onExportEq={handleExportEq}
      onDisconnect={disconnectDevice}
      onConnectClick={handleOpenDeviceModal}
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
            className="workspace mobile-workspace"
            aria-label={mobilePageTitle}
            inert={showReconnectOverlay ? true : undefined}
          >
            {activeTab !== "eq" && (
              <h1 className="visually-hidden">{mobilePageTitle}</h1>
            )}
            {recoveryPending && (
              <MobileDraftRecovery
                invalid={draftInvalid}
                connected={connected}
                isBusy={isBusy}
                onRestore={restoreDraft}
                onDiscard={resolveDraft}
              />
            )}
            {showGraph && (activeTab === "eq" || activeTab === "tuning") && (
              <section
                className={`mobile-graph-container mobile-graph-${activeTab} ${graphCollapsed ? "collapsed" : ""}`}
              >
                <div
                  className="graph-card"
                  inert={graphCollapsed ? true : undefined}
                  aria-hidden={graphCollapsed}
                >
                  {graphElement(activeTab === "eq")}
                </div>
                {/* Curves live under the plot so they never cover the data. */}
                <div className="graph-toolbar">
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
                  {graphElement(false, true)}
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
                    dirty={dirty}
                    isBusy={isBusy || recoveryPending}
                    preview={profilePreview}
                    onReviewEq={() => handleSelectWorkspaceTab("eq")}
                  />
                </section>
              )}
              {activeTab === "tuning" && (
                <section className="left-pane">
                  <TuningPanel
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
                    onReviewEq={() => handleSelectWorkspaceTab("eq")}
                  />
                </section>
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
              {activeTab === "device" && (
                <section className="left-pane">
                  <DeviceView
                    key={`${connected ? "connected" : "offline"}:${selectedDevice}`}
                    connected={connected}
                    isBusy={isBusy}
                    isSimulated={isDevDummyDevice(selectedDevice)}
                    deviceInfo={selectedDeviceInfo}
                    capabilities={capabilities}
                    firmwareVersion={firmwareVersion}
                    section={deviceSection}
                    setStatus={setStatus}
                    onPull={hardwareEq ? pullEq : undefined}
                    onOpenConnectModal={handleOpenDeviceModal}
                    onDisconnect={connected ? disconnectDevice : undefined}
                    onPreviewChange={handlePreviewChange}
                    onExpectedDisconnect={handleExpectedDisconnect}
                    onReadFailure={recoverDeviceRead}
                    onResetEq={resetDeviceEq}
                    runMaintenance={runDeviceMaintenance}
                  />
                </section>
              )}
            </div>
            <nav
              className="mobile-tab-bar"
              aria-label={t("navigation.primary")}
            >
              {MOBILE_TABS.map(({ id, icon, label }) => (
                <Link
                  key={id}
                  to={workspacePath(id)}
                  className={`mobile-tab-item ${activeTab === id ? "active" : ""}`}
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
          inert={showReconnectOverlay ? true : undefined}
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
                      <div className="graph-toolbar">{eqCurves}</div>
                      {graphElement(activeTab === "eq")}
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
                onReviewEq={() => handleSelectWorkspaceTab("eq")}
                profilePreview={
                  activeTab === "profiles" ? profilePreview : undefined
                }
                onPull={hardwareEq ? pullEq : undefined}
                dirty={dirty}
                profiles={profiles}
                selectedPreset={selectedPreset}
                profileSearch={profileSearch}
                setProfileSearch={setProfileSearch}
                newProfileName={newProfileName}
                setNewProfileName={setNewProfileName}
                onSelectProfile={applyProfile}
                onApplyProfile={
                  connected && supportsRamApply ? applyProfileToRam : undefined
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
                onOpenConnectModal={handleOpenDeviceModal}
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
                onResetEq={resetDeviceEq}
                runMaintenance={runDeviceMaintenance}
              />
            )}
          </div>
        </main>
      )}
      {showReconnectOverlay && (
        <div
          className="reconnecting-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-label={
            Date.now() < expectedRestartUntilRef.current
              ? t("connection.reconnecting")
              : t("connection.lost")
          }
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
            <h3>
              {Date.now() < expectedRestartUntilRef.current
                ? t("connection.restarting")
                : t("connection.lost")}
            </h3>
            <p>
              <Trans
                t={t}
                i18nKey="connection.reconnectingTo"
                values={{ name: connectedDeviceName }}
                components={{ strong: <strong /> }}
              />
            </p>
            <button
              type="button"
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
              {t("connection.cancel")}
            </button>
          </div>
        </div>
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
