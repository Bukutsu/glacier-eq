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

export interface DeviceInfo {
  vendor_id: number;
  product_id: number;
  path: string;
  manufacturer: string | null;
  product_string: string | null;
  profile_name: string | null;
}

export interface SupportedDeviceInfo {
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
  modified: string | null;
}

export interface OperationProgress {
  message: string;
  percentage: number;
}
