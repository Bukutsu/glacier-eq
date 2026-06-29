import { type CSSProperties, useState, useEffect, useRef } from "react";
import { invoke, listen, readText, writeText, save } from "../lib/rpc";

import { parseMeasurementText } from "../lib/measurements";
import type { AppSettings, MeasurementTrace, Profile, PEQData, GraphViewMode, TargetTrace } from "../types";
import { Icon } from "./Icon";
import { NumberInput } from "./NumberInput";
import { Slider } from "./Slider";
import {
  isDatabaseDownloaded,
  clearCachedDatabase,
  downloadDatabase,
  fetchManifest,
  loadDeviceCurvePoints,
  type OnlineDevice,
} from "../lib/onlineDb";

const DEFAULT_PROFILE_NAME = "Default EQ";

interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

interface SelectProps<T extends string | number> {
  id?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
}

function Select<T extends string | number>({
  id,
  value,
  options,
  onChange,
  className = "",
  disabled = false,
}: SelectProps<T>) {
  return (
    <div className={`custom-select-container ${disabled ? "disabled" : ""} ${className}`.trim()}>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          const coerced = options.length > 0 && typeof options[0].value === "number"
            ? (Number(raw) as T)
            : (raw as T);
          onChange(coerced);
        }}
        disabled={disabled}
        className="custom-select-trigger"
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          MozAppearance: "none",
          paddingRight: "30px",
          width: "100%",
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} style={{ background: "var(--panel)", color: "var(--text)" }}>
            {opt.label}
          </option>
        ))}
      </select>
      <span className="custom-select-arrow" style={{ pointerEvents: "none" }}>
        <Icon>expand_more</Icon>
      </span>
    </div>
  );
}


type ToolsTab = "Preset" | "Import" | "Measure" | "AutoEQ" | "Device" | "Settings";

const TOOL_TAB_META: Record<ToolsTab, { icon: string; label: string }> = {
  Preset: { icon: "library_music", label: "Preset" },
  Import: { icon: "file_upload", label: "Import" },
  Measure: { icon: "analytics", label: "Measure" },
  AutoEQ: { icon: "auto_awesome", label: "AutoEQ" },
  Device: { icon: "tune", label: "Device" },
  Settings: { icon: "settings", label: "Settings" },
};

interface ToolsPanelProps {
  peq: PEQData;
  onImportPEQ: (data: PEQData, name: string, isSaved: boolean) => void;
  profiles: Profile[];
  selectedPreset: string;
  profileSearch: string;
  setProfileSearch: (value: string) => void;
  newProfileName: string;
  setNewProfileName: (value: string) => void;
  onSelectProfile: (profile: Profile) => void;
  onApplyProfile?: (profile: Profile) => void;
  onReloadProfiles: () => void;
  onOpenProfilesDir: () => void;
  onReset: () => void;
  onSave: () => void;
  onDelete: () => void;
  setStatus: (value: string) => void;
  measurements: MeasurementTrace[];
  onAddMeasurement: (name: string, points: MeasurementTrace["points"]) => void;
  onRemoveMeasurement: (id: string) => void;
  onToggleMeasurement: (id: string) => void;
  onClearMeasurements: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  availableTabs?: ToolsTab[];
  defaultTab?: ToolsTab;
  showActions?: boolean;
  graphViewMode?: GraphViewMode;
  onGraphViewModeChange?: (mode: GraphViewMode) => void;
  allTargets?: TargetTrace[];
  onSelectedMeasurementChange?: (measurementId: string | null) => void;
  enableOnlineMeasurements?: boolean;
  onEnableOnlineMeasurementsChange?: (enable: boolean) => void;
  settings: AppSettings;
  onSettingChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export function ToolsPanel(props: ToolsPanelProps) {
  const requestedTabs = props.availableTabs ?? ["Preset", "Import", "Measure", "AutoEQ", "Device", "Settings"];
  const availableTabs = requestedTabs.filter((name) => name !== "Import" || !requestedTabs.includes("Preset"));
  const showDiagnostics = props.settings.show_diagnostics;
  const [tab, setTab] = useState<ToolsTab>(() => (
    props.defaultTab === "Import" && availableTabs.includes("Preset")
      ? "Preset"
      : props.defaultTab && availableTabs.includes(props.defaultTab) ? props.defaultTab : availableTabs[0]
  ));

  useEffect(() => {
    if (!availableTabs.includes(tab)) {
      setTab(availableTabs[0]);
    }
  }, [availableTabs, tab]);

  return (
    <aside className={`right-rail ${showDiagnostics ? "has-diagnostics" : ""}`}>
      <section className="tools-card">
        <TabStrip active={tab} onSelect={setTab} tabs={availableTabs} />
        {tab === "Preset" && (
          <>
            <PresetTab {...props} />
            {props.showActions !== false && <ToolActions {...props} />}
            <ImportTab
              peq={props.peq}
              profiles={props.profiles}
              onImportPEQ={props.onImportPEQ}
              onReloadProfiles={props.onReloadProfiles}
              setStatus={props.setStatus}
            />
          </>
        )}
        {tab === "Import" && <ImportTab
          peq={props.peq}
          profiles={props.profiles}
          onImportPEQ={props.onImportPEQ}
          onReloadProfiles={props.onReloadProfiles}
          setStatus={props.setStatus}
        />}
        {tab === "AutoEQ" && (
          <AutoEqTab
            measurements={props.measurements}
            allTargets={props.allTargets ?? []}
            onImportPEQ={props.onImportPEQ}
            setStatus={props.setStatus}
            onSelectTab={setTab}
            onSelectedMeasurementChange={props.onSelectedMeasurementChange}
          />
        )}
        {tab === "Measure" && <MeasureTab
          measurements={props.measurements}
          onAddMeasurement={props.onAddMeasurement}
          onRemoveMeasurement={props.onRemoveMeasurement}
          onToggleMeasurement={props.onToggleMeasurement}
          onClearMeasurements={props.onClearMeasurements}
          setStatus={props.setStatus}
          enableOnlineMeasurements={props.enableOnlineMeasurements}
          onEnableOnlineMeasurementsChange={props.onEnableOnlineMeasurementsChange}
        />}
        {tab === "Device" && (
          <DeviceTab setStatus={props.setStatus} />
        )}
        {tab === "Settings" && (
          <SettingsTab
            graphViewMode={props.graphViewMode}
            onGraphViewModeChange={props.onGraphViewModeChange}
            settings={props.settings}
            onSettingChange={props.onSettingChange}
          />
        )}
      </section>
      {showDiagnostics && <DiagnosticsPanel />}
    </aside>
  );
}

function TabStrip({
  active,
  onSelect,
  tabs,
}: {
  active: ToolsTab;
  onSelect: (tab: ToolsTab) => void;
  tabs: ToolsTab[];
}) {
  if (tabs.length <= 1) {
    return null;
  }

  return (
    <nav
      className={`tabs ${tabs.length <= 2 ? "compact" : ""}`}
      style={{
        "--tab-count": tabs.length,
        "--tab-columns": tabs.length >= 3 ? 2 : tabs.length,
      } as CSSProperties}
    >
      {tabs.map((name) => (
        <button key={name} className={active === name ? "active" : ""} onClick={() => onSelect(name)}>
          <Icon>{TOOL_TAB_META[name].icon}</Icon>
          <span>{TOOL_TAB_META[name].label}</span>
        </button>
      ))}
    </nav>
  );
}

interface MeasureTabProps {
  measurements: MeasurementTrace[];
  onAddMeasurement: (name: string, points: MeasurementTrace["points"]) => void;
  onRemoveMeasurement: (id: string) => void;
  onToggleMeasurement: (id: string) => void;
  onClearMeasurements: () => void;
  setStatus: (msg: string) => void;
  enableOnlineMeasurements?: boolean;
  onEnableOnlineMeasurementsChange?: (enable: boolean) => void;
}

export function MeasureTab({
  measurements,
  onAddMeasurement,
  onRemoveMeasurement,
  onToggleMeasurement,
  onClearMeasurements,
  setStatus,
  enableOnlineMeasurements,
  onEnableOnlineMeasurementsChange,
}: MeasureTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [downloaded, setDownloaded] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [manifest, setManifest] = useState<OnlineDevice[]>([]);
  const [loadingManifest, setLoadingManifest] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loadingDevice, setLoadingDevice] = useState<string | null>(null);

