import { memo, type CSSProperties, type KeyboardEvent, useState, useEffect, useRef } from "react";
import { invoke, listen, readText, writeText, save } from "../lib/rpc";
import type { AppSettings, MeasurementTrace, Profile, PEQData, GraphViewMode, TargetTrace } from "../types";
import { DEFAULT_PROFILE_NAME } from "../lib/peq";
import { Icon } from "./Icon";
import { confirmDialog } from "./ConfirmDialog";

import { fuzzyMatch } from "../lib/search";
import { AddTraceModal } from "./AddTraceModal";
import { Collapsible } from "./Collapsible";
import { Modal } from "./Modal";
import { UnifiedTracesList } from "./UnifiedTraces";
import { NumberInput } from "./NumberInput";
import { Slider } from "./Slider";
import { TAB_META, type ToolsTab } from "../lib/tabs";
import { parseAutoEqResult, type ParsedAutoEqResult } from "../lib/parsedAutoEq";
import {
  createCoalescingTaskScheduler,
  mergeFieldsAtUnchangedRevisions,
  revertFieldIfCurrent,
  setField,
} from "../lib/serializedWrites";
import {
  mergeDiagnosticEvents,
  parseDiagnosticEvent,
  parseDiagnosticHistory,
  type DiagnosticEvent,
} from "../lib/diagnostics";

const KEYBOARD_SHORTCUTS: [string, string][] = [
  ["Ctrl/⌘ Z", "Undo"],
  ["Ctrl/⌘ Shift Z", "Redo"],
  ["Ctrl/⌘ Y", "Redo"],
  ["Ctrl/⌘ S", "Save profile"],
  ["Ctrl/⌘ R", "Read EQ from DAC"],
  ["Ctrl/⌘ Shift R", "Reset EQ"],
  ["Ctrl/⌘ Enter", "Write EQ to DAC"],
];



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



export interface AsyncContext {
  editorRevision: number;
  connectionRevision: number;
}

export type ProfileMutationRunner = <T>(
  task: () => Promise<T>,
) => Promise<{ value: T; current: boolean }>;

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
  measurements?: MeasurementTrace[];
  onAddMeasurement?: (name: string, points: MeasurementTrace["points"]) => void;
  onRemoveMeasurement?: (id: string) => void;
  onToggleMeasurement?: (id: string) => void;
  onClearMeasurements?: () => void;
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
  isSimulated?: boolean;
  activeTab?: ToolsTab;
  onActiveTabChange?: (tab: ToolsTab) => void;
  onOpenConnectModal?: () => void;
  onOpenDiagnostics?: () => void;
  showGraph?: boolean;
  onShowGraphChange?: (show: boolean) => void;
  maxBands?: number;
  dspSampleRate?: number;
  getAsyncContext: () => AsyncContext;
  runProfileMutation: ProfileMutationRunner;
}

