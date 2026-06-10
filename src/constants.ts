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

export const SUPPORTED_DACS = [
  { name: "EPZ TP35 Pro", vid: "3302", pid: "43E6", status: "Tested" },
  { name: "Moondrop Dawn Pro", vid: "2FC6", pid: "DF30", status: "Untested" },
  { name: "Truthear KEYX", vid: "0D8C", pid: "0210", status: "Untested" },
];
