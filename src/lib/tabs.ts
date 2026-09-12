export type ToolsTab = "Preset" | "Tuning" | "Device" | "Settings";
export type MobileTab = "eq" | "profiles" | "tuning" | "device" | "settings";
export type DeviceSection = "root" | "overview" | "controls" | "maintenance";
export type SettingsSection = "root" | "general" | "appearance" | "diagnostics";

export const DEVICE_SECTIONS = [
  { id: "overview", label: "Overview", icon: "info" },
  { id: "controls", label: "Controls", icon: "tune" },
  { id: "maintenance", label: "Maintenance", icon: "build" },
] as const satisfies ReadonlyArray<{ id: Exclude<DeviceSection, "root">; label: string; icon: string }>;

export const SETTINGS_SECTIONS = [
  { id: "general", label: "Behavior & Audio", icon: "tune" },
  { id: "appearance", label: "Interface & Appearance", icon: "palette" },
  { id: "diagnostics", label: "Diagnostics & Permissions", icon: "bug_report" },
] as const satisfies ReadonlyArray<{ id: Exclude<SettingsSection, "root">; label: string; icon: string }>;

export const MOBILE_TABS = [
  { id: "eq", icon: "tune", label: "EQ" },
  { id: "tuning", icon: "auto_awesome", label: "Tuning" },
  { id: "profiles", icon: "folder", label: "Profiles" },
  { id: "device", icon: "memory", label: "Device" },
  { id: "settings", icon: "settings", label: "Settings" },
] as const;

const MOBILE_TAB_IDS = new Set<MobileTab>(MOBILE_TABS.map(({ id }) => id));
const DEVICE_SECTION_IDS = new Set<DeviceSection>(["overview", "controls", "maintenance"]);
const SETTINGS_SECTION_IDS = new Set<SettingsSection>(["general", "appearance", "diagnostics"]);

export interface WorkspaceRoute {
  tab: MobileTab;
  deviceSection: DeviceSection;
  settingsSection: SettingsSection;
}

export function parseWorkspacePath(pathname: string): WorkspaceRoute {
  const [tab, section] = pathname.replace(/^\/+|\/+$/g, "").split("/");
  const activeTab = MOBILE_TAB_IDS.has(tab as MobileTab) ? tab as MobileTab : "eq";

  return {
    tab: activeTab,
    deviceSection: activeTab === "device" && section && DEVICE_SECTION_IDS.has(section as DeviceSection)
      ? section as DeviceSection
      : "root",
    settingsSection: activeTab === "settings" && section && SETTINGS_SECTION_IDS.has(section as SettingsSection)
      ? section as SettingsSection
      : "root",
  };
}

export function workspacePath(tab: MobileTab, section?: DeviceSection | SettingsSection): string {
  if (tab === "device" && section && section !== "root") return `/device/${section}`;
  if (tab === "settings" && section && section !== "root") return `/settings/${section}`;
  return `/${tab}`;
}
