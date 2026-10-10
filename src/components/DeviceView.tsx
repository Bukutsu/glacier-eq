import type { StatusReporter } from "../stores/toastStore";
// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { memo, useEffect, useRef, useState } from "react";
import { confirmDialog } from "./ConfirmDialog";
import { DacFilterVisual } from "./DacFilterVisual";
import { Icon } from "./Icon";
import { Button } from "./ui/Button";
import { ConfigurationLayout } from "./ConfigurationLayout";
import { DEVICE_SECTIONS } from "../lib/tabs";
import { Select } from "./Select";
import { Slider } from "./Slider";
import {
  ActionRow,
  StackHeader,
  ToggleRow,
} from "./SettingsPrimitives";
import { invoke, listen } from "../lib/rpc";
import { getOfficialDacSpec, OFFLINE_EDITOR_CAPABILITIES } from "../lib/dacSpecs";
import type { DeviceSection } from "../lib/tabs";
import {
  createCoalescingTaskScheduler,
  mergeFieldsAtUnchangedRevisions,
  revertFieldIfCurrent,
  setField,
} from "../lib/serializedWrites";
import type { DeviceCapabilities, DeviceInfo } from "../types";

export function formatChannelBalance(balance: number): string {
  if (balance === 0) return "Center (0)";
  return balance > 0
    ? `Right +${balance}`
    : `Left +${Math.abs(balance)}`;
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
}: DeviceViewProps) {
  const [utility, setUtility] = useState<DeviceUtilityState | null>(null);
  const utilityRef = useRef<DeviceUtilityState | null>(null);
  const confirmedUtilityRef = useRef<DeviceUtilityState | null>(null);
  const fieldRevisionsRef = useRef<Partial<Record<keyof DeviceUtilityState, number>>>({});
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;
  const mountedRef = useRef(true);
  const [scheduleUtilityTask] = useState(() => createCoalescingTaskScheduler<string>());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchState = async (isActive = () => true, silent = false) => {
    if (!connected) return;
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
    if (!connected) {
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
          try { unsub(); } catch {}
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
  }, [connected, deviceInfo?.path]);

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
    setUtilityField("amp_mode_class_ab", isClassAb, "set_dac_work_mode", { isClassAb });

  const handleSetOutputGain = (isHighGain: boolean) =>
    setUtilityField("high_gain_mode", isHighGain, "set_dac_output_gain", { isHighGain });

  const handleSetBalance = (balance: number) =>
    setUtilityField("channel_balance", balance, "set_dac_balance", { balance });

  const handleSetMicVolume = (volumeDb: number) =>
    setUtilityField("mic_volume_db", volumeDb, "set_mic_volume", { volumeDb });

  const handleResetDeviceEq = async () => {
    if (isBusyRef.current) return;
    if (!(await confirmDialog({
      title: "Reset device EQ?",
      message: "Reset all hardware EQ bands on the DAC to 0 dB?",
      confirmLabel: "Reset",
      danger: true,
    }))) return;
    if (isBusyRef.current) return;

    scheduleUtilityTask.enqueue("reset", async (isCurrent) => {
      try {
        await invoke("reset_device_eq");
        if (!isCurrent()) return;
        const pulled = await onPull?.();
        if (!isCurrent()) return;
        setStatus(pulled === false
          ? "Device EQ was reset, but reading it back failed. Read EQ from the DAC again before editing."
          : "Device EQ reset to flat.", pulled === false ? "error" : "success");
      } catch (err) {
        if (!isCurrent()) return;
        setStatus(`Could not reset device EQ: ${err}`);
      }
    }, { supersedePending: true });
  };

  const handleResetDeviceControls = async () => {
    if (isBusyRef.current) return;
    if (!(await confirmDialog({
      title: "Reset hardware controls?",
      message: "Reset filter mode, amplifier mode, gain, balance, and microphone volume to defaults?",
      confirmLabel: "Reset",
      danger: true,
    }))) return;
    if (isBusyRef.current) return;

    scheduleUtilityTask.enqueue("reset", async (isCurrent) => {
      try {
        await invoke("reset_device_controls");
        if (!isCurrent()) return;
        const data = await invoke<DeviceUtilityState>("get_dac_utility_state");
        if (!isCurrent()) return;
        utilityRef.current = data;
        confirmedUtilityRef.current = data;
        setUtility(data);
        setStatus("Device controls reset to defaults.", "success");
      } catch (err) {
        if (!isCurrent()) return;
        setStatus(`Could not reset device controls: ${err}`);
      }
    }, { supersedePending: true });
  };

  const handleFactoryReset = async () => {
    if (isBusyRef.current) return;
    if (!(await confirmDialog({
      title: "Factory reset DAC?",
      message: "Restore the DAC to its factory defaults, including EQ filters, volume, and amplifier mode?",
      confirmLabel: "Factory reset",
      danger: true,
    }))) return;
    if (isBusyRef.current) return;

    scheduleUtilityTask.enqueue("reset", async (isCurrent) => {
      try {
        await invoke("execute_factory_reset");
        if (!isCurrent()) return;
        const data = await invoke<DeviceUtilityState>("get_dac_utility_state");
        if (!isCurrent()) return;
        utilityRef.current = data;
        confirmedUtilityRef.current = data;
        setUtility(data);
        if (!isCurrent()) return;
        const pulled = await onPull?.();
        if (!isCurrent()) return;
        setStatus(pulled === false
          ? "Device restored to factory defaults, but reading it back failed. Read EQ from the DAC again before editing."
          : "Device restored to factory defaults.", pulled === false ? "error" : "success");
      } catch (err) {
        if (!isCurrent()) return;
        setStatus(`Could not restore factory defaults: ${err}`);
      }
    }, { supersedePending: true });
  };

  const officialSpec = connected || isSimulated
    ? getOfficialDacSpec(
        deviceInfo?.vendor_id,
        deviceInfo?.product_id,
        deviceInfo?.profile_name || deviceInfo?.product_string,
      )
    : null;

  const deviceTitle = connected || isSimulated
    ? deviceInfo?.profile_name || deviceInfo?.product_string || officialSpec?.name || "Connected DAC"
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
  const sections = connected ? DEVICE_SECTIONS : DEVICE_SECTIONS.filter(item => item.id === "overview");

  return (
    <ConfigurationLayout kind="device" active={activeSection} sections={sections}>
      <section className="device-summary" aria-label="Device connection">
          <div className="device-hero-header">
            <span className={`device-status-badge ${connected ? (isSimulated ? "simulated" : "connected") : "offline"}`}>
              <span className="status-dot" aria-hidden="true" />
              <span>{connected ? (isSimulated ? "Simulation" : "Connected") : "Offline"}</span>
            </span>

          </div>

          <div className="device-hero-body">
            <h2 className="device-hero-title">{deviceTitle}</h2>
            <p className="device-hero-desc">
              {connected
                ? isSimulated
                  ? "Preview EQ without changing hardware."
                  : "Manage DAC audio controls and settings."
                : "Edit EQ offline or connect a DAC to adjust device settings."}
            </p>
          </div>

          <div className="device-hero-actions">
            {connected ? (
              <>
                {onDisconnect && (
                  <Button type="button" onClick={onDisconnect} disabled={isBusy}>
                    <Icon name="link_off" />
                    <span>Disconnect</span>
                  </Button>
                )}
                {onOpenConnectModal && (
                  <Button type="button" variant="primary" onClick={handleChangeDevice} disabled={isBusy}>
                    <Icon name="swap_horiz" />
                    <span>Change device</span>
                  </Button>
                )}
              </>
            ) : (
              onOpenConnectModal && (
                <Button type="button" variant="primary" onClick={onOpenConnectModal}>
                  <Icon name="usb" />
                  <span>Connect DAC</span>
                </Button>
              )
            )}
          </div>
        </section>
      <StackHeader
        title={
          activeSection === "overview"
            ? connected
              ? "Specifications"
              : "Offline specifications"
            : activeSection === "controls"
              ? "Sound controls"
              : "Reset & maintenance"
        }
      />

      {activeSection === "controls" && connected && !isSimulated && (
        <p className="configuration-description">Changes apply directly to the connected DAC.</p>
      )}
      <div className="stack-content">
        {activeSection === "overview" && (
          <>
            <dl className="device-spec-list">
              {connected && (
                <div><dt>Chip</dt><dd>{officialSpec?.chip ?? "Not reported"}</dd></div>
              )}
              <div><dt>DSP sample rate</dt><dd>{dspKhz} kHz</dd></div>
              <div><dt>EQ bands</dt><dd>{capabilities.num_bands}</dd></div>
              <div><dt>Band gain</dt><dd>{capabilities.band_gain_range[0]} to {capabilities.band_gain_range[1]} dB</dd></div>
              {officialSpec?.outputs && (
                <div><dt>Outputs</dt><dd>{officialSpec.outputs}</dd></div>
              )}
              {officialSpec?.maxPower && (
                <div><dt>Output power</dt><dd>{officialSpec.maxPower}</dd></div>
              )}
              {officialSpec?.decoding && (
                <div><dt>Decoding</dt><dd>{officialSpec.decoding}</dd></div>
              )}
              {connected && firmwareVersion && (
                <div><dt>Firmware</dt><dd>{firmwareVersion}</dd></div>
              )}
              {connected && deviceInfo && (
                <div><dt>USB ID</dt><dd>{deviceInfo.vendor_id.toString(16).padStart(4, "0")}:{deviceInfo.product_id.toString(16).padStart(4, "0")}</dd></div>
              )}
            </dl>
            <p className="device-note">
              {connected ? "Available controls depend on the connected DAC." : "Offline editor capabilities are shown. Connect a DAC to view its hardware details."}
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
                  <p>Connect a supported DAC to adjust filter modes, amplifier mode, and channel balance.</p>
                  {onOpenConnectModal && (
                    <Button type="button" variant="primary" onClick={onOpenConnectModal}>
                      <Icon name="usb" />
                      <span>Connect DAC</span>
                    </Button>
                  )}
                </div>
              </section>
            ) : loading ? (
              <section className="settings-card empty-card">
                <div className="empty-state">
                  <div className="reconnecting-spinner" style={{ width: 32, height: 32 }} />
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
                  <h3>{isSimulated ? "Simulation mode" : "Controls unavailable"}</h3>
                  <p>
                    {isSimulated
                      ? "Hardware controls are not available on the simulated device."
                      : "This DAC supports EQ, but does not support filter or amplifier settings."}
                  </p>
                </div>
              </section>
            ) : (
              <div className="stack-card">
                <div className="stack-pref-row select-row">
                  <div className="stack-pref-info">
                    <label className="stack-pref-title" htmlFor="utility-filter-select">Reconstruction filter</label>
                    <span className="stack-pref-desc">Sets digital filter roll-off and phase response</span>
                  </div>
                  <div className="stack-pref-control">
                    <div className="setting-select-wrapper">
                      <Select
                        id="utility-filter-select"
                        value={utility.filter_mode}
                        disabled={isBusy}
                        onChange={handleSetFilter}
                        options={[
                          { value: "FAST-LL", label: "FAST-LL (fast roll-off, low latency)" },
                          { value: "FAST-PC", label: "FAST-PC (fast roll-off, phase compensated)" },
                          { value: "Slow-LL", label: "Slow-LL (slow roll-off, low latency)" },
                          { value: "Slow-PC", label: "Slow-PC (slow roll-off, phase compensated)" },
                          { value: "NON-OS", label: "NON-OS (non-oversampling)" },
                        ]}
                      />
                    </div>
                  </div>
                </div>

                <details className="device-filter-details">
                  <summary>Filter response</summary>
                  <DacFilterVisual mode={utility.filter_mode} />
                </details>

                <ToggleRow
                  title="Class AB amplifier"
                  desc="Runs cooler and uses less power"
                  checked={utility.amp_mode_class_ab}
                  onChange={handleSetAmpMode}
                  disabled={isBusy}
                />

                <ToggleRow
                  title="High gain"
                  desc="Higher output power for headphones that require more amplification"
                  checked={utility.high_gain_mode}
                  onChange={handleSetOutputGain}
                  disabled={isBusy}
                />

                <div className="pref-slider-item pref-slider-first">
                  <div className="pref-slider-head">
                    <div className="stack-pref-info">
                      <span className="stack-pref-title">Channel balance</span>
                      <span className="stack-pref-desc">Adjust balance between left and right channels</span>
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
                    aria-valuetext={formatChannelBalance(utility.channel_balance)}
                    value={utility.channel_balance}
                    onChange={(e) => handleSetBalance(Number(e.target.value))}
                  />
                </div>

                <div className="pref-slider-item">
                  <div className="pref-slider-head">
                    <div className="stack-pref-info">
                      <span className="stack-pref-title">Microphone sidetone</span>
                      <span className="stack-pref-desc">Headset microphone monitoring volume</span>
                    </div>
                    <span className="pref-value-badge">{utility.mic_volume_db} dB</span>
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
                  <p>Connect a supported DAC to reset EQ, controls, or restore factory defaults.</p>
                  {onOpenConnectModal && (
                    <Button type="button" variant="primary" onClick={onOpenConnectModal}>
                      <Icon name="usb" />
                      <span>Connect DAC</span>
                    </Button>
                  )}
                </div>
              </section>
            ) : (
              <div className="stack-card">
                <ActionRow
                  title="Reset device EQ"
                  desc="Resets all EQ bands on the DAC to 0 dB"
                  actionLabel="Reset EQ"
                  disabled={isBusy}
                  onAction={handleResetDeviceEq}
                />

                <ActionRow
                  title="Reset device controls"
                  desc="Resets filter mode, amplifier mode, gain, and balance to defaults"
                  actionLabel="Reset controls"
                  disabled={isBusy}
                  onAction={handleResetDeviceControls}
                />

                <ActionRow
                  title="Factory reset"
                  desc="Restores the DAC to its factory defaults"
                  actionLabel="Factory reset"
                  danger
                  disabled={isBusy}
                  onAction={handleFactoryReset}
                />
              </div>
            )}
          </>
        )}
      </div>
    </ConfigurationLayout>
  );
});
