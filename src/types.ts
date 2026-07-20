export type FilterType = "Peak" | "LowShelf" | "HighShelf" | "HighPass" | "LowPass";

export interface Filter {
  index: number;
  enabled: boolean;
  filter_type: FilterType;
  freq: number;
  gain: number;
  q: number;
}

export interface PEQData {
  filters: Filter[];
  global_gain: number;
}

export interface MeasurementPoint {
  freq: number;
  db: number;
}

export interface MeasurementTrace {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  points: MeasurementPoint[];
}

export interface TargetTrace {
  id: string;
  name: string;
  color: string;
  builtIn: boolean;
  points: MeasurementPoint[];
}

export type GraphViewMode = "shape" | "level";

export interface DeviceCapabilities {
  num_bands: number;
  global_gain_range: [number, number];
  band_gain_range: [number, number];
  freq_range: [number, number];
  q_range: [number, number];
  supported_filter_types: FilterType[];
  supports_per_band_enable: boolean;
  supports_ram_apply: boolean;
  integer_preamp: boolean;
}

export interface DeviceInfo extends DeviceCapabilities {
  vendor_id: number;
  product_id: number;
  path: string;
  manufacturer: string | null;
  product_string: string | null;
  profile_name: string | null;
}

export interface SupportedDeviceInfo extends DeviceCapabilities {
  name: string;
  protocol: string;
  vendor_id: number;
  product_id: number | null;
  status: string;
  family: string;
}

export interface Profile {
  name: string;
  data: PEQData;
  modified: number | null;
}

export interface OperationProgress {
  message: string;
  percentage: number;
}

export interface AppSettings {
  auto_pull_on_connect: boolean;
  skip_push_verification: boolean;
  theme: string;
  enable_online_measurements: boolean;
  snap_to_iso_frequencies: boolean;
}
