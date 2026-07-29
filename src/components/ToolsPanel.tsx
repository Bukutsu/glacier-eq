import { memo, type CSSProperties, useState, useEffect, useRef } from "react";
import { invoke, listen, readText, writeText, save } from "../lib/rpc";
import type { AppSettings, MeasurementTrace, Profile, PEQData, GraphViewMode, TargetTrace } from "../types";
import { DEFAULT_PROFILE_NAME } from "../App";
import { Icon } from "./Icon";

import { fuzzyMatch } from "../lib/search";
import { AddTraceModal } from "./AddTraceModal";
import { Collapsible } from "./Collapsible";
import { Modal } from "./Modal";
import { UnifiedTracesList } from "./UnifiedTraces";
import { NumberInput } from "./NumberInput";
import { Slider } from "./Slider";
import { TAB_META, type ToolsTab } from "../lib/tabs";



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



interface ToolsPanelProps {
  peq: PEQData;
  onImportPEQ: (data: PEQData, name: string, isSaved: boolean) => void;
  onPull?: () => Promise<void>;
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
  hideProfileFolderButton?: boolean;
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
  dirty?: boolean;
  showActions?: boolean;
  graphViewMode?: GraphViewMode;
  onGraphViewModeChange?: (mode: GraphViewMode) => void;
  allTargets?: TargetTrace[];
  activeTargetIds?: string[];
  onSelectedMeasurementChange?: (measurementId: string | null) => void;
  settings: AppSettings;
  onSettingChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onToggleTarget?: (id: string) => void;
  onRemoveTarget?: (id: string) => void;
  onAddTarget?: (name: string, points: MeasurementTrace["points"]) => void;
  connected?: boolean;
  activeTab?: ToolsTab;
  onActiveTabChange?: (tab: ToolsTab) => void;
  onOpenConnectModal?: () => void;
  onOpenDiagnostics?: () => void;
  showGraph?: boolean;
  onShowGraphChange?: (show: boolean) => void;
  maxBands?: number;
}

export const ToolsPanel = memo(function ToolsPanel(props: ToolsPanelProps) {
  const requestedTabs = props.availableTabs ?? ["Preset", "Import", "Tuning", "Device", "Settings"];
  const availableTabs = requestedTabs.filter((name) => name !== "Import" || !requestedTabs.includes("Preset"));
  const [internalTab, setInternalTab] = useState<ToolsTab>(() => (
    props.defaultTab === "Import" && availableTabs.includes("Preset")
      ? "Preset"
      : props.defaultTab && availableTabs.includes(props.defaultTab) ? props.defaultTab : availableTabs[0]
  ));

  const tab = props.activeTab ?? internalTab;
  const setTab = props.onActiveTabChange ?? setInternalTab;

  useEffect(() => {
    if (!availableTabs.includes(tab)) {
      setTab(availableTabs[0]);
    }
  }, [availableTabs, tab]);

  return (
    <aside className="right-rail">
      <section className="tools-card">
        <TabStrip active={tab} onSelect={setTab} tabs={availableTabs} />
        <div className="tab-panel">
          {tab === "Preset" && (
            <>
              <PresetTab {...props} />
              <ImportTab
                peq={props.peq}
                profiles={props.profiles}
                selectedPreset={props.selectedPreset}
                onImportPEQ={props.onImportPEQ}
                onReloadProfiles={props.onReloadProfiles}
                setStatus={props.setStatus}
              />
            </>
          )}
          {tab === "Tuning" && (
            <div className="desktop-tuning-tab">
              <Collapsible
                title={`Measurements & Targets (${props.measurements.length})`}
                icon="analytics"
                defaultOpen={props.measurements.length === 0}
                className="tuning-library"
              >
                <CurvesTab
                  measurements={props.measurements}
                  onRemoveMeasurement={props.onRemoveMeasurement}
                  onToggleMeasurement={props.onToggleMeasurement}
                  onClearMeasurements={props.onClearMeasurements}
                  allTargets={props.allTargets ?? []}
                  activeTargetIds={props.activeTargetIds ?? []}
                  onToggleTarget={props.onToggleTarget ?? (() => {})}
                  onRemoveTarget={props.onRemoveTarget ?? (() => {})}
                  onAddTarget={props.onAddTarget}
                  onAddMeasurement={props.onAddMeasurement}
                  setStatus={props.setStatus}
                />
              </Collapsible>
              <AutoEqTab
                measurements={props.measurements}
                allTargets={props.allTargets ?? []}
                activeTargetIds={props.activeTargetIds}
                onImportPEQ={props.onImportPEQ}
                setStatus={props.setStatus}
                onSelectedMeasurementChange={props.onSelectedMeasurementChange}
                onToggleMeasurement={props.onToggleMeasurement}
                onToggleTarget={props.onToggleTarget}
                maxBands={props.maxBands}
              />
            </div>
          )}
          {tab === "Device" && (
            props.connected ? (
              <DeviceTab setStatus={props.setStatus} onPull={props.onPull} />
            ) : (
              <div className="device-disconnected-panel" style={{ padding: "24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                <span className="material-symbols-outlined" style={{ fontSize: "48px", color: "var(--muted)" }}>link_off</span>
                <strong style={{ fontSize: "16px" }}>DSP Offline</strong>
                <p style={{ color: "var(--muted)", fontSize: "13px", lineHeight: "1.5", margin: "0" }}>Connect a supported Glacier-compatible DAC to adjust hardware options, filter modes, and amplifier gain.</p>
                <button className="btn filled" style={{ width: "100%", marginTop: "8px" }} onClick={props.onOpenConnectModal}>
                  Connect Device
                </button>
              </div>
            )
          )}
          {tab === "Settings" && (
            <SettingsTab
              graphViewMode={props.graphViewMode}
              onGraphViewModeChange={props.onGraphViewModeChange}
              settings={props.settings}
              onSettingChange={props.onSettingChange}
              onOpenDiagnostics={props.onOpenDiagnostics}
              showGraph={props.showGraph}
              onShowGraphChange={props.onShowGraphChange}
            />
          )}
        </div>
      </section>
    </aside>
  );
});

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
          <Icon>{TAB_META[name].icon}</Icon>
          <span>{TAB_META[name].label}</span>
        </button>
      ))}
    </nav>
  );
}



