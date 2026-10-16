// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import type { DeviceCapabilities } from "../types";

// Offline editor fallback. Must stay in sync with glacier-core
// `DESKTOP_DAC_CAPS` (glacier-core/src/device/capabilities.rs); there is no
// wasm export exposing it, so this constant is the shared TS-side mirror
// imported by the editor and device views.
export const OFFLINE_EDITOR_CAPABILITIES: DeviceCapabilities = {
  num_bands: 10,
  global_gain_range: [-16, 6],
  band_gain_range: [-10, 10],
  freq_range: [20, 20000],
  q_range: [0.1, 20],
  supported_filter_types: ["Peak", "HighShelf", "LowShelf", "HighPass", "LowPass"],
  supports_per_band_enable: true,
  supports_ram_apply: false,
  dsp_sample_rate: 96000,
  gain_tolerance: 0.15,
  freq_tolerance: 1,
  q_tolerance: 0.05,
  integer_preamp: false,
};

export interface DacOfficialSpec {
  name: string;
  chip: string;
  outputs: string;
  maxPower?: string;
  decoding?: string;
  snr?: string;
  thd?: string;
}

