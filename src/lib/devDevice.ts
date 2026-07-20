import type { DeviceInfo, PEQData } from "../types";
import { DEFAULT_FREQS_10_BAND } from "./peq";

const DEV_DUMMY_DEVICE_PATH = "glacier-dev://dummy-dac";

export const DEV_DUMMY_DEVICE: DeviceInfo = {
  vendor_id: 0x3302,
  product_id: 0x43e6,
  path: DEV_DUMMY_DEVICE_PATH,
  manufacturer: "Glacier",
  product_string: "Dev Dummy DAC",
  profile_name: "Glacier Dummy DAC",
  num_bands: 10,
  global_gain_range: [-16, 6],
  band_gain_range: [-10, 10],
  freq_range: [20, 20000],
  q_range: [0.1, 10],
  supported_filter_types: ["Peak", "HighShelf", "LowShelf", "HighPass", "LowPass"],
  supports_per_band_enable: false,
  supports_ram_apply: false,
  integer_preamp: true,
};

export function isDevDummyDevice(path: string): boolean {
  return import.meta.env.DEV && path === DEV_DUMMY_DEVICE_PATH;
}

export function buildDevDummyPeq(): PEQData {
  const gains = [2.5, 1.5, -1.5, -3.5, -2, 0.5, 3, 2, -1, -4];
  const qValues = [0.7, 0.9, 1.1, 1.4, 1, 1.2, 1.5, 1.1, 0.9, 0.7];

  return {
    global_gain: -4,
    filters: DEFAULT_FREQS_10_BAND.map((freq, index) => ({
      index,
      enabled: index < 8,
      filter_type: index === 0 ? "LowShelf" : index === 9 ? "HighShelf" : "Peak",
      freq,
      gain: gains[index],
      q: qValues[index],
    })),
  };
}
