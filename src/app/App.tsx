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
import { useAppFeedback } from "@/app/hooks/useAppFeedback";
import { useEditorShortcuts } from "@/features/eq/hooks/useEditorShortcuts";
import { useCallback, useEffect, useRef, useState } from "react";
import { DeviceChooser } from "@/features/device/components/DeviceChooser";
import { EqGraph } from "@/features/eq/components/EqGraph";
import { EqCurves } from "@/features/eq/components/EqCurves";
import { Header } from "@/app/components/Header";
import { exportEqFile } from "@/features/eq/lib/exportEq";
import { DraftRecovery } from "@/features/eq/components/DraftRecovery";
import { CompareHoldButton } from "@/features/device/components/CompareHoldButton";
import { loadProfile } from "@/features/profiles/lib/loadProfile";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { MOBILE_TABS, workspacePath } from "@/lib/tabs";
import {
  ConfirmDialogHost,
  confirmDialog,
} from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { SidebarDevice } from "@/features/device/components/SidebarDevice";
import { isDevDummyDevice } from "@/features/device/lib/devDevice";
import { DEFAULT_PROFILE_NAME, peqEquals } from "@/features/eq/lib/peq";
import { isAndroidDevice, isTauri } from "@/lib/platform";

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

import { profileIdentityKey } from "@/features/profiles/lib/profileIdentity";
import { readLocalStorage } from "@/lib/safeStorage";

import { AppEffects } from "./components/AppEffects";
import { DesktopWorkspace } from "./components/DesktopWorkspace";
import { MobileWorkspace } from "./components/MobileWorkspace";
import {
  WorkspacePanels,
  type WorkspacePanelsProps,
} from "./components/WorkspacePanels";
import { useWorkspaceNavigation } from "./hooks/useWorkspaceNavigation";
import { EqEditorControls } from "@/features/eq/components/EqEditorControls";
import {
  WorkspaceGraph,
  type WorkspaceGraphProps,
} from "@/features/eq/components/WorkspaceGraph";
import { MobileResponseGraph } from "@/features/eq/components/MobileResponseGraph";
import { useMobileRecovery } from "@/features/eq/hooks/useMobileRecovery";
import { useDacCompare } from "@/features/device/hooks/useDacCompare";
import { DiagnosticsDialog } from "@/features/diagnostics/components/DiagnosticsDialog";
import { MobileRecovery } from "@/features/eq/components/MobileRecovery";

const EMPTY_MEASUREMENTS: MeasurementTrace[] = [];
const EMPTY_TARGETS: TargetTrace[] = [];