interface CurvesTabProps {
  measurements: MeasurementTrace[];
  onRemoveMeasurement: (id: string) => void;
  onToggleMeasurement: (id: string) => void;
  onClearMeasurements: () => void;
  allTargets: TargetTrace[];
  activeTargetIds: string[];
  onToggleTarget: (id: string) => void;
  onRemoveTarget: (id: string) => void;
  onAddTarget?: (name: string, points: MeasurementTrace["points"]) => void;
  onAddMeasurement?: (name: string, points: MeasurementTrace["points"]) => void;
  setStatus?: (value: string) => void;
}

function CurvesTab({
  measurements,
  onRemoveMeasurement,
  onToggleMeasurement,
  onClearMeasurements,
  allTargets,
  activeTargetIds,
  onToggleTarget,
  onRemoveTarget,
  onAddTarget,
  onAddMeasurement,
  setStatus,
}: CurvesTabProps) {
  const [showAddModal, setShowAddModal] = useState(false);

  return (
    <div className="curves-tab">
      <UnifiedTracesList
        measurements={measurements}
        allTargets={allTargets}
        activeTargetIds={activeTargetIds}
        onToggleMeasurement={onToggleMeasurement}
        onRemoveMeasurement={onRemoveMeasurement}
        onToggleTarget={onToggleTarget}
        onRemoveTarget={onRemoveTarget}
      />
      <div className="curves-actions">
        <button className="btn add-trace-btn" onClick={() => setShowAddModal(true)}>
          <Icon>add</Icon>
          <span>Add Trace</span>
        </button>
        {measurements.length > 0 && (
          <button className="tool-link-button danger" onClick={onClearMeasurements}>
            Clear all
          </button>
        )}
      </div>
      {showAddModal && (
        <AddTraceModal
          onClose={() => setShowAddModal(false)}
          onAddMeasurement={onAddMeasurement}
          onAddTarget={onAddTarget}
          setStatus={setStatus}
        />
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
  hideProfileFolderButton,
  onReset,
  onSave,
  onDelete,
  showActions,
  dirty,
}: ToolsPanelProps) {
  const query = profileSearch.trim().toLowerCase();
  const filteredProfiles = profiles.filter(
    (p) => !query || fuzzyMatch(query, p.name)
  );
  const selectedProfile = profiles.find((p) => p.name === selectedPreset);
  const savedProfiles = profiles.filter((p) => p.modified != null);
  const selectedIsSaved = savedProfiles.some((p) => p.name === selectedPreset);
  const canDelete = selectedIsSaved;
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const showSaveAs = !selectedIsSaved || saveAsOpen;
  const saveName = newProfileName.trim();
  const isOverwrite = savedProfiles.some(
    (p) => p.name.toLowerCase() === saveName.toLowerCase()
  );
  const canSave = showSaveAs ? !!saveName : selectedIsSaved;
  const saveLabel = showSaveAs
    ? isOverwrite ? "Overwrite profile" : "Save profile"
    : "Save changes";

  useEffect(() => setSaveAsOpen(false), [selectedPreset]);

  const handleSelectProfile = (profile: typeof profiles[0]) => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onSelectProfile(profile);
  };

  return (
    <section className="profile-card">
      <div className="profile-card-head">
        <div className="profile-title">
          <strong>Profile Library</strong>
          <span>{savedProfiles.length} saved</span>
        </div>
        <div className="profile-card-tools">
          <button title="Reload profiles" aria-label="Reload profiles" onClick={onReloadProfiles}>
            <Icon>refresh</Icon>
          </button>
          {!hideProfileFolderButton && (
            <button title="Open profiles folder" aria-label="Open profiles folder" onClick={onOpenProfilesDir}>
              <Icon>folder</Icon>
            </button>
          )}
        </div>
      </div>

      <input
        className="profile-search"
        placeholder="Search profiles…"
        value={profileSearch}
        onChange={(e) => setProfileSearch(e.target.value)}
      />

      <div className="preset-list">
        {filteredProfiles.length === 0 ? (
          <div className="empty-profiles">No profiles found</div>
        ) : (
          filteredProfiles.map((profile) => (
            <div
              key={profile.name}
              className={selectedPreset === profile.name ? "profile-row selected" : "profile-row"}
            >
              <button
                className="profile-name-btn"
                title={`Load ${profile.name} into editor`}
                aria-label={`Load ${profile.name} into editor`}
                onClick={() => handleSelectProfile(profile)}
              >
                {profile.name}
              </button>
              {onApplyProfile && (
                <button
                  className="profile-apply-btn"
                  title={`Try ${profile.name} on DAC temporarily`}
                  aria-label={`Try ${profile.name} on DAC temporarily`}
                  onClick={() => onApplyProfile(profile)}
                >
                  <Icon>send</Icon>
                  <span>Try</span>
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {showActions !== false && (
        <>
          {showSaveAs && (
            <div className="profile-save-field">
              <label htmlFor="profile-save-name">{selectedIsSaved ? "Save a copy" : "Profile name"}</label>
              <div className="profile-name-input-wrap">
                <input
                  id="profile-save-name"
                  className="profile-search"
                  placeholder="Profile name…"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                />
                {!!saveName && (
                  <span className={`profile-name-badge ${isOverwrite ? "overwrite" : "new"}`}>
                    {isOverwrite ? "Overwrite" : "New"}
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="profile-management-actions">
            <button className="save primary-save" onClick={onSave} title={saveLabel} disabled={!canSave}>
              <Icon>save</Icon>
              <span>{saveLabel}</span>
            </button>
            <button className="icon-action profile-icon-action" title="Reset profile" aria-label="Reset profile" onClick={onReset}>
              <Icon>restart_alt</Icon>
            </button>
            <button
              className="icon-action profile-icon-action danger"
              title="Delete profile"
              aria-label="Delete profile"
              disabled={!canDelete}
              onClick={onDelete}
            >
              <Icon>delete</Icon>
            </button>
          </div>
          {selectedIsSaved && (
            <button
              type="button"
              className="profile-save-as-toggle"
              onClick={() => {
                setNewProfileName("");
                setSaveAsOpen((open) => !open);
              }}
            >
              {saveAsOpen ? "Cancel save as" : "Save as copy…"}
            </button>
          )}
        </>
      )}

      <div className="profile-card-foot">
        <small className="modified">
          {selectedProfile?.modified != null
            ? `Modified: ${new Date(selectedProfile.modified! * 1000).toLocaleDateString()}`
            : "Glacier data folder"}
        </small>
      </div>
    </section>
  );
}

interface ImportTabProps {
  peq: PEQData;
  profiles: Profile[];
  selectedPreset: string;
  onImportPEQ: (data: PEQData, name: string, isSaved: boolean) => void;
  onReloadProfiles: () => void;
  setStatus: (msg: string) => void;
}

interface ParsedResult {
  peq: PEQData;
  headphone_name: string | null;
  warnings: string[];
}

function ImportTab({ peq, profiles, selectedPreset, onImportPEQ, onReloadProfiles, setStatus }: ImportTabProps) {
  const [parsed, setParsed] = useState<ParsedResult | null>(null);
  const [importName, setImportName] = useState("");
  const [isTemporary, setIsTemporary] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".txt")) {
      setStatus("Error: Only .txt AutoEQ files are supported.");
      return;
    }

    try {
      const text = await file.text();
      await parseAndLoadText(text, file.name.replace(/\.[^/.]+$/, ""));
    } catch (error) {
      setStatus(`Import failed: ${error}`);
    }
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
      if (!text.trim()) throw new Error("Clipboard is empty.");
      await parseAndLoadText(text, `Pasted ${new Date().toLocaleDateString()}`);
    } catch (err) {
      setStatus(`Unable to read clipboard: ${err}`);
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
      const baseName = importName || selectedPreset || "eq_profile";
      const defaultName = `${baseName.replace(/[^a-zA-Z0-9_\-@+&.() ]/g, "")}.txt`;
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
    if (nameExists && !window.confirm(`Overwrite profile "${importName.trim()}"?`)) return;

    if (isTemporary) {
      onImportPEQ(parsed.peq, importName || "Imported EQ", false);
      setParsed(null);
      setStatus("Imported profile applied directly to active EQ (temporary)");
    } else {
      const name = importName.trim();
      if (!name) {
        setStatus("Please enter a name for the profile.");
        return;
      }
      if (name === DEFAULT_PROFILE_NAME) {
        setStatus(`"${DEFAULT_PROFILE_NAME}" is reserved. Choose another profile name.`);
        return;
      }
      try {
        await invoke("save_profile", { name, peq: parsed.peq });
        await onReloadProfiles();
        onImportPEQ(parsed.peq, name, true);
        setParsed(null);
        setStatus(`Profile '${name}' saved successfully`);
      } catch (err) {
        setStatus(`Save failed: ${err}`);
      }
    }
  };

  const handleCancel = () => {
    setParsed(null);
  };

  const importNameLower = importName.trim().toLowerCase();
  const savedProfiles = profiles.filter((profile) => profile.modified != null);
  const nameExists = parsed ? (!isTemporary && savedProfiles.some((p) => p.name.toLowerCase() === importNameLower)) : false;
  const activeFilters = parsed ? parsed.peq.filters.filter((f) => f.enabled) : [];

  return (
    <>
      <section className="profile-action-group import-section">
        <div className="profile-action-head">
          <strong>Import / Export</strong>
        </div>
        <input
          className="hidden-file-input"
          type="file"
          ref={fileInputRef}
          accept=".txt"
          onChange={handleFileChange}
        />
        <div className="transfer-actions">
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
      </section>

      {parsed && (
        <Modal title="Import Profile" onClose={handleCancel}>
            <div className="modal-body">
              <div className="import-mode-tabs">
                <button
                  className={!isTemporary ? "active" : ""}
                  onClick={() => setIsTemporary(false)}
                >
                  Save to Profile
                </button>
                <button
                  className={isTemporary ? "active" : ""}
                  onClick={() => setIsTemporary(true)}
                >
                  Try temporarily
                </button>
              </div>

              <div className="import-flow-content">
                {!isTemporary ? (
                  <div className="import-field-group">
                    <label htmlFor="import-name">Profile Name</label>
                    <input
                      id="import-name"
                      type="text"
                      value={importName}
                      onChange={(e) => setImportName(e.target.value)}
                      placeholder="Profile Name…"
                    />
                    {savedProfiles.length > 0 && (
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
                            ...savedProfiles.map((p) => ({ value: p.name, label: p.name })),
                          ]}
                        />
                      </div>
                    )}
                    {nameExists && (
                      <span className="import-overwrite-warning">
                        ⚠️ Profile already exists. Saving will overwrite it.
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
                  {isTemporary ? "Try temporarily" : "Save Profile"}
                </button>
              </div>
            </div>
        </Modal>
      )}
    </>
  );
}

interface AutoEqTabProps {
  measurements: MeasurementTrace[];
  allTargets: TargetTrace[];
  activeTargetIds?: string[];
  onImportPEQ: (data: PEQData, name: string, isSaved: boolean) => void;
  setStatus: (msg: string) => void;
  onSelectedMeasurementChange?: (measurementId: string | null) => void;
  onToggleMeasurement?: (id: string) => void;
  onToggleTarget?: (id: string) => void;
  maxBands?: number;
}

export function AutoEqTab({
  measurements,
  allTargets = [],
  activeTargetIds = [],
  onImportPEQ,
  setStatus,
  onSelectedMeasurementChange,
  onToggleMeasurement,
  onToggleTarget,
  maxBands = 10,
}: AutoEqTabProps) {
  const [nBands, setNBands] = useState<number>(Math.max(1, maxBands));
  const [steps, setSteps] = useState<number>(2000);
  const [smoothType, setSmoothType] = useState<string>("IE");
  const [fs, setFs] = useState<number>(96000);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    setNBands((current) => Math.min(current, Math.max(1, maxBands)));
  }, [maxBands]);

  // Local selection states
  const [localMeasId, setLocalMeasId] = useState<string>("");
  const [localTargetId, setLocalTargetId] = useState<string>("");

  // Sync default measurement selection
  useEffect(() => {
    if (localMeasId && measurements.some((m) => m.id === localMeasId)) {
      return;
    }
    const visible = measurements.find((m) => m.visible);
    if (visible) {
      setLocalMeasId(visible.id);
    } else if (measurements.length > 0) {
      setLocalMeasId(measurements[0].id);
    }
  }, [measurements, localMeasId]);

  // Sync default target selection
  useEffect(() => {
    if (localTargetId && allTargets.some((t) => t.id === localTargetId)) {
      return;
    }
    const active = allTargets.find((t) => activeTargetIds.includes(t.id));
    if (active) {
      setLocalTargetId(active.id);
    } else if (allTargets.length > 0) {
      setLocalTargetId(allTargets[0].id);
    }
  }, [allTargets, activeTargetIds, localTargetId]);

  // Sync selected measurement to parent for graph highlighting
  useEffect(() => {
    if (localMeasId) {
      onSelectedMeasurementChange?.(localMeasId);
    }
  }, [onSelectedMeasurementChange, localMeasId]);

  // Resolve measurement and target objects dynamically
  const meas = measurements.find((m) => m.id === localMeasId) || measurements.find((m) => m.visible) || measurements[0] || null;
  const target = allTargets.find((t) => t.id === localTargetId) || allTargets.find((t) => activeTargetIds.includes(t.id)) || allTargets[0] || null;

  const handleMeasChange = (id: string) => {
    setLocalMeasId(id);
    const m = measurements.find((x) => x.id === id);
    if (m) {
      if (!m.visible) {
        onToggleMeasurement?.(id);
      }
      onSelectedMeasurementChange?.(id);
    }
  };

  const handleTargetChange = (id: string) => {
    setLocalTargetId(id);
    if (!activeTargetIds.includes(id)) {
      onToggleTarget?.(id);
    }
    // Deactivate other active targets to keep display clean
    activeTargetIds.forEach((activeId) => {
      if (activeId !== id) {
        onToggleTarget?.(activeId);
      }
    });
  };

  const handleRunAutoEq = async () => {
    if (!meas || !target) return;

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

      const cleanMeasName = meas.name
        .replace(/\s*\(.*?\)/g, "")
        .trim() || meas.name;
      const cleanTargetName = target.name
        .replace(/IE 2019/i, "IE")
        .replace(/OE 2018/i, "OE")
        .replace(/Preference \d+/i, "Pref")
        .replace(/PEQdb /i, "")
        .replace(/Reference/i, "")
        .trim() || target.name;
      const autoName = `${cleanMeasName} @ ${cleanTargetName}`;
      onImportPEQ(result.peq, autoName, false);
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

  return (
    <div className="autoeq-tab">
      {measurements.length === 0 ? (
        <p className="autoeq-empty-hint">
          <Icon>info</Icon>
          Add a measurement above, then match it to a target curve.
        </p>
      ) : (
        <section className="tool-card">
          <div className="autoeq-match-grid">
            <div className="import-field-group">
              <label>Measurement</label>
              <Select
                value={localMeasId}
                options={measurements.map(m => ({ value: m.id, label: m.name }))}
                onChange={handleMeasChange}
              />
            </div>

            <div className="import-field-group">
              <label>Target</label>
              <Select
                value={localTargetId}
                options={allTargets.map(t => ({ value: t.id, label: t.name }))}
                onChange={handleTargetChange}
              />
            </div>
          </div>

          <Collapsible title="Advanced options" compact defaultOpen={false}>
            <div className="autoeq-form-grid">
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
                    IE
                  </button>
                  <button
                    className={smoothType === "OE" ? "active" : ""}
                    onClick={() => setSmoothType("OE")}
                  >
                    OE
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
            </div>
          </Collapsible>

          <div className="autoeq-run-row">
            <span className="autoeq-bands-label">Bands</span>
            <NumberInput
              id="autoeq-bands"
              aria-label="Bands"
              value={nBands}
              min={1}
              max={Math.max(1, maxBands)}
              onChange={setNBands}
              className="autoeq-bands-stepper"
            />
            <button
              className="btn filled autoeq-run-btn"
              disabled={isOptimizing || !meas || !target}
              onClick={handleRunAutoEq}
            >
              <Icon>{isOptimizing ? "hourglass_empty" : "bolt"}</Icon>
              <span>{isOptimizing ? "Optimizing..." : "Run Match"}</span>
            </button>
          </div>
        </section>
      )}

      {warnings.length > 0 && (
        <div className="import-warnings-box">
          {warnings.map((w, idx) => (
            <div key={idx} className="warning-line">
              • {w}
            </div>
          ))}
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
  onOpenDiagnostics,
  showGraph,
  onShowGraphChange,
}: {
  graphViewMode?: GraphViewMode;
  onGraphViewModeChange?: (mode: GraphViewMode) => void;
  settings: AppSettings;
  onSettingChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onOpenDiagnostics?: () => void;
  showGraph?: boolean;
  onShowGraphChange?: (show: boolean) => void;
}) {
  return (
    <div className="settings-list">
      <section className="tool-card">
        <div className="tool-card-head">
          <strong>Behavior</strong>
        </div>
        <label>
          <input type="checkbox" className="custom-checkbox"
            checked={settings.auto_pull_on_connect}
            onChange={(e) => onSettingChange("auto_pull_on_connect", e.target.checked)}
          />
          Auto-pull EQ from device on connect
        </label>
        <label>
          <input type="checkbox" className="custom-checkbox"
            checked={settings.skip_push_verification}
            onChange={(e) => onSettingChange("skip_push_verification", e.target.checked)}
          />
          Skip push verification
        </label>
        <label>
          <input type="checkbox" className="custom-checkbox"
            checked={settings.snap_to_iso_frequencies}
            onChange={(e) => onSettingChange("snap_to_iso_frequencies", e.target.checked)}
          />
          Snap frequency to ISO standard values
        </label>
      </section>

      <section className="tool-card">
        <div className="tool-card-head">
          <strong>Interface</strong>
        </div>
        {onShowGraphChange !== undefined && (
          <label>
            <input type="checkbox" className="custom-checkbox"
              checked={!!showGraph}
              onChange={(e) => onShowGraphChange(e.target.checked)}
            />
            Show frequency response graph
          </label>
        )}
        {onOpenDiagnostics && (
          <div className="setting-row">
            <span className="setting-label">Diagnostics</span>
            <button className="btn" onClick={onOpenDiagnostics} style={{ minHeight: "36px", padding: "0 12px" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>bug_report</span>
              View Logs
            </button>
          </div>
        )}
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
      </section>
    </div>
  );
}

type DeviceUtilityState = {
  supported: boolean;
  filter_mode: string;
  amp_mode_class_ab: boolean;
  high_gain_mode: boolean;
  mic_volume_db: number;
  channel_balance: number;
};

function DeviceTab({ setStatus, onPull }: { setStatus: (msg: string) => void; onPull?: () => Promise<void> }) {
  const [utility, setUtility] = useState<DeviceUtilityState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchState = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setUtility(await invoke<DeviceUtilityState>("get_dac_utility_state"));
    } catch (err) {
      setLoadError(`Failed to load device status: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchState();

    let unlisten: (() => void) | null = null;
    listen<void>("device-pull", () => {
      fetchState();
    }).then((unsub) => {
      unlisten = unsub;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const setUtilityField = async <K extends keyof DeviceUtilityState>(
    field: K,
    value: DeviceUtilityState[K],
    command: string,
    args: Record<string, unknown>,
  ) => {
    if (!utility) return;
    const previous = utility;
    setUtility({ ...previous, [field]: value });
    try {
      await invoke(command, args);
    } catch (err) {
      setUtility(previous);
      setStatus(`Device setting update failed: ${err}`);
    }
  };

  const handleSetFilter = (mode: string) =>
    setUtilityField("filter_mode", mode, "set_dac_filter_mode", { mode });

  const handleSetAmpMode = (isClassAb: boolean) =>
    setUtilityField("amp_mode_class_ab", isClassAb, "set_dac_work_mode", { isClassAb });

  const handleSetOutputGain = (isHighGain: boolean) =>
    setUtilityField("high_gain_mode", isHighGain, "set_dac_output_gain", { isHighGain });

  const handleSetBalance = (balance: number) =>
    setUtilityField("channel_balance", balance, "set_dac_balance", { balance });

  const handleSetMicVolume = (volumeDb: number) =>
    setUtilityField("mic_volume_db", volumeDb, "set_mic_volume", { volumeDb });

  const handleResetDeviceEq = async () => {
    if (!confirm("Reset device EQ? This clears all hardware bands and sets device preamp to 0 dB.")) return;
    try {
      await invoke("reset_device_eq");
      setStatus("Device EQ reset");
      if (onPull) {
        await onPull();
      }
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
      const data = await invoke<DeviceUtilityState>("get_dac_utility_state");
      setUtility(data);
      if (onPull) {
        await onPull();
      }
    } catch (err) {
      setStatus(`Factory reset failed: ${err}`);
    }
  };

  if (loading) {
    return (
      <div className="settings-list device-utility">
        <section className="tool-card">
          <div className="device-empty">Loading device status...</div>
        </section>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="settings-list device-utility">
        <section className="tool-card">
          <div className="device-empty">
            <Icon>error</Icon>
            <strong>Unable to load device status.</strong>
            <span>{loadError}</span>
            <button className="btn" onClick={fetchState}>Retry</button>
          </div>
        </section>
      </div>
    );
  }

  if (!utility?.supported) {
    return (
      <div className="settings-list device-utility">
        <section className="tool-card">
          <div className="device-empty">
            <Icon>tune</Icon>
            <strong>No supported hardware PEQ DAC connected.</strong>
            <span>Connect a supported Savitech DSP DAC.</span>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="settings-list device-utility">
      <section className="tool-card">
        <div className="tool-card-head">
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

        <label>
          <input type="checkbox" className="custom-checkbox"
            checked={utility.amp_mode_class_ab}
            onChange={(e) => handleSetAmpMode(e.target.checked)}
          />
          Amplifier Class AB
        </label>

        <label>
          <input type="checkbox" className="custom-checkbox"
            checked={utility.high_gain_mode}
            onChange={(e) => handleSetOutputGain(e.target.checked)}
          />
          Hardware High Gain
        </label>
      </section>

      <section className="tool-card">
        <div className="tool-card-head">
          <strong>Output Controls</strong>
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
      </section>

      <section className="tool-card">
        <div className="tool-card-head">
          <strong>Reset Device</strong>
        </div>
        <div className="action-row action-row-primary">
          <button className="btn" onClick={handleResetDeviceEq}>EQ</button>
          <button className="btn" onClick={handleResetDeviceControls}>Controls</button>
          <button className="btn danger" onClick={handleFactoryReset}>Factory</button>
        </div>
      </section>
    </div>
  );
}

interface DiagnosticEvent {
  timestamp: string;
  level: "Info" | "Warn" | "Error";
  source: "UI" | "Worker" | "HID" | "AutoEQ" | "Device";
  message: string;
}

type DiagLevel = "All" | "Error" | "Warn" | "Info";

const DIAG_LEVELS: DiagLevel[] = ["All", "Error", "Warn", "Info"];

export function DiagnosticsPanel() {
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

  const counts = events.reduce(
    (acc, event) => ({ ...acc, [event.level]: acc[event.level] + 1 }),
    { Error: 0, Warn: 0, Info: 0 },
  );
  const errorCount = counts.Error;
  const warnCount = counts.Warn;
  const infoCount = counts.Info;

  const searchQuery = search.trim().toLowerCase();
  const filtered = events.filter((e) => {
    if (levelFilter !== "All" && e.level !== levelFilter) return false;
    if (searchQuery) {
      return (
        fuzzyMatch(searchQuery, e.message) ||
        fuzzyMatch(searchQuery, e.source) ||
        e.timestamp.includes(searchQuery)
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
        {DIAG_LEVELS.map((lvl) => (
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
