// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

export interface FilterModeInfo {
  tag: string;
  badge: string;
  description: string;
  path: string;
}

export const DAC_FILTER_MODES: Record<string, FilterModeInfo> = {
  "FAST-LL": {
    tag: "Low Latency (Minimum Phase)",
    badge: "Zero Pre-Ringing",
    description: "Eliminates pre-echo for sharp, natural transient attack on drums and acoustic plucks.",
    path: "M 4 22 L 78 22 C 79.4 22 79.8 6 80 6 C 80.2 6 80.6 34 82.5 34 C 84 34 85 13 88 13 C 91 13 94 30 98 30 C 102 30 106 16 111 16 C 116 16 121 27 127 27 C 133 27 139 19 145 19 C 150 19 153 22 156 22",
  },
  "FAST-PC": {
    tag: "Phase Linear (Linear Phase)",
    badge: "Symmetric Phase",
    description: "Symmetrical ringing preserving exact phase alignment and cohesive soundstage imaging.",
    path: "M 4 22 C 16 22 22 23 28 23 C 34 23 38 20.5 44 20.5 C 50 20.5 54 24.5 60 24.5 C 65 24.5 68 17 73 17 C 76 17 77.5 28 79 28 C 79.5 28 79.8 6 80 6 C 80.2 6 80.5 28 81 28 C 82.5 28 84 17 87 17 C 92 17 95 24.5 100 24.5 C 106 24.5 110 20.5 116 20.5 C 122 20.5 126 23 132 23 C 138 23 144 22 156 22",
  },
  "Slow-LL": {
    tag: "Slow Roll-Off (Minimum Phase)",
    badge: "Gentle Decay",
    description: "Gentle high-frequency attenuation with zero pre-ringing for a warm, relaxed presentation.",
    path: "M 4 22 L 78 22 C 79.4 22 79.8 6 80 6 C 80.3 6 80.8 30 83 30 C 85.5 30 88 17 92 17 C 96 17 100 25 106 25 C 112 25 118 22 126 22 L 156 22",
  },
  "Slow-PC": {
    tag: "Slow Roll-Off (Linear Phase)",
    badge: "Soft Linear",
    description: "Linear phase with a softer roll-off slope to tame aggressive high-frequency glare.",
    path: "M 4 22 L 50 22 C 60 22 66 24 72 24 C 76 24 77.8 19 79.2 19 C 79.7 19 79.8 6 80 6 C 80.2 6 80.3 19 80.8 19 C 82.2 19 84 24 88 24 C 94 24 100 22 110 22 L 156 22",
  },
  "NON-OS": {
    tag: "Non-Oversampling (NOS)",
    badge: "Direct NOS",
    description: "Bypasses digital interpolation entirely for raw, unfiltered analog conversion with zero ringing.",
    path: "M 4 22 L 74 22 L 74 6 L 86 6 L 86 22 L 156 22",
  },
};

export const DEFAULT_FILTER_MODE_INFO: FilterModeInfo = {
  tag: "Standard Interpolation",
  badge: "Reconstruction",
  description: "Digital reconstruction filter mode applied by the DAC hardware.",
  path: "M 4 22 L 78 22 L 80 6 L 82 22 L 156 22",
};

export function getFilterModeInfo(mode: string): FilterModeInfo {
  return DAC_FILTER_MODES[mode] ?? DEFAULT_FILTER_MODE_INFO;
}
