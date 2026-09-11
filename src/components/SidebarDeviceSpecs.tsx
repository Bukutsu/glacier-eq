// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { memo } from "react";
import { getOfficialDacSpec } from "../lib/dacSpecs";
import type { DeviceCapabilities, DeviceInfo } from "../types";

interface SidebarDeviceSpecsProps {
  connected: boolean;
  isSimulated?: boolean;
  deviceInfo?: DeviceInfo;
  capabilities: DeviceCapabilities;
  firmwareVersion?: string | null;
}

export const SidebarDeviceSpecs = memo(function SidebarDeviceSpecs({
  connected,
  isSimulated = false,
  deviceInfo,
  capabilities,
  firmwareVersion,
}: SidebarDeviceSpecsProps) {
  const officialSpec = connected || isSimulated
    ? getOfficialDacSpec(
        deviceInfo?.vendor_id,
        deviceInfo?.product_id,
        deviceInfo?.profile_name || deviceInfo?.product_string,
      )
    : null;

  const title = connected || isSimulated
    ? deviceInfo?.profile_name || deviceInfo?.product_string || officialSpec?.name || "Connected DAC"
    : "Virtual DAC";

  const dotClass = !connected
    ? "offline"
    : isSimulated
      ? "simulated"
      : "connected";

  const eyebrow = !connected
    ? "OFFLINE ENGINE"
    : isSimulated
      ? "DEV SIMULATION"
      : "DAC HARDWARE";

  const dspKhz = Math.round(capabilities.dsp_sample_rate / 1000);
  const bandGain = Math.abs(capabilities.band_gain_range[1]);

  return (
    <div className="sidebar-specs-card" aria-label="DAC specifications">
      <div className="sidebar-specs-header">
        <span className="sidebar-specs-eyebrow">
          <span className={`sidebar-specs-dot ${dotClass}`} aria-hidden="true" />
          {eyebrow}
        </span>
      </div>

      <div className="sidebar-specs-title" title={title}>
        {title}
      </div>

      <dl className="sidebar-specs-grid">
        {officialSpec && (
          <>
            <div className="sidebar-specs-row">
              <dt>CHIP</dt>
              <dd className="highlight" title={officialSpec.chip}>
                {officialSpec.chip}
              </dd>
            </div>
            <div className="sidebar-specs-row">
              <dt>OUT</dt>
              <dd title={officialSpec.outputs}>{officialSpec.outputs}</dd>
            </div>
            {officialSpec.maxPower && (
              <div className="sidebar-specs-row">
                <dt>PWR</dt>
                <dd title={officialSpec.maxPower}>{officialSpec.maxPower}</dd>
              </div>
            )}
            {officialSpec.decoding && (
              <div className="sidebar-specs-row secondary">
                <dt>DEC</dt>
                <dd title={officialSpec.decoding}>{officialSpec.decoding}</dd>
              </div>
            )}
          </>
        )}

        <div className="sidebar-specs-row">
          <dt>DSP</dt>
          <dd>{dspKhz} kHz</dd>
        </div>

        <div className="sidebar-specs-row">
          <dt>PEQ</dt>
          <dd>{capabilities.num_bands} bands</dd>
        </div>

        <div className="sidebar-specs-row secondary">
          <dt>GAIN</dt>
          <dd>±{bandGain} dB</dd>
        </div>

        {connected && firmwareVersion && (
          <div className="sidebar-specs-row secondary">
            <dt>FW</dt>
            <dd>v{firmwareVersion}</dd>
          </div>
        )}
      </dl>
    </div>
  );
});
