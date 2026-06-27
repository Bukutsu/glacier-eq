import type { FilterType } from "./types";

export const FILTER_TYPES: FilterType[] = ["Peak", "HighShelf", "LowShelf", "HighPass", "LowPass"];

export const TYPE_LABELS: Record<FilterType, string> = {
  Peak: "PK",
  HighShelf: "HS",
  LowShelf: "LS",
  HighPass: "HP",
  LowPass: "LP",
};

export const DEFAULT_PROFILE_NAME = "Default EQ";