export const ToolsPanel = memo(function ToolsPanel(props: ToolsPanelProps) {
  const requestedTabs = props.availableTabs ?? ["Preset", "Import", "Tuning", "Device", "Settings"];
  // Import lives inside the Preset panel, so it is never offered as its own tab.
  const availableTabs = requestedTabs.filter((name): name is ToolsTab => name !== "Import");
  const [internalTab, setInternalTab] = useState<ToolsTab>(() => (
    props.defaultTab && availableTabs.includes(props.defaultTab) ? props.defaultTab : availableTabs[0]
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
        <div
          className="tab-panel"
          role="tabpanel"
          id={`tools-panel-${tab}`}
          aria-labelledby={`tools-tab-${tab}`}
        >
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
                getAsyncContext={props.getAsyncContext}
                runProfileMutation={props.runProfileMutation}
              />
            </>
          )}
          {tab === "Tuning" && (
            <div className="desktop-tuning-tab">
              <Collapsible
                title={`Traces & Targets (${(props.measurements?.length ?? 0) + (props.allTargets?.length ?? 0)})`}
                icon="analytics"
                defaultOpen={(props.measurements?.length ?? 0) === 0 && (props.allTargets?.length ?? 0) === 0}
                className="tuning-library"
              >
                <CurvesTab
                  measurements={props.measurements ?? []}
                  onRemoveMeasurement={props.onRemoveMeasurement ?? (() => {})}
                  onToggleMeasurement={props.onToggleMeasurement ?? (() => {})}
                  onClearMeasurements={props.onClearMeasurements ?? (() => {})}
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
                measurements={props.measurements ?? []}
                allTargets={props.allTargets ?? []}
                activeTargetIds={props.activeTargetIds}
                onImportPEQ={props.onImportPEQ}
                setStatus={props.setStatus}
                onSelectedMeasurementChange={props.onSelectedMeasurementChange}
                onToggleMeasurement={props.onToggleMeasurement}
                onToggleTarget={props.onToggleTarget}
                maxBands={props.maxBands}
                dspSampleRate={props.dspSampleRate}
                getAsyncContext={props.getAsyncContext}
              />
            </div>
          )}
          {tab === "Device" && (
            props.connected ? (
              <DeviceTab
                setStatus={props.setStatus}
                onPull={props.onPull}
                isSimulated={props.isSimulated}
              />
            ) : (
              <div className="device-empty">
                <span className="material-symbols-outlined" aria-hidden="true">link_off</span>
                <strong>DSP Offline</strong>
                <span>Connect a supported DAC to adjust hardware options, filter modes, and amplifier gain.</span>
                <button className="btn filled" onClick={props.onOpenConnectModal}>
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
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  if (tabs.length <= 1) {
    return null;
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const next = (index + delta + tabs.length) % tabs.length;
    onSelect(tabs[next]);
    buttonRefs.current[next]?.focus();
  };

  return (
    <nav
      className={`tabs ${tabs.length <= 2 ? "compact" : ""}`}
      role="tablist"
      aria-label="Tools"
      style={{
        "--tab-count": tabs.length,
        "--tab-columns": tabs.length >= 3 ? 2 : tabs.length,
      } as CSSProperties}
    >
      {tabs.map((name, index) => (
        <button
          key={name}
          ref={(el) => {
            buttonRefs.current[index] = el;
          }}
          id={`tools-tab-${name}`}
          role="tab"
          aria-selected={active === name}
          aria-controls={`tools-panel-${name}`}
          tabIndex={active === name ? 0 : -1}
          className={active === name ? "active" : ""}
          onClick={() => onSelect(name)}
          onKeyDown={(e) => handleKeyDown(e, index)}
        >
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
      <UnifiedTracesList
        measurements={measurements}
        allTargets={allTargets}
        activeTargetIds={activeTargetIds}
        onToggleMeasurement={onToggleMeasurement}
        onRemoveMeasurement={onRemoveMeasurement}
        onToggleTarget={onToggleTarget}
        onRemoveTarget={onRemoveTarget}
      />
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

  const handleSelectProfile = async (profile: typeof profiles[0]) => {
    if (dirty && !(await confirmDialog({
      title: "Discard changes?",
      message: "Loading this profile will replace the current unsaved changes.",
      confirmLabel: "Discard and load",
    }))) return;
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
        aria-label="Search profiles"
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
              disabled={!selectedIsSaved}
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
  onReloadProfiles: () => void | Promise<void>;
  setStatus: (msg: string) => void;
  getAsyncContext: () => AsyncContext;
  runProfileMutation: ProfileMutationRunner;
}

function sameAsyncContext(left: AsyncContext, right: AsyncContext): boolean {
  return left.editorRevision === right.editorRevision
    && left.connectionRevision === right.connectionRevision;
}

function ImportTab({
  peq,
  profiles,
  selectedPreset,
  onImportPEQ,
  onReloadProfiles,
  setStatus,
  getAsyncContext,
  runProfileMutation,
}: ImportTabProps) {
  const [parsed, setParsed] = useState<ParsedAutoEqResult | null>(null);
  const [importName, setImportName] = useState("");
  const [isTemporary, setIsTemporary] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const parseRequestRef = useRef(0);
  const modalContextRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      parseRequestRef.current += 1;
      modalContextRef.current += 1;
    };
  }, []);

  const invalidateModalOperation = () => {
    modalContextRef.current += 1;
    setIsSubmitting(false);
  };

  const handleImportFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Clear up front so re-selecting the same file re-fires onChange even
    // when we early-return below.
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const request = ++parseRequestRef.current;

    if (!file.name.endsWith(".txt")) {
      setStatus("Error: Only .txt AutoEQ files are supported.");
      return;
    }

    try {
      if (file.size > 1_048_576) throw new Error("File exceeds the 1 MiB limit");
      const text = await file.text();
      await parseAndLoadText(text, file.name.replace(/\.[^/.]+$/, ""), request);
    } catch (error) {
      if (request === parseRequestRef.current) {
        setStatus(`Failed to import: ${error}`);
      }
    }
  };

  const parseAndLoadText = async (
    text: string,
    defaultNameFallback: string,
    request: number,
  ) => {
    try {
      const rawResult = await invoke<unknown>("parse_autoeq", { text });
      if (request !== parseRequestRef.current) return;
      const result = parseAutoEqResult(rawResult);
      invalidateModalOperation();
      setParsed(result);
      const initialName = result.headphone_name || defaultNameFallback || "Imported Profile";
      setImportName(initialName);
      setIsTemporary(false);
      setStatus("Parsed AutoEQ profile");
    } catch (error) {
      if (request === parseRequestRef.current) {
        setStatus(`Failed to import: ${error}`);
      }
    }
  };

  const handlePaste = async () => {
    const request = ++parseRequestRef.current;
    try {
      const text = await readText();
      if (!text.trim()) throw new Error("Clipboard is empty.");
      await parseAndLoadText(
        text,
        `Pasted ${new Date().toLocaleDateString()}`,
        request,
      );
    } catch (err) {
      if (request === parseRequestRef.current) {
        setStatus(`Unable to read clipboard: ${err}`);
        console.error(err);
      }
    }
  };

  const handleCopy = async () => {
    try {
      const text = await invoke<string>("peq_to_autoeq", { peq });
      await writeText(text);
      setStatus("EQ settings copied to clipboard");
    } catch (err) {
      setStatus(`Failed to copy: ${err}`);
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
      // Backend-owned dialogs report cancellation as a null result rather
      // than a failure, so the user gets the right message.
      const savedName = await invoke<string | null>("save_text_file", { path, content: text });
      if (savedName === null) {
        setStatus("Export cancelled.");
        return;
      }
      setStatus("EQ settings exported successfully");
    } catch (err) {
      setStatus(`Failed to export: ${err}`);
    }
  };

  const handleConfirm = async () => {
    if (!parsed || isSubmitting) return;

    const operation = ++modalContextRef.current;
    const context = getAsyncContext();
    const parsedSnapshot = parsed;
    const nameSnapshot = importName;
    const temporarySnapshot = isTemporary;
    const isCurrent = () => mountedRef.current
      && operation === modalContextRef.current
      && sameAsyncContext(context, getAsyncContext());
    setIsSubmitting(true);

    try {
      if (nameExists && !(await confirmDialog({
        title: "Overwrite profile?",
        message: `A profile named "${nameSnapshot.trim()}" already exists. Saving will replace it.`,
        confirmLabel: "Overwrite",
        danger: true,
      }))) return;
      if (!isCurrent()) return;

      if (temporarySnapshot) {
        onImportPEQ(parsedSnapshot.peq, nameSnapshot || "Imported EQ", false);
        setParsed(null);
        setStatus("Applied to the editor without saving");
        return;
      }

      const name = nameSnapshot.trim();
      if (!name) {
        setStatus("Please enter a name for the profile.");
        return;
      }
      if (name === DEFAULT_PROFILE_NAME) {
        setStatus(`"${DEFAULT_PROFILE_NAME}" is reserved. Choose another profile name.`);
        return;
      }

      const mutation = await runProfileMutation(async () => {
        await invoke("save_profile", { name, peq: parsedSnapshot.peq });
        await onReloadProfiles();
      });
      if (!mutation.current || !isCurrent()) return;

      onImportPEQ(parsedSnapshot.peq, name, true);
      setParsed(null);
      setStatus(`Profile '${name}' saved`);
    } catch (err) {
      if (isCurrent()) setStatus(`Failed to save profile: ${err}`);
    } finally {
      if (mountedRef.current && operation === modalContextRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  const handleCancel = () => {
    invalidateModalOperation();
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
              <div className="import-mode-tabs" role="group" aria-label="Import destination mode">
                <button
                  className={!isTemporary ? "active" : ""}
                  aria-pressed={!isTemporary}
                  onClick={() => {
                    invalidateModalOperation();
                    setIsTemporary(false);
                  }}
                >
                  Save to Profile
                </button>
                <button
                  className={isTemporary ? "active" : ""}
                  aria-pressed={isTemporary}
                  onClick={() => {
                    invalidateModalOperation();
                    setIsTemporary(true);
                  }}
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
                      onChange={(e) => {
                        invalidateModalOperation();
                        setImportName(e.target.value);
                      }}
                      placeholder="Profile Name…"
                    />
                    {savedProfiles.length > 0 && (
                      <div className="import-field-group" style={{ marginTop: "8px" }}>
                        <label htmlFor="overwrite-select">Or overwrite an existing profile:</label>
                        <Select
                          id="overwrite-select"
                          value={profiles.some((p) => p.name === importName) ? importName : ""}
                          onChange={(val) => {
                            if (val) {
                              invalidateModalOperation();
                              setImportName(val);
                            }
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
                        A profile with this name already exists. Saving will replace it.
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="import-temp-info">
                    Applies the parsed EQ to the editor, replacing unsaved changes.
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
                <button className="btn filled" onClick={handleConfirm} disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : isTemporary ? "Try temporarily" : "Save Profile"}
                </button>
              </div>
            </div>
        </Modal>
      )}
    </>
  );
}

const EMPTY_TARGETS: TargetTrace[] = [];
const EMPTY_TARGET_IDS: string[] = [];

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
  dspSampleRate?: number;
  getAsyncContext: () => AsyncContext;
}

export function AutoEqTab({
  measurements,
  allTargets = EMPTY_TARGETS,
  activeTargetIds = EMPTY_TARGET_IDS,
  onImportPEQ,
  setStatus,
  onSelectedMeasurementChange,
  onToggleMeasurement,
  onToggleTarget,
  maxBands = 10,
  dspSampleRate = 96000,
  getAsyncContext,
}: AutoEqTabProps) {
  const [nBands, setNBands] = useState<number>(Math.max(1, maxBands));
  const [steps, setSteps] = useState<number>(2000);
  const [smoothType, setSmoothType] = useState<string>("IE");
  const [fs, setFs] = useState<number>(dspSampleRate);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);

  const invalidateRequest = () => {
    requestRef.current += 1;
    setIsOptimizing(false);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    requestRef.current += 1;
  }, [measurements, allTargets, activeTargetIds]);

  useEffect(() => {
    requestRef.current += 1;
    setNBands((current) => Math.min(current, Math.max(1, maxBands)));
  }, [maxBands]);

  useEffect(() => {
    requestRef.current += 1;
    setFs(dspSampleRate);
  }, [dspSampleRate]);

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
    invalidateRequest();
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
    invalidateRequest();
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

    const request = ++requestRef.current;
    const context = getAsyncContext();
    const input = {
      measurementName: meas.name,
      measurementPoints: meas.points.map((point) => [point.freq, point.db]),
      targetName: target.name,
      targetPoints: target.points.map((point) => [point.freq, point.db]),
      nBands,
      steps,
      smoothType,
      fs,
    };
    const isCurrent = () => mountedRef.current
      && request === requestRef.current
      && sameAsyncContext(context, getAsyncContext());

    setIsOptimizing(true);
    setStatus("Running AutoEQ optimization...");
    setWarnings([]);

    try {
      const rawResult = await invoke<unknown>("run_autoeq", {
        measurementPoints: input.measurementPoints,
        targetPoints: input.targetPoints,
        nBands: input.nBands,
        steps: input.steps,
        smoothType: input.smoothType,
        fs: input.fs,
      });
      const result = parseAutoEqResult(rawResult);
      if (!isCurrent()) return;

      const cleanMeasName = input.measurementName
        .replace(/\s*\(.*?\)/g, "")
        .trim() || input.measurementName;
      const cleanTargetName = input.targetName
        .replace(/IE 2019/i, "IE")
        .replace(/OE 2018/i, "OE")
        .replace(/Preference \d+/i, "Pref")
        .replace(/PEQdb /i, "")
        .replace(/Reference/i, "")
        .trim() || input.targetName;
      const autoName = `${cleanMeasName} @ ${cleanTargetName}`;
      onImportPEQ(result.peq, autoName, false);
      setWarnings(result.warnings);

      if (result.warnings.length > 0) {
        setStatus(`AutoEQ match complete with ${result.warnings.length} device warning${result.warnings.length === 1 ? "" : "s"}`);
      } else {
        setStatus("AutoEQ match complete");
      }
    } catch (err) {
      if (isCurrent()) {
        setStatus(`AutoEQ match failed: ${err}`);
        console.error(err);
      }
    } finally {
      if (isCurrent()) setIsOptimizing(false);
    }
  };

  return (
    <div className="autoeq-tab">
      {measurements.length === 0 ? (
        <div className="autoeq-empty">
          <Icon>auto_awesome</Icon>
          <p>Add a measurement, then match it to a target curve to generate an EQ automatically.</p>
        </div>
      ) : (
        <section className="tool-card">
          <div className="tool-card-head">
            <strong>AutoEQ Match</strong>
          </div>
          <p className="autoeq-description">
            Fit the selected measurement to a target curve and load the result into the editor.
          </p>
          <div className="autoeq-match-grid">
            <div className="import-field-group">
              <label htmlFor="autoeq-measurement">Measurement</label>
              <Select
                id="autoeq-measurement"
                value={localMeasId}
                options={measurements.map(m => ({ value: m.id, label: m.name }))}
                onChange={handleMeasChange}
              />
            </div>

            <div className="import-field-group">
              <label htmlFor="autoeq-target">Target</label>
              <Select
                id="autoeq-target"
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
                <div className="smooth-buttons" role="group" aria-label="Treble smoothing algorithm">
                  <button
                    className={smoothType === "None" ? "active" : ""}
                    aria-pressed={smoothType === "None"}
                    onClick={() => {
                      invalidateRequest();
                      setSmoothType("None");
                    }}
                  >
                    None
                  </button>
                  <button
                    className={smoothType === "IE" ? "active" : ""}
                    aria-pressed={smoothType === "IE"}
                    onClick={() => {
                      invalidateRequest();
                      setSmoothType("IE");
                    }}
                  >
                    IE
                  </button>
                  <button
                    className={smoothType === "OE" ? "active" : ""}
                    aria-pressed={smoothType === "OE"}
                    onClick={() => {
                      invalidateRequest();
                      setSmoothType("OE");
                    }}
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
                  onChange={(value) => {
                    invalidateRequest();
                    setSteps(value);
                  }}
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
                  onChange={(value) => {
                    invalidateRequest();
                    setFs(value);
                  }}
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
            <label htmlFor="autoeq-bands" className="autoeq-bands-label">Bands</label>
            <NumberInput
              id="autoeq-bands"
              aria-label="Bands"
              value={nBands}
              min={1}
              max={Math.max(1, maxBands)}
              onChange={(value) => {
                invalidateRequest();
                setNBands(value);
              }}
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
        <label>
          <input type="checkbox" className="custom-checkbox"
            checked={settings.floating_graph_preview ?? true}
            onChange={(e) => onSettingChange("floating_graph_preview", e.target.checked)}
          />
          Show floating graph preview while scrolling
        </label>
        {onOpenDiagnostics && (
          <div className="setting-row">
            <span className="setting-label">Diagnostics</span>
            <button className="btn" onClick={onOpenDiagnostics} style={{ minHeight: "36px", padding: "0 12px" }}>
              <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: "18px" }}>bug_report</span>
              View Logs
            </button>
          </div>
        )}
        <div className="setting-row">
          <label className="setting-label" htmlFor="theme-select">Color Theme</label>
          <div className="setting-select-wrapper">
            <Select
              id="theme-select"
              value={settings.theme}
              onChange={(val) => onSettingChange("theme", val)}
              options={[
                { value: "auto", label: "Auto (System Theme)" },
                { value: "tokyo-night", label: "Tokyo Night" },
                { value: "tokyo-night-storm", label: "Tokyo Night Storm" },
                { value: "tokyo-night-day", label: "Tokyo Night Day (Light)" },
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
          <>
            <div className="setting-row">
              <span className="setting-label">Graph View</span>
              <div className="graph-view-toggle" role="group" aria-label="Graph view mode">
                <button
                  className={graphViewMode === "shape" ? "active" : ""}
                  aria-pressed={graphViewMode === "shape"}
                  title="Normalize the curve to its 1 kHz response"
                  onClick={() => onGraphViewModeChange("shape")}
                >
                  Shape
                </button>
                <button
                  className={graphViewMode === "level" ? "active" : ""}
                  aria-pressed={graphViewMode === "level"}
                  title="Show absolute gain across the frequency range"
                  onClick={() => onGraphViewModeChange("level")}
                >
                  Level
                </button>
              </div>
            </div>
            <p className="setting-hint">
              Shape normalizes the curve to its 1 kHz response; Level shows absolute gain.
            </p>
          </>
        )}
      </section>

      <section className="tool-card shortcuts-card">
        <div className="tool-card-head">
          <strong>Keyboard Shortcuts</strong>
        </div>
        <div className="shortcut-list">
          {KEYBOARD_SHORTCUTS.map(([keys, action]) => (
            <div className="shortcut-row" key={keys}>
              <span className="shortcut-keys">{keys}</span>
              <span className="shortcut-action">{action}</span>
            </div>
          ))}
        </div>
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

function DeviceTab({
  setStatus,
  onPull,
  isSimulated = false,
}: {
  setStatus: (msg: string) => void;
  onPull?: () => Promise<void>;
  isSimulated?: boolean;
}) {
  const [utility, setUtility] = useState<DeviceUtilityState | null>(null);
  // Mirror for the mount-only device-pull listener below, whose closure would
  // otherwise see the first render's `utility` (always null) forever.
  const utilityRef = useRef<DeviceUtilityState | null>(null);
  const confirmedUtilityRef = useRef<DeviceUtilityState | null>(null);
  const fieldRevisionsRef = useRef<Partial<Record<keyof DeviceUtilityState, number>>>({});
  const mountedRef = useRef(true);
  // One lifecycle-aware scheduler for every utility mutation (field writes,
  // refreshes, resets). Tasks coalesce per key, and invalidation on unmount
  // drops queued work so it can never target a replacement device.
  const [scheduleUtilityTask] = useState(() => createCoalescingTaskScheduler<string>());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchState = async (isActive = () => true, silent = false) => {
    if (!silent) {
      setLoading(true);
      setLoadError(null);
    }
    // A refresh started before optimistic edits must not clobber newer user
    // values: merge only fields whose revision has not advanced since the
    // refresh began.
    const revisionsAtRefresh = { ...fieldRevisionsRef.current };
    try {
      const data = await invoke<DeviceUtilityState>("get_dac_utility_state");
      if (isActive()) {
        const base = utilityRef.current ?? data;
        const merged = mergeFieldsAtUnchangedRevisions(
          base,
          data,
          revisionsAtRefresh,
          fieldRevisionsRef.current,
        );
        setUtility(merged);
        utilityRef.current = merged;
        confirmedUtilityRef.current = data;
        setLoadError(null);
      }
    } catch (err) {
      if (isActive()) {
        if (!silent || utilityRef.current === null) {
          setLoadError(`Couldn't load device status: ${err}`);
        } else {
          setStatus(`Couldn't refresh device status: ${err}`);
        }
      }
    } finally {
      if (isActive()) setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    scheduleUtilityTask.enqueue("refresh", async (isCurrent) => {
      await fetchState(() => active && isCurrent());
    });

    let unlisten: (() => void) | null = null;
    listen<void>("device-pull", () => {
      if (active) {
        // Route background refreshes through the same scheduler as writes so
        // they cannot interleave with pending utility mutations.
        scheduleUtilityTask.enqueue("refresh", async (isCurrent) => {
          await fetchState(() => active && isCurrent(), true);
        });
      }
    })
      .then((unsub) => {
        if (active) {
          unlisten = unsub;
        } else {
          try { unsub(); } catch {}
        }
      })
      .catch((error) => {
        if (active) console.error("Failed to listen for device-pull:", error);
      });

    return () => {
      active = false;
      mountedRef.current = false;
      // Drop queued utility work so a replacement device never receives it.
      scheduleUtilityTask.invalidate();
      if (unlisten) unlisten();
    };
  }, []);

  const setUtilityField = async <K extends keyof DeviceUtilityState>(
    field: K,
    value: DeviceUtilityState[K],
    command: string,
    args: Record<string, unknown>,
  ) => {
    const current = utilityRef.current;
    if (!current) return;

    const revision = (fieldRevisionsRef.current[field] ?? 0) + 1;
    fieldRevisionsRef.current[field] = revision;
    const optimistic = setField(current, field, value);
    utilityRef.current = optimistic;
    setUtility(optimistic);

    // Per-field coalescing: slider streams collapse to the latest value per
    // control while preserving cross-field ordering.
    scheduleUtilityTask.enqueue(field, async (isCurrent) => {
      if (!isCurrent()) return;
      try {
        await invoke(command, args);
        const confirmed = confirmedUtilityRef.current;
        if (confirmed && isCurrent()) {
          confirmedUtilityRef.current = setField(confirmed, field, value);
        }
      } catch (err) {
        if (!isCurrent()) return;
        const latest = utilityRef.current;
        const confirmed = confirmedUtilityRef.current;
        if (latest && confirmed) {
          const reverted = revertFieldIfCurrent(
            latest,
            confirmed,
            field,
            revision,
            fieldRevisionsRef.current[field] ?? 0,
          );
          if (reverted !== latest) {
            utilityRef.current = reverted;
            if (mountedRef.current) setUtility(reverted);
          }
        }
        if (mountedRef.current) {
          setStatus(`Failed to update device setting: ${err}`);
        }
      }
    });
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
    if (!(await confirmDialog({
      title: "Reset device EQ?",
      message: "This clears all hardware bands and sets device preamp to 0 dB.",
      confirmLabel: "Reset EQ",
      danger: true,
    }))) return;
    // Resets supersede queued field writes so stale slider values cannot
    // overwrite the reset on hardware.
    scheduleUtilityTask.enqueue("reset", async (isCurrent) => {
      try {
        await invoke("reset_device_eq");
        if (!isCurrent()) return;
        setStatus("Device EQ reset");
        if (onPull) {
          await onPull();
        }
      } catch (err) {
        if (!isCurrent()) return;
        setStatus(`Failed to reset device EQ: ${err}`);
      }
    }, { supersedePending: true });
  };

  const handleResetDeviceControls = async () => {
    if (!(await confirmDialog({
      title: "Reset device controls?",
      message: "This restores filter, amp mode, output gain, mic volume, and balance defaults.",
      confirmLabel: "Reset controls",
      danger: true,
    }))) return;
    scheduleUtilityTask.enqueue("reset", async (isCurrent) => {
      try {
        const data = await invoke<DeviceUtilityState>("reset_device_controls");
        if (!isCurrent()) return;
        utilityRef.current = data;
        confirmedUtilityRef.current = data;
        setUtility(data);
        setStatus("Device controls reset");
      } catch (err) {
        if (!isCurrent()) return;
        setStatus(`Failed to reset device controls: ${err}`);
      }
    }, { supersedePending: true });
  };

  const handleFactoryReset = async () => {
    if (!(await confirmDialog({
      title: "Factory reset?",
      message: "This will restore all device settings to their factory defaults.",
      confirmLabel: "Factory reset",
      danger: true,
    }))) return;
    scheduleUtilityTask.enqueue("reset", async (isCurrent) => {
      try {
        await invoke("execute_factory_reset");
        if (!isCurrent()) return;
        const data = await invoke<DeviceUtilityState>("get_dac_utility_state");
        if (!isCurrent()) return;
        utilityRef.current = data;
        confirmedUtilityRef.current = data;
        setUtility(data);
        if (onPull) {
          await onPull();
        }
      } catch (err) {
        if (!isCurrent()) return;
        setStatus(`Failed to factory reset: ${err}`);
      }
    }, { supersedePending: true });
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
            <strong>Couldn't load device status.</strong>
            <span>{loadError}</span>
            <button className="btn" onClick={() => fetchState()}>Retry</button>
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
            <strong>{isSimulated ? "Simulation · editor only" : "No supported DSP DAC connected."}</strong>
            <span>
              {isSimulated
                ? "Hardware DSP controls are unavailable for the dummy DAC."
                : "Connect a supported Savitech DSP DAC to use these controls."}
            </span>
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
          <label className="setting-label" htmlFor="utility-filter-select">Filter Mode</label>
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
          {utility.filter_mode === "FAST-LL" && "FAST-LL: minimizes pre-ringing for a warm, punchy sound."}
          {utility.filter_mode === "FAST-PC" && "FAST-PC: preserves phase linearity for a clean, balanced sound."}
          {utility.filter_mode === "Slow-LL" && "Slow-LL: gentle high-frequency roll-off for a warm, relaxed sound."}
          {utility.filter_mode === "Slow-PC" && "Slow-PC: phase linearity with a gentler high-frequency roll-off."}
          {utility.filter_mode === "NON-OS" && "NON-OS: bypasses digital interpolation for a raw analog sound."}
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
            min={-15}
            max={15}
            step={1}
            aria-label="Channel Balance"
            aria-valuetext={utility.channel_balance === 0 ? "Center (0)" : utility.channel_balance > 0 ? `Left +${utility.channel_balance}` : `Right +${Math.abs(utility.channel_balance)}`}
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
            min={-15}
            max={15}
            step={1}
            aria-label="Microphone Monitor Loopback"
            aria-valuetext={`${utility.mic_volume_db} dB`}
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

type DiagLevel = "All" | "Error" | "Warn" | "Info";

const DIAG_LEVELS: DiagLevel[] = ["All", "Error", "Warn", "Info"];
const DIAG_PREVIEW_LENGTH = 180;

function formatDiagnosticTimestamp(timestamp: string) {
  const match = timestamp.match(/T(\d{2}:\d{2}:\d{2}(?:\.\d{3})?)/);
  return match?.[1] ?? timestamp;
}

function DiagnosticMessage({ message }: { message: string }) {
  if (message.length <= DIAG_PREVIEW_LENGTH) {
    return <span className="log-msg">{message}</span>;
  }

  return (
    <details className="log-details">
      <summary className="log-msg">{message.slice(0, DIAG_PREVIEW_LENGTH).trimEnd()}…</summary>
      <pre>{message}</pre>
    </details>
  );
}

export function DiagnosticsPanel() {
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const [levelFilter, setLevelFilter] = useState<DiagLevel>("All");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // Set while a backend clear is in flight; live events received meanwhile
  // are buffered here so the clear cannot erase them.
  const clearingRef = useRef(false);
  const clearedBufferRef = useRef<DiagnosticEvent[]>([]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  // Subscribe first so events emitted while history is loading cannot be lost.
  useEffect(() => {
    let active = true;
    let loadingHistory = true;
    let buffered: DiagnosticEvent[] = [];
    let unlistenFn: (() => void) | null = null;

    const appendLiveEvent = (event: DiagnosticEvent) => {
      if (!active) return;
      if (loadingHistory) {
        buffered.push(event);
        return;
      }
      // Events arriving while a clear is in flight are kept aside so the
      // clear cannot erase them locally.
      if (clearingRef.current) {
        clearedBufferRef.current.push(event);
        return;
      }
      setEvents((previous) => [...previous, event].slice(-1000));
    };

    const start = async () => {
      try {
        const unlisten = await listen<unknown>(
          "diagnostic-event",
          (event) => {
            try {
              appendLiveEvent(parseDiagnosticEvent(event.payload));
            } catch (error) {
              console.error("Ignored invalid diagnostic event:", error);
            }
          },
        );
        if (!active) {
          try { unlisten(); } catch {}
          return;
        }
        unlistenFn = unlisten;
      } catch (error) {
        if (!active) return;
        console.error("Failed to listen for diagnostic-event:", error);
      }

      if (!active) return;
      try {
        const rawHistory = await invoke<unknown>("get_diagnostics");
        if (!active) return;
        const history = parseDiagnosticHistory(rawHistory);
        loadingHistory = false;
        setEvents(mergeDiagnosticEvents(history, buffered));
        buffered = [];
      } catch (error) {
        if (!active) return;
        console.error("Failed to load diagnostics:", error);
        loadingHistory = false;
        setEvents(buffered.slice(-1000));
        buffered = [];
      }
    };

    void start();
    return () => {
      active = false;
      buffered = [];
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
    // Events emitted while the backend clear is in flight must survive it:
    // buffer them and merge after the local history is reset.
    clearingRef.current = true;
    try {
      await invoke("clear_diagnostics");
      if (!mountedRef.current) return;
      setEvents([]);
      const survived = clearedBufferRef.current;
      clearedBufferRef.current = [];
      if (survived.length > 0) {
        setEvents(mergeDiagnosticEvents([], survived));
      }
    } catch (err) {
      console.error("Failed to clear diagnostics:", err);
    } finally {
      clearingRef.current = false;
    }
  };

  const copyToClipboard = async () => {
    const text = filtered
      .map((e) => `${e.timestamp} [${e.level.toUpperCase()}] [${e.source}] ${e.message}`)
      .join("\n");
    try {
      await writeText(text);
      if (!mountedRef.current) return;
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setCopied(false);
      }, 1500);
    } catch (err) {
      console.error("Failed to copy logs:", err);
    }
  };

  return (
    <section className="diag-card">
      <div className="diag-head">
        <strong>Diagnostics</strong>
        <div className="diag-counts">
          <span className="diag-count-e" title="Errors" aria-label={`${errorCount} errors`}>{errorCount}E</span>
          <span className="diag-count-w" title="Warnings" aria-label={`${warnCount} warnings`}>{warnCount}W</span>
          <span className="diag-count-i" title="Info" aria-label={`${infoCount} info events`}>{infoCount}I</span>
        </div>
        <button title={copied ? "Copied!" : "Copy filtered logs to clipboard"} aria-label={copied ? "Copied" : "Copy filtered logs to clipboard"} onClick={copyToClipboard}>
          <Icon>{copied ? "check" : "content_copy"}</Icon>
        </button>
        <button className="danger" title="Clear all logs" aria-label="Clear all logs" onClick={clearLogs}>
          <Icon>delete</Icon>
        </button>
      </div>

      <div className="diag-toolbar">
        {DIAG_LEVELS.map((lvl) => (
          <button
            key={lvl}
            className={`diag-filter-btn${levelFilter === lvl ? " active" : ""}${lvl === "Error" ? " f-error" : ""}${lvl === "Warn" ? " f-warn" : ""}`}
            aria-pressed={levelFilter === lvl}
            onClick={() => setLevelFilter(lvl)}
          >
            {lvl}
          </button>
        ))}
        <input
          className="diag-search"
          type="search"
          placeholder="Search…"
          aria-label="Search logs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className={`diag-scroll-btn${autoScroll ? " active" : ""}`}
          title={autoScroll ? "Auto-scroll on" : "Auto-scroll paused"}
          aria-label={autoScroll ? "Auto-scroll on" : "Auto-scroll paused"}
          onClick={() => setAutoScroll((v) => !v)}
        >
          <Icon>{autoScroll ? "vertical_align_bottom" : "lock"}</Icon>
        </button>
      </div>

      <div
        className="log-box"
        ref={logBoxRef}
        tabIndex={0}
        role="log"
        aria-label="Diagnostics event log"
        aria-live="polite"
      >
        {filtered.length === 0 ? (
          <div className="diag-empty">
            {events.length === 0 ? "No logs yet." : "No matches for current filter."}
          </div>
        ) : (
          filtered.map((event, index) => (
            <div
              key={`${index}-${event.timestamp}-${event.level}-${event.message}`}
              className={`log-line log-line-${event.level.toLowerCase()}`}
            >
              <span className="log-ts" title={event.timestamp}>
                {formatDiagnosticTimestamp(event.timestamp)}
              </span>
              <span className="log-level">{event.level}</span>
              <DiagnosticMessage message={`[${event.source}] ${event.message}`} />
            </div>
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
