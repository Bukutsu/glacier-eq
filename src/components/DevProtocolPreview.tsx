// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useEffect, useState } from "react";
import { invoke } from "../lib/rpc";
import { buildDevPreviewDevice, DEV_DUMMY_DEVICE } from "../lib/devDevice";
import type { DeviceInfo, SupportedDeviceInfo } from "../types";
import { Select } from "./Select";

export function DevProtocolPreview({ device, disabled, onChange }: {
  device: DeviceInfo; disabled: boolean; onChange: (device: DeviceInfo) => void;
}) {
  const [choices, setChoices] = useState<{ device: DeviceInfo; protocol: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    invoke<SupportedDeviceInfo[]>("list_supported_devices").then(profiles => {
      // Alternate USB IDs (e.g. JA11 UAC 1.0/2.0) share one simulated model.
      const unique = profiles.filter((profile, index) =>
        profiles.findIndex(other => other.name === profile.name && other.protocol === profile.protocol) === index);
      const choices = unique.map(profile => ({ device: buildDevPreviewDevice(profile), protocol: profile.protocol }));
      if (active) setChoices(choices);
    }).catch(error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, []);
  return <section className="stack-card">
    <div className="stack-pref-row select-row">
      <div className="stack-pref-info">
        <label className="stack-pref-title" htmlFor="dev-preview-model">Protocol / model preview</label>
        <span className="stack-pref-desc">Simulated settings and EQ only. No hardware commands are sent.</span>
      </div>
      <div className="stack-pref-control setting-select-wrapper">
        <Select id="dev-preview-model" value={device.path} disabled={disabled}
          options={[
            { value: DEV_DUMMY_DEVICE.path, label: "Walkplay — Default dummy DAC" },
            ...choices.map(choice => ({ value: choice.device.path,
              label: `${choice.protocol} — ${choice.device.profile_name}` })),
          ]}
          onChange={path => {
            const selected = path === DEV_DUMMY_DEVICE.path ? DEV_DUMMY_DEVICE
              : choices.find(choice => choice.device.path === path)?.device;
            if (!selected) throw new Error("Unknown DAC preview");
            onChange(selected);
          }} />
      </div>
    </div>
    <p className="configuration-description">Previewing {device.profile_name} · {device.hardware_eq ? `${device.num_bands} bands · ${device.dsp_sample_rate / 1000} kHz` : "no hardware EQ"}</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
