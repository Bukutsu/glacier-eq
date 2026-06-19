import { type CSSProperties, useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";

import { DEFAULT_PROFILE_NAME } from "../constants";
import { parseMeasurementText } from "../lib/measurements";
import { safeUnlisten } from "../lib/unlisten";
import type { MeasurementTrace, Profile, PEQData, GraphViewMode, TargetTrace } from "../types";
import { Icon } from "./Icon";
import { NumberInput } from "./NumberInput";

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
        onChange={(e) => onChange(e.target.value as T)}
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


type ToolsTab = "Preset" | "Import" | "Measure" | "AutoEQ" | "Settings";

const TOOL_TAB_META: Record<ToolsTab, { icon: string; label: string }> = {
  Preset: { icon: "library_music", label: "Preset" },
  Import: { icon: "file_upload", label: "Import" },
  Measure: { icon: "analytics", label: "Measure" },
  AutoEQ: { icon: "auto_awesome", label: "AutoEQ" },
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
  showDiagnostics?: boolean;
  onShowDiagnosticsChange?: (show: boolean) => void;
  graphViewMode?: GraphViewMode;
  onGraphViewModeChange?: (mode: GraphViewMode) => void;
  allTargets?: TargetTrace[];
  theme?: string;
  onThemeChange?: (theme: string) => void;
}

export function ToolsPanel(props: ToolsPanelProps) {
  const availableTabs = props.availableTabs ?? ["Preset", "Import", "Measure", "AutoEQ", "Settings"];
  const showDiagnostics = props.showDiagnostics ?? false;
  const [tab, setTab] = useState<ToolsTab>(() => (
    props.defaultTab && availableTabs.includes(props.defaultTab) ? props.defaultTab : availableTabs[0]
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
        {tab === "Preset" && <PresetTab {...props} />}
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
          />
        )}
        {tab === "Measure" && <MeasureTab
          measurements={props.measurements}
          onAddMeasurement={props.onAddMeasurement}
          onRemoveMeasurement={props.onRemoveMeasurement}
          onToggleMeasurement={props.onToggleMeasurement}
          onClearMeasurements={props.onClearMeasurements}
          setStatus={props.setStatus}
        />}
        {tab === "Settings" && (
          <SettingsTab
            graphViewMode={props.graphViewMode}
            onGraphViewModeChange={props.onGraphViewModeChange}
            theme={props.theme}
            onThemeChange={props.onThemeChange}
            onShowDiagnosticsChange={props.onShowDiagnosticsChange}
          />
        )}
        {tab === "Preset" && props.showActions !== false && <ToolActions {...props} />}
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
}

export function MeasureTab({
  measurements,
  onAddMeasurement,
  onRemoveMeasurement,
  onToggleMeasurement,
  onClearMeasurements,
  setStatus,
}: MeasureTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        {selectedProfile?.modified ? `Modified: ${selectedProfile.modified}` : "Profiles: Glacier data folder"}
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
}

export function AutoEqTab({
  measurements,
  allTargets = [],
  onImportPEQ,
  setStatus,
  onSelectTab,
}: AutoEqTabProps) {
  const [selectedMeasId, setSelectedMeasId] = useState<string>("");
  const [selectedTargetId, setSelectedTargetId] = useState<string>("");
  const [nBands, setNBands] = useState<number>(10);
  const [steps, setSteps] = useState<number>(2000);
  const [smoothType, setSmoothType] = useState<string>("IE");
  const [fs, setFs] = useState<number>(96000);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Automatically select the first visible/active measurement/target on mount or update
  useEffect(() => {
    if (measurements.length > 0 && !selectedMeasId) {
      const firstVisible = measurements.find(m => m.visible) ?? measurements[0];
      setSelectedMeasId(firstVisible.id);
    }
  }, [measurements, selectedMeasId]);

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
          options={measurements.map((m) => ({
            value: m.id,
            label: `${m.name} (${m.points.length} pts)`,
          }))}
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
  onThemeChange,
  onShowDiagnosticsChange,
}: {
  graphViewMode?: GraphViewMode;
  onGraphViewModeChange?: (mode: GraphViewMode) => void;
  theme?: string;
  onThemeChange?: (theme: string) => void;
  onShowDiagnosticsChange?: (show: boolean) => void;
}) {
  const [settings, setSettings] = useState({
    auto_pull_on_connect: true,
    skip_push_verification: false,
    theme: "tokyo-night",
    show_diagnostics: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<typeof settings>("get_settings")
      .then((data) => {
        setSettings((prev) => ({ ...prev, ...data }));
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load settings:", err);
        setLoading(false);
      });
  }, []);

  const updateSetting = async (key: string, value: any) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    try {
      await invoke("save_settings", { settings: updated });
      if (key === "theme") {
        if (onThemeChange) {
          onThemeChange(value);
        }
      }
      if (key === "show_diagnostics") {
        if (onShowDiagnosticsChange) {
          onShowDiagnosticsChange(value);
        }
      }
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
      <label>
        <input
          type="checkbox"
          checked={settings.show_diagnostics}
          onChange={(e) => updateSetting("show_diagnostics", e.target.checked)}
        />
        Show diagnostic log panel
      </label>

      <div className="setting-row">
        <span className="setting-label">Color Theme</span>
        <div className="setting-select-wrapper">
          <Select
            id="theme-select"
            value={settings.theme}
            onChange={(val) => updateSetting("theme", val)}
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

function ToolActions({ selectedPreset, profiles, onReset, onSave, onDelete }: ToolsPanelProps) {
  const canDelete = selectedPreset !== DEFAULT_PROFILE_NAME && profiles.some((profile) => profile.name === selectedPreset);

  return (
    <section className="action-section">
      <div className="action-section-head">
        <strong>Preset Actions</strong>
        <span>Reset the current EQ or save it back to the selected preset.</span>
      </div>
      <div className="action-row action-row-primary">
        <button onClick={onReset}>Reset</button>
        <button className="save" onClick={onSave}>Save</button>
        <button className="danger" disabled={!canDelete} onClick={onDelete}>Delete</button>
      </div>
    </section>
  );
}

interface DiagnosticEvent {
  timestamp: string;
  level: "Info" | "Warn" | "Error";
  source: "UI" | "Worker" | "HID" | "AutoEQ";
  message: string;
}

function DiagnosticsPanel() {
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);

  useEffect(() => {
    invoke<DiagnosticEvent[]>("get_diagnostics")
      .then((data) => setEvents(data))
      .catch((err) => console.error("Failed to load diagnostics:", err));

    let active = true;
    let unlistenFn: (() => void) | null = null;

    listen<DiagnosticEvent>("diagnostic-event", (event) => {
      setEvents((prev) => [...prev, event.payload].slice(-500));
    }).then((fn) => {
      if (active) {
        unlistenFn = fn;
      } else {
        safeUnlisten(fn);
      }
    });

    return () => {
      active = false;
      if (unlistenFn) {
        safeUnlisten(unlistenFn);
      }
    };
  }, []);

  const clearLogs = async () => {
    try {
      await invoke("clear_diagnostics");
      setEvents([]);
    } catch (err) {
      console.error("Failed to clear diagnostics:", err);
    }
  };

  const getFormattedLogs = () => {
    return events
      .map((e) => `${e.timestamp} [${e.level.toUpperCase()}] [${e.source}] ${e.message}`)
      .join("\n");
  };

  const copyToClipboard = async () => {
    try {
      await writeText(getFormattedLogs());
    } catch (err) {
      console.error("Failed to copy logs:", err);
    }
  };

  const exportLogs = async () => {
    try {
      const blob = new Blob([getFormattedLogs()], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `glacier_diagnostics_${new Date().toISOString().slice(0, 10)}.log`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export logs:", err);
    }
  };

  const errorCount = events.filter((e) => e.level === "Error").length;
  const warnCount = events.filter((e) => e.level === "Warn").length;
  const infoCount = events.filter((e) => e.level === "Info").length;

  return (
    <section className="diag-card">
      <div className="diag-head">
        <strong>DIAGNOSTICS</strong>
        <Icon>warning</Icon>
        <button onClick={copyToClipboard}>Copy</button>
        <button onClick={clearLogs}>Clear</button>
        <button onClick={exportLogs}>Export</button>
      </div>
      <div className="diag-summary">
        E:{errorCount}&nbsp;&nbsp;W:{warnCount}&nbsp;&nbsp;I:{infoCount}
      </div>
      <div className="log-box">
        {events.length === 0 ? (
          <div className="empty-profiles" style={{ padding: "12px" }}>No logs yet</div>
        ) : (
          events.map((event, index) => (
            <p key={index} className={`log-line-${event.level.toLowerCase()}`}>
              <span>{event.timestamp}</span>
              <span>[{event.source}]</span>
              <span>{event.message}</span>
            </p>
          ))
        )}
      </div>
    </section>
  );
}
