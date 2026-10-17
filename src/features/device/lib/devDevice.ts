// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import type {
  DeviceCapabilities,
  DeviceInfo,
  PEQData,
  SupportedDeviceInfo,
} from "@/types";
import {
  DEFAULT_FREQS_10_BAND,
  normalizePeqForDevice,
} from "@/features/eq/lib/peq";

const DEV_DUMMY_DEVICE_PATH = "glacier-dev://dummy-dac";

export const DEV_DUMMY_DEVICE: DeviceInfo = {
  vendor_id: 0x3302,
  product_id: 0x43e6,
  path: DEV_DUMMY_DEVICE_PATH,
  manufacturer: "Glacier",
  product_string: "Dev Dummy DAC",
  profile_name: "Glacier Dummy DAC",
  hardware_eq: true,
  controls: "walkplay",
  spec: null,
  num_bands: 10,
  global_gain_range: [-16, 6],
  band_gain_range: [-10, 10],
  freq_range: [20, 20000],
  q_range: [0.1, 10],
  supported_filter_types: [
    "Peak",
    "HighShelf",
    "LowShelf",
    "HighPass",
    "LowPass",
  ],
  supports_per_band_enable: false,
  supports_ram_apply: false,
  dsp_sample_rate: 96000,
  integer_preamp: true,
};

export function isDevDummyPath(path: string): boolean {
  return (
    path === DEV_DUMMY_DEVICE_PATH ||
    path.startsWith(DEV_DUMMY_DEVICE_PATH + "/")
  );
}

export function isDevDummyDevice(path: string): boolean {
  return import.meta.env.DEV && isDevDummyPath(path);
}

export function buildDevDummyPeq(
  capabilities: DeviceCapabilities = DEV_DUMMY_DEVICE,
): PEQData {
  const gains = [2.5, 1.5, -1.5, -3.5, -2, 0.5, 3, 2, -1, -4];
  const qValues = [0.7, 0.9, 1.1, 1.4, 1, 1.2, 1.5, 1.1, 0.9, 0.7];
  return {
    global_gain: -4,
    filters: Array.from({ length: capabilities.num_bands }, (_, index) => ({
      index,
      enabled: index < 8,
      filter_type:
        index === 0
          ? "LowShelf"
          : index === capabilities.num_bands - 1
            ? "HighShelf"
            : "Peak",
      freq:
        capabilities.num_bands === 10
          ? DEFAULT_FREQS_10_BAND[index]
          : Math.round(
              31 *
                (16000 / 31) **
                  (index / Math.max(1, capabilities.num_bands - 1)),
            ),
      gain: gains[index % gains.length],
      q: qValues[index % qValues.length],
    })),
  };
}

// Preview state is deliberately synthetic, not a HID transport emulator.
// Use the app's registry for model capabilities; never advertise extra hardware
// controls just because this is a dummy device.
type UtilityState = {
  supported: boolean;
  filter_mode: string;
  amp_mode_class_ab: boolean;
  high_gain_mode: boolean;
  mic_volume_db: number;
  channel_balance: number;
};
type DawnState = {
  filter: number;
  high_gain: boolean;
  led: number;
  volume_step: number;
  volume_raw: number;
};
type Ja11State = { microphone: number; uac: number; volume: number };
type Preview = {
  ja11: Ja11State;
  device: DeviceInfo;
  peq: PEQData;
  savedPeq: PEQData;
  utility: UtilityState;
  dawn: DawnState;
};

// Original-Dawn volume codes credited in families/dawn_pro/mod.rs, from Abdul Mateen:
// https://github.com/RetR0-hex/moondrop-dawn-pro-gui/blob/69f95f669377646da1e9ba931bec9a5dc9b5d40c/moondrop/protocol.py
const DAWN_VOLUME_CODES = [
  255, 200, 180, 170, 160, 150, 140, 130, 122, 116, 110, 106, 102, 98, 94, 90,
  88, 86, 84, 82, 80, 78, 76, 74, 72, 70, 68, 66, 64, 62, 60, 58, 56, 54, 52,
  50, 48, 46, 44, 42, 40, 38, 36, 34, 32, 30, 28, 26, 24, 22, 20, 18, 16, 14,
  12, 10, 8, 6, 4, 2, 0,
];

function newPreview(device: DeviceInfo): Preview {
  const peq = normalizePeqForDevice(buildDevDummyPeq(device), device);
  return {
    device,
    peq,
    savedPeq: structuredClone(peq),
    utility: {
      supported: device.controls === "walkplay",
      filter_mode: "FAST-LL",
      amp_mode_class_ab: false,
      high_gain_mode: false,
      mic_volume_db: 0,
      channel_balance: 0,
    },
    // Synthetic preview defaults, not values read from hardware.
    ja11: { microphone: 1, uac: 1, volume: 30 },
    dawn: {
      filter: 2,
      high_gain: false,
      led: 0,
      volume_step: 45,
      volume_raw: 30,
    },
  };
}

const previews = new Map<string, Preview>();

export function buildDevPreviewDevice(
  profile: SupportedDeviceInfo,
): DeviceInfo {
  if (!import.meta.env.DEV)
    throw new Error("DAC previews are available only in development builds");
  const path =
    DEV_DUMMY_DEVICE_PATH +
    "/" +
    encodeURIComponent(profile.name) +
    "/" +
    profile.vendor_id.toString(16) +
    ":" +
    (profile.product_id?.toString(16) ?? "*");
  const existing = previews.get(path);
  if (existing) return existing.device;
  const {
    name,
    protocol: _protocol,
    product_id,
    status: _status,
    family: _family,
    ...capabilities
  } = profile;
  const device: DeviceInfo = {
    ...capabilities,
    product_id: product_id ?? 0,
    path,
    manufacturer: "Glacier preview",
    product_string: name,
    profile_name: name,
  };
  previews.set(path, newPreview(device));
  return device;
}

