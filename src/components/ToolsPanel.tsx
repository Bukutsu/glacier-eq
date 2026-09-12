import { memo, useState, useEffect, useRef } from "react";
import { invoke, listen, writeText } from "../lib/rpc";
import type {
  AppSettings,
  MeasurementTrace,
  Profile,
  PEQData,
  GraphViewMode,
  TargetTrace,
  DeviceCapabilities,
  DeviceInfo,
} from "../types";
import { asyncContextEquals } from "../lib/asyncContext";
import { fuzzyMatch } from "../lib/search";
import { Icon } from "./Icon";
import { DeviceView } from "./DeviceView";
import { SettingsView } from "./SettingsView";
import { AddTraceModal } from "./AddTraceModal";
import { Collapsible } from "./Collapsible";
import { UnifiedTracesList } from "./UnifiedTraces";
import { NumberInput } from "./NumberInput";
import { Select } from "./Select";
import { ProfilesView } from "./ProfilesView";
import { type DeviceSection, type SettingsSection, type ToolsTab } from "../lib/tabs";
import { parseAutoEqResult } from "../lib/parsedAutoEq";
import {
  mergeDiagnosticEvents,
  parseDiagnosticEvent,
  parseDiagnosticHistory,
  type DiagnosticEvent,
} from "../lib/diagnostics";



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
  activeTab: ToolsTab;
  onOpenConnectModal?: () => void;
  onOpenDiagnostics?: () => void;
  showGraph?: boolean;
  onShowGraphChange?: (show: boolean) => void;
  maxBands?: number;
  dspSampleRate?: number;
  getAsyncContext: () => AsyncContext;
  runProfileMutation: ProfileMutationRunner;
  onUdevInstalled?: () => Promise<string | null>;
  deviceInfo?: DeviceInfo;
  capabilities?: DeviceCapabilities;
  firmwareVersion?: string | null;
  deviceSection?: DeviceSection;
  settingsSection?: SettingsSection;
  onDisconnect?: () => Promise<void>;
}

export const ToolsPanel = memo(function ToolsPanel(props: ToolsPanelProps) {
  const tab = props.activeTab;

  return (
    <aside className="right-rail">
      <section className="tools-card">
        <div className="tab-panel">
          {tab === "Preset" && <ProfilesView {...props} />}
          {tab === "Tuning" && (
            <div className="desktop-tuning-tab">
              <Collapsible
                title={
                  <span className="tuning-library-header">
                    <span>Traces & Targets</span>
                    <span className="tuning-count-badge">
                      {(props.measurements?.length ?? 0) + (props.allTargets?.length ?? 0)}
                    </span>
                  </span>
                }
                icon="analytics"
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
            <DeviceView
              connected={!!props.connected}
              isSimulated={props.isSimulated}
              deviceInfo={props.deviceInfo}
              capabilities={props.capabilities}
              firmwareVersion={props.firmwareVersion}
              section={props.deviceSection}
              setStatus={props.setStatus}
              onPull={props.onPull}
              onOpenConnectModal={props.onOpenConnectModal}
              onDisconnect={props.onDisconnect}
            />
          )}
          {tab === "Settings" && (
            <SettingsView
              settings={props.settings}
              onSettingChange={props.onSettingChange}
              section={props.settingsSection}
              graphViewMode={props.graphViewMode}
              onGraphViewModeChange={props.onGraphViewModeChange}
              onOpenDiagnostics={props.onOpenDiagnostics}
              showGraph={props.showGraph}
              onShowGraphChange={props.onShowGraphChange}
              setStatus={props.setStatus}
              onUdevInstalled={props.onUdevInstalled}
            />
          )}
        </div>
      </section>
    </aside>
  );
});

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
          <button
            className="btn danger curves-clear-btn"
            title="Clear all measurements"
            aria-label="Clear all measurements"
            onClick={onClearMeasurements}
          >
            <Icon>delete</Icon>
            <span>Clear</span>
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
    } else {
      setLocalMeasId("");
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
    } else {
      setLocalTargetId("");
    }
  }, [allTargets, activeTargetIds, localTargetId]);

  // Sync selected measurement to parent for graph highlighting
  useEffect(() => {
    onSelectedMeasurementChange?.(localMeasId || null);
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
      && asyncContextEquals(context, getAsyncContext());

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
      if (mountedRef.current && request === requestRef.current) setIsOptimizing(false);
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
        <section className="tool-card autoeq-match-card">
          <div className="tool-card-head">
            <div className="tool-card-title">
              <Icon>auto_awesome</Icon>
              <strong>Match to target</strong>
            </div>
          </div>
          <p className="autoeq-description">
            Generate EQ from a measurement and target.
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

          <Collapsible title="Advanced settings" compact defaultOpen={false}>
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
              <span>{isOptimizing ? "Generating EQ..." : "Generate EQ"}</span>
            </button>
          </div>
          {!target && <p className="card-note" role="status">Add a target using Add Trace to continue.</p>}
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
