// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { memo, useEffect, useRef, useState } from "react";
import { confirmDialog } from "./ConfirmDialog";
import { DacFilterVisual } from "./DacFilterVisual";
import { Icon } from "./Icon";
import { Select } from "./Select";
import { Slider } from "./Slider";
import {
  ActionRow,
  NavRow,
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

export interface DeviceViewProps {
  connected: boolean;
  isSimulated?: boolean;
  deviceInfo?: DeviceInfo;
  capabilities?: DeviceCapabilities;
  firmwareVersion?: string | null;
  section?: DeviceSection;
  setStatus: (msg: string) => void;
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
    if (!connected) {
      setUtility(null);
      utilityRef.current = null;
      confirmedUtilityRef.current = null;
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
  }, [connected]);

  const setUtilityField = async <K extends keyof DeviceUtilityState>(
    field: K,
    value: DeviceUtilityState[K],
    command: string,
    args: Record<string, unknown>,
  ) => {
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
    if (!(await confirmDialog({
      title: "Reset device EQ?",
      message: "Reset all hardware EQ bands on the DAC to 0 dB?",
      confirmLabel: "Reset",
      danger: true,
    }))) return;

    scheduleUtilityTask.enqueue("reset", async (isCurrent) => {
      try {
        await invoke("reset_device_eq");
        if (!isCurrent()) return;
        const pulled = await onPull?.();
        if (!isCurrent()) return;
        setStatus(pulled === false
          ? "Device EQ was reset, but reading it back failed. Read EQ from the DAC again before editing."
          : "Device EQ reset to flat.");
      } catch (err) {
        if (!isCurrent()) return;
        setStatus(`Could not reset device EQ: ${err}`);
      }
    }, { supersedePending: true });
  };

  const handleResetDeviceControls = async () => {
    if (!(await confirmDialog({
      title: "Reset hardware controls?",
      message: "Reset filter mode, amp mode, gain, balance, and mic volume to defaults?",
      confirmLabel: "Reset",
      danger: true,
    }))) return;

    scheduleUtilityTask.enqueue("reset", async (isCurrent) => {
      try {
        await invoke("reset_device_controls");
        if (!isCurrent()) return;
        const data = await invoke<DeviceUtilityState>("get_dac_utility_state");
        if (!isCurrent()) return;
        utilityRef.current = data;
        confirmedUtilityRef.current = data;
        setUtility(data);
        setStatus("Device controls reset to defaults.");
      } catch (err) {
        if (!isCurrent()) return;
        setStatus(`Could not reset device controls: ${err}`);
      }
    }, { supersedePending: true });
  };

  const handleFactoryReset = async () => {
    if (!(await confirmDialog({
      title: "Factory reset DAC?",
      message: "This resets all EQ filters, volume, amplifier mode, and restores the device to factory defaults.",
      confirmLabel: "Factory Reset",
      danger: true,
    }))) return;

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
          : "Device restored to factory defaults.");
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
    : "Virtual DAC (Offline)";

  const dspKhz = Math.round(capabilities.dsp_sample_rate / 1000);

  if (section === "root") {
    return (
      <div className="stack-view device-stack-view">
        <StackHeader title="Device" />

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
                  : "Manage your DAC’s sound and settings."
                : "Edit EQ offline, or connect a DAC to adjust its hardware."}
            </p>
          </div>

          <div className="device-hero-actions">
            {connected ? (
              <>
                {onDisconnect && (
                  <button type="button" className="btn" onClick={onDisconnect}>
                    <Icon>link_off</Icon>
                    <span>Disconnect</span>
                  </button>
                )}
                {onOpenConnectModal && (
                  <button type="button" className="btn filled" onClick={onOpenConnectModal}>
                    <Icon>swap_horiz</Icon>
                    <span>Change Device</span>
                  </button>
                )}
              </>
            ) : (
              onOpenConnectModal && (
                <button type="button" className="btn filled hero-connect-btn" onClick={onOpenConnectModal}>
                  <Icon>usb</Icon>
                  <span>Connect DAC</span>
                </button>
              )
            )}
          </div>
        </section>

        <nav className="stack-list device-navigation" aria-label="Device settings">
          <NavRow
            to="/device/overview"
            icon="memory"
            title="Specifications"
            desc="Chip, sample rate, EQ bands, and outputs"
          />

          <NavRow
            to="/device/controls"
            icon="tune"
            title="Sound controls"
            desc="Reconstruction filters, amplifier mode, gain, and balance"
          />

          <NavRow
            to="/device/maintenance"
            icon="build"
            title="Reset & maintenance"
            desc="Restore EQ or device defaults"
          />
        </nav>
      </div>
    );
  }

  // Real subscreen with back button
  return (
    <div className="stack-view device-stack-view">
      <StackHeader
        title={
          section === "overview"
            ? "Specifications"
            : section === "controls"
              ? "Sound controls"
              : "Reset & maintenance"
        }
        backTo="/device"
        backLabel="Back to device"
      />

      <div className="stack-content">
        {section === "overview" && (
          <>
            <dl className="device-spec-list">
              <div><dt>Chip</dt><dd>{officialSpec?.chip ?? "Not reported"}</dd></div>
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
              {connected ? "Available controls depend on your DAC." : "Showing offline editor capabilities. Connect a DAC to see its hardware details."}
            </p>
          </>
        )}

        {section === "controls" && (
          <>
            {!connected ? (
              <section className="settings-card empty-card">
                <div className="empty-state">
                  <Icon size={44}>tune</Icon>
                  <h3>Device Not Connected</h3>
                  <p>Connect a supported DAC to adjust filter modes, amplifier mode, and channel balance.</p>
                  {onOpenConnectModal && (
                    <button type="button" className="btn filled" onClick={onOpenConnectModal}>
                      <Icon>usb</Icon>
                      <span>Connect DAC</span>
                    </button>
                  )}
                </div>
              </section>
            ) : loading ? (
              <section className="settings-card empty-card">
                <div className="empty-state">
                  <div className="reconnecting-spinner" style={{ width: 32, height: 32 }} />
                  <h3>Reading Device Settings</h3>
                  <p>Reading settings from the DAC…</p>
                </div>
              </section>
            ) : loadError ? (
              <section className="settings-card empty-card">
                <div className="empty-state">
                  <Icon>error</Icon>
                  <h3>Could Not Load Controls</h3>
                  <p>{loadError}</p>
                  <button type="button" className="btn" onClick={() => fetchState()}>
                    <Icon>refresh</Icon>
                    <span>Retry</span>
                  </button>
                </div>
              </section>
            ) : !utility?.supported ? (
              <section className="settings-card empty-card">
                <div className="empty-state">
                  <Icon>tune</Icon>
                  <h3>{isSimulated ? "Simulation Mode" : "Controls Unavailable"}</h3>
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
                    <span className="stack-pref-title">Reconstruction Filter</span>
                    <span className="stack-pref-desc">Sets digital filter roll-off and phase response</span>
                  </div>
                  <div className="stack-pref-control">
                    <div className="setting-select-wrapper">
                      <Select
                        id="utility-filter-select"
                        value={utility.filter_mode}
                        onChange={handleSetFilter}
                        options={[
                          { value: "FAST-LL", label: "FAST-LL (Fast Roll-off, Low Latency)" },
                          { value: "FAST-PC", label: "FAST-PC (Fast Roll-off, Phase Compensated)" },
                          { value: "Slow-LL", label: "Slow-LL (Slow Roll-off, Low Latency)" },
                          { value: "Slow-PC", label: "Slow-PC (Slow Roll-off, Phase Compensated)" },
                          { value: "NON-OS", label: "NON-OS (Non-oversampling)" },
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
                  title="Amplifier Class AB"
                  desc="Runs cooler and uses less power"
                  checked={utility.amp_mode_class_ab}
                  onChange={handleSetAmpMode}
                />

                <ToggleRow
                  title="High Gain"
                  desc="Higher output power for hard-to-drive headphones"
                  checked={utility.high_gain_mode}
                  onChange={handleSetOutputGain}
                />

                <div className="pref-slider-item pref-slider-first">
                  <div className="pref-slider-head">
                    <div className="stack-pref-info">
                      <span className="stack-pref-title">Channel Balance</span>
                      <span className="stack-pref-desc">Adjust balance between left and right channels</span>
                    </div>
                    <span className="pref-value-badge">
                      {utility.channel_balance === 0
                        ? "Center (0)"
                        : utility.channel_balance > 0
                          ? `Left +${utility.channel_balance}`
                          : `Right +${Math.abs(utility.channel_balance)}`}
                    </span>
                  </div>
                  <Slider
                    min={-15}
                    max={15}
                    step={1}
                    aria-label="Channel Balance"
                    aria-valuetext={
                      utility.channel_balance === 0
                        ? "Center (0)"
                        : utility.channel_balance > 0
                          ? `Left +${utility.channel_balance}`
                          : `Right +${Math.abs(utility.channel_balance)}`
                    }
                    value={utility.channel_balance}
                    onChange={(e) => handleSetBalance(Number(e.target.value))}
                  />
                </div>

                <div className="pref-slider-item">
                  <div className="pref-slider-head">
                    <div className="stack-pref-info">
                      <span className="stack-pref-title">Microphone Sidetone</span>
                      <span className="stack-pref-desc">Monitor volume for headset microphone</span>
                    </div>
                    <span className="pref-value-badge">{utility.mic_volume_db} dB</span>
                  </div>
                  <Slider
                    min={-15}
                    max={15}
                    step={1}
                    aria-label="Microphone Sidetone"
                    aria-valuetext={`${utility.mic_volume_db} dB`}
                    value={utility.mic_volume_db}
                    onChange={(e) => handleSetMicVolume(Number(e.target.value))}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {section === "maintenance" && (
          <>
            {!connected ? (
              <section className="settings-card empty-card">
                <div className="empty-state">
                  <Icon size={44}>build</Icon>
                  <h3>Device Not Connected</h3>
                  <p>Connect a supported DAC to reset EQ, controls, or restore factory defaults.</p>
                  {onOpenConnectModal && (
                    <button type="button" className="btn filled" onClick={onOpenConnectModal}>
                      <Icon>usb</Icon>
                      <span>Connect DAC</span>
                    </button>
                  )}
                </div>
              </section>
            ) : (
              <div className="stack-card">
                <ActionRow
                  title="Reset Hardware EQ"
                  desc="Resets all EQ bands on the DAC to 0 dB flat"
                  actionLabel="Reset EQ"
                  onAction={handleResetDeviceEq}
                />

                <ActionRow
                  title="Reset Hardware Controls"
                  desc="Resets filter mode, amplifier mode, gain, and balance to defaults"
                  actionLabel="Reset Controls"
                  onAction={handleResetDeviceControls}
                />

                <ActionRow
                  title="Factory Reset"
                  desc="Restores the DAC to its factory defaults"
                  actionLabel="Factory Reset"
                  danger
                  onAction={handleFactoryReset}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});