function previewFor(path: string): Preview {
  if (!isDevDummyDevice(path)) throw new Error("Not a development DAC preview");
  if (path === DEV_DUMMY_DEVICE_PATH && !previews.has(path)) {
    previews.set(path, newPreview(DEV_DUMMY_DEVICE));
  }
  const preview = previews.get(path);
  if (!preview) throw new Error("Unknown DAC preview");
  return preview;
}

export function reconnectDevDummyDevice(path: string): void {
  const preview = previewFor(path);
  preview.peq = structuredClone(preview.savedPeq);
  // JA11 control writes last only for this simulated connection.
  preview.ja11 = newPreview(preview.device).ja11;
}

function eqPreviewFor(path: string): Preview {
  const preview = previewFor(path);
  if (!preview.device.hardware_eq)
    throw new Error(`${preview.device.profile_name} has no hardware EQ`);
  return preview;
}

export function readDevDummyPeq(path: string): PEQData {
  return structuredClone(eqPreviewFor(path).peq);
}

export function writeDevDummyPeq(
  path: string,
  peq: PEQData,
  save = true,
): PEQData {
  const preview = eqPreviewFor(path);
  const incoming = structuredClone(peq);
  incoming.filters = incoming.filters.slice(0, preview.device.num_bands);
  preview.peq = normalizePeqForDevice(incoming, preview.device);
  if (save) preview.savedPeq = structuredClone(preview.peq);
  return readDevDummyPeq(path);
}

function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`Expected an integer from ${min} to ${max}`);
  }
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Expected a boolean");
  return value;
}

// Called only by invokeForDevice's explicit virtual-path branch. Unknown
// commands fail here rather than falling through to a real device backend.
export function invokeDevDummy<T>(
  path: string,
  command: string,
  args: Record<string, unknown> = {},
): T {
  const preview = previewFor(path);
  const requireWalkplay = () => {
    if (!preview.utility.supported)
      throw new Error("This protocol does not expose Walkplay controls");
  };
  switch (command) {
    case "ja11_control": {
      if (preview.device.controls !== "ja11")
        throw new Error("These controls require a JA11 preview");
      const control = args.control;
      if (
        control !== "microphone" &&
        control !== "uac" &&
        control !== "volume"
      ) {
        throw new Error("Unknown JA11 control");
      }
      if (args.value !== undefined)
        preview.ja11[control] = integer(
          args.value,
          0,
          control === "volume" ? 60 : 1,
        );
      return preview.ja11[control] as T;
    }
    case "get_dac_utility_state":
      return structuredClone(preview.utility) as T;
    case "get_dawn_pro_state":
    case "set_dawn_pro_control": {
      if (preview.device.controls !== "dawn_pro")
        throw new Error("These controls require an original-Dawn preview");
      if (command === "set_dawn_pro_control") {
        switch (args.control) {
          case "filter":
            preview.dawn.filter = integer(args.value, 0, 4);
            break;
          case "gain":
            preview.dawn.high_gain = integer(args.value, 0, 1) === 1;
            break;
          case "led":
            preview.dawn.led = integer(args.value, 0, 2);
            break;
          case "volume": {
            const step = integer(args.value, 0, 60);
            preview.dawn.volume_step = step;
            preview.dawn.volume_raw = DAWN_VOLUME_CODES[step];
            break;
          }
          default:
            throw new Error("Unknown Dawn Pro control");
        }
      }
      return structuredClone(preview.dawn) as T;
    }
    case "set_dac_filter_mode": {
      requireWalkplay();
      if (
        !["FAST-LL", "FAST-PC", "Slow-LL", "Slow-PC", "NON-OS"].includes(
          String(args.mode),
        )
      ) {
        throw new Error("Unknown reconstruction filter");
      }
      preview.utility.filter_mode = String(args.mode);
      break;
    }
    case "set_dac_work_mode":
      requireWalkplay();
      preview.utility.amp_mode_class_ab = boolean(args.isClassAb);
      break;
    case "set_dac_output_gain":
      requireWalkplay();
      preview.utility.high_gain_mode = boolean(args.isHighGain);
      break;
    case "set_mic_volume":
      requireWalkplay();
      preview.utility.mic_volume_db = integer(args.volumeDb, -15, 15);
      break;
    case "set_dac_balance":
      requireWalkplay();
      preview.utility.channel_balance = integer(args.balance, -15, 15);
      break;
    case "reset_device_eq": {
      const flat = readDevDummyPeq(path);
      flat.global_gain = 0;
      flat.filters.forEach((filter) => {
        filter.gain = 0;
      });
      writeDevDummyPeq(path, flat);
      break;
    }
    case "reset_device_controls": {
      const defaults = newPreview(preview.device);
      preview.utility = defaults.utility;
      preview.dawn = defaults.dawn;
      preview.ja11 = defaults.ja11;
      break;
    }
    case "execute_factory_reset": {
      invokeDevDummy(path, "reset_device_eq");
      invokeDevDummy(path, "reset_device_controls");
      break;
    }
    default:
      throw new Error(`Command is not implemented for DAC preview: ${command}`);
  }
  return undefined as T;
}
