import { memo, useState, useEffect, useRef, type ReactNode } from "react";
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
import type { AsyncContext } from "../lib/asyncContext";
import { fuzzyMatch } from "../lib/search";
import { Icon } from "./Icon";
import { DeviceView } from "./DeviceView";
import { SettingsView } from "./SettingsView";
import { ProfilesView } from "./ProfilesView";
import { TuningPanel } from "./TuningPanel";
import { type DeviceSection, type SettingsSection, type ToolsTab } from "../lib/tabs";
import type { ProfileMutationRunner } from "../features/profiles/useProfiles";
import {
  appendDiagnosticEvent,
  formatDiagnosticReport,
  mergeDiagnosticEvents,
  parseDiagnosticEvent,
  parseDiagnosticHistory,
  settleDiagnosticClear,
  type DiagnosticContext,
  type DiagnosticEvent,
} from "../lib/diagnostics";



export type { ProfileMutationRunner };

interface ToolsPanelProps {
  peq: PEQData;
  onImportPEQ: (data: PEQData, name: string, isSaved: boolean) => boolean;
  onPull?: () => Promise<boolean>;
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
  isBusy?: boolean;
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
  onReviewEq?: () => void;
  profilePreview?: ReactNode;
}

export const ToolsPanel = memo(function ToolsPanel(props: ToolsPanelProps) {
  const tab = props.activeTab;

  return (
    <aside id="workspace-content" tabIndex={-1} className="right-rail" aria-label={tab === "Preset" ? "Profiles" : tab === "Tuning" ? "Tuning" : tab}>
      <section className="tools-card">
        <div className="tab-panel">
          {tab === "Preset" && <ProfilesView {...props} preview={props.profilePreview} />}
          {tab === "Tuning" && (
            <TuningPanel
              measurements={props.measurements ?? []}
              allTargets={props.allTargets ?? []}
              activeTargetIds={props.activeTargetIds ?? []}
              onImportPEQ={props.onImportPEQ}
              setStatus={props.setStatus}
              onSelectedMeasurementChange={props.onSelectedMeasurementChange}
              onRemoveMeasurement={props.onRemoveMeasurement ?? (() => {})}
              onToggleMeasurement={props.onToggleMeasurement ?? (() => {})}
              onClearMeasurements={props.onClearMeasurements ?? (() => {})}
              onToggleTarget={props.onToggleTarget ?? (() => {})}
              onRemoveTarget={props.onRemoveTarget ?? (() => {})}
              onAddTarget={props.onAddTarget}
              onAddMeasurement={props.onAddMeasurement}
              maxBands={props.maxBands}
              dspSampleRate={props.dspSampleRate}
              getAsyncContext={props.getAsyncContext}
              onReviewEq={props.onReviewEq}
            />
          )}
          {tab === "Device" && (
            <DeviceView
              key={`${props.connected ? "connected" : "offline"}:${props.deviceInfo?.path ?? "none"}`}
              connected={!!props.connected}
              isBusy={!!props.isBusy}
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
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
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
        buffered = appendDiagnosticEvent(buffered, event);
        return;
      }
      // Events arriving while a clear is in flight are kept aside so the
      // clear cannot erase them locally.
      if (clearingRef.current) {
        clearedBufferRef.current = appendDiagnosticEvent(clearedBufferRef.current, event);
        return;
      }
      setEvents((previous) => appendDiagnosticEvent(previous, event));
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
        setEvents(buffered);
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
    // A second clear must not drain the first request's live-event buffer.
    if (clearingRef.current) return;
    clearingRef.current = true;
    let outcome: "cleared" | "failed" = "failed";
    try {
      await invoke("clear_diagnostics");
      outcome = "cleared";
    } catch (err) {
      console.error("Failed to clear diagnostics:", err);
    } finally {
      // Drain on both outcomes: a failed clear preserves the previous log too.
      const survived = clearedBufferRef.current;
      clearedBufferRef.current = [];
      clearingRef.current = false;
      if (mountedRef.current) {
        setEvents((previous) => settleDiagnosticClear({
          events: previous,
          buffered: survived,
          outcome,
        }));
      }
    }
  };

  const copyToClipboard = async () => {
    if (copyState === "copying") return;
    setCopyState("copying");
    try {
      const context = await invoke<DiagnosticContext>("get_diagnostic_context");
      await writeText(formatDiagnosticReport(events, context));
      if (!mountedRef.current) return;
      setCopyState("copied");
    } catch (err) {
      console.error("Failed to copy diagnostic report:", err);
      if (!mountedRef.current) return;
      setCopyState("failed");
    }
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setCopyState("idle");
    }, 2000);
  };

  const copyLabel = copyState === "copying"
    ? "Copying…"
    : copyState === "copied"
      ? "Report copied"
      : copyState === "failed"
        ? "Copy failed"
        : "Copy report";

  return (
    <section className="diag-card">
      <div className="diag-head">
        <strong>Diagnostics</strong>
        <div className="diag-counts">
          <span className="diag-count-e" title="Errors" aria-label={`${errorCount} errors`}>{errorCount}E</span>
          <span className="diag-count-w" title="Warnings" aria-label={`${warnCount} warnings`}>{warnCount}W</span>
          <span className="diag-count-i" title="Info" aria-label={`${infoCount} info events`}>{infoCount}I</span>
        </div>
        <button
          type="button"
          className="diag-copy-btn"
          onClick={copyToClipboard}
          disabled={copyState === "copying"}
          title="Copy system information, device details, and all logs"
          aria-live="polite"
        >
          <Icon name={copyState === "copied" ? "check" : "content_copy"} />
          <span>{copyLabel}</span>
        </button>
        <button type="button" className="danger" title="Clear logs" aria-label="Clear logs" onClick={clearLogs}>
          <Icon name="delete" />
        </button>
      </div>

      <div className="diag-toolbar">
        {DIAG_LEVELS.map((lvl) => (
          <button
            type="button"
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
          type="button"
          className={`diag-scroll-btn${autoScroll ? " active" : ""}`}
          title={autoScroll ? "Auto-scroll on" : "Auto-scroll paused"}
          aria-label={autoScroll ? "Auto-scroll on" : "Auto-scroll paused"}
          onClick={() => setAutoScroll((v) => !v)}
        >
          <Icon name={autoScroll ? "vertical_align_bottom" : "lock"} />
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
            {events.length === 0 ? "No logs recorded." : "No matching logs."}
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
