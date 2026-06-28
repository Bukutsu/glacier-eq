import type { DeviceInfo, PEQData } from "../types";

export const DEV_DUMMY_DEVICE_PATH = "glacier-dev://dummy-dac";

export const DEV_DUMMY_DEVICE: DeviceInfo = {
  vendor_id: 0x3302,
  product_id: 0x43e6,
  path: DEV_DUMMY_DEVICE_PATH,
  manufacturer: "Glacier",
  product_string: "Dev Dummy DAC",
  profile_name: "Glacier Dummy DAC",
  num_bands: 10,
  supports_ram_apply: true,
};

export function isDevDummyDevice(path: string): boolean {
  return import.meta.env.DEV && path === DEV_DUMMY_DEVICE_PATH;
}

export function buildDevDummyPeq(): PEQData {
  const freqs = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const gains = [2.5, 1.5, -1.5, -3.5, -2, 0.5, 3, 2, -1, -4];
  const qValues = [0.7, 0.9, 1.1, 1.4, 1, 1.2, 1.5, 1.1, 0.9, 0.7];

  return {
    global_gain: -4,
    filters: freqs.map((freq, index) => ({
      index,
      enabled: index < 8,
      filter_type: index === 0 ? "LowShelf" : index === 9 ? "HighShelf" : "Peak",
      freq,
      gain: gains[index],
      q: qValues[index],
    })),
  };
}
