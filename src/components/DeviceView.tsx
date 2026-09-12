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
  CategoryHeader,
  NavRow,
  StackHeader,
  ToggleRow,
} from "./SettingsPrimitives";
import { invoke, listen } from "../lib/rpc";
import { isTauri } from "../lib/platform";
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
  onPull?: () => Promise<void>;
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
    if (!connected || !isTauri()) return;
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
          setLoadError(`Couldn't load device status: ${err}`);
        } else {
          setStatus(`Couldn't refresh device status: ${err}`);
        }
      }
    } finally {
      if (isActive()) setLoading(false);
    }
  };

  useEffect(() => {
    if (!connected || !isTauri()) {
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
          setStatus(`Failed to update device setting: ${err}`);
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
      message: "Reset all hardware PEQ bands on the device to 0 dB flat?",
      confirmLabel: "Reset",
      danger: true,
    }))) return;

    scheduleUtilityTask.enqueue("reset", async (isCurrent) => {
      try {
        await invoke("reset_device_eq");
        if (onPull) await onPull();
        if (isCurrent()) setStatus("Device EQ reset to flat.");
      } catch (err) {
        if (!isCurrent()) return;
        setStatus(`Failed to reset device EQ: ${err}`);
      }
    }, { supersedePending: true });
  };

  const handleResetDeviceControls = async () => {
    if (!(await confirmDialog({
      title: "Reset hardware controls?",
      message: "Reset filter mode, amp mode, gain, balance, and mic volume to factory defaults?",
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
        setStatus(`Failed to reset device controls: ${err}`);
      }
    }, { supersedePending: true });
  };

  const handleFactoryReset = async () => {
    if (!(await confirmDialog({
      title: "Factory reset DAC?",
      message: "This will reset all EQ filters, volume, amplifier mode, and restore the device to its factory defaults.",
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
        if (onPull) await onPull();
        setStatus("Device restored to factory defaults.");
      } catch (err) {
        if (!isCurrent()) return;
        setStatus(`Failed to factory reset: ${err}`);
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
    : "Virtual DAC (Offline Engine)";

  const dspKhz = Math.round(capabilities.dsp_sample_rate / 1000);
  const bandGain = Math.abs(capabilities.band_gain_range[1]);

  // Section select FIRST!
  if (section === "root") {
    return (
      <div className="stack-view device-stack-view">
        <StackHeader title="Device" />

        <section className="device-hero-card">
          <div className="device-hero-header">
            <span className={`device-status-badge ${connected ? (isSimulated ? "simulated" : "connected") : "offline"}`}>
              <span className="status-dot" aria-hidden="true" />
              <span>{connected ? (isSimulated ? "DEV SIMULATION" : "CONNECTED") : "OFFLINE ENGINE"}</span>
            </span>
            {deviceInfo && (
              <span className="device-id-tag">
                {`USB ${deviceInfo.vendor_id?.toString(16).padStart(4, "0")}:${deviceInfo.product_id?.toString(16).padStart(4, "0")}`}
              </span>
            )}
          </div>

          <div className="device-hero-body">
            <h2 className="device-hero-title">{deviceTitle}</h2>
            <p className="device-hero-desc">
              {connected
                ? isSimulated
                  ? "Development simulation mode active. Audio processing, filters, and preamp are simulated in software."
                  : "Hardware DSP connected. Filter parameters and DSP settings synchronize directly with on-board flash."
                : "Glacier EQ is running in offline editor mode. Connect a supported USB DAC over OTG or USB-C to adjust hardware DSP filters, output balance, and amplifier modes."}
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

        <div className="stack-list">
          <CategoryHeader title="Device Configuration" />
          <NavRow
            to="/device/overview"
            icon="memory"
            title="Hardware Specifications"
            desc="Chipset architecture, sample rates, PEQ capacity, outputs"
          />

          <NavRow
            to="/device/controls"
            icon="tune"
            title="Hardware DSP Controls"
            desc="Reconstruction filters, amplifier class AB, gain, balance"
          />

          <NavRow
            to="/device/maintenance"
            icon="build"
            title="Maintenance & Resets"
            desc="Clear hardware PEQ filters, reset controls, factory restore"
          />
        </div>
      </div>
    );
  }

  // Real subscreen with back button
  return (
    <div className="stack-view device-stack-view">
      <StackHeader
        title={
          section === "overview"
            ? "Hardware Specifications"
            : section === "controls"
              ? "Hardware DSP Controls"
              : "Maintenance & Resets"
        }
        backTo="/device"
        backLabel="Back to device"
      />

      <div className="stack-content">
        {section === "overview" && (
          <>
            <div className="device-spec-grid">
              <div className="spec-tile">
                <span className="spec-label">CHIP ARCHITECTURE</span>
                <span className="spec-value highlight">{officialSpec?.chip ?? "Savitech DSP Audio"}</span>
              </div>
              <div className="spec-tile">
                <span className="spec-label">DSP SAMPLE RATE</span>
                <span className="spec-value">{dspKhz} kHz Audio DSP</span>
              </div>
              <div className="spec-tile">
                <span className="spec-label">PEQ FILTER BANDS</span>
                <span className="spec-value">{capabilities.num_bands} Parametric Bands</span>
              </div>
              <div className="spec-tile">
                <span className="spec-label">FILTER GAIN RANGE</span>
                <span className="spec-value">±{bandGain}.0 dB per band</span>
              </div>
              {officialSpec?.outputs && (
                <div className="spec-tile">
                  <span className="spec-label">HEADPHONE OUTPUTS</span>
                  <span className="spec-value">{officialSpec.outputs}</span>
                </div>
              )}
              {officialSpec?.maxPower && (
                <div className="spec-tile">
                  <span className="spec-label">OUTPUT POWER</span>
                  <span className="spec-value">{officialSpec.maxPower}</span>
                </div>
              )}
              {officialSpec?.decoding && (
                <div className="spec-tile">
                  <span className="spec-label">DECODING SUPPORT</span>
                  <span className="spec-value">{officialSpec.decoding}</span>
                </div>
              )}
              {connected && firmwareVersion && (
                <div className="spec-tile">
                  <span className="spec-label">FIRMWARE VERSION</span>
                  <span className="spec-value mono">v{firmwareVersion}</span>
                </div>
              )}
            </div>

            <section className="settings-card">
              <div className="settings-card-head">
                <div className="card-head-title">
                  <Icon>info</Icon>
                  <strong>Supported Hardware</strong>
                </div>
                <span className="card-head-sub">Verified USB DAC architectures</span>
              </div>
              <div className="supported-guide">
                <p className="guide-text">
                  Glacier EQ provides native hardware DSP control for Savitech SA9312L family USB DACs, including FiiO KA11, FiiO KA13, Moondrop Dawn Pro, and compatible Walkplay USB HID DSP bridges.
                </p>
                <div className="guide-bullets">
                  <div className="guide-bullet-item">
                    <Icon>check</Icon>
                    <span>Real-time parametric EQ filtering written directly to hardware DSP memory</span>
                  </div>
                  <div className="guide-bullet-item">
                    <Icon>check</Icon>
                    <span>Hardware reconstruction filters, amplifier bias, and analog gain controls</span>
                  </div>
                  <div className="guide-bullet-item">
                    <Icon>check</Icon>
                    <span>Zero battery drain background operation via USB OTG</span>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {section === "controls" && (
          <>
            {!connected ? (
              <section className="settings-card empty-card">
                <div className="empty-state">
                  <Icon size={44}>tune</Icon>
                  <h3>Hardware DSP Controls Offline</h3>
                  <p>Reconstruction filters, amplifier bias mode, and hardware channel balance require a connected hardware DAC.</p>
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
                  <h3>Reading Hardware Parameters</h3>
                  <p>Querying on-board DSP registers over USB HID…</p>
                </div>
              </section>
            ) : loadError ? (
              <section className="settings-card empty-card">
                <div className="empty-state">
                  <Icon>error</Icon>
                  <h3>Failed to Load Controls</h3>
                  <p>{loadError}</p>
                  <button type="button" className="btn" onClick={() => fetchState()}>
                    <Icon>refresh</Icon>
                    <span>Retry Query</span>
                  </button>
                </div>
              </section>
            ) : !utility?.supported ? (
              <section className="settings-card empty-card">
                <div className="empty-state">
                  <Icon>tune</Icon>
                  <h3>{isSimulated ? "Simulation Mode" : "DSP Utility Unavailable"}</h3>
                  <p>
                    {isSimulated
                      ? "Hardware DSP registers are unavailable for the simulated device."
                      : "The connected DAC supports PEQ streaming, but does not provide vendor-specific filter and amplifier registers."}
                  </p>
                </div>
              </section>
            ) : (
              <div className="stack-card">
                <div className="stack-pref-row select-row">
                  <div className="stack-pref-info">
                    <span className="stack-pref-title">Interpolation Filter Mode</span>
                    <span className="stack-pref-desc">Configures DAC digital oversampling roll-off and phase characteristics</span>
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

                <DacFilterVisual mode={utility.filter_mode} />

                <ToggleRow
                  title="Amplifier Class AB Mode"
                  desc="Reduces thermal dissipation and power draw on mobile devices"
                  checked={utility.amp_mode_class_ab}
                  onChange={handleSetAmpMode}
                />

                <ToggleRow
                  title="Hardware High Gain"
                  desc="Increases analog voltage swing for high-impedance headphones"
                  checked={utility.high_gain_mode}
                  onChange={handleSetOutputGain}
                />

                <div className="pref-slider-item pref-slider-first">
                  <div className="pref-slider-head">
                    <div className="stack-pref-info">
                      <span className="stack-pref-title">Channel Balance</span>
                      <span className="stack-pref-desc">Shift stereo output balance between left and right channels</span>
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
                      <span className="stack-pref-title">Microphone Monitor Loopback</span>
                      <span className="stack-pref-desc">Hardware sidetone monitoring volume from headphone microphone</span>
                    </div>
                    <span className="pref-value-badge">{utility.mic_volume_db} dB</span>
                  </div>
                  <Slider
                    min={-15}
                    max={15}
                    step={1}
                    aria-label="Microphone Monitor Loopback"
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
                  <h3>Hardware Maintenance Offline</h3>
                  <p>Connect a supported hardware DAC to perform on-board filter resets or factory firmware restoration.</p>
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
                  desc="Sets all parametric equalizer filters on the DAC back to 0 dB flat"
                  actionLabel="Reset EQ"
                  onAction={handleResetDeviceEq}
                />

                <ActionRow
                  title="Reset Hardware Controls"
                  desc="Restores filter mode, amplifier bias, gain stage, and balance to defaults"
                  actionLabel="Reset Controls"
                  onAction={handleResetDeviceControls}
                />

                <ActionRow
                  title="Factory Reset"
                  desc="Completely restores the DAC hardware to factory firmware state"
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
