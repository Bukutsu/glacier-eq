export const TAB_META = {
  Preset: { icon: "library_music", label: "Profiles" },
  Import: { icon: "file_upload", label: "Import" },
  Tuning: { icon: "auto_awesome", label: "Tuning" },
  Device: { icon: "tune", label: "Device" },
  Settings: { icon: "settings", label: "Settings" },
} as const;

export type ToolsTab = keyof typeof TAB_META;
export type MobileTab = "eq" | "profiles" | "tuning" | "device" | "settings";

export const DESKTOP_TABS = [
  { id: "Preset", ...TAB_META.Preset },
  { id: "Tuning", ...TAB_META.Tuning },
  { id: "Device", ...TAB_META.Device },
  { id: "Settings", ...TAB_META.Settings },
] as const;

export const MOBILE_TABS = [
  { id: "eq", icon: "tune", label: "EQ" },
  { id: "tuning", icon: "auto_awesome", label: "Tuning" },
  { id: "profiles", icon: "folder", label: "Profiles" },
  { id: "device", icon: "memory", label: "Device" },
  { id: "settings", icon: "settings", label: "Settings" },
] as const;
