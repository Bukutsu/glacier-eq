export const TAB_META = {
  Preset: { icon: "library_music", label: "Preset" },
  Curves: { icon: "analytics", label: "Curves" },
  AutoEQ: { icon: "auto_awesome", label: "AutoEQ" },
  Device: { icon: "tune", label: "Device" },
  Settings: { icon: "settings", label: "Settings" },
} as const;

export type ToolsTab = keyof typeof TAB_META;
export type MobileTab = "eq" | "profiles" | "tuning" | "device" | "settings";

export const DESKTOP_TABS = [
  { id: "Preset", ...TAB_META.Preset },
  { id: "Curves", ...TAB_META.Curves },
  { id: "AutoEQ", ...TAB_META.AutoEQ },
  { id: "Device", ...TAB_META.Device },
  { id: "Settings", ...TAB_META.Settings },
] as const;

export const MOBILE_TABS = [
  { id: "eq", icon: "tune", label: "EQ" },
  { id: "profiles", icon: "folder", label: "Profiles" },
  { id: "tuning", icon: "auto_awesome", label: "Tuning" },
  { id: "device", icon: "memory", label: "DSP" },
  { id: "settings", icon: "settings", label: "Settings" },
] as const;
