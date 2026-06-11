import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_PROFILE_NAME } from "../constants";
import type { Profile } from "../types";
import { Icon } from "./Icon";

type ToolsTab = "Preset" | "Import" | "Settings";

interface ToolsPanelProps {
  profiles: Profile[];
  selectedPreset: string;
  profileSearch: string;
  setProfileSearch: (value: string) => void;
  newProfileName: string;
  setNewProfileName: (value: string) => void;
  onSelectProfile: (profile: Profile) => void;
  onReloadProfiles: () => void;
  onOpenProfilesDir: () => void;
  onReset: () => void;
  onSave: () => void;
  onDelete: () => void;
}

export function ToolsPanel(props: ToolsPanelProps) {
  const [tab, setTab] = useState<ToolsTab>("Preset");

  return (
    <aside className="right-rail">
      <section className="tools-card">
        <TabStrip active={tab} onSelect={setTab} />
        {tab === "Preset" && <PresetTab {...props} />}
        {tab === "Import" && <ImportTab />}
        {tab === "Settings" && <SettingsTab />}
        <ToolActions {...props} />
      </section>
      <DiagnosticsPanel />
    </aside>
  );
}

function TabStrip({ active, onSelect }: { active: ToolsTab; onSelect: (tab: ToolsTab) => void }) {
  return (
    <nav className="tabs">
      {(["Preset", "Import", "Settings"] as const).map((name) => (
        <button key={name} className={active === name ? "active" : ""} onClick={() => onSelect(name)}>
          {name}
        </button>
      ))}
    </nav>
  );
}

function PresetTab({
  profiles,
  selectedPreset,
  profileSearch,
  setProfileSearch,
  newProfileName,
  setNewProfileName,
  onSelectProfile,
  onReloadProfiles,
  onOpenProfilesDir,
}: ToolsPanelProps) {
  const query = profileSearch.trim().toLowerCase();
  const filteredProfiles = profiles.filter((profile) => !query || profile.name.toLowerCase().includes(query));
  const selectedProfile = profiles.find((profile) => profile.name === selectedPreset);

  return (
    <>
      <div className="search-row">
        <input
          placeholder="Search profiles…"
          value={profileSearch}
          onChange={(event) => setProfileSearch(event.target.value)}
        />
        <button title="Reload profiles" onClick={onReloadProfiles}><Icon>refresh</Icon></button>
        <button title="Open profiles folder" onClick={onOpenProfilesDir}><Icon>folder</Icon></button>
      </div>
      <div className="preset-list">
        {filteredProfiles.length === 0 ? (
          <div className="empty-profiles">No profiles found</div>
        ) : filteredProfiles.map((profile) => (
          <button
            key={profile.name}
            className={selectedPreset === profile.name ? "selected" : ""}
            onClick={() => onSelectProfile(profile)}
          >
            {profile.name}
          </button>
        ))}
      </div>
      <small className="modified">
        {selectedProfile?.modified ? `Modified: ${selectedProfile.modified}` : "Profiles: Frost-Tune data folder"}
      </small>
      <label className="check-line"><input type="checkbox" defaultChecked /> Snap to ISO frequencies</label>
      <input
        className="new-name"
        placeholder="New Name…"
        value={newProfileName}
        onChange={(event) => setNewProfileName(event.target.value)}
      />
    </>
  );
}

function ImportTab() {
  return (
    <div className="import-grid">
      <button>Import File</button><button>Paste</button><button>Export File</button><button>Copy</button>
    </div>
  );
}

function SettingsTab() {
  const [settings, setSettings] = useState({
    auto_pull_on_connect: true,
    skip_push_verification: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<typeof settings>("get_settings")
      .then((data) => {
        setSettings(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load settings:", err);
        setLoading(false);
      });
  }, []);

  const updateSetting = async (key: keyof typeof settings, value: boolean) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    try {
      await invoke("save_settings", { settings: updated });
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  };

  if (loading) {
    return <div className="settings-list">Loading settings...</div>;
  }

  return (
    <div className="settings-list">
      <label>
        <input
          type="checkbox"
          checked={settings.auto_pull_on_connect}
          onChange={(e) => updateSetting("auto_pull_on_connect", e.target.checked)}
        />
        Auto-pull EQ from device on connect
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.skip_push_verification}
          onChange={(e) => updateSetting("skip_push_verification", e.target.checked)}
        />
        Skip push verification
      </label>
    </div>
  );
}

function ToolActions({ selectedPreset, profiles, onReset, onSave, onDelete }: ToolsPanelProps) {
  const canDelete = selectedPreset !== DEFAULT_PROFILE_NAME && profiles.some((profile) => profile.name === selectedPreset);

  return (
    <>
      <div className="action-row"><button disabled>Undo</button><button disabled>Redo</button></div>
      <div className="action-row">
        <button onClick={onReset}>Reset</button>
        <button className="save" onClick={onSave}>Save</button>
        <button className="danger" disabled={!canDelete} onClick={onDelete}>Delete</button>
      </div>
    </>
  );
}

function DiagnosticsPanel() {
  const lines = [
    "Status set: Device matches profile: TE Nova Diamond B",
    "Pull successful",
    "Reading from device...",
    "Connected to EPZ TP35 Pro",
  ];

  return (
    <section className="diag-card">
      <div className="diag-head">
        <strong>DIAGNOSTICS</strong><Icon>warning</Icon><button>Copy</button><button>Clear</button><button>Export</button>
      </div>
      <div className="diag-summary">E:0&nbsp;&nbsp;W:0&nbsp;&nbsp;I:140</div>
      <div className="log-box">
        {lines.map((line, index) => (
          <p key={line}><span>18:03:{16 - index}.038</span> <span>[UI]</span> {line}</p>
        ))}
      </div>
    </section>
  );
}
