// Reorder this list to change desktop and mobile navigation together.
export type TabConcept = "editor" | "library" | "match" | "device" | "settings";

export const CANONICAL_TABS: TabConcept[] = [
  "editor",
  "library",
  "match",
  "device",
  "settings",
];

export const TAB_META = {
  Preset: { icon: "library_music", label: "Preset" },
  Import: { icon: "file_upload", label: "Import" },
  Curves: { icon: "analytics", label: "Curves" },
  Measure: { icon: "analytics", label: "Measure" },
  AutoEQ: { icon: "auto_awesome", label: "AutoEQ" },
  Device: { icon: "tune", label: "Device" },
  Settings: { icon: "settings", label: "Settings" },
} as const;

export type ToolsTab = keyof typeof TAB_META;
export type MobileTab = "eq" | "profiles" | "tuning" | "device" | "settings";
type DesktopTab = Exclude<ToolsTab, "Import" | "Measure">;
type TabDef<Id extends string> = { id: Id; icon: string; label: string };

const DESKTOP_TABS_BY_CONCEPT: Record<TabConcept, DesktopTab[]> = {
  editor: [],
  library: ["Preset"],
  match: ["Curves", "AutoEQ"],
  device: ["Device"],
  settings: ["Settings"],
};

const MOBILE_TABS_BY_CONCEPT: Record<TabConcept, TabDef<MobileTab>[]> = {
  editor: [{ id: "eq", icon: "tune", label: "EQ" }],
  library: [{ id: "profiles", icon: "folder", label: "Profiles" }],
  match: [{ id: "tuning", icon: "auto_awesome", label: "Tuning" }],
  device: [{ id: "device", icon: "memory", label: "DSP" }],
  settings: [{ id: "settings", icon: "settings", label: "Settings" }],
};

export const DESKTOP_TABS = CANONICAL_TABS.flatMap((concept) =>
  DESKTOP_TABS_BY_CONCEPT[concept].map((id) => ({ id, ...TAB_META[id] })),
);

export const MOBILE_TABS = CANONICAL_TABS.flatMap((concept) => MOBILE_TABS_BY_CONCEPT[concept]);