function App() {
  const { t } = useTranslation("shell");
  const { t: libraryT } = useTranslation("library");
  const isMobile = useIsMobile();
  const [showGraph, setShowGraph] = useState(true);
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);
  const [bankSwitching, setBankSwitching] = useState(false);
  const editingMelodyBank = useRef<number | null>(null);
  const device = useDeviceState();
  const navigation = useWorkspaceNavigation(isMobile, () => {
    device.reconnectEffectGenerationRef.current += 1;
    device.ambiguousReconnectRef.current = false;
    device.setIsReconnecting(false);
    setShowDeviceModal(false);
    setShowDiagnosticsModal(false);
  });
  const {
    tab: activeTab,
    deviceSection,
    settingsSection,
    scrollRef: mobileScrollRef,
    selectTab: handleSelectWorkspaceTab,
  } = navigation;
  const isAndroid = isAndroidDevice();
  const {
    ambiguousReconnectRef,
    devices,
    selectedDevice,
    connected,
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
    mobileScrollRef,
    floatingGraphPreview: settings.floating_graph_preview,
  });
  const editor = useEqEditor(device, preview, feedback.setStatus);
  const {
    peq,
    peqRef,
    dirty,
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
    reset,
    canUndoHistory,
    canRedoHistory,
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
  const getCompareScope = () =>
    `${device.connectedRef.current}:${device.connectedPathRef.current}:${device.connectedSessionIdRef.current}`;
  const live = useLiveApply({
    active: liveApplyActive,
    scopeKey: getCompareScope(),
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

  // A/B needs to know what the DAC plays: the editor under live apply, the
  // stored EQ otherwise. Without either it would guess, so it is hidden.
  const comparePlaying: PEQData | null = liveApplyActive ? peq : lastPushedPeq;
  const canCompare =
    connected &&
    hardwareEq &&
    supportsRamApply &&
    !melodyWorkspace.experimental &&
    comparePlaying !== null;
  const bypassCompare = useDacCompare({
    playing: comparePlaying ?? peqRef.current,
    capabilities,
    busy: isBusy,
    busyRef: eqOperationInFlightRef,
    path: selectedDevice,
    scopeKey: getCompareScope(),
    getScopeKey: getCompareScope,
    live,
    liveActive: liveApplyActive,
    reportStatus,
  });
  const recovery = useMobileRecovery(editor, connected, isMobile);

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

  const handleConnectSimulated = useCallback(() => {
    if (
      !import.meta.env.DEV ||
      connected ||
      isBusy ||
      device.eqOperationInFlightRef.current
    )
      return;
    const preview = device.devPreviewDeviceRef.current;
    void handleConnectDevice(preview.path, preview);
  }, [
    connected,
    isBusy,
    device.eqOperationInFlightRef,
    device.devPreviewDeviceRef,
    handleConnectDevice,
  ]);

  const handleExportEq = useCallback(
    () => exportEqFile(peq, selectedPreset, setStatus),
    [peq, selectedPreset, setStatus],
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

  const graphProps: WorkspaceGraphProps = {
    editor,
    mobile: isMobile,
    disabled: isBusy || eqOperationInFlightRef.current,
    capabilities,
    peq,
    committedPeq: lastPushedPeq,
    selectedMeasurementId,
    measurements,
    targets: activeTargets,
    viewMode: graphViewMode,
    theme: resolvedTheme,
    snapToIso,
  };
  const compareControl = canCompare ? (
    <CompareHoldButton
      disabled={isBusy}
      onStart={() => void bypassCompare.start()}
      onEnd={() => void bypassCompare.end()}
    />
  ) : null;
  const editorControls = (
    <EqEditorControls
      editor={editor}
      capabilities={capabilities}
      committedPeq={lastPushedPeq}
      disabled={isBusy || eqOperationInFlightRef.current || recoveryPending}
      mobile={isMobile}
      snapToIso={snapToIso}
    />
  );
  const panelProps: WorkspacePanelsProps = {
    activeTab,
    mobile: isMobile,
    profiles: {
      peq,
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
      onUseOnDac: connected && hardwareEq ? handleUseProfileOnDac : undefined,
      onReloadProfiles: reloadProfiles,
      onOpenProfilesDir: isTauri() && !isAndroid ? openProfilesDir : undefined,
      profilesOnDisk: isTauri(),
      onReset: reset,
      onSave: saveProfile,
      onDelete: deleteProfile,
      onRename: renameProfile,
      setStatus,
      onImportPEQ: importPeq,
      getAsyncContext,
      runProfileMutation,
      dirty,
      isBusy: isBusy || (isMobile && recoveryPending),
      preview: profilePreview,
      dacBanks,
      dacEditor: melodyWorkspace.editorState,
      onSaveEditorToDacBank: melodyWorkspace.saveEditorToBank,
      liveApply: liveApplyActive || melodyWorkspace.active,
      onReviewEq: () => handleSelectWorkspaceTab("eq"),
    },
    tuning: {
      liveApply: liveApplyActive || melodyWorkspace.active,
      measurements,
      allTargets,
      activeTargetIds,
      onImportPEQ: importPeq,
      setStatus,
      onAddMeasurement: addMeasurement,
      onAddTarget: addTarget,
      onSelectedMeasurementChange: setSelectedMeasurementId,
      onSelectMeasurementOnly: selectMeasurementOnly,
      onSelectTargetOnly: selectTargetOnly,
      maxBands: maxFilterBands,
      dspSampleRate: capabilities.dsp_sample_rate,
      getAsyncContext,
    },
    device: {
      connected,
      isBusy,
      isSimulated,
      deviceInfo: selectedDeviceInfo,
      capabilities,
      firmwareVersion,
      section: isMobile && activeTab === "settings" ? "root" : deviceSection,
      setStatus,
      onPull: hardwareEq ? pullEq : undefined,
      onOpenConnectModal: connectPrimary,
      onChooseDevice: handleOpenDeviceModal,
      onConnectSimulated: import.meta.env.DEV
        ? handleConnectSimulated
        : undefined,
      onDisconnect: connected ? disconnectDevice : undefined,
      onPreviewChange: handlePreviewChange,
      onExpectedDisconnect: handleExpectedDisconnect,
      onReadFailure: recoverDeviceRead,
      onResetEq:
        melodyWorkspace.available && melodyWorkspace.bank === null
          ? undefined
          : resetDeviceEq,
      resetSlot: melodyWorkspace.bank ?? undefined,
      onHardwareEqChanged: melodyWorkspace.invalidate,
      onBeforePresetChange: melodyWorkspace.beforeExternalChange,
      runMaintenance: runDeviceMaintenance,
    },
    settings: {
      settings,
      onSettingChange: updateSetting,
      section: settingsSection,
      graphViewMode,
      onGraphViewModeChange: setGraphViewMode,
      onOpenDiagnostics: handleOpenDiagnosticsModal,
      showGraph,
      onShowGraphChange: setShowGraph,
      setStatus,
      onUdevInstalled: handleUdevInstalled,
      liveApplySupported,
    },
  };
  const panels = <WorkspacePanels {...panelProps} />;
  const desktopGraph =
    showGraph && (activeTab === "eq" || activeTab === "tuning") ? (
      <section className="graph-card leg:[background:var(--panel)] leg:rounded-[var(--radius-surface)] leg:[box-shadow:none] leg:flex-[1_1_auto] leg:min-h-[280px] leg:p-[var(--space-4)] leg:[border:1px_solid_var(--line-soft)] leg:flex leg:min-w-[0] leg:relative leg:[.left-pane>&]:sticky leg:[.left-pane>&]:top-[0] leg:[.left-pane>&]:z-[var(--z-graph-sticky)] leg:[.left-pane>&]:flex-col leg:compact:h-[clamp(230px,_34dvh,_300px)] leg:compact:min-h-[230px] leg:compact:p-[10px_8px_8px] leg:compact:rounded-[var(--radius-surface)]! leg:compact:[border:1px_solid_var(--line-soft)]! leg:compact:[background:var(--panel)]! leg:compact:overflow-hidden leg:compact:[.mobile-graph-container_&]:[transition:height_var(--motion-duration)_var(--motion-ease),_opacity_var(--motion-duration)_var(--motion-ease)] leg:compact:[.mobile-graph-container_&]:opacity-[1] leg:compact:[.mobile-graph-container.collapsed_&]:h-[0px]! leg:compact:[.mobile-graph-container.collapsed_&]:min-h-[0px]! leg:compact:[.mobile-graph-container.collapsed_&]:[border:none]! leg:compact:[.mobile-graph-container.collapsed_&]:p-[0]! leg:compact:[.mobile-graph-container.collapsed_&]:m-[0]! leg:compact:[.mobile-graph-container.collapsed_&]:opacity-[0] leg:compact:[.mobile-graph-container.collapsed_&]:pointer-events-none leg:compact:[@media(orientation:_landscape)]:[.mobile-graph-container_&&&]:h-[clamp(100px,_32dvh,_160px)] leg:compact:[@media(orientation:_landscape)]:[.mobile-graph-container_&&]:min-h-[100px] leg:compact:[@media(orientation:_landscape)]:[.mobile-graph-tuning_&&&&]:h-[clamp(80px,_20dvh,_120px)] leg:compact:[@media(orientation:_landscape)]:[.mobile-graph-tuning_&&&]:min-h-[80px] leg:compact:[.mobile-workspace_.mobile-graph-container>&]:rounded-[0]! leg:compact:[.mobile-workspace_.mobile-graph-container>&]:[border-inline:0]! leg:compact:[.mobile-graph-container_&&&&&]:h-[clamp(100px,_16dvh,_136px)] leg:compact:[.mobile-graph-container_&&&&]:min-h-[0] leg:compact:[.mobile-graph-container_&]:p-[6px_8px_4px] leg:compact:[.mobile-graph-tuning_&&&&&&]:h-[clamp(112px,_16dvh,_148px)] leg:compact:[.mobile-graph-tuning_&&&&&]:min-h-[0] leg:[@media(max-height:_580px)]:[.mobile-graph-container_&]:h-[clamp(80px,_18dvh,_100px)]! leg:[@media(max-height:_580px)]:[.mobile-graph-tuning_&&]:h-[clamp(65px,_15dvh,_90px)]! leg:[@media(min-width:_851px)_and_(max-height:_820px)]:min-h-[150px]! leg:[@media(min-width:_851px)_and_(max-height:_820px)]:h-[clamp(150px,_24dvh,_190px)]! leg:[@media(min-width:_600px)_and_(max-width:_850px)]:[.mobile-graph-container_&&&&&&&]:h-[clamp(180px,_24dvh,_300px)] leg:[@media(min-width:_600px)_and_(max-width:_850px)]:[.mobile-graph-tuning_&&&&&&&&]:h-[clamp(160px,_22dvh,_260px)] cmp:compact:[.mobile-workspace_&:has(.eq-graph-layout.legend-open)]:h-[auto]! cmp:compact:[.mobile-workspace_&:has(.eq-graph-layout.legend-open)]:max-h-[none]">
        <div className="graph-toolbar leg:flex leg:items-center leg:justify-end leg:gap-[var(--space-2)] leg:min-h-[32px] leg:m-[calc(-1_*_var(--space-2))_calc(-1_*_var(--space-2))_var(--space-1)] leg:compact:[.mobile-workspace_&]:justify-between leg:compact:[.mobile-workspace_&]:gap-[8px] leg:compact:[.mobile-workspace_&]:min-h-[0] leg:compact:[.mobile-workspace_&]:m-[0] leg:compact:[.mobile-workspace_&]:p-[0_4px]">
          {activeTab === "eq" && compareControl}
          {eqCurves}
        </div>
        <WorkspaceGraph {...graphProps} editing={activeTab === "eq"} />
      </section>
    ) : null;
  const saveBar = showSaveBar ? (
    <div className="mobile-save-bar cmp:compact:fixed cmp:compact:right-[0] cmp:compact:bottom-[calc(var(--tabbar-h,_56px)_+_var(--safe-area-bottom,_0px))] cmp:compact:left-[0] cmp:compact:z-[var(--z-tabbar)] cmp:compact:flex cmp:compact:items-center cmp:compact:justify-between cmp:compact:gap-[var(--space-3)] cmp:compact:p-[var(--space-2)_max(var(--space-4),_var(--safe-area-right,_0px))_var(--space-2)_max(var(--space-4),_var(--safe-area-left,_0px))] cmp:compact:[background:var(--bg)] cmp:compact:[border-top:1px_solid_var(--border)] cmp:compact:text-[color:var(--muted-foreground)] cmp:compact:text-[length:var(--type-small)] cmp:compact:[.keyboard-open_&]:hidden" role="status">
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
  ) : null;

  return (
    <div id="app">
      <AppEffects />
      <a
        className="leg:fixed leg:top-[var(--space-3)] leg:left-[var(--space-3)] leg:z-[var(--z-skip-link)] leg:p-[var(--space-3)_var(--space-4)] leg:[background:var(--bg)] leg:text-[color:var(--text)] leg:[transform:translateY(calc(-100%_-_var(--space-5)))] leg:[&:focus]:[transform:translateY(0)]"
        href="#workspace-content"
        onClick={(event) => {
          // HashRouter owns the fragment; focus without changing routes.
          event.preventDefault();
          document.getElementById("workspace-content")?.focus();
        }}
      >
        {t("workspace.skip")}
      </a>
      <DebugEqBanner />
      {isMobile ? (
        <MobileWorkspace
          activeTab={activeTab}
          title={mobilePageTitle}
          header={workspaceHeader}
          scrollRef={mobileScrollRef}
          recovery={
            <MobileRecovery
              editor={editor}
              connected={connected}
              isBusy={isBusy}
              recovery={recovery}
            />
          }
          graph={
            <MobileResponseGraph
              activeTab={activeTab}
              visible={showGraph}
              graph={graphProps}
              preview={preview}
              scrollRef={mobileScrollRef}
              curves={eqCurves}
              compare={compareControl}
            />
          }
          editor={editorControls}
          panels={panels}
          saveBar={saveBar}
          onSelectTab={handleSelectWorkspaceTab}
        />
      ) : (
        <DesktopWorkspace
          activeTab={activeTab}
          header={workspaceHeader}
          device={
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
          }
          graph={desktopGraph}
          editor={editorControls}
          panels={panels}
          onSelectTab={handleSelectWorkspaceTab}
        />
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
              connected={connected}
              status={status}
              isBusy={isBusy}
            />
          </div>
        </Modal>
      )}
      {showDiagnosticsModal && (
        <DiagnosticsDialog onClose={handleCloseDiagnosticsModal} />
      )}
      <ConfirmDialogHost />
    </div>
  );
}

export default App;