  useEffect(() => {
    if (enableOnlineMeasurements) {
      isDatabaseDownloaded().then(setDownloaded);
    }
  }, [enableOnlineMeasurements]);

  useEffect(() => {
    if (enableOnlineMeasurements && downloaded) {
      setLoadingManifest(true);
      fetchManifest()
        .then((devices) => {
          setManifest(devices);
          setTotalCount(devices.length);
        })
        .catch((err) => {
          console.error("Failed to load online manifest:", err);
          setStatus(`Failed to load online search manifest: ${err}`);
        })
        .finally(() => {
          setLoadingManifest(false);
        });
    }
  }, [enableOnlineMeasurements, downloaded]);

  const handleDownload = async () => {
    setIsDownloading(true);
    setDownloadProgress(0);
    try {
      const count = await downloadDatabase((percent) => {
        setDownloadProgress(percent);
      });
      setDownloaded(true);
      setTotalCount(count);
      setStatus(`Successfully downloaded online database (${count} curves cached)`);
    } catch (error) {
      console.error(error);
      setStatus(`Database download failed: ${error}`);
    } finally {
      setIsDownloading(false);
      setDownloadProgress(null);
    }
  };

  const handleResetCache = async () => {
    if (window.confirm("Are you sure you want to delete the cached online measurement database? This will clear about 16MB of local storage.")) {
      try {
        await clearCachedDatabase();
        setDownloaded(false);
        setManifest([]);
        setSearchQuery("");
        setTotalCount(null);
        setStatus("Online measurement database cache cleared.");
      } catch (error) {
        console.error(error);
        setStatus(`Failed to clear cache: ${error}`);
      }
    }
  };

  const handleLoadDevice = async (dev: OnlineDevice) => {
    setLoadingDevice(dev.id);
    try {
      const points = await loadDeviceCurvePoints(dev.id);
      onAddMeasurement(`${dev.brand} ${dev.name} (${dev.source})`, points);
      setStatus(`Loaded online measurement: ${dev.brand} ${dev.name} (${points.length} points)`);
    } catch (error) {
      console.error(error);
      setStatus(`Failed to load curve: ${error}`);
    } finally {
      setLoadingDevice(null);
    }
  };

  const filteredManifest = searchQuery.trim() === ""
    ? []
    : manifest.filter((dev) => {
        const full = `${dev.brand} ${dev.name}`.toLowerCase();
        return searchQuery.toLowerCase().split(/\s+/).every((token) => full.includes(token));
      });

  const displayResults = filteredManifest.slice(0, 50);

