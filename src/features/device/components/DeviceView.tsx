import type { StatusReporter } from "@/stores/toastStore";
// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { memo, useEffect, useRef, useState } from "react";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { FilterResponse } from "./DacFilterVisual";
import { DawnProControls } from "./DawnProControls";
import { Ja11Controls } from "./Ja11Controls";
import { Icon } from "@/components/ui/Icon";
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

export function formatChannelBalance(balance: number): string {
  if (balance === 0) return "Center (0)";
  return balance > 0 ? `Right +${balance}` : `Left +${Math.abs(balance)}`;
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
  onDisconnect?: () => Promise<void>;
  onPreviewChange?: (device: DeviceInfo) => void;
  /** Called before a write that may make the DAC briefly drop off USB. */
  onExpectedDisconnect?: (restart?: boolean) => void | Promise<void>;
  onReadFailure?: (path: string, error: unknown) => Promise<boolean>;
  onResetEq?: () => Promise<void>;
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
  onDisconnect,
  onPreviewChange,
  onExpectedDisconnect,
  onReadFailure,
  onResetEq,
  runMaintenance,
}: DeviceViewProps) {
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
    if (!connected || dawnDevice || ja11Device) return;
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
          setLoadError(`Could not load device status: ${err}`);
        } else {
          setStatus(`Could not refresh device status: ${err}`);
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
    if (!connected || dawnDevice || ja11Device) {
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
  }, [connected, deviceInfo?.path, !!dawnDevice, !!ja11Device]);

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
        await invoke(command, args);
        const confirmed = confirmedUtilityRef.current;
        if (confirmed && isCurrent()) {
          confirmedUtilityRef.current = setField(confirmed, field, value);
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
          setStatus(`Could not update device setting: ${err}`);
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
          title: factory ? "Factory reset DAC?" : "Reset hardware controls?",
          message: factory
            ? "Restore the DAC's EQ and hardware controls to defaults?"
            : "Reset filter mode, amplifier mode, gain, balance, and microphone volume to defaults?",
          confirmLabel: factory ? "Factory reset" : "Reset",
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
              setStatus("Device controls reset to defaults.", "success");
            }
          } catch (err) {
            if (!isCurrent()) return;
            setStatus(
              factory
                ? `Could not restore factory defaults: ${err}`
                : `Could not reset device controls: ${err}`,
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
            ? "Device restored to factory defaults, but reading it back failed. Read EQ from the DAC again before editing."
            : "Device restored to factory defaults.",
          pulled === false ? "error" : "success",
        );
      } catch (error) {
        if (readAfterReset())
          setStatus(
            `Device restored to factory defaults, but reading EQ failed: ${error}`,
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
        "Connected DAC"
      : "Offline editor";

  const dspKhz = Math.round(capabilities.dsp_sample_rate / 1000);

  const handleChangeDevice = async () => {
    // The chooser is the point of this button, so open it even if the
    // disconnect fails or is superseded. Otherwise a rejected teardown leaves
    // the user on a device screen with no way forward.
    try {
      await onDisconnect?.();
    } finally {
      onOpenConnectModal?.();
    }
  };

  const activeSection = section === "root" ? "overview" : section;
  const sectionTitle =
    activeSection === "overview"
      ? connected
        ? "Specifications"
        : "Offline specifications"
      : activeSection === "controls"
        ? "Sound controls"
        : "Reset & maintenance";
  const sections = connected
    ? DEVICE_SECTIONS
    : DEVICE_SECTIONS.filter((item) => item.id === "overview");

  const deviceSummary = (
    <Card className="device-summary" aria-label="Device connection">
      <div className="device-hero-body">
        <div className="device-hero-heading">
          <h2 className="device-hero-title">{deviceTitle}</h2>
          <Badge className="gap-1.5">
            <span
              className={`size-1.5 shrink-0 rounded-full ${connected ? (isSimulated ? "bg-[var(--yellow)]" : "bg-[var(--green)]") : "bg-muted-foreground"}`}
              aria-hidden="true"
            />
            {connected ? (isSimulated ? "Simulation" : "Connected") : "Offline"}
          </Badge>
        </div>
        <p className="device-hero-desc">
          {connected
            ? deviceInfo?.hardware_eq === false
              ? dawnDevice
                ? "Sound controls are supported. This model has no hardware EQ, so EQ Read/Write actions are unavailable."
                : "This DAC has no hardware EQ, so EQ Read/Write actions are unavailable."
              : isSimulated
                ? "Preview EQ without changing hardware."
                : "Manage DAC audio controls and settings."
            : "Edit EQ offline or connect a DAC to adjust device settings."}
        </p>
      </div>

      <div className="device-hero-actions">
        {connected ? (
          <>
            {onDisconnect && (
              <Button
                type="button"
                variant="ghost"
                onClick={onDisconnect}
                disabled={isBusy}
              >
                <Icon name="link_off" />
                <span>Disconnect</span>
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
                <span>Change device</span>
              </Button>
            )}
          </>
        ) : (
          onOpenConnectModal && (
            <Button
              type="button"
              variant="primary"
              onClick={onOpenConnectModal}
            >
              <Icon name="usb" />
              <span>Connect DAC</span>
            </Button>
          )
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
            ? "No hardware EQ"
            : `${capabilities.num_bands} bands · ${dspKhz} kHz`,
        controls: ja11Device
          ? "Microphone · USB audio · volume"
          : dawnDevice
            ? "Volume · gain · filter · LED"
            : utility?.supported
              ? `${utility.high_gain_mode ? "High" : "Low"} gain · ${utility.filter_mode}`
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
        <p className="configuration-description">
          Changes apply directly to the connected DAC.
        </p>
      )}
      {activeSection === "controls" &&
        connected &&
        isSimulated &&
        ja11Device && (
          <p className="configuration-description">
            Simulated controls: changes update mock values immediately. No USB
            commands are sent. Reconnecting resets these mock controls.
          </p>
        )}
      <div className="stack-content">
        {activeSection === "overview" && (
          <>
            <dl className="device-spec-list">
              {connected && (
                <div>
                  <dt>Chip</dt>
                  <dd>{officialSpec?.chip ?? "Not reported"}</dd>
                </div>
              )}
              {deviceInfo?.hardware_eq === false ? (
                <div>
                  <dt>Hardware EQ</dt>
                  <dd>None</dd>
                </div>
              ) : (
                <>
                  <div>
                    <dt>DSP sample rate</dt>
                    <dd>{dspKhz} kHz</dd>
                  </div>
                  <div>
                    <dt>EQ bands</dt>
                    <dd>{capabilities.num_bands}</dd>
                  </div>
                  <div>
                    <dt>Band gain</dt>
                    <dd>
                      {capabilities.band_gain_range[0]} to{" "}
                      {capabilities.band_gain_range[1]} dB
                    </dd>
                  </div>
                </>
              )}
              {officialSpec?.outputs && (
                <div>
                  <dt>Outputs</dt>
                  <dd>{officialSpec.outputs}</dd>
                </div>
              )}
              {officialSpec?.maxPower && (
                <div>
                  <dt>Output power</dt>
                  <dd>{officialSpec.maxPower}</dd>
                </div>
              )}
              {officialSpec?.decoding && (
                <div>
                  <dt>Decoding</dt>
                  <dd>{officialSpec.decoding}</dd>
                </div>
              )}
              {connected && firmwareVersion && (
                <div>
                  <dt>Firmware</dt>
                  <dd>{firmwareVersion}</dd>
                </div>
              )}
              {/* What the device reports about itself, so a re-flashed unit is identifiable. */}
              {connected && deviceInfo?.manufacturer && (
                <div>
                  <dt>USB manufacturer</dt>
                  <dd>{deviceInfo.manufacturer}</dd>
                </div>
              )}
              {connected && deviceInfo?.product_string && (
                <div>
                  <dt>USB product</dt>
                  <dd>{deviceInfo.product_string}</dd>
                </div>
              )}
              {connected && deviceInfo && (
                <div>
                  <dt>USB ID</dt>
                  <dd>
                    {deviceInfo.vendor_id.toString(16).padStart(4, "0")}:
                    {deviceInfo.product_id.toString(16).padStart(4, "0")}
                  </dd>
                </div>
              )}
            </dl>
            <p className="device-note">
              {connected
                ? "Available controls depend on the connected DAC."
                : "Offline editor capabilities are shown. Connect a DAC to view its hardware details."}
            </p>
          </>
        )}

        {activeSection === "controls" && (
          <>
            {!connected ? (
              <section className="settings-card empty-card">
                <div className="empty-state">
                  <Icon name="tune" size={44} />
                  <h3>Device not connected</h3>
                  <p>
                    Connect a supported DAC to adjust filter modes, amplifier
                    mode, and channel balance.
                  </p>
                  {onOpenConnectModal && (
                    <Button
                      type="button"
                      variant="primary"
                      onClick={onOpenConnectModal}
                    >
                      <Icon name="usb" />
                      <span>Connect DAC</span>
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
                    className="reconnecting-spinner"
                    style={{ width: 32, height: 32 }}
                  />
                  <h3>Reading device settings</h3>
                  <p>Reading settings from the DAC…</p>
                </div>
              </section>
            ) : loadError ? (
              <section className="settings-card empty-card">
                <div className="empty-state">
                  <Icon name="error" />
                  <h3>Could not load controls</h3>
                  <p>{loadError}</p>
                  <Button type="button" onClick={() => fetchState()}>
                    <Icon name="refresh" />
                    <span>Retry</span>
                  </Button>
                </div>
              </section>
            ) : !utility?.supported ? (
              <section className="settings-card empty-card">
                <div className="empty-state">
                  <Icon name="tune" />
                  <h3>
                    {isSimulated ? "Simulation mode" : "Controls unavailable"}
                  </h3>
                  <p>
                    {isSimulated
                      ? "This protocol has no additional sound controls. Select another preview model to review its controls."
                      : "This DAC supports EQ, but does not support filter or amplifier settings."}
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
                      Reconstruction filter
                    </label>
                    <span className="stack-pref-desc">
                      Sets digital filter roll-off and phase response
                    </span>
                  </div>
                  <div className="stack-pref-control">
                    <div className="setting-select-wrapper">
                      <Select
                        id="utility-filter-select"
                        value={utility.filter_mode}
                        disabled={isBusy}
                        onChange={handleSetFilter}
                        options={[
                          {
                            value: "FAST-LL",
                            label: "FAST-LL (fast roll-off, low latency)",
                          },
                          {
                            value: "FAST-PC",
                            label: "FAST-PC (fast roll-off, phase compensated)",
                          },
                          {
                            value: "Slow-LL",
                            label: "Slow-LL (slow roll-off, low latency)",
                          },
                          {
                            value: "Slow-PC",
                            label: "Slow-PC (slow roll-off, phase compensated)",
                          },
                          {
                            value: "NON-OS",
                            label: "NON-OS (non-oversampling)",
                          },
                        ]}
                      />
                    </div>
                  </div>
                </div>

                <FilterResponse mode={utility.filter_mode} />

                <SegmentedRow
                  title="Amplifier"
                  desc="Output stage: Class H or Class AB"
                  value={utility.amp_mode_class_ab ? "ab" : "h"}
                  options={[
                    { value: "h", label: "Class H" },
                    { value: "ab", label: "Class AB" },
                  ]}
                  onChange={(value) => handleSetAmpMode(value === "ab")}
                  disabled={isBusy}
                />

                <SegmentedRow
                  title="Gain"
                  desc="High gain gives more power for headphones that need it"
                  value={utility.high_gain_mode ? "high" : "low"}
                  options={[
                    { value: "low", label: "Low" },
                    { value: "high", label: "High" },
                  ]}
                  onChange={(value) => handleSetOutputGain(value === "high")}
                  disabled={isBusy}
                />

                <div className="pref-slider-item pref-slider-first">
                  <div className="pref-slider-head">
                    <div className="stack-pref-info">
                      <span className="stack-pref-title">Channel balance</span>
                      <span className="stack-pref-desc">
                        Adjust balance between left and right channels
                      </span>
                    </div>
                    <span className="pref-value-badge">
                      {formatChannelBalance(utility.channel_balance)}
                    </span>
                  </div>
                  <Slider
                    min={-15}
                    max={15}
                    step={1}
                    aria-label="Channel balance"
                    disabled={isBusy}
                    aria-valuetext={formatChannelBalance(
                      utility.channel_balance,
                    )}
                    value={utility.channel_balance}
                    onChange={(e) => handleSetBalance(Number(e.target.value))}
                  />
                </div>

                <div className="pref-slider-item">
                  <div className="pref-slider-head">
                    <div className="stack-pref-info">
                      <span className="stack-pref-title">
                        Microphone sidetone
                      </span>
                      <span className="stack-pref-desc">
                        Headset microphone monitoring volume
                      </span>
                    </div>
                    <span className="pref-value-badge">
                      {utility.mic_volume_db} dB
                    </span>
                  </div>
                  <Slider
                    min={-15}
                    max={15}
                    step={1}
                    aria-label="Microphone sidetone"
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
                  <h3>Device not connected</h3>
                  <p>
                    Connect a supported DAC to reset EQ, controls, or restore
                    factory defaults.
                  </p>
                  {onOpenConnectModal && (
                    <Button
                      type="button"
                      variant="primary"
                      onClick={onOpenConnectModal}
                    >
                      <Icon name="usb" />
                      <span>Connect DAC</span>
                    </Button>
                  )}
                </div>
              </section>
            ) : (
              <div className="stack-card">
                {deviceInfo?.hardware_eq !== false && (
                  <ActionRow
                    title="Reset device EQ"
                    desc="Resets all EQ bands on the DAC to 0 dB"
                    actionLabel={isBusy ? "Please wait…" : "Reset EQ"}
                    disabled={isBusy || !onResetEq}
                    onAction={() => void onResetEq?.()}
                  />
                )}

                {/* Control and factory resets use Walkplay commands only. */}
                {utility?.supported && (
                  <>
                    <ActionRow
                      title="Reset device controls"
                      desc="Resets filter mode, amplifier mode, gain, and balance to defaults"
                      actionLabel="Reset controls"
                      disabled={isBusy || !runMaintenance}
                      onAction={() => handleUtilityReset(false)}
                    />

                    <ActionRow
                      title="Factory reset"
                      desc="Restores the DAC to its factory defaults"
                      actionLabel="Factory reset"
                      danger
                      disabled={isBusy || !runMaintenance}
                      onAction={() => handleUtilityReset(true)}
                    />
                  </>
                )}
                {deviceInfo?.hardware_eq === false && !utility?.supported && (
                  <p className="configuration-description">
                    This DAC has no maintenance actions.
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
