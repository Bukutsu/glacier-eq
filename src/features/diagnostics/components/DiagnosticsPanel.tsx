import { useTranslation } from "react-i18next";
import { useState, useEffect, useRef } from "react";
import { invoke, listen, writeText } from "@/lib/rpc";
import { fuzzyMatch } from "@/lib/search";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { ToggleRow } from "@/components/ui/SettingsPrimitives";
import { useDebugStore } from "@/features/diagnostics/stores/debugStore";
import {
  appendDiagnosticEvent,
  formatDiagnosticReport,
  mergeDiagnosticEvents,
  parseDiagnosticEvent,
  parseDiagnosticHistory,
  settleDiagnosticClear,
  type DiagnosticContext,
  type DiagnosticEvent,
} from "@/features/diagnostics/lib/diagnostics";

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
      <summary className="log-msg">
        {message.slice(0, DIAG_PREVIEW_LENGTH).trimEnd()}…
      </summary>
      <pre>{message}</pre>
    </details>
  );
}

export function DiagnosticsPanel() {
  const { t } = useTranslation("editor");
  const autoDiscardEq = useDebugStore((s) => s.autoDiscardEq);
  const setAutoDiscardEq = useDebugStore((s) => s.setAutoDiscardEq);
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const [levelFilter, setLevelFilter] = useState<DiagLevel>("All");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "failed"
  >("idle");
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
        clearedBufferRef.current = appendDiagnosticEvent(
          clearedBufferRef.current,
          event,
        );
        return;
      }
      setEvents((previous) => appendDiagnosticEvent(previous, event));
    };

    const start = async () => {
      try {
        const unlisten = await listen<unknown>("diagnostic-event", (event) => {
          try {
            appendLiveEvent(parseDiagnosticEvent(event.payload));
          } catch (error) {
            console.error("Ignored invalid diagnostic event:", error);
          }
        });
        if (!active) {
          try {
            unlisten();
          } catch {}
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
      try {
        unlistenFn?.();
      } catch {}
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
        setEvents((previous) =>
          settleDiagnosticClear({
            events: previous,
            buffered: survived,
            outcome,
          }),
        );
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

  const copyLabel =
    copyState === "copying"
      ? t("diagnostics.copying")
      : copyState === "copied"
        ? t("diagnostics.copied")
        : copyState === "failed"
          ? t("diagnostics.copyFailed")
          : t("diagnostics.copy");

  return (
    <section className="diagnostics-view">
      <details className="debug-eq-options">
        <summary>{t("diagnostics.advanced")}</summary>
        <ToggleRow
          title={t("diagnostics.autoDiscard")}
          desc={t("diagnostics.autoDiscardDescription")}
          checked={autoDiscardEq}
          onChange={setAutoDiscardEq}
        />
      </details>
      <div className="diag-head">
        <div className="diag-counts">
          <span
            className="diag-count-e"
            title={t("diagnostics.errorsTitle")}
            aria-label={t("diagnostics.errors", { count: errorCount })}
          >
            {t("diagnostics.errors", { count: errorCount })}
          </span>
          <span
            className="diag-count-w"
            title={t("diagnostics.warningsTitle")}
            aria-label={t("diagnostics.warnings", { count: warnCount })}
          >
            {t("diagnostics.warnings", { count: warnCount })}
          </span>
          <span
            className="diag-count-i"
            title={t("diagnostics.infoTitle")}
            aria-label={t("diagnostics.infoEvents", { count: infoCount })}
          >
            {t("diagnostics.infoEvents", { count: infoCount })}
          </span>
        </div>
      </div>

      <div className="diag-toolbar">
        <div
          className="diag-severity-group"
          role="group"
          aria-label={t("diagnostics.severity")}
        >
          {DIAG_LEVELS.map((lvl) => (
            <Button
              type="button"
              key={lvl}
              variant={levelFilter === lvl ? "default" : "ghost"}
              className={`diag-filter-btn${levelFilter === lvl ? " active" : ""}${lvl === "Error" ? " f-error" : ""}${lvl === "Warn" ? " f-warn" : ""}`}
              aria-pressed={levelFilter === lvl}
              onClick={() => setLevelFilter(lvl)}
            >
              {t(`diagnostics.levels.${lvl}`)}
            </Button>
          ))}
        </div>
      </div>
      <div className="diag-search-field">
        <Input
          className="diag-search"
          type="search"
          placeholder={t("diagnostics.searchPlaceholder")}
          aria-label={t("diagnostics.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div
        className="log-box"
        ref={logBoxRef}
        tabIndex={0}
        role="log"
        aria-label={t("diagnostics.log")}
        onScroll={(event) => {
          const box = event.currentTarget;
          if (
            autoScroll &&
            box.scrollHeight - box.scrollTop - box.clientHeight > 24
          ) {
            setAutoScroll(false);
          }
        }}
        aria-live={autoScroll ? "polite" : "off"}
      >
        {filtered.length === 0 ? (
          <div className="diag-empty">
            {events.length === 0
              ? t("diagnostics.empty")
              : t("diagnostics.noMatch")}
          </div>
        ) : (
          filtered.map((event, index) => (
            <div
              key={`${index}-${event.timestamp}-${event.level}-${event.message}`}
              className={`log-line log-line-${event.level.toLowerCase()}`}
            >
              <div className="diag-event-meta">
                <span className="log-ts" title={event.timestamp}>
                  {formatDiagnosticTimestamp(event.timestamp)}
                </span>
                <span className="log-level">{event.level}</span>
              </div>
              <DiagnosticMessage
                message={`[${event.source}] ${event.message}`}
              />
            </div>
          ))
        )}
      </div>

      <div className="diag-footer">
        {!autoScroll && (
          <Button variant="ghost" onClick={() => setAutoScroll(true)}>
            {t("diagnostics.jumpLatest")}
          </Button>
        )}
        <span>
          {t("diagnostics.eventCount", {
            shown: filtered.length,
            count: events.length,
          })}
          {levelFilter !== "All" &&
            ` · ${t(`diagnostics.levels.${levelFilter}`)}`}
          {/* eslint-disable-next-line i18next/no-literal-string -- Separator and quoted user input only. */}
          {search && ` · "${search}"`}
        </span>
        <label className="diag-follow" htmlFor="diagnostics-follow">
          {t("diagnostics.follow")}
          <Switch
            id="diagnostics-follow"
            label={t("diagnostics.follow")}
            checked={autoScroll}
            onCheckedChange={setAutoScroll}
          />
        </label>
      </div>
      <div className="diag-report-actions">
        {" "}
        <Button
          type="button"
          className="diag-copy-btn"
          onClick={copyToClipboard}
          disabled={copyState === "copying"}
          title={t("diagnostics.copyDescription")}
          aria-live="polite"
        >
          <Icon name={copyState === "copied" ? "check" : "content_copy"} />
          <span>{copyLabel}</span>
        </Button>
        <Button
          type="button"
          variant="danger"
          size="icon"
          title={t("diagnostics.clear")}
          aria-label={t("diagnostics.clear")}
          onClick={clearLogs}
        >
          <Icon name="delete" />
        </Button>
      </div>
    </section>
  );
}
