// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import type { DeviceCapabilities } from "../types";

export const OFFLINE_EDITOR_CAPABILITIES: DeviceCapabilities = {
  num_bands: 10,
  global_gain_range: [-10, 0],
  band_gain_range: [-10, 10],
  freq_range: [20, 20000],
  q_range: [0.1, 10],
  supported_filter_types: ["Peak", "LowShelf", "HighShelf"],
  supports_per_band_enable: true,
  supports_ram_apply: true,
  dsp_sample_rate: 96000,
  gain_tolerance: 0.1,
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

interface SpecEntry {
  vendorId: number;
  productId?: number | null;
  nameMatches?: string[];
  spec: DacOfficialSpec;
}

export const DAC_OFFICIAL_SPECS: SpecEntry[] = [
  {
    vendorId: 0x3302,
    productId: 0x43e6,
    nameMatches: ["tp35", "epz tp35", "dummy"],
    spec: {
      name: "EPZ TP35 Pro",
      chip: "Dual CS43198",
      outputs: "3.5 / 4.4mm",
      maxPower: "262mW @ 32Ω",
      decoding: "384k / DSD256",
      snr: "125 dB",
      thd: "0.0004%",
    },
  },
  {
    vendorId: 0x3302,
    productId: 0x43e8,
    nameMatches: ["black pearl", "trn black pearl"],
    spec: {
      name: "TRN Black Pearl",
      chip: "Dual CS43131",
      outputs: "3.5 / 4.4mm",
      maxPower: "250mW @ 32Ω",
      decoding: "384k / DSD256",
      snr: "125 dB",
      thd: "0.0005%",
    },
  },
  {
    vendorId: 0x3302,
    productId: null,
    nameMatches: ["aura", "audiocular aura"],
    spec: {
      name: "Audiocular Aura",
      chip: "Dual CS43198",
      outputs: "3.5 / 4.4mm",
      maxPower: "262mW @ 32Ω",
      decoding: "384k / DSD256",
      snr: "125 dB",
    },
  },
  {
    vendorId: 0x262a,
    productId: null,
    nameMatches: ["ds2", "fosi", "dc04", "ibasso"],
    spec: {
      name: "Fosi Audio DS2 / iBasso DC04 Pro",
      chip: "Dual CS43131",
      outputs: "3.5 / 4.4mm",
      maxPower: "510mW @ 32Ω",
      decoding: "384k / DSD256",
      snr: "130 dB",
    },
  },
  {
    vendorId: 0x0661,
    productId: null,
    nameMatches: ["jm20", "jcally jm20"],
    spec: {
      name: "JCally JM20 / Savitech Generic",
      chip: "CS43131",
      outputs: "3.5mm SE",
      maxPower: "95mW @ 32Ω",
      decoding: "384k / DSD256",
    },
  },
  {
    vendorId: 0x0666,
    productId: null,
    nameMatches: ["jm20 pro"],
    spec: {
      name: "JCally JM20 Pro / Alt Savitech",
      chip: "CS43131",
      outputs: "3.5mm SE",
      maxPower: "95mW @ 32Ω",
      decoding: "384k / DSD256",
    },
  },
  {
    vendorId: 0x2fc6,
    productId: null,
    nameMatches: ["dawn pro", "moondrop dawn pro"],
    spec: {
      name: "Moondrop Dawn Pro",
      chip: "Dual CS43131",
      outputs: "3.5 / 4.4mm",
      maxPower: "230mW @ 32Ω",
      decoding: "384k / DSD256",
      snr: "131 dB",
      thd: "0.00014%",
    },
  },
  {
    vendorId: 0x35d8,
    productId: 0x011d,
    nameMatches: ["dawn pro 2", "moondrop dawn pro 2"],
    spec: {
      name: "Moondrop Dawn Pro 2",
      chip: "Dual CS43131",
      outputs: "3.5 / 4.4mm",
      maxPower: "260mW @ 32Ω",
      decoding: "384k / DSD256",
      snr: "131 dB",
    },
  },
  {
    vendorId: 0x2972,
    productId: 0x0102,
    nameMatches: ["ja11", "fiio ja11"],
    spec: {
      name: "FiiO JA11",
      chip: "KT02H20 DSP",
      outputs: "3.5mm SE",
      maxPower: "30mW @ 32Ω",
      decoding: "384k / DSD128",
      snr: "115 dB",
    },
  },
  {
    vendorId: 0x31b2,
    productId: 0x0111,
    nameMatches: ["jm12", "jcally jm12"],
    spec: {
      name: "JCally JM12",
      chip: "KT02H20",
      outputs: "3.5mm SE",
      maxPower: "30mW @ 32Ω",
      decoding: "384k / DSD128",
    },
  },
  {
    vendorId: 0x2972,
    productId: null,
    nameMatches: ["ka series", "fiio ka"],
    spec: {
      name: "FiiO KA Series",
      chip: "Cirrus / ESS",
      outputs: "3.5 / 4.4mm",
      decoding: "384k / DSD256",
    },
  },
  {
    vendorId: 0x0d8c,
    productId: 0x0210,
    nameMatches: ["keyx", "truthear keyx"],
    spec: {
      name: "Truthear KEYX",
      chip: "CM6542 Codec",
      outputs: "3.5mm SE",
      maxPower: "60mW @ 32Ω",
      decoding: "384k / 32-bit",
    },
  },
];

export function getOfficialDacSpec(
  vendorId?: number | null,
  productId?: number | null,
  name?: string | null,
): DacOfficialSpec | null {
  if (vendorId != null) {
    if (productId != null) {
      const exact = DAC_OFFICIAL_SPECS.find(
        (entry) => entry.vendorId === vendorId && entry.productId === productId,
      );
      if (exact) return exact.spec;
    }

    const vidMatch = DAC_OFFICIAL_SPECS.find(
      (entry) => entry.vendorId === vendorId && (entry.productId === null || entry.productId === undefined),
    );
    if (vidMatch) return vidMatch.spec;
  }

  if (name) {
    const lower = name.toLowerCase();
    const nameMatch = DAC_OFFICIAL_SPECS.find((entry) =>
      entry.nameMatches?.some((keyword) => lower.includes(keyword)),
    );
    if (nameMatch) return nameMatch.spec;
  }

  return null;
}
