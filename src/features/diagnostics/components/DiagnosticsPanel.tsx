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
    return <span className="leg:[word-break:break-word] leg:whitespace-pre-wrap leg:text-[color:inherit] cmp:[.diagnostics-view_&]:min-w-[0] cmp:[.diagnostics-view_&]:w-[100%] cmp:[.diagnostics-view_&]:text-[length:12px] cmp:[.diagnostics-view_&]:leading-[1.6]">{message}</span>;
  }

  return (
    <details className="log-details leg:min-w-[0] cmp:[.diagnostics-view_&]:min-w-[0] cmp:[.diagnostics-view_&]:w-[100%] cmp:[.diagnostics-view_&]:text-[length:12px] cmp:[.diagnostics-view_&]:leading-[1.6]">
      <summary className="leg:[word-break:break-word] leg:whitespace-pre-wrap leg:text-[color:inherit] cmp:[.diagnostics-view_&]:min-w-[0] cmp:[.diagnostics-view_&]:w-[100%] cmp:[.diagnostics-view_&]:text-[length:12px] cmp:[.diagnostics-view_&]:leading-[1.6]">
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
    <section className="diagnostics-view cmp:[.modal-content_&]:flex cmp:[.modal-content_&]:flex-col cmp:[.modal-content_&]:flex-[1] cmp:[.modal-content_&]:min-h-[0] cmp:[.modal-content_&]:p-[0_var(--space-4)_var(--space-4)] cmp:[.modal-content_&]:gap-[var(--space-3)] cmp:[.modal-content_&]:overflow-hidden">
      <details className="debug-eq-options leg:[border:1px_solid_var(--line-soft)] leg:rounded-[var(--radius-card)]">
        <summary>{t("diagnostics.advanced")}</summary>
        <ToggleRow
          title={t("diagnostics.autoDiscard")}
          desc={t("diagnostics.autoDiscardDescription")}
          checked={autoDiscardEq}
          onChange={setAutoDiscardEq}
        />
      </details>
      <div className="diag-head leg:grid leg:grid-cols-[minmax(0,_1fr)_auto_auto_auto] leg:items-center leg:gap-[8px] leg:compact:grid-cols-[minmax(0,_1fr)_auto_36px] cmp:[.modal-content_&]:flex-wrap cmp:[.modal-content_&]:gap-[var(--space-2)] cmp:[.modal-content_&]:p-[var(--space-4)] cmp:[.modal-content_&]:[background:transparent] cmp:[.modal-content_.diagnostics-view_&]:p-[0] cmp:[.modal-content_.diagnostics-view_&]:block">
        <div className="diag-counts leg:flex leg:items-center leg:gap-[12px] leg:text-[length:var(--type-caption)] leg:[font-family:var(--font-mono)] leg:compact:[grid-column:1_/_-1] leg:compact:row-[2] cmp:[.diagnostics-view_&]:flex cmp:[.diagnostics-view_&]:flex-wrap cmp:[.diagnostics-view_&]:gap-[var(--space-3)] cmp:[.diagnostics-view_&]:[font:inherit] cmp:[.diagnostics-view_&&]:text-[length:var(--type-small)]">
          <span
            className="leg:text-[color:var(--destructive-foreground)]"
            title={t("diagnostics.errorsTitle")}
            aria-label={t("diagnostics.errors", { count: errorCount })}
          >
            {t("diagnostics.errors", { count: errorCount })}
          </span>
          <span
            className="leg:text-[color:var(--warning-foreground)]"
            title={t("diagnostics.warningsTitle")}
            aria-label={t("diagnostics.warnings", { count: warnCount })}
          >
            {t("diagnostics.warnings", { count: warnCount })}
          </span>
          <span
            className="leg:text-[color:var(--comment)]"
            title={t("diagnostics.infoTitle")}
            aria-label={t("diagnostics.infoEvents", { count: infoCount })}
          >
            {t("diagnostics.infoEvents", { count: infoCount })}
          </span>
        </div>
      </div>

      <div className="leg:grid leg:grid-cols-[auto_auto_auto_auto_1fr_auto] leg:gap-[1px] leg:[background:var(--line-strong)] leg:compact:grid-cols-[repeat(4,_minmax(0,_1fr))_38px] cmp:[.modal-content_&]:flex-wrap cmp:[.modal-content_&]:gap-[var(--space-2)] cmp:[.modal-content_&]:p-[var(--space-3)_var(--space-4)] cmp:[.modal-content_&]:[background:transparent] cmp:[.modal-content_.diagnostics-view_&]:block cmp:[.modal-content_.diagnostics-view_&]:p-[0] cmp:[.modal-content_.diagnostics-view_&]:[background:transparent]">
        <div
          className="diag-severity-group cmp:[.diagnostics-view_&]:flex cmp:[.diagnostics-view_&]:gap-[2px] cmp:[.diagnostics-view_&]:p-[3px] cmp:[.diagnostics-view_&]:[background:var(--accent)] cmp:[.diagnostics-view_&]:rounded-[var(--control-radius)]"
          role="group"
          aria-label={t("diagnostics.severity")}
        >
          {DIAG_LEVELS.map((lvl) => (
            <Button
              type="button"
              key={lvl}
              variant={levelFilter === lvl ? "default" : "ghost"}
              className={`leg:compact:min-h-[44px] cmp:[.diagnostics-view_.diag-severity-group_&]:flex-[1] cmp:[.diagnostics-view_.diag-severity-group_&]:min-w-[0] cmp:[.diagnostics-view_.diag-severity-group_&]:min-h-[44px] cmp:[.diagnostics-view_.diag-severity-group_&]:[border:0] cmp:[.diagnostics-view_.diag-severity-group_&]:[background:transparent] cmp:[.diagnostics-view_.diag-severity-group_&]:[font-family:var(--font-ui)] cmp:[.diagnostics-view_.diag-severity-group_&]:text-[color:var(--muted-foreground)] cmp:[.diagnostics-view_.diag-severity-group_&]:p-[0_8px] cmp:[.diagnostics-view_.diag-severity-group_&.active]:[background:var(--popover)] cmp:[.diagnostics-view_.diag-severity-group_&.active]:text-[color:var(--foreground)] cmp:[.diagnostics-view_.diag-severity-group_&.active]:[box-shadow:var(--shadow-sm)] ${levelFilter === lvl ? " active" : ""}${lvl === "Error" ? " f-error" : ""}${lvl === "Warn" ? " f-warn" : ""}`}
              aria-pressed={levelFilter === lvl}
              onClick={() => setLevelFilter(lvl)}
            >
              {t(`diagnostics.levels.${lvl}`)}
            </Button>
          ))}
        </div>
      </div>
      <div className="cmp:flex-[1_1_140px] cmp:min-w-[140px] cmp:[.diagnostics-view_&]:flex-[0_0_auto] cmp:[.diagnostics-view_&]:min-w-[0] cmp:[.diagnostics-view_&]:w-[100%] cmp:[.diagnostics-view_&]:order-[-1]">
        <Input
          className="leg:w-[100%] leg:h-[38px] leg:[border:0] leg:[background:var(--input-bg,_var(--surface-soft))] leg:text-[color:var(--text)] leg:p-[0_10px] leg:[outline:0] leg:text-[length:var(--type-small)] leg:[font-family:var(--font-mono)] leg:[&::placeholder]:text-[color:var(--muted)] leg:[&::placeholder]:opacity-[1] leg:[&:focus]:[background:var(--input-bg,_var(--bg-dark))] leg:compact:text-[length:16px]! leg:pointer-coarse:[&&]:text-[length:16px]! leg:compact:[grid-column:1_/_-2] leg:compact:row-[2] cmp:[.diagnostics-view_&]:[border:1px_solid_var(--input)] cmp:[.diagnostics-view_&]:rounded-[var(--control-radius)] cmp:[.diagnostics-view_&]:h-[44px] cmp:[.diagnostics-view_&]:[font-family:var(--font-ui)] cmp:[.diagnostics-view_&]:[background:var(--field-background)]"
          type="search"
          placeholder={t("diagnostics.searchPlaceholder")}
          aria-label={t("diagnostics.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div
        className="log-box leg:[background:var(--bg-dark)] leg:overflow-y-auto leg:min-h-[0] leg:flex-[1] leg:[outline:1px_solid_var(--line-soft)] leg:[outline-offset:-1px] leg:[scroll-behavior:smooth] leg:[&:focus-visible]:[outline:1px_solid_var(--focus-ring)] leg:[&:focus-visible]:[outline-offset:-1px] leg:max-[960px]:max-h-[38vh] cmp:[.diagnostics-view_&]:flex-[1] cmp:[.diagnostics-view_&]:min-h-[0] cmp:[.diagnostics-view_&]:max-h-[none] cmp:[.diagnostics-view_&]:overflow-y-auto cmp:[.diagnostics-view_&]:[border:1px_solid_var(--border)] cmp:[.diagnostics-view_&]:rounded-[var(--control-radius)] cmp:[.diagnostics-view_&]:[background:transparent] cmp:[.diagnostics-view_&]:[outline:none] cmp:[.diagnostics-view_&]:[scroll-behavior:auto] cmp:[.diagnostics-view_&]:[overscroll-behavior:contain] cmp:[.diagnostics-view_&:focus-visible]:[outline:2px_solid_var(--ring)] cmp:[.diagnostics-view_&:focus-visible]:[outline-offset:-2px]"
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
          <div className="leg:p-[12px] leg:text-[color:var(--muted)] leg:text-[length:var(--type-label)] leg:[font-family:var(--font-ui)] cmp:[.diagnostics-view_&]:grid cmp:[.diagnostics-view_&]:[place-items:center] cmp:[.diagnostics-view_&]:min-h-[120px] cmp:[.diagnostics-view_&]:p-[16px]">
            {events.length === 0
              ? t("diagnostics.empty")
              : t("diagnostics.noMatch")}
          </div>
        ) : (
          filtered.map((event, index) => (
            <div
              key={`${index}-${event.timestamp}-${event.level}-${event.message}`}
              className={`log-line leg:m-[0] leg:p-[6px_10px] leg:grid leg:grid-cols-[96px_46px_minmax(0,_1fr)] leg:gap-[8px] leg:[align-items:start] leg:text-[color:var(--comment)] leg:text-[length:var(--type-caption)] leg:[font-family:var(--font-mono)] leg:[.log-line+&]:[border-top:1px_solid_var(--line-subtle)] leg:[&:hover]:[background:var(--hover-bg)] leg:[&.log-line-error]:text-[color:var(--destructive-foreground)] leg:[&&.log-line-warn]:text-[color:var(--warning-foreground)] leg:compact:grid-cols-[1fr] leg:compact:gap-[3px] cmp:[.diagnostics-view_&]:flex cmp:[.diagnostics-view_&]:flex-col cmp:[.diagnostics-view_&]:gap-[6px] cmp:[.diagnostics-view_&]:p-[12px] cmp:[.diagnostics-view_&]:text-[color:var(--foreground)] log-line-${event.level.toLowerCase()}`}
            >
              <div className="cmp:[.diagnostics-view_&]:flex cmp:[.diagnostics-view_&]:flex-wrap cmp:[.diagnostics-view_&]:items-baseline cmp:[.diagnostics-view_&]:gap-[12px]">
                <span className="leg:text-[color:var(--comment)] leg:shrink-0 leg:text-[length:var(--type-caption)] leg:whitespace-nowrap cmp:[.diagnostics-view_&]:text-[length:11px] cmp:[.diagnostics-view_&]:[font-variant-numeric:tabular-nums] cmp:[.diagnostics-view_&]:text-[color:var(--muted-foreground)]" title={event.timestamp}>
                  {formatDiagnosticTimestamp(event.timestamp)}
                </span>
                <span className="leg:text-[length:var(--type-caption)] leg:font-semibold leg:tracking-[0.04em] leg:uppercase leg:[.log-line.log-line-error_&]:text-[color:var(--destructive-foreground)] leg:[.log-line.log-line-warn_&&]:text-[color:var(--warning-foreground)] leg:[.log-line:not(.log-line-error):not(.log-line-warn)_&&]:text-[color:var(--comment)] cmp:[.diagnostics-view_&]:[font-family:var(--font-ui)] cmp:[.diagnostics-view_&]:text-[length:11px] cmp:[.diagnostics-view_&]:tracking-[0] cmp:[.diagnostics-view_&]:normal-case">{event.level}</span>
              </div>
              <DiagnosticMessage
                message={`[${event.source}] ${event.message}`}
              />
            </div>
          ))
        )}
      </div>

      <div className="leg:text-[length:var(--type-caption)] leg:text-[color:var(--comment)] leg:pt-[2px] leg:text-right leg:[font-family:var(--font-ui)] cmp:[.diagnostics-view_&]:flex cmp:[.diagnostics-view_&]:justify-between cmp:[.diagnostics-view_&]:items-center cmp:[.diagnostics-view_&]:flex-wrap cmp:[.diagnostics-view_&]:gap-[8px] cmp:[.diagnostics-view_&]:p-[0] cmp:[.diagnostics-view_&]:text-left cmp:[.diagnostics-view_&]:text-[length:var(--type-small)]">
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
        <label className="cmp:[.diagnostics-view_&]:flex cmp:[.diagnostics-view_&]:items-center cmp:[.diagnostics-view_&]:gap-[8px] cmp:[.diagnostics-view_&]:min-h-[44px] cmp:[.diagnostics-view_&]:text-[color:var(--muted-foreground)]" htmlFor="diagnostics-follow">
          {t("diagnostics.follow")}
          <Switch
            id="diagnostics-follow"
            label={t("diagnostics.follow")}
            checked={autoScroll}
            onCheckedChange={setAutoScroll}
          />
        </label>
      </div>
      <div className="diag-report-actions cmp:[.diagnostics-view_&]:flex cmp:[.diagnostics-view_&]:gap-[8px]">
        {" "}
        <Button
          type="button"
          className="leg:[.diag-head_&]:w-[auto] leg:[.diag-head_&]:p-[0_10px] leg:[.diag-head_&]:inline-flex leg:[.diag-head_&]:items-center leg:[.diag-head_&]:gap-[6px] leg:[.diag-head_&]:whitespace-nowrap leg:[.diag-head_&]:text-[length:var(--type-caption)] cmp:[.diagnostics-view_.diag-report-actions_&]:flex-[1]"
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
