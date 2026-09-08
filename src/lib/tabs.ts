export type ToolsTab = "Preset" | "Tuning" | "Device" | "Settings";
export type MobileTab = "eq" | "profiles" | "tuning" | "device" | "settings";

export const MOBILE_TABS = [
  { id: "eq", icon: "tune", label: "EQ" },
  { id: "tuning", icon: "auto_awesome", label: "Tuning" },
  { id: "profiles", icon: "folder", label: "Profiles" },
  { id: "device", icon: "memory", label: "Device" },
  { id: "settings", icon: "settings", label: "Settings" },
] as const;
