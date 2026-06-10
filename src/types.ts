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

export interface DeviceInfo {
  vendor_id: number;
  product_id: number;
  path: string;
  manufacturer: string | null;
  product_string: string | null;
  profile_name: string | null;
}

export interface Profile {
  name: string;
  data: PEQData;
  modified: string | null;
}
