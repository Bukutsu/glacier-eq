import "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { memo, type ReactNode } from "react";
import type {
  AppSettings,
  MeasurementTrace,
  Profile,
  PEQData,
  GraphViewMode,
  TargetTrace,
  DeviceCapabilities,
  DeviceInfo,
} from "@/types";
import type { AsyncContext } from "@/lib/asyncContext";
import { DeviceView } from "@/features/device/components/DeviceView";
import type { DeviceMaintenanceRunner } from "@/features/device/operations/runDeviceMaintenance";
import { SettingsView } from "@/features/settings/components/SettingsView";
import { ProfilesView } from "@/features/profiles/components/ProfilesView";
import { TuningPanel } from "@/features/tuning/components/TuningPanel";
import {
  type DeviceSection,
  type SettingsSection,
  type ToolsTab,
} from "@/lib/tabs";
import type { ProfileMutationRunner } from "@/features/profiles/hooks/useProfiles";

interface ToolsPanelProps {
  peq: PEQData;
  onImportPEQ: (data: PEQData, name: string, isSaved: boolean) => boolean;
  onPull?: () => Promise<boolean>;
  profiles: Profile[];
  selectedPreset: string;
  profileSearch: string;
  setProfileSearch: (value: string) => void;
  newProfileName: string;
  setNewProfileName: (value: string) => void;
  onSelectProfile: (profile: Profile) => void;
  onApplyProfile?: (profile: Profile) => void;
  onUseOnDac?: (profile: Profile) => Promise<void>;
  onReloadProfiles: () => void;
  onOpenProfilesDir?: () => void;
  profilesOnDisk?: boolean;
  onReset: () => void;
  onSave: () => void;
  onDelete: (name: string) => void | Promise<void>;
  onRename: (from: string, to: string) => Promise<boolean>;
  setStatus: (value: string) => void;
  measurements?: MeasurementTrace[];
  onAddMeasurement?: (
    name: string,
    points: MeasurementTrace["points"],
  ) => string;
  dirty?: boolean;
  showActions?: boolean;
  graphViewMode?: GraphViewMode;
  onGraphViewModeChange?: (mode: GraphViewMode) => void;
  allTargets?: TargetTrace[];
  activeTargetIds?: string[];
  onSelectedMeasurementChange?: (measurementId: string | null) => void;
  onSelectMeasurementOnly?: (measurementId: string) => void;
  onSelectTargetOnly?: (targetId: string) => void;
  settings: AppSettings;
  onSettingChange: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => void;
  onAddTarget?: (name: string, points: MeasurementTrace["points"]) => string;
  connected?: boolean;
  isBusy?: boolean;
  isSimulated?: boolean;
  activeTab: ToolsTab;
  onOpenConnectModal?: () => void;
  onChooseDevice?: () => void;
  onOpenDiagnostics?: () => void;
  showGraph?: boolean;
  onShowGraphChange?: (show: boolean) => void;
  maxBands?: number;
  dspSampleRate?: number;
  getAsyncContext: () => AsyncContext;
  runProfileMutation: ProfileMutationRunner;
  onUdevInstalled?: () => Promise<string | null>;
  deviceInfo?: DeviceInfo;
  capabilities?: DeviceCapabilities;
  firmwareVersion?: string | null;
  deviceSection?: DeviceSection;
  settingsSection?: SettingsSection;
  liveApplySupported?: boolean;
  onDisconnect?: () => Promise<void>;
  onPreviewChange?: (device: DeviceInfo) => void;
  onExpectedDisconnect?: (restart?: boolean) => void | Promise<void>;
  onReadFailure?: (path: string, error: unknown) => Promise<boolean>;
  onResetEq?: () => Promise<void>;
  resetSlot?: number;
  onHardwareEqChanged?: () => void;
  runMaintenance?: DeviceMaintenanceRunner;
  profilePreview?: ReactNode;
  dacBanks?: ReactNode;
  dacEditor?: { status: string; unsaved: boolean; slot?: number | null };
  onSaveEditorToDacBank?: (slot: number) => Promise<boolean>;
  liveApply?: boolean;
  onBeforePresetChange?: () => Promise<boolean>;
}

export const ToolsPanel = memo(function ToolsPanel(props: ToolsPanelProps) {
  const { t } = useTranslation("shell");
  const tab = props.activeTab;

  return (
    <aside
      id="workspace-content"
      tabIndex={-1}
      className="right-rail"
      aria-label={
        tab === "Preset"
          ? t("navigation.profiles")
          : tab === "Tuning"
            ? t("navigation.tuning")
            : tab === "Device"
              ? t("navigation.device")
              : t("navigation.settings")
      }
    >
      <section className="tools-card">
        <div className="tab-panel">
          {tab === "Preset" && (
            <ProfilesView {...props} preview={props.profilePreview} />
          )}
          {tab === "Tuning" && (
            <TuningPanel
              liveApply={props.liveApply}
              measurements={props.measurements ?? []}
              allTargets={props.allTargets ?? []}
              activeTargetIds={props.activeTargetIds ?? []}
              onImportPEQ={props.onImportPEQ}
              setStatus={props.setStatus}
              onSelectedMeasurementChange={props.onSelectedMeasurementChange}
              onSelectMeasurementOnly={props.onSelectMeasurementOnly}
              onSelectTargetOnly={props.onSelectTargetOnly}
              onAddTarget={props.onAddTarget}
              onAddMeasurement={props.onAddMeasurement}
              maxBands={props.maxBands}
              dspSampleRate={props.dspSampleRate}
              getAsyncContext={props.getAsyncContext}
            />
          )}
          {tab === "Device" && (
            <DeviceView
              key={`${props.connected ? "connected" : "offline"}:${props.deviceInfo?.path ?? "none"}`}
              connected={!!props.connected}
              isBusy={!!props.isBusy}
              isSimulated={props.isSimulated}
              deviceInfo={props.deviceInfo}
              capabilities={props.capabilities}
              firmwareVersion={props.firmwareVersion}
              section={props.deviceSection}
              setStatus={props.setStatus}
              onPull={props.onPull}
              onOpenConnectModal={props.onOpenConnectModal}
              onChooseDevice={props.onChooseDevice}
              onDisconnect={props.onDisconnect}
              onPreviewChange={props.onPreviewChange}
              onExpectedDisconnect={props.onExpectedDisconnect}
              onReadFailure={props.onReadFailure}
              onResetEq={props.onResetEq}
              resetSlot={props.resetSlot}
              onHardwareEqChanged={props.onHardwareEqChanged}
              onBeforePresetChange={props.onBeforePresetChange}
              runMaintenance={props.runMaintenance}
            />
          )}
          {tab === "Settings" && (
            <SettingsView
              settings={props.settings}
              onSettingChange={props.onSettingChange}
              section={props.settingsSection}
              graphViewMode={props.graphViewMode}
              onGraphViewModeChange={props.onGraphViewModeChange}
              onOpenDiagnostics={props.onOpenDiagnostics}
              showGraph={props.showGraph}
              onShowGraphChange={props.onShowGraphChange}
              setStatus={props.setStatus}
              onUdevInstalled={props.onUdevInstalled}
              liveApplySupported={props.liveApplySupported}
            />
          )}
        </div>
      </section>
    </aside>
  );
});
