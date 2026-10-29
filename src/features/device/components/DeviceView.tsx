import { i18n } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import type { StatusReporter } from "@/stores/toastStore";
// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { memo, useEffect, useRef, useState } from "react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { FilterResponse } from "./DacFilterVisual";
import { DawnProControls } from "./DawnProControls";
import { Ja11Controls } from "./Ja11Controls";
import { MelodyControls } from "./MelodyControls";
import { Icon } from "@/components/ui/Icon";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { ConfigurationLayout } from "@/components/layout/ConfigurationLayout";
import { DEVICE_SECTIONS } from "@/lib/tabs";
import { Select } from "@/components/ui/Select";
import { Slider } from "@/components/ui/Slider";
import {
  ActionRow,
  SegmentedRow,
  StackHeader,
} from "@/components/ui/SettingsPrimitives";
import { invokeForDevice, listen } from "@/lib/rpc";
import { DevProtocolPreview } from "./DevProtocolPreview";
import { isDevDummyDevice } from "@/features/device/lib/devDevice";
import { OFFLINE_EDITOR_CAPABILITIES } from "@/features/device/lib/dacSpecs";
import type { DeviceSection } from "@/lib/tabs";
import {
  createCoalescingTaskScheduler,
  mergeFieldsAtUnchangedRevisions,
  revertFieldIfCurrent,
  setField,
} from "@/lib/serializedWrites";
import type { DeviceCapabilities, DeviceInfo } from "@/types";
import type { DeviceMaintenanceRunner } from "@/features/device/operations/runDeviceMaintenance";

function formatChannelBalance(balance: number): string {
  if (balance === 0) return i18n.t("device:deviceView.balanceCenter");
  return balance > 0
    ? i18n.t("device:deviceView.balanceRight", { balance: balance })
    : i18n.t("device:deviceView.balanceLeft", { balance: Math.abs(balance) });
}

export interface DeviceViewProps {
  connected: boolean;
  isBusy?: boolean;
  isSimulated?: boolean;
  deviceInfo?: DeviceInfo;
  capabilities?: DeviceCapabilities;
  firmwareVersion?: string | null;
  section?: DeviceSection;
  setStatus: StatusReporter;
  onPull?: () => Promise<void | boolean>;
  onOpenConnectModal?: () => void;
  onChooseDevice?: () => void;
  onConnectSimulated?: () => void;
  onDisconnect?: () => Promise<void>;
  onPreviewChange?: (device: DeviceInfo) => void;
  /** Called before a write that may make the DAC briefly drop off USB. */
  onExpectedDisconnect?: (restart?: boolean) => void | Promise<void>;
  onReadFailure?: (path: string, error: unknown) => Promise<boolean>;
  onResetEq?: () => Promise<void>;
  resetSlot?: number;
  onHardwareEqChanged?: () => void;
  onBeforePresetChange?: () => Promise<boolean>;
  runMaintenance?: DeviceMaintenanceRunner;
}

type DeviceUtilityState = {
  supported: boolean;
  filter_mode: string;
  amp_mode_class_ab: boolean;
  high_gain_mode: boolean;
  mic_volume_db: number;
  channel_balance: number;
};