  const addMeasurementFromText = (text: string, fallbackName: string) => {
    try {
      const points = parseMeasurementText(text);
      onAddMeasurement(fallbackName, points);
      setStatus(`Loaded measurement: ${fallbackName} (${points.length} points)`);
    } catch (error) {
      setStatus(`Measurement import failed: ${error}`);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setStatus("Measurement import failed: choose a .csv or .txt file.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const text = String(loadEvent.target?.result || "");
      addMeasurementFromText(text, file.name.replace(/\.[^/.]+$/, ""));
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const handlePaste = async () => {
    try {
      const text = await readText();
      if (!text || !text.trim()) {
        setStatus("Clipboard is empty or not text.");
        return;
      }
      addMeasurementFromText(text, `Clipboard ${new Date().toLocaleDateString()}`);
    } catch {
      setStatus("Unable to read clipboard. Check permissions.");
    }
  };

  return (
    <div className="measurements-pane">
      <div className="measurements-intro">
        <strong>Graph Overlays</strong>
        <p>Load frequency,dB traces from `.csv` or `.txt` to compare multiple measurements against your EQ curve.</p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        style={{ display: "none" }}
        accept=".txt,.csv,text/plain,text/csv"
        onChange={handleFileChange}
      />

      <div className="import-grid measurement-import-grid">
        <button className="icon-action" onClick={() => fileInputRef.current?.click()}>
          <Icon>playlist_add</Icon>
          <span>Add File</span>
        </button>
        <button className="icon-action" onClick={handlePaste}>
          <Icon>content_paste</Icon>
          <span>Paste Trace</span>
        </button>
      </div>

      <div className="measurement-format-note">
        Example: `20,82.6` or `20 82.6`; traces are centered near 1 kHz.
      </div>

      {/* Online Measurement Database */}
      {!enableOnlineMeasurements ? (
        <div className="online-db-banner" style={{ borderStyle: "dashed" }}>
          <strong>Online Database</strong>
          <p>Search and compare frequency response measurements from the Squiglink/Squig-Rank database.</p>
          <button className="btn" onClick={() => onEnableOnlineMeasurementsChange?.(true)}>
            Enable Online Database
          </button>
        </div>
      ) : !downloaded ? (
        <div className="online-db-banner">
          <strong>Online Database</strong>
          <p>Compare with thousands of headphone/IEM database measurements. Download the offline cache to start search (~16MB).</p>
          {downloadProgress !== null ? (
            <div className="progress-container">
              <div className="progress-track">
                <div className="progress-bar" style={{ width: `${downloadProgress * 100}%` }} />
              </div>
              <span>{Math.round(downloadProgress * 100)}%</span>
            </div>
          ) : (
            <button className="btn" onClick={handleDownload} disabled={isDownloading}>
              {isDownloading ? "Downloading..." : "Download Cache"}
            </button>
          )}
        </div>
      ) : (
        <div className="online-search-section">
          <div className="online-db-status-bar">
            <span>Online Database ({totalCount !== null ? `${totalCount} curves` : "Ready"})</span>
            <button onClick={handleResetCache}>Clear Cache</button>
          </div>
          <input
            type="text"
            placeholder="Search online database..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={loadingManifest}
          />
          {searchQuery && (
            <div className="online-search-results scrollbar">
              {loadingManifest ? (
                <div className="online-result-item" style={{ justifyContent: "center", color: "var(--muted)" }}>
                  Loading devices index...
                </div>
              ) : displayResults.length === 0 ? (
                <div className="online-result-item" style={{ justifyContent: "center", color: "var(--muted)" }}>
                  No online devices found matching "{searchQuery}"
                </div>
              ) : (
                displayResults.map((dev) => (
                  <div key={dev.id} className="online-result-item">
                    <div className="online-result-info">
                      <div className="online-result-name">
                        {dev.brand} {dev.name}
                        {dev.price !== null && (
                          <span className="online-result-price">${dev.price}</span>
                        )}
                      </div>
                      <div className="online-result-source">Source: {dev.source}</div>
                    </div>
                    <button
                      className="online-result-action"
                      disabled={loadingDevice !== null}
                      onClick={() => handleLoadDevice(dev)}
                    >
                      {loadingDevice === dev.id ? (
                        <span>Loading...</span>
                      ) : (
                        <>
                          <Icon>download</Icon>
                          <span>Load</span>
                        </>
                      )}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      <div className="measurement-list">
        {measurements.length === 0 ? (
          <div className="measurement-empty">
            No measurements loaded yet.
          </div>
        ) : (
          measurements.map((trace) => (
            <div className="measurement-item" key={trace.id}>
              <label className="measurement-toggle">
                <input
                  type="checkbox"
                  checked={trace.visible}
                  onChange={() => onToggleMeasurement(trace.id)}
                />
                <span className="measurement-swatch" style={{ backgroundColor: trace.color }} />
                <span className="measurement-meta">
                  <span className="measurement-name">{trace.name}</span>
                  <span className="measurement-points">{trace.points.length} points</span>
                </span>
              </label>
              <button
                className="measurement-delete"
                title={`Delete ${trace.name}`}
                onClick={() => onRemoveMeasurement(trace.id)}
              >
                <Icon>delete</Icon>
              </button>
            </div>
          ))
        )}
      </div>

      {measurements.length > 0 && (
        <button className="btn" onClick={onClearMeasurements}>Clear All</button>
      )}
    </div>
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
  onApplyProfile,
  onReloadProfiles,
  onOpenProfilesDir,
}: ToolsPanelProps) {
  const query = profileSearch.trim().toLowerCase();
  const filteredProfiles = profiles.filter((profile) => !query || profile.name.toLowerCase().includes(query));
  const selectedProfile = profiles.find((profile) => profile.name === selectedPreset);

  return (
    <div className="profile-pane">
      <div className="tool-section-head">
        <strong>Profile Library</strong>
        <span>{profiles.length} saved</span>
      </div>
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
          <div
            key={profile.name}
            className={selectedPreset === profile.name ? "profile-row selected" : "profile-row"}
          >
            <button className="profile-name-btn" onClick={() => onSelectProfile(profile)}>
              {profile.name}
            </button>
            {onApplyProfile && (
              <button
                className="profile-apply-btn"
                title="Apply to device RAM"
                aria-label={`Apply ${profile.name} to device RAM`}
                onClick={() => onApplyProfile(profile)}
              >
                <Icon>send</Icon>
              </button>
            )}
          </div>
        ))}
      </div>
      <small className="modified">
        {selectedProfile?.modified ? `Modified: ${selectedProfile.modified}` : "Profiles: Glacier data folder"}
      </small>
      <input
        className="new-name"
        placeholder="New Name…"
        value={newProfileName}
        onChange={(event) => setNewProfileName(event.target.value)}
      />
    </div>
  );
}

interface ImportTabProps {
  peq: PEQData;
  profiles: Profile[];
  onImportPEQ: (data: PEQData, name: string, isSaved: boolean) => void;
  onReloadProfiles: () => void;
  setStatus: (msg: string) => void;
}

interface ParsedResult {
  peq: PEQData;
  headphone_name: string | null;
  warnings: string[];
}

function ImportTab({ peq, profiles, onImportPEQ, onReloadProfiles, setStatus }: ImportTabProps) {
  const [parsed, setParsed] = useState<ParsedResult | null>(null);
  const [importName, setImportName] = useState("");
  const [isTemporary, setIsTemporary] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".txt")) {
      setStatus("Error: Only .txt AutoEQ files are supported.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      await parseAndLoadText(text, file.name.replace(/\.[^/.]+$/, ""));
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const parseAndLoadText = async (text: string, defaultNameFallback: string) => {
    try {
      const result = await invoke<ParsedResult>("parse_autoeq", { text });
      setParsed(result);
      const initialName = result.headphone_name || defaultNameFallback || "Imported Profile";
      setImportName(initialName);
      setIsTemporary(false);
      setStatus("AutoEQ profile parsed successfully");
    } catch (error) {
      setStatus(`Import failed: ${error}`);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await readText();
      if (!text || !text.trim()) {
        setStatus("Clipboard is empty or not text.");
        return;
      }
      await parseAndLoadText(text, `Pasted ${new Date().toLocaleDateString()}`);
    } catch (err) {
      setStatus("Unable to read clipboard. Check permissions.");
      console.error(err);
    }
  };

  const handleCopy = async () => {
    try {
      const text = await invoke<string>("peq_to_autoeq", { peq });
      await writeText(text);
      setStatus("EQ settings copied to clipboard");
    } catch (err) {
      setStatus(`Copy failed: ${err}`);
    }
  };

  const handleExportFile = async () => {
    try {
      const text = await invoke<string>("peq_to_autoeq", { peq });
      const defaultName = `${(importName || "eq_profile").replace(/[^a-zA-Z0-9_\- ]/g, "")}.txt`;
      const path = await save({
        defaultPath: defaultName,
        filters: [{ name: "Text Files", extensions: ["txt"] }],
      });
      if (!path) {
        setStatus("Export cancelled.");
        return;
      }
      await invoke("save_text_file", { path, content: text });
      setStatus("EQ settings exported successfully");
    } catch (err) {
      setStatus(`Export failed: ${err}`);
    }
  };

  const handleConfirm = async () => {
    if (!parsed) return;

    if (isTemporary) {
      onImportPEQ(parsed.peq, importName || "Imported EQ", false);
      setParsed(null);
      setStatus("Imported preset applied directly to active EQ (temporary)");
    } else {
      const name = importName.trim();
      if (!name) {
        setStatus("Please enter a name for the preset.");
        return;
      }
      try {
        await invoke("save_profile", { name, peq: parsed.peq });
        await onReloadProfiles();
        onImportPEQ(parsed.peq, name, true);
        setParsed(null);
        setStatus(`Preset '${name}' saved successfully`);
      } catch (err) {
        setStatus(`Save failed: ${err}`);
      }
    }
  };

  const handleCancel = () => {
    setParsed(null);
  };

  if (!parsed) {
    return (
      <details className="import-section secondary-actions">
        <summary>Import / Export</summary>
        <div className="import-grid">
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            accept=".txt"
            onChange={handleFileChange}
          />
          <button className="icon-action" onClick={handleImportFileClick}>
            <Icon>file_upload</Icon>
            <span>Import File</span>
          </button>
          <button className="icon-action" onClick={handlePaste}>
            <Icon>content_paste</Icon>
            <span>Paste</span>
          </button>
          <button className="icon-action" onClick={handleExportFile}>
            <Icon>file_download</Icon>
            <span>Export File</span>
          </button>
          <button className="icon-action" onClick={handleCopy}>
            <Icon>content_copy</Icon>
            <span>Copy</span>
          </button>
        </div>
      </details>
    );
  }

  const nameExists = !isTemporary && profiles.some((p) => p.name.toLowerCase() === importName.trim().toLowerCase());
  const activeFilters = parsed.peq.filters.filter((f) => f.enabled);

  return (
    <div className="import-flow">
      <div className="import-flow-header">
        <strong>Import Profile</strong>
      </div>

      <div className="import-mode-tabs">
        <button
          className={!isTemporary ? "active" : ""}
          onClick={() => setIsTemporary(false)}
        >
          Save to Preset
        </button>
        <button
          className={isTemporary ? "active" : ""}
          onClick={() => setIsTemporary(true)}
        >
          Try (Temporary)
        </button>
      </div>

      <div className="import-flow-content">
        {!isTemporary ? (
          <div className="import-field-group">
            <label htmlFor="import-name">Preset Name</label>
            <input
              id="import-name"
              type="text"
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              placeholder="Preset Name…"
            />
            {profiles.length > 0 && (
              <div className="import-field-group" style={{ marginTop: "8px" }}>
                <label htmlFor="overwrite-select">Or Overwrite Existing:</label>
                <Select
                  id="overwrite-select"
                  value={profiles.some((p) => p.name === importName) ? importName : ""}
                  onChange={(val) => {
                    if (val) setImportName(val);
                  }}
                  options={[
                    { value: "", label: "-- Select profile --" },
                    ...profiles.map((p) => ({ value: p.name, label: p.name })),
                  ]}
                />
              </div>
            )}
            {nameExists && (
              <span className="import-overwrite-warning">
                ⚠️ Preset already exists. Saving will overwrite it.
              </span>
            )}
          </div>
        ) : (
          <div className="import-temp-info">
            Apply the parsed EQ filters directly to the editor. Unsaved changes will be replaced.
          </div>
        )}

        <div className="import-preview-section">
          <span>Filters Preview:</span>
          <div className="import-preview-box">
            {activeFilters.length === 0 ? (
              <div className="empty-preview">No active filters (preamp only)</div>
            ) : (
              activeFilters.map((f, idx) => (
                <div key={idx} className="preview-line">
                  Band {f.index + 1}: {f.filter_type} fc {f.freq}Hz, gain {f.gain.toFixed(1)}dB, Q {f.q.toFixed(2)}
                </div>
              ))
            )}
          </div>
        </div>

        {parsed.warnings.length > 0 && (
          <div className="import-warnings-section">
            <span>Compatibility Adjustments:</span>
            <div className="import-warnings-box">
              {parsed.warnings.map((w, idx) => (
                <div key={idx} className="warning-line">
                  • {w}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="import-flow-actions">
        <button className="btn" onClick={handleCancel}>Cancel</button>
        <button className="btn filled" onClick={handleConfirm}>
          {isTemporary ? "Apply to EQ" : "Save Preset"}
        </button>
      </div>
    </div>
  );
}

interface AutoEqTabProps {
  measurements: MeasurementTrace[];
  allTargets: TargetTrace[];
  onImportPEQ: (data: PEQData, name: string, isSaved: boolean) => void;
  setStatus: (msg: string) => void;
  onSelectTab?: (tab: ToolsTab) => void;
  onSelectedMeasurementChange?: (measurementId: string | null) => void;
}

export function AutoEqTab({
  measurements,
  allTargets = [],
  onImportPEQ,
  setStatus,
  onSelectTab,
  onSelectedMeasurementChange,
}: AutoEqTabProps) {
  const [selectedMeasId, setSelectedMeasId] = useState<string>("");
  const [selectedTargetId, setSelectedTargetId] = useState<string>("");
  const [nBands, setNBands] = useState<number>(10);
  const [steps, setSteps] = useState<number>(2000);
  const [smoothType, setSmoothType] = useState<string>("IE");
  const [fs, setFs] = useState<number>(96000);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Measurement selection stays empty until the user picks one.
  useEffect(() => {
    if (measurements.length === 0) {
      if (selectedMeasId) {
        setSelectedMeasId("");
      }
      return;
    }

    if (selectedMeasId && !measurements.some((m) => m.id === selectedMeasId)) {
      setSelectedMeasId("");
    }
  }, [measurements, selectedMeasId]);

  useEffect(() => {
    onSelectedMeasurementChange?.(selectedMeasId || null);
  }, [onSelectedMeasurementChange, selectedMeasId]);

  useEffect(() => {
    if (allTargets.length > 0 && !selectedTargetId) {
      setSelectedTargetId(allTargets[0].id);
    }
  }, [allTargets, selectedTargetId]);

  const handleRunAutoEq = async () => {
    const meas = measurements.find(m => m.id === selectedMeasId);
    const target = allTargets.find(t => t.id === selectedTargetId);

    if (!meas) {
      setStatus("Error: Select a measurement trace first.");
      return;
    }
    if (!target) {
      setStatus("Error: Select a target curve first.");
      return;
    }

    setIsOptimizing(true);
    setStatus("Running AutoEQ optimization engine...");
    setWarnings([]);

    try {
      const measurementPoints = meas.points.map(p => [p.freq, p.db]);
      const targetPoints = target.points.map(p => [p.freq, p.db]);

      const result = await invoke<{ peq: PEQData; warnings: string[] }>("run_autoeq", {
        measurementPoints,
        targetPoints,
        nBands,
        steps,
        smoothType,
        fs,
      });

      onImportPEQ(result.peq, `${meas.name} Match`, false);
      setWarnings(result.warnings);
      
      if (result.warnings.length > 0) {
        setStatus(`AutoEQ optimized successfully with ${result.warnings.length} device warnings.`);
      } else {
        setStatus("AutoEQ optimization completed successfully!");
      }
    } catch (err) {
      setStatus(`AutoEQ optimization failed: ${err}`);
      console.error(err);
    } finally {
      setIsOptimizing(false);
    }
  };

  if (measurements.length === 0) {
    return (
      <div className="autoeq-tab">
        <div className="measurements-intro">
          <strong>AutoEQ Match</strong>
          <p>Optimize parametric EQ filters using glacier-core's optimization engine to match target curves.</p>
        </div>
        <div className="empty-profiles" style={{ padding: "16px 0", textAlign: "center" }}>
          <p style={{ color: "var(--muted)", marginBottom: "12px", fontSize: "var(--type-label)" }}>
            No measurement traces loaded.
          </p>
          {onSelectTab && (
            <button className="btn" onClick={() => onSelectTab("Measure")}>
              Go to Measure Tab
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="autoeq-tab">
      <div className="measurements-intro">
        <strong>AutoEQ Match</strong>
        <p>Run the native AdaBelief optimizer to fit biquad filters to a target curve.</p>
      </div>

      <div className="import-field-group">
        <label htmlFor="autoeq-meas">Source Measurement</label>
        <Select
          id="autoeq-meas"
          value={selectedMeasId}
          onChange={setSelectedMeasId}
          options={[
            { value: "", label: "-- Select measurement --" },
            ...measurements.map((m) => ({
              value: m.id,
              label: `${m.name} (${m.points.length} pts)`,
            })),
          ]}
        />
      </div>

      <div className="import-field-group">
        <label htmlFor="autoeq-target">Target Reference</label>
        <Select
          id="autoeq-target"
          value={selectedTargetId}
          onChange={setSelectedTargetId}
          options={allTargets.map((t) => ({
            value: t.id,
            label: t.name,
          }))}
        />
      </div>

      <div className="import-field-group">
        <label htmlFor="autoeq-bands">Bands Count</label>
        <NumberInput
          id="autoeq-bands"
          value={nBands}
          min={1}
          max={32}
          onChange={setNBands}
          className="autoeq-bands-stepper"
        />
      </div>

      <div className="import-field-group">
        <label>Treble Smoothing</label>
        <div className="smooth-buttons">
          <button
            className={smoothType === "None" ? "active" : ""}
            onClick={() => setSmoothType("None")}
          >
            None
          </button>
          <button
            className={smoothType === "IE" ? "active" : ""}
            onClick={() => setSmoothType("IE")}
          >
            IE (In-Ear)
          </button>
          <button
            className={smoothType === "OE" ? "active" : ""}
            onClick={() => setSmoothType("OE")}
          >
            OE (Over-Ear)
          </button>
        </div>
      </div>

      <div className="import-field-group">
        <label htmlFor="autoeq-steps">Optimizer Steps</label>
        <Select
          id="autoeq-steps"
          value={steps}
          onChange={setSteps}
          options={[
            { value: 500, label: "500 (Fast)" },
            { value: 1000, label: "1000" },
            { value: 2000, label: "2000 (Standard)" },
            { value: 3000, label: "3000" },
            { value: 5000, label: "5000 (Precise)" },
          ]}
        />
      </div>

      <div className="import-field-group">
        <label htmlFor="autoeq-fs">Sample Rate</label>
        <Select
          id="autoeq-fs"
          value={fs}
          onChange={setFs}
          options={[
            { value: 44100, label: "44.1 kHz" },
            { value: 48000, label: "48.0 kHz" },
            { value: 96000, label: "96.0 kHz" },
          ]}
        />
      </div>

      <button
        className="btn filled autoeq-run-btn"
        disabled={isOptimizing}
        onClick={handleRunAutoEq}
      >
        <Icon>{isOptimizing ? "hourglass_empty" : "bolt"}</Icon>
        <span>{isOptimizing ? "Optimizing..." : "Run Match"}</span>
      </button>

      {warnings.length > 0 && (
        <div className="import-warnings-section" style={{ marginTop: "8px" }}>
          <span>Device Range Adjustments:</span>
          <div className="import-warnings-box">
            {warnings.map((w, idx) => (
              <div key={idx} className="warning-line">
                • {w}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsTab({
  graphViewMode,
  onGraphViewModeChange,
  settings,
  onSettingChange,
}: {
  graphViewMode?: GraphViewMode;
  onGraphViewModeChange?: (mode: GraphViewMode) => void;
  settings: AppSettings;
  onSettingChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}) {
  return (
    <div className="settings-list">
      <label>
        <input
          type="checkbox"
          checked={settings.auto_pull_on_connect}
          onChange={(e) => onSettingChange("auto_pull_on_connect", e.target.checked)}
        />
        Auto-pull EQ from device on connect
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.skip_push_verification}
          onChange={(e) => onSettingChange("skip_push_verification", e.target.checked)}
        />
        Skip push verification
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.show_diagnostics}
          onChange={(e) => onSettingChange("show_diagnostics", e.target.checked)}
        />
        Show diagnostic log panel
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.snap_to_iso_frequencies}
          onChange={(e) => onSettingChange("snap_to_iso_frequencies", e.target.checked)}
        />
        Snap frequency to ISO standard values
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.enable_online_measurements}
          onChange={(e) => onSettingChange("enable_online_measurements", e.target.checked)}
        />
        Enable online measurement database (Squiglink)
      </label>

      <div className="setting-row">
        <span className="setting-label">Color Theme</span>
        <div className="setting-select-wrapper">
          <Select
            id="theme-select"
            value={settings.theme}
            onChange={(val) => onSettingChange("theme", val)}
            options={[
              { value: "auto", label: "Auto (System Theme)" },
              { value: "tokyo-night", label: "Tokyo Night" },
              { value: "nord", label: "Nord" },
              { value: "dracula", label: "Dracula" },
              { value: "gruvbox", label: "Gruvbox Dark" },
              { value: "catppuccin-mocha", label: "Catppuccin Mocha" },
              { value: "catppuccin-latte", label: "Catppuccin Latte (Light)" },
            ]}
          />
        </div>
      </div>

      {graphViewMode && onGraphViewModeChange && (
        <div className="setting-row">
          <span className="setting-label">Graph View</span>
          <div className="graph-view-toggle">
            <button
              className={graphViewMode === "shape" ? "active" : ""}
              onClick={() => onGraphViewModeChange("shape")}
            >
              Shape
            </button>
            <button
              className={graphViewMode === "level" ? "active" : ""}
              onClick={() => onGraphViewModeChange("level")}
            >
              Level
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DeviceTab({ setStatus }: { setStatus: (msg: string) => void }) {
  const [utility, setUtility] = useState<{
    supported: boolean;
    filter_mode: string;
    amp_mode_class_ab: boolean;
    high_gain_mode: boolean;
    mic_volume_db: number;
    channel_balance: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<any>("get_dac_utility_state")
      .then((data) => {
        setUtility(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load DAC utility state:", err);
        setLoading(false);
      });
  }, []);

  const handleSetFilter = async (mode: string) => {
    if (!utility) return;
    setUtility({ ...utility, filter_mode: mode });
    try {
      await invoke("set_dac_filter_mode", { mode });
    } catch (err) {
      console.error("Failed to set filter mode:", err);
    }
  };

  const handleSetAmpMode = async (isClassAb: boolean) => {
    if (!utility) return;
    setUtility({ ...utility, amp_mode_class_ab: isClassAb });
    try {
      await invoke("set_dac_work_mode", { isClassAb });
    } catch (err) {
      console.error("Failed to set amp mode:", err);
    }
  };

  const handleSetOutputGain = async (isHighGain: boolean) => {
    if (!utility) return;
    setUtility({ ...utility, high_gain_mode: isHighGain });
    try {
      await invoke("set_dac_output_gain", { isHighGain });
    } catch (err) {
      console.error("Failed to set output gain:", err);
    }
  };

  const handleSetBalance = async (balance: number) => {
    if (!utility) return;
    setUtility({ ...utility, channel_balance: balance });
    try {
      await invoke("set_dac_balance", { balance });
    } catch (err) {
      console.error("Failed to set balance:", err);
    }
  };

  const handleSetMicVolume = async (volumeDb: number) => {
    if (!utility) return;
    setUtility({ ...utility, mic_volume_db: volumeDb });
    try {
      await invoke("set_mic_volume", { volumeDb });
    } catch (err) {
      console.error("Failed to set mic volume:", err);
    }
  };

  const handleResetDeviceEq = async () => {
    if (!confirm("Reset device EQ? This clears all hardware bands and sets device preamp to 0 dB.")) return;
    try {
      await invoke("reset_device_eq");
      setStatus("Device EQ reset");
    } catch (err) {
      setStatus(`Device EQ reset failed: ${err}`);
    }
  };

  const handleResetDeviceControls = async () => {
    if (!confirm("Reset device controls? This restores filter, amp mode, output gain, mic volume, and balance defaults.")) return;
    try {
      setUtility(await invoke<typeof utility>("reset_device_controls"));
      setStatus("Device controls reset");
    } catch (err) {
      setStatus(`Device controls reset failed: ${err}`);
    }
  };

  const handleFactoryReset = async () => {
    if (!confirm("Are you sure you want to perform a factory reset? This will restore default settings.")) return;
    try {
      await invoke("execute_factory_reset");
      const data = await invoke<any>("get_dac_utility_state");
      setUtility(data);
    } catch (err) {
      console.error("Failed to execute factory reset:", err);
    }
  };

  if (loading) {
    return <div className="settings-list device-utility">Loading device status...</div>;
  }

  if (!utility?.supported) {
    return (
      <div className="settings-list device-utility">
        <div className="device-empty">
          <Icon>tune</Icon>
          <strong>No supported hardware PEQ DAC connected.</strong>
          <span>Connect a supported Savitech DSP DAC.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-list device-utility">
      <div className="tool-section-head">
        <strong>Hardware DSP</strong>
        <span>Device controls</span>
      </div>

      <div className="setting-row">
        <span className="setting-label">Filter Mode</span>
        <div className="setting-select-wrapper">
          <Select
            id="utility-filter-select"
            value={utility.filter_mode}
            onChange={handleSetFilter}
            options={[
              { value: "FAST-LL", label: "FAST-LL" },
              { value: "FAST-PC", label: "FAST-PC" },
              { value: "Slow-LL", label: "Slow-LL" },
              { value: "Slow-PC", label: "Slow-PC" },
              { value: "NON-OS", label: "NON-OS" },
            ]}
          />
        </div>
      </div>
      <div className="device-hint">
        {utility.filter_mode === "FAST-LL" && "FAST-LL: Minimizes pre-ringing, warm and punchy sound."}
        {utility.filter_mode === "FAST-PC" && "FAST-PC: Preserves phase linearity, clean and balanced sound."}
        {utility.filter_mode === "Slow-LL" && "Slow-LL: Gentle high-frequency roll-off, warm and relaxed sound."}
        {utility.filter_mode === "Slow-PC" && "Slow-PC: Phase linearity with a gentler high-frequency roll-off."}
        {utility.filter_mode === "NON-OS" && "NON-OS: Bypasses digital interpolation. Pure, raw analog signature."}
      </div>

      <div className="setting-row">
        <span className="setting-label">Amplifier Class AB</span>
        <input
          type="checkbox"
          checked={utility.amp_mode_class_ab}
          onChange={(e) => handleSetAmpMode(e.target.checked)}
        />
      </div>

      <div className="setting-row">
        <span className="setting-label">Hardware High Gain</span>
        <input
          type="checkbox"
          checked={utility.high_gain_mode}
          onChange={(e) => handleSetOutputGain(e.target.checked)}
        />
      </div>

      <div className="setting-row device-range-row">
        <div className="device-range-head">
          <span className="setting-label">Channel Balance</span>
          <span className="device-value">
            {utility.channel_balance === 0 ? "Center (0)" : utility.channel_balance > 0 ? `L +${utility.channel_balance}` : `R +${Math.abs(utility.channel_balance)}`}
          </span>
        </div>
        <Slider
          min="-15"
          max="15"
          step="1"
          value={utility.channel_balance}
          onChange={(e) => handleSetBalance(Number(e.target.value))}
        />
      </div>

      <div className="setting-row device-range-row">
        <div className="device-range-head">
          <span className="setting-label">Microphone Monitor Loopback</span>
          <span className="device-value">
            {utility.mic_volume_db} dB
          </span>
        </div>
        <Slider
          min="-15"
          max="15"
          step="1"
          value={utility.mic_volume_db}
          onChange={(e) => handleSetMicVolume(Number(e.target.value))}
        />
      </div>

      <div className="setting-row">
        <span className="setting-label">Reset</span>
        <div className="action-row action-row-primary">
          <button className="btn" onClick={handleResetDeviceEq}>EQ</button>
          <button className="btn" onClick={handleResetDeviceControls}>Controls</button>
          <button className="btn danger" onClick={handleFactoryReset}>Factory</button>
        </div>
      </div>
    </div>
  );
}

function ToolActions({ selectedPreset, profiles, onReset, onSave, onDelete }: ToolsPanelProps) {
  const canDelete = selectedPreset !== DEFAULT_PROFILE_NAME && profiles.some((profile) => profile.name === selectedPreset);

  return (
    <section className="action-section">
      <div className="action-section-head">
        <strong>Preset Actions</strong>
        <span>Save changes to the selected preset.</span>
      </div>
      <button className="save primary-save" onClick={onSave}>Save</button>
      <details className="secondary-actions">
        <summary>Reset / Delete</summary>
        <div className="action-row action-row-primary">
          <button onClick={onReset}>Reset</button>
          <button className="danger" disabled={!canDelete} onClick={onDelete}>Delete</button>
        </div>
      </details>
    </section>
  );
}

interface DiagnosticEvent {
  timestamp: string;
  level: "Info" | "Warn" | "Error";
  source: "UI" | "Worker" | "HID" | "AutoEQ" | "Device";
  message: string;
}

type DiagLevel = "All" | "Error" | "Warn" | "Info";

function DiagnosticsPanel() {
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const [levelFilter, setLevelFilter] = useState<DiagLevel>("All");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const logBoxRef = useRef<HTMLDivElement>(null);

  // Load history + subscribe to live events
  useEffect(() => {
    invoke<DiagnosticEvent[]>("get_diagnostics")
      .then((data) => setEvents(data))
      .catch((err) => console.error("Failed to load diagnostics:", err));

    let active = true;
    let unlistenFn: (() => void) | null = null;

    listen<DiagnosticEvent>("diagnostic-event", (event) => {
      setEvents((prev) => [...prev, event.payload].slice(-1000));
    }).then((fn) => {
      if (active) {
        unlistenFn = fn;
      } else {
        try { fn(); } catch {}
      }
    });

    return () => {
      active = false;
      try { unlistenFn?.(); } catch {}
    };
  }, []);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const errorCount = events.filter((e) => e.level === "Error").length;
  const warnCount  = events.filter((e) => e.level === "Warn").length;
  const infoCount  = events.filter((e) => e.level === "Info").length;

  const filtered = events.filter((e) => {
    if (levelFilter !== "All" && e.level !== levelFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        e.message.toLowerCase().includes(q) ||
        e.source.toLowerCase().includes(q) ||
        e.timestamp.includes(q)
      );
    }
    return true;
  });

  const clearLogs = async () => {
    try {
      await invoke("clear_diagnostics");
      setEvents([]);
    } catch (err) {
      console.error("Failed to clear diagnostics:", err);
    }
  };

  const copyToClipboard = async () => {
    const text = filtered
      .map((e) => `${e.timestamp} [${e.level.toUpperCase()}] [${e.source}] ${e.message}`)
      .join("\n");
    try {
      await writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy logs:", err);
    }
  };

  const LEVELS: DiagLevel[] = ["All", "Error", "Warn", "Info"];

  return (
    <section className="diag-card">
      <div className="diag-head">
        <strong>Diagnostics</strong>
        <div className="diag-counts">
          <span className="diag-count-e" title="Errors">{errorCount}E</span>
          <span className="diag-count-w" title="Warnings">{warnCount}W</span>
          <span className="diag-count-i" title="Info">{infoCount}I</span>
        </div>
        <button title={copied ? "Copied!" : "Copy filtered logs to clipboard"} onClick={copyToClipboard}>
          <Icon>{copied ? "check" : "content_copy"}</Icon>
        </button>
        <button className="danger" title="Clear all logs" onClick={clearLogs}>
          <Icon>delete</Icon>
        </button>
      </div>

      <div className="diag-toolbar">
        {LEVELS.map((lvl) => (
          <button
            key={lvl}
            className={`diag-filter-btn${levelFilter === lvl ? " active" : ""}${lvl === "Error" ? " f-error" : ""}${lvl === "Warn" ? " f-warn" : ""}`}
            onClick={() => setLevelFilter(lvl)}
          >
            {lvl}
          </button>
        ))}
        <input
          className="diag-search"
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className={`diag-scroll-btn${autoScroll ? " active" : ""}`}
          title={autoScroll ? "Auto-scroll on" : "Auto-scroll paused"}
          onClick={() => setAutoScroll((v) => !v)}
        >
          <Icon>{autoScroll ? "vertical_align_bottom" : "lock"}</Icon>
        </button>
      </div>

      <div className="log-box" ref={logBoxRef}>
        {filtered.length === 0 ? (
          <div className="diag-empty">
            {events.length === 0 ? "No logs yet." : "No matches for current filter."}
          </div>
        ) : (
          filtered.map((event, index) => (
            <p key={index} className={`log-line log-line-${event.level.toLowerCase()}`}>
              <span className="log-ts">{event.timestamp}</span>
              <span className="log-level">{event.level}</span>
              <span className="log-msg">[{event.source}] {event.message}</span>
            </p>
          ))
        )}
      </div>

      <div className="diag-footer">
        {filtered.length}/{events.length} events
        {levelFilter !== "All" && ` · ${levelFilter}`}
        {search && ` · "${search}"`}
      </div>
    </section>
  );
}
