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

/**
 * A stored filter as either backend actually serializes it: the desktop Tauri
 * command emits `type` (the serde rename of `filter_type`), while web
 * localStorage may hold either alias. Exactly one spelling is present at
 * runtime; normalize via parseStoredPeq()/normalizePeq() before reading
 * values as a Filter.
 */
export type StoredFilter = Omit<Filter, "filter_type"> &
  (
    | { filter_type: FilterType; type?: FilterType }
    | { type: FilterType; filter_type?: FilterType }
  );

/**
 * A profile's stored EQ payload: the desktop DTO serializes `global_gain` as
 * `globalGain`, web storage writes `global_gain` (parsers accept both, and
 * reject conflicting values). This is deliberately not a PEQData — callers
 * must pass it through normalizePeq() before treating it as editor state.
 */
export type StoredPEQData =
  | { filters: StoredFilter[]; global_gain: number; globalGain?: number }
  | { filters: StoredFilter[]; globalGain: number; global_gain?: number };

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
  dsp_sample_rate: number;
  gain_tolerance?: number;
  freq_tolerance?: number;
  q_tolerance?: number;
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
  data: StoredPEQData;
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
  snap_to_iso_frequencies: boolean;
  floating_graph_preview: boolean;
}