export const DeviceView = memo(function DeviceView({
  connected,
  isBusy = false,
  isSimulated = false,
  deviceInfo,
  capabilities = OFFLINE_EDITOR_CAPABILITIES,
  firmwareVersion,
  section = "root",
  setStatus,
  onPull,
  onOpenConnectModal,
  onChooseDevice,
  onConnectSimulated,
  onDisconnect,
  onPreviewChange,
  onExpectedDisconnect,
  onReadFailure,
  onResetEq,
  resetSlot,
  onHardwareEqChanged,
  onBeforePresetChange,
  runMaintenance,
}: DeviceViewProps) {
  const { t } = useTranslation("device");
  const mobile = useIsMobile();

  const invoke = <T,>(command: string, args?: Record<string, unknown>) =>
    invokeForDevice<T>(deviceInfo?.path, command, args);
  const dawnDevice =
    (!isSimulated || isDevDummyDevice(deviceInfo?.path ?? "")) &&
    deviceInfo?.controls === "dawn_pro"
      ? deviceInfo
      : null;
  const ja11Device =
    (!isSimulated || isDevDummyDevice(deviceInfo?.path ?? "")) &&
    deviceInfo?.controls === "ja11"
      ? deviceInfo
      : null;
  const melodyDevice =
    (!isSimulated || isDevDummyDevice(deviceInfo?.path ?? "")) &&
    deviceInfo?.controls === "melody"
      ? deviceInfo
      : null;
  const [utility, setUtility] = useState<DeviceUtilityState | null>(null);
  const utilityRef = useRef<DeviceUtilityState | null>(null);
  const confirmedUtilityRef = useRef<DeviceUtilityState | null>(null);
  const fieldRevisionsRef = useRef<
    Partial<Record<keyof DeviceUtilityState, number>>
  >({});
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;
  const mountedRef = useRef(true);
  const [scheduleUtilityTask] = useState(() =>
    createCoalescingTaskScheduler<string>(),
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchState = async (isActive = () => true, silent = false) => {
    if (!connected || dawnDevice || ja11Device || melodyDevice) return;
    if (!silent) {
      setLoading(true);
      setLoadError(null);
    }
    const revisionsAtRefresh = { ...fieldRevisionsRef.current };
    try {
      const data = await invoke<DeviceUtilityState>("get_dac_utility_state");
      if (isActive()) {
        const base = utilityRef.current ?? data;
        const merged = mergeFieldsAtUnchangedRevisions(
          base,
          data,
          revisionsAtRefresh,
          fieldRevisionsRef.current,
        );
        setUtility(merged);
        utilityRef.current = merged;
        confirmedUtilityRef.current = data;
        setLoadError(null);
      }
    } catch (err) {
      if (isActive()) {
        if (!silent || utilityRef.current === null) {
          setLoadError(t("deviceView.loadFailed", { err: err }));
        } else {
          setStatus(t("deviceView.refreshFailed", { err: err }));
        }
      }
    } finally {
      if (isActive()) setLoading(false);
    }
  };

  useEffect(() => {
    setUtility(null);
    utilityRef.current = null;
    confirmedUtilityRef.current = null;
    fieldRevisionsRef.current = {};
    if (!connected || dawnDevice || ja11Device || melodyDevice) {
      setLoading(false);
      return;
    }

    let active = true;
    mountedRef.current = true;
    scheduleUtilityTask.enqueue("refresh", async (isCurrent) => {
      await fetchState(() => active && isCurrent());
    });

    let unlisten: (() => void) | null = null;
    listen<void>("device-pull", () => {
      if (active) {
        scheduleUtilityTask.enqueue("refresh", async (isCurrent) => {
          await fetchState(() => active && isCurrent(), true);
        });
      }
    })
      .then((unsub) => {
        if (active) {
          unlisten = unsub;
        } else {
          try {
            unsub();
          } catch {}
        }
      })
      .catch((error) => {
        if (active) console.error("Failed to listen for device-pull:", error);
      });

    return () => {
      active = false;
      mountedRef.current = false;
      scheduleUtilityTask.invalidate();
      if (unlisten) unlisten();
    };
  }, [connected, deviceInfo?.path, !!dawnDevice, !!ja11Device, !!melodyDevice]);

  const setUtilityField = async <K extends keyof DeviceUtilityState>(
    field: K,
    value: DeviceUtilityState[K],
    command: string,
    args: Record<string, unknown>,
  ) => {
    if (isBusyRef.current) return;
    const current = utilityRef.current;
    if (!current) return;

    const revision = (fieldRevisionsRef.current[field] ?? 0) + 1;
    fieldRevisionsRef.current[field] = revision;
    const optimistic = setField(current, field, value);
    utilityRef.current = optimistic;
    setUtility(optimistic);

    scheduleUtilityTask.enqueue(field, async (isCurrent) => {
      if (!isCurrent()) return;
      try {
        const actual = await invoke<DeviceUtilityState>(command, args);
        if (
          !actual ||
          typeof actual !== "object" ||
          typeof actual[field] !== typeof value
        ) {
          throw new Error("Device returned an invalid utility readback.");
        }
        const observed = actual[field];
        const confirmed = confirmedUtilityRef.current;
        if (confirmed && isCurrent()) {
          confirmedUtilityRef.current = setField(confirmed, field, observed);
          const latest = utilityRef.current;
          if (latest && fieldRevisionsRef.current[field] === revision) {
            const corrected = setField(latest, field, observed);
            utilityRef.current = corrected;
            if (mountedRef.current) setUtility(corrected);
          }
        }
      } catch (err) {
        if (!isCurrent()) return;
        const latest = utilityRef.current;
        const confirmed = confirmedUtilityRef.current;
        if (latest && confirmed) {
          const reverted = revertFieldIfCurrent(
            latest,
            confirmed,
            field,
            revision,
            fieldRevisionsRef.current[field] ?? 0,
          );
          if (reverted !== latest) {
            utilityRef.current = reverted;
            if (mountedRef.current) setUtility(reverted);
          }
        }
        if (mountedRef.current) {
          setStatus(t("deviceView.updateFailed", { err: err }));
        }
      }
    });
  };

  const handleSetFilter = (mode: string) =>
    setUtilityField("filter_mode", mode, "set_dac_filter_mode", { mode });

  const handleSetAmpMode = (isClassAb: boolean) =>
    setUtilityField("amp_mode_class_ab", isClassAb, "set_dac_work_mode", {
      isClassAb,
    });

  const handleSetOutputGain = (isHighGain: boolean) =>
    setUtilityField("high_gain_mode", isHighGain, "set_dac_output_gain", {
      isHighGain,
    });

  const handleSetBalance = (balance: number) =>
    setUtilityField("channel_balance", balance, "set_dac_balance", { balance });

  const handleSetMicVolume = (volumeDb: number) =>
    setUtilityField("mic_volume_db", volumeDb, "set_mic_volume", { volumeDb });

  const handleUtilityReset = async (factory: boolean) => {
    if (isBusyRef.current || !runMaintenance) return;
    let readAfterReset: (() => boolean) | undefined;
    await runMaintenance(async (sessionIsCurrent) => {
      const active = () => mountedRef.current && sessionIsCurrent();
      if (
        !(await confirmDialog({
          title: factory
            ? t("deviceView.factoryResetTitle")
            : t("deviceView.resetControlsTitle"),
          message: factory
            ? t("deviceView.factoryResetConfirmation")
            : t("deviceView.resetControlsConfirmation"),
          confirmLabel: factory
            ? t("deviceView.factoryReset")
            : t("deviceView.reset"),
          danger: true,
        })) ||
        !active()
      )
        return;

      scheduleUtilityTask.enqueue(
        "reset",
        async (taskIsCurrent) => {
          const isCurrent = () => active() && taskIsCurrent();
          // A reset queued behind a control write may outlive its connection.
          if (!isCurrent()) return;
          try {
            const resetState = await invoke<DeviceUtilityState | undefined>(
              factory ? "execute_factory_reset" : "reset_device_controls",
            );
            if (!isCurrent()) return;
            const data =
              resetState ??
              (await invoke<DeviceUtilityState>("get_dac_utility_state"));
            if (!isCurrent()) return;
            utilityRef.current = data;
            confirmedUtilityRef.current = data;
            setUtility(data);
            if (factory) {
              readAfterReset = active;
            } else {
              setStatus(t("deviceView.controlsReset"), "success");
            }
          } catch (err) {
            if (!isCurrent()) return;
            setStatus(
              factory
                ? t("deviceView.factoryResetFailed", { err: err })
                : t("deviceView.controlsResetFailed", { err: err }),
            );
          }
        },
        { supersedePending: true },
      );
      await scheduleUtilityTask.whenIdle();
    });
    // The EQ reader claims the same operation slot. Start it only after the
    // maintenance runner releases that slot, and never for a replaced session.
    if (readAfterReset?.()) {
      try {
        const pulled = await onPull?.();
        if (!readAfterReset()) return;
        setStatus(
          pulled === false
            ? t("deviceView.factoryResetReadbackFailed")
            : t("deviceView.factoryResetComplete"),
          pulled === false ? "error" : "success",
        );
      } catch (error) {
        if (readAfterReset())
          setStatus(
            t("deviceView.factoryResetReadFailed", {
              error: error,
            }),
            "error",
          );
      }
    }
  };

  const officialSpec =
    connected || isSimulated ? (deviceInfo?.spec ?? null) : null;

  const deviceTitle =
    connected || isSimulated
      ? deviceInfo?.profile_name ||
        deviceInfo?.product_string ||
        officialSpec?.name ||
        t("deviceView.connectedDac")
      : t("deviceView.offlineEditor");

  const dspKhz = Math.round(capabilities.dsp_sample_rate / 1000);

  const handleChangeDevice = async () => {
    // The chooser is the point of this button, so open it even if the
    // disconnect fails or is superseded. Otherwise a rejected teardown leaves
    // the user on a device screen with no way forward.
    try {
      await onDisconnect?.();
    } finally {
      (onChooseDevice ?? onOpenConnectModal)?.();
    }
  };

  const activeSection = section === "root" ? "overview" : section;
  const sectionTitle =
    activeSection === "overview"
      ? connected
        ? t("deviceView.specifications")
        : t("deviceView.offlineSpecifications")
      : activeSection === "controls"
        ? t("deviceView.soundControls")
        : t("deviceView.resetMaintenance");
  const sections = connected
    ? DEVICE_SECTIONS
    : DEVICE_SECTIONS.filter((item) => item.id === "overview");

  const connectionActions = (
    <>
      {onDisconnect && (
        <Button
          type="button"
          variant="ghost"
          onClick={onDisconnect}
          disabled={isBusy}
        >
          <Icon name="link_off" />
          <span>{t("deviceView.disconnect")}</span>
        </Button>
      )}
      {onOpenConnectModal && (
        <Button
          type="button"
          variant="default"
          onClick={handleChangeDevice}
          disabled={isBusy}
        >
          <Icon name="swap_horiz" />
          <span>{t("deviceView.changeDevice")}</span>
        </Button>
      )}
    </>
  );

  const deviceSummary = (
    <Card
      className="device-summary leg:m-[0_16px] leg:p-[20px_0] leg:[border-bottom:1px_solid_var(--line-soft)] leg:compact:[.mobile-workspace_&]:m-[0] leg:compact:[.mobile-workspace_&]:p-[16px] cmp:[.configuration-layout_&]:grid cmp:[.configuration-layout_&]:grid-cols-[minmax(0,_1fr)_auto] cmp:[.configuration-layout_&]:gap-[var(--space-2)_var(--space-4)] cmp:[.configuration-layout_&]:p-[var(--space-4)] cmp:[.configuration-layout_&]:m-[0_0_var(--space-5)] cmp:compact:[.configuration-layout_&&]:grid-cols-[minmax(0,_1fr)]"
      aria-label={t("deviceView.deviceConnection")}
    >
      <div className="leg:flex leg:flex-col leg:gap-[6px] leg:m-[10px_0_14px] cmp:[.configuration-layout_&]:min-w-[0] cmp:[.configuration-layout_&]:m-[0] cmp:[.configuration-layout_&]:gap-[var(--space-1)]">
        <div className="cmp:flex cmp:items-center cmp:flex-wrap cmp:gap-[var(--space-2)_var(--space-3)]">
          <h2 className="leg:[.device-summary_&]:text-[length:20px] leg:[.device-summary_&]:font-semibold leg:[.device-summary_&]:[overflow-wrap:anywhere] leg:m-[0] leg:text-[length:clamp(18px,_3.5vw,_20px)] leg:font-bold leg:text-[color:var(--text)] leg:tracking-[-0.01em] cmp:[.configuration-layout_&]:text-[length:var(--type-body)] cmp:[.configuration-layout_&]:font-semibold cmp:[.configuration-layout_&]:m-[0]">{deviceTitle}</h2>
          <Badge className="gap-1.5">
            <span
              className={`size-1.5 shrink-0 rounded-full ${connected ? (isSimulated ? "bg-[var(--yellow)]" : "bg-[var(--green)]") : "bg-muted-foreground"}`}
              aria-hidden="true"
            />
            {connected
              ? isSimulated
                ? t("deviceView.simulation")
                : t("deviceView.connected")
              : t("deviceView.offline")}
          </Badge>
        </div>
        <p className="leg:[.device-summary_&]:max-w-[52ch] leg:m-[0] leg:text-[length:var(--type-small)] leg:text-[color:var(--muted)] leg:leading-[1.5] cmp:[.configuration-layout_&]:text-[length:var(--type-small)] cmp:[.configuration-layout_&]:leading-[1.5] cmp:[.configuration-layout_&]:m-[var(--space-1)_0_0]">
          {connected
            ? deviceInfo?.hardware_eq === false
              ? dawnDevice
                ? t("deviceView.controlsOnlyDescription")
                : t("deviceView.noEqDescription")
              : isSimulated
                ? t("deviceView.simulationDescription")
                : t("deviceView.connectedDescription")
            : t("deviceView.offlineDescription")}
        </p>
      </div>

      <div className="device-hero-actions leg:[.device-summary_&]:flex-row leg:[.device-summary_&]:flex-wrap leg:[.device-summary_&]:gap-[8px] leg:flex leg:items-center leg:gap-[12px] leg:compact:[.mobile-workspace_&&]:flex-row leg:compact:[.mobile-workspace_&&]:flex-wrap leg:compact:[.mobile-workspace_&]:items-center cmp:[.configuration-layout_&]:[align-self:center] cmp:[.configuration-layout_&]:m-[0] cmp:compact:[.configuration-layout_&]:flex-wrap">
        {connected ? (
          mobile ? (
            <details className="device-connection-options">
              <summary>
                {t("deviceView.connectionOptions")}
                <Icon
                  name="expand_more"
                  size={18}
                  className="leg:flex-[0_0_auto] leg:text-[color:var(--muted)] leg:[transition:transform_var(--motion-duration)_var(--motion-ease)] leg:[details[open]>summary_&]:[transform:rotate(180deg)] leg:[.add-trace-cache_summary_&]:ml-[auto]"
                />
              </summary>
              {connectionActions}
            </details>
          ) : (
            <div className="leg:flex leg:items-center leg:gap-[8px]">{connectionActions}</div>
          )
        ) : (
          <>
            {onOpenConnectModal && (
              <Button
                type="button"
                variant="primary"
                onClick={onOpenConnectModal}
                disabled={isBusy}
              >
                <Icon name="usb" />
                <span>{t("deviceView.connectDac")}</span>
              </Button>
            )}
            {import.meta.env.DEV && onConnectSimulated && (
              <Button onClick={onConnectSimulated} disabled={isBusy}>
                {t("deviceView.connectSimulatedDac")}
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );

  return (
    <ConfigurationLayout
      kind="device"
      active={activeSection}
      root={section === "root"}
      sections={sections}
      summary={deviceSummary}
      sectionTitle={sectionTitle}
      sectionValues={{
        overview:
          deviceInfo?.hardware_eq === false
            ? t("deviceView.noHardwareEq")
            : t("deviceView.bandSummary", {
                count: capabilities.num_bands,
                rate: dspKhz,
              }),
        controls: ja11Device
          ? t("deviceView.microphoneUsbAudioVolume")
          : melodyDevice
            ? t("deviceView.eqPresetSummary")
            : dawnDevice
              ? t("deviceView.volumeGainFilterLed")
              : utility?.supported
                ? t(
                    utility.high_gain_mode
                      ? "deviceView.highGainSummary"
                      : "deviceView.lowGainSummary",
                    { mode: utility.filter_mode },
                  )
                : undefined,
      }}
    >
      <StackHeader title={sectionTitle} />
      {isSimulated && deviceInfo && onPreviewChange && (
        <DevProtocolPreview
          device={deviceInfo}
          disabled={isBusy}
          onChange={onPreviewChange}
        />
      )}

      {activeSection === "controls" && connected && !isSimulated && (
        <p className="cmp:m-[0_0_var(--space-5)] cmp:text-[color:var(--muted-foreground)] cmp:text-[length:var(--type-small)] cmp:leading-[1.5]">
          {t("deviceView.controlsDescription")}
        </p>
      )}
      {activeSection === "controls" &&
        connected &&
        isSimulated &&
        (ja11Device || melodyDevice) && (
          <p className="cmp:m-[0_0_var(--space-5)] cmp:text-[color:var(--muted-foreground)] cmp:text-[length:var(--type-small)] cmp:leading-[1.5]">
            {t("deviceView.simulatedControlsDescription")}
          </p>
        )}
      <div className="stack-content leg:flex leg:flex-col leg:gap-[14px] leg:p-[16px] leg:w-[100%] leg:box-border leg:compact:[.mobile-workspace_&]:p-[0] leg:compact:[.mobile-workspace_&]:gap-[12px] cmp:[.configuration-layout_&]:p-[0] cmp:[.configuration-layout_&]:gap-[var(--space-5)]">
        {activeSection === "overview" && (
          <>
            <dl className="device-spec-list leg:m-[0] leg:p-[0_16px] leg:[.stack-content>&]:px-[0]! leg:compact:[.mobile-workspace_&]:p-[0_16px] leg:compact:[.mobile-workspace_.stack-content>&]:px-[16px]! cmp:[.configuration-layout_&]:p-[0] cmp:[.configuration-layout_&]:gap-[0]">
              {connected && (
                <div>
                  <dt>{t("deviceView.chip")}</dt>
                  <dd>{officialSpec?.chip ?? t("deviceView.notReported")}</dd>
                </div>
              )}
              {deviceInfo?.hardware_eq === false ? (
                <div>
                  <dt>{t("deviceView.hardwareEq")}</dt>
                  <dd>{t("deviceView.none")}</dd>
                </div>
              ) : (
                <>
                  <div>
                    <dt>{t("deviceView.dspSampleRate")}</dt>
                    <dd>{dspKhz} kHz</dd>
                  </div>
                  <div>
                    <dt>{t("deviceView.eqBands")}</dt>
                    <dd>{capabilities.num_bands}</dd>
                  </div>
                  <div>
                    <dt>{t("deviceView.bandGain")}</dt>
                    <dd>
                      {t("deviceView.bandGainRange", {
                        min: capabilities.band_gain_range[0],
                        max: capabilities.band_gain_range[1],
                      })}
                    </dd>
                  </div>
                </>
              )}
              {officialSpec?.outputs && (
                <div>
                  <dt>{t("deviceView.outputs")}</dt>
                  <dd>{officialSpec.outputs}</dd>
                </div>
              )}
              {officialSpec?.maxPower && (
                <div>
                  <dt>{t("deviceView.outputPower")}</dt>
                  <dd>{officialSpec.maxPower}</dd>
                </div>
              )}
              {officialSpec?.decoding && (
                <div>
                  <dt>{t("deviceView.decoding")}</dt>
                  <dd>{officialSpec.decoding}</dd>
                </div>
              )}
              {connected && firmwareVersion && (
                <div>
                  <dt>{t("deviceView.firmware")}</dt>
                  <dd>{firmwareVersion}</dd>
                </div>
              )}
              {/* What the device reports about itself, so a re-flashed unit is identifiable. */}
              {connected && deviceInfo?.manufacturer && (
                <div>
                  <dt>{t("deviceView.usbManufacturer")}</dt>
                  <dd>{deviceInfo.manufacturer}</dd>
                </div>
              )}
              {connected && deviceInfo?.product_string && (
                <div>
                  <dt>{t("deviceView.usbProduct")}</dt>
                  <dd>{deviceInfo.product_string}</dd>
                </div>
              )}
              {connected && deviceInfo && (
                <div>
                  <dt>{t("deviceView.usbId")}</dt>
                  <dd>
                    {deviceInfo.vendor_id.toString(16).padStart(4, "0")}:
                    {deviceInfo.product_id.toString(16).padStart(4, "0")}
                  </dd>
                </div>
              )}
            </dl>
            <p className="leg:m-[0] leg:p-[12px_16px] leg:text-[color:var(--muted)] leg:text-[length:var(--type-small)] leg:leading-[1.5] leg:compact:[.mobile-workspace_&]:p-[12px_16px] cmp:[.configuration-layout_&]:text-[length:var(--type-small)] cmp:[.configuration-layout_&]:leading-[1.5] cmp:[.configuration-layout_&]:text-[color:var(--muted-foreground)]">
              {connected
                ? t("deviceView.connectedSpecsNote")
                : t("deviceView.offlineSpecsNote")}
            </p>
          </>
        )}

        {activeSection === "controls" && (
          <>
            {!connected ? (
              <section className="settings-card empty-card">
                <div className="empty-state">
                  <Icon name="tune" size={44} />
                  <h3>{t("deviceView.deviceNotConnected")}</h3>
                  <p>{t("deviceView.connectForControls")}</p>
                  {onOpenConnectModal && (
                    <Button
                      type="button"
                      variant="primary"
                      onClick={onOpenConnectModal}
                    >
                      <Icon name="usb" />
                      <span>{t("deviceView.connectDac")}</span>
                    </Button>
                  )}
                </div>
              </section>
            ) : ja11Device ? (
              <Ja11Controls
                key={ja11Device.path}
                path={ja11Device.path}
                isBusy={isBusy}
                setStatus={setStatus}
                onExpectedDisconnect={onExpectedDisconnect}
                onReadFailure={onReadFailure}
              />
            ) : melodyDevice ? (
              <MelodyControls
                key={melodyDevice.path}
                path={melodyDevice.path}
                isBusy={isBusy}
                setStatus={setStatus}
                onReadFailure={onReadFailure}
                onHardwareEqChanged={onHardwareEqChanged}
                onBeforePresetChange={onBeforePresetChange}
                runMaintenance={runMaintenance}
                onResetEq={onResetEq}
                resetSlot={resetSlot}
              />
            ) : dawnDevice ? (
              <DawnProControls
                key={dawnDevice.path}
                path={dawnDevice.path}
                isBusy={isBusy}
                setStatus={setStatus}
              />
            ) : loading ? (
              <section className="settings-card empty-card">
                <div className="empty-state">
                  <div
                    className="leg:w-[48px] leg:h-[48px] leg:[border:3px_solid_var(--bg-dark)] leg:[&&]:[border-top-color:var(--warning-foreground)] leg:rounded-[50%] leg:[animation:spin_1s_linear_infinite]"
                    style={{ width: 32, height: 32 }}
                  />
                  <h3>{t("deviceView.readingDeviceSettings")}</h3>
                  <p>{t("deviceView.readingSettingsFromTheDac")}</p>
                </div>
              </section>
            ) : loadError ? (
              <section className="settings-card empty-card">
                <div className="empty-state">
                  <Icon name="error" />
                  <h3>{t("deviceView.controlsLoadFailed")}</h3>
                  <p>{loadError}</p>
                  <Button type="button" onClick={() => fetchState()}>
                    <Icon name="refresh" />
                    <span>{t("deviceView.retry")}</span>
                  </Button>
                </div>
              </section>
            ) : !utility?.supported ? (
              <section className="settings-card empty-card">
                <div className="empty-state">
                  <Icon name="tune" />
                  <h3>
                    {isSimulated
                      ? t("deviceView.simulationMode")
                      : t("deviceView.controlsUnavailable")}
                  </h3>
                  <p>
                    {isSimulated
                      ? t("deviceView.unsupportedSimulationDescription")
                      : t("deviceView.unsupportedControlsDescription")}
                  </p>
                </div>
              </section>
            ) : (
              <div className="stack-card">
                <div className="stack-pref-row select-row">
                  <div className="stack-pref-info">
                    <label
                      className="stack-pref-title"
                      htmlFor="utility-filter-select"
                    >
                      {t("deviceView.reconstructionFilter")}
                    </label>
                    <span className="stack-pref-desc">
                      {t("deviceView.filterDescription")}
                    </span>
                  </div>
                  <div className="stack-pref-control">
                    <div className="leg:flex-[0_1_240px] leg:w-[min(240px,_60%)] leg:min-w-[190px] leg:compact:[.mobile-workspace_.stack-pref-row.select-row_&]:w-[100%]! leg:compact:[.mobile-workspace_.stack-pref-row.select-row_&]:min-w-[100%]! leg:compact:[.mobile-workspace_.stack-pref-row.select-row_&]:flex-[1_1_100%]! cmp:[.configuration-layout_&]:w-[240px] cmp:[.configuration-layout_&]:max-w-[100%] cmp:max-[1050px]:[.configuration-layout_&&]:w-[100%]">
                      <Select
                        id="utility-filter-select"
                        value={utility.filter_mode}
                        disabled={isBusy}
                        onChange={handleSetFilter}
                        options={[
                          {
                            value: "FAST-LL",
                            label: t("deviceView.filterFastLowLatency"),
                          },
                          {
                            value: "FAST-PC",
                            label: t("deviceView.filterFastPhaseCompensated"),
                          },
                          {
                            value: "Slow-LL",
                            label: t("deviceView.filterSlowLowLatency"),
                          },
                          {
                            value: "Slow-PC",
                            label: t("deviceView.filterSlowPhaseCompensated"),
                          },
                          {
                            value: "NON-OS",
                            label: t("deviceView.filterNonOversampling"),
                          },
                        ]}
                      />
                    </div>
                  </div>
                </div>

                <FilterResponse mode={utility.filter_mode} />

                <SegmentedRow
                  title={t("deviceView.amplifier")}
                  desc={t("deviceView.amplifierDescription")}
                  value={utility.amp_mode_class_ab ? "ab" : "h"}
                  options={[
                    { value: "h", label: t("deviceView.classH") },
                    { value: "ab", label: t("deviceView.classAb") },
                  ]}
                  onChange={(value) => handleSetAmpMode(value === "ab")}
                  disabled={isBusy}
                />

                <SegmentedRow
                  title={t("deviceView.gain")}
                  desc={t("deviceView.gainDescription")}
                  value={utility.high_gain_mode ? "high" : "low"}
                  options={[
                    { value: "low", label: t("deviceView.low") },
                    { value: "high", label: t("deviceView.high") },
                  ]}
                  onChange={(value) => handleSetOutputGain(value === "high")}
                  disabled={isBusy}
                />

                <div className="leg:flex leg:flex-col leg:gap-[10px] leg:p-[14px_16px] leg:[border-top:1px_solid_var(--line-subtle)] leg:rounded-[0]! leg:[&.pref-slider-first]:[border-top:none] leg:[&.pref-slider-first]:pt-[12px] cmp:[.configuration-layout_&]:p-[var(--space-4)_0] pref-slider-first">
                  <div className="leg:flex leg:items-center leg:justify-between leg:gap-[12px] cmp:[.configuration-layout_&]:gap-[var(--space-3)]">
                    <div className="stack-pref-info">
                      <span className="stack-pref-title">
                        {t("deviceView.channelBalance")}
                      </span>
                      <span className="stack-pref-desc">
                        {t("deviceView.balanceDescription")}
                      </span>
                    </div>
                    <span className="leg:[font-family:var(--font-mono)] leg:text-[length:13px] leg:font-semibold leg:text-[color:var(--link-foreground)] leg:[background:var(--bg-dark)] leg:[border:1px_solid_var(--line-subtle)] leg:p-[3px_8px] leg:rounded-[0]! leg:whitespace-nowrap cmp:[.configuration-layout_&]:shrink-0 cmp:[.configuration-layout_&]:[align-self:flex-start] cmp:[.configuration-layout_&]:p-[0] cmp:[.configuration-layout_&]:[border:0] cmp:[.configuration-layout_&]:[background:transparent] cmp:[.configuration-layout_&]:text-[color:var(--foreground)] cmp:[.configuration-layout_&]:[font-family:var(--font-ui)] cmp:[.configuration-layout_&]:text-[length:var(--type-label)] cmp:[.configuration-layout_&]:font-normal cmp:[.configuration-layout_&]:[font-variant-numeric:tabular-nums] cmp:[.configuration-layout_&]:leading-[1.35] cmp:[.configuration-layout_&]:text-right">
                      {formatChannelBalance(utility.channel_balance)}
                    </span>
                  </div>
                  <Slider
                    min={-15}
                    max={15}
                    step={1}
                    aria-label={t("deviceView.channelBalance")}
                    disabled={isBusy}
                    aria-valuetext={formatChannelBalance(
                      utility.channel_balance,
                    )}
                    value={utility.channel_balance}
                    onChange={(e) => handleSetBalance(Number(e.target.value))}
                  />
                </div>

                <div className="leg:flex leg:flex-col leg:gap-[10px] leg:p-[14px_16px] leg:[border-top:1px_solid_var(--line-subtle)] leg:rounded-[0]! leg:[&.pref-slider-first]:[border-top:none] leg:[&.pref-slider-first]:pt-[12px] cmp:[.configuration-layout_&]:p-[var(--space-4)_0]">
                  <div className="leg:flex leg:items-center leg:justify-between leg:gap-[12px] cmp:[.configuration-layout_&]:gap-[var(--space-3)]">
                    <div className="stack-pref-info">
                      <span className="stack-pref-title">
                        {t("deviceView.microphoneSidetone")}
                      </span>
                      <span className="stack-pref-desc">
                        {t("deviceView.sidetoneDescription")}
                      </span>
                    </div>
                    <span className="leg:[font-family:var(--font-mono)] leg:text-[length:13px] leg:font-semibold leg:text-[color:var(--link-foreground)] leg:[background:var(--bg-dark)] leg:[border:1px_solid_var(--line-subtle)] leg:p-[3px_8px] leg:rounded-[0]! leg:whitespace-nowrap cmp:[.configuration-layout_&]:shrink-0 cmp:[.configuration-layout_&]:[align-self:flex-start] cmp:[.configuration-layout_&]:p-[0] cmp:[.configuration-layout_&]:[border:0] cmp:[.configuration-layout_&]:[background:transparent] cmp:[.configuration-layout_&]:text-[color:var(--foreground)] cmp:[.configuration-layout_&]:[font-family:var(--font-ui)] cmp:[.configuration-layout_&]:text-[length:var(--type-label)] cmp:[.configuration-layout_&]:font-normal cmp:[.configuration-layout_&]:[font-variant-numeric:tabular-nums] cmp:[.configuration-layout_&]:leading-[1.35] cmp:[.configuration-layout_&]:text-right">
                      {utility.mic_volume_db} dB
                    </span>
                  </div>
                  <Slider
                    min={-15}
                    max={15}
                    step={1}
                    aria-label={t("deviceView.microphoneSidetone")}
                    disabled={isBusy}
                    aria-valuetext={`${utility.mic_volume_db} dB`}
                    value={utility.mic_volume_db}
                    onChange={(e) => handleSetMicVolume(Number(e.target.value))}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {activeSection === "maintenance" && (
          <>
            {!connected ? (
              <section className="settings-card empty-card">
                <div className="empty-state">
                  <Icon name="build" size={44} />
                  <h3>{t("deviceView.deviceNotConnected")}</h3>
                  <p>{t("deviceView.connectForMaintenance")}</p>
                  {onOpenConnectModal && (
                    <Button
                      type="button"
                      variant="primary"
                      onClick={onOpenConnectModal}
                    >
                      <Icon name="usb" />
                      <span>{t("deviceView.connectDac")}</span>
                    </Button>
                  )}
                </div>
              </section>
            ) : (
              <div className="stack-card">
                {deviceInfo?.hardware_eq !== false && (
                  <ActionRow
                    title={t("deviceView.resetDeviceEq")}
                    desc={t("deviceView.resetEqDescription")}
                    actionLabel={
                      isBusy
                        ? t("deviceView.pleaseWait")
                        : t("deviceView.resetEq")
                    }
                    disabled={isBusy || !onResetEq}
                    onAction={() => void onResetEq?.()}
                  />
                )}

                {/* Control and factory resets use Walkplay commands only. */}
                {utility?.supported && (
                  <>
                    <ActionRow
                      title={t("deviceView.resetDeviceControls")}
                      desc={t("deviceView.resetControlsDescription")}
                      actionLabel={t("deviceView.resetControls")}
                      disabled={isBusy || !runMaintenance}
                      onAction={() => handleUtilityReset(false)}
                    />

                    <ActionRow
                      title={t("deviceView.factoryReset")}
                      desc={t("deviceView.factoryResetDescription")}
                      actionLabel={t("deviceView.factoryReset")}
                      danger
                      disabled={isBusy || !runMaintenance}
                      onAction={() => handleUtilityReset(true)}
                    />
                  </>
                )}
                {deviceInfo?.hardware_eq === false && !utility?.supported && (
                  <p className="cmp:m-[0_0_var(--space-5)] cmp:text-[color:var(--muted-foreground)] cmp:text-[length:var(--type-small)] cmp:leading-[1.5]">
                    {t("deviceView.noMaintenanceActions")}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </ConfigurationLayout>
  );
});
