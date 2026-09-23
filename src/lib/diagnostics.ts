export const DIAGNOSTIC_LEVELS = ["Info", "Warn", "Error"] as const;
export type DiagnosticLevel = (typeof DIAGNOSTIC_LEVELS)[number];

/**
 * `Storage` is emitted by the web backend's quarantine path; the other
 * sources mirror the desktop `LogSource` enum.
 */
export const DIAGNOSTIC_SOURCES = [
  "UI",
  "Worker",
  "HID",
  "AutoEQ",
  "Device",
  "Storage",
] as const;
export type DiagnosticSource = (typeof DIAGNOSTIC_SOURCES)[number];

export interface DiagnosticEvent {
  /** Backend-assigned monotonic ID; absent in legacy payloads. */
  seq?: number;
  timestamp: string;
  level: DiagnosticLevel;
  source: DiagnosticSource;
  message: string;
}

export interface DiagnosticContext {
  app_version: string;
  runtime: string;
  platform: string;
  architecture: string | null;
  device_name: string | null;
  device_id: string | null;
  protocol: string | null;
  transport: string | null;
}

export const DIAGNOSTIC_EVENT_LIMIT = 1_000;

/** Apply the same retention bound to pending buffers and the displayed log. */
export function appendDiagnosticEvent(
  events: DiagnosticEvent[],
  event: DiagnosticEvent,
): DiagnosticEvent[] {
  return [...events.slice(-(DIAGNOSTIC_EVENT_LIMIT - 1)), event];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Union membership check shared by the parser and the web command boundary. */
export function isDiagnosticLevel(value: unknown): value is DiagnosticLevel {
  return DIAGNOSTIC_LEVELS.includes(value as DiagnosticLevel);
}

/** Union membership check shared by the parser and the web command boundary. */
export function isDiagnosticSource(value: unknown): value is DiagnosticSource {
  return DIAGNOSTIC_SOURCES.includes(value as DiagnosticSource);
}

export function parseDiagnosticEvent(value: unknown): DiagnosticEvent {
  if (
    !isRecord(value) ||
    (value.seq !== undefined &&
      (typeof value.seq !== "number" || !Number.isSafeInteger(value.seq) || value.seq <= 0)) ||
    typeof value.timestamp !== "string" ||
    !isDiagnosticLevel(value.level) ||
    !isDiagnosticSource(value.source) ||
    typeof value.message !== "string"
  ) {
    throw new Error("Invalid diagnostic event payload");
  }
  return {
    ...(typeof value.seq === "number" ? { seq: value.seq } : {}),
    timestamp: value.timestamp,
    level: value.level,
    source: value.source,
    message: value.message,
  };
}

export function parseDiagnosticHistory(value: unknown): DiagnosticEvent[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid diagnostics history payload");
  }
  return value.map(parseDiagnosticEvent);
}

function eventKey(event: DiagnosticEvent): string {
  // Prefer the backend sequence ID: two distinct events can share a
  // millisecond timestamp and identical content.
  if (event.seq !== undefined) return `seq:${event.seq}`;
  return JSON.stringify([
    event.timestamp,
    event.level,
    event.source,
    event.message,
  ]);
}

export function mergeDiagnosticEvents(
  history: DiagnosticEvent[],
  buffered: DiagnosticEvent[],
  limit = DIAGNOSTIC_EVENT_LIMIT,
): DiagnosticEvent[] {
  const seen = new Set<string>();
  const merged: DiagnosticEvent[] = [];
  for (const event of [...history, ...buffered]) {
    const key = eventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(event);
  }
  return merged.slice(-limit);
}

export function settleDiagnosticClear({
  events,
  buffered,
  outcome,
}: {
  events: DiagnosticEvent[];
  buffered: DiagnosticEvent[];
  outcome: "cleared" | "failed";
}): DiagnosticEvent[] {
  return mergeDiagnosticEvents(outcome === "cleared" ? [] : events, buffered);
}

export function formatDiagnosticReport(
  events: DiagnosticEvent[],
  context: DiagnosticContext,
  generatedAt = new Date(),
): string {
  const platform = context.architecture
    ? `${context.platform} (${context.architecture})`
    : context.platform;
  const device = context.device_name
    ? `${context.device_name}${context.device_id ? ` (${context.device_id})` : ""}`
    : "Not connected";
  const details = [
    "Glacier EQ diagnostic report",
    `Generated: ${generatedAt.toISOString()}`,
    `App: ${context.app_version}`,
    `Runtime: ${context.runtime}`,
    `Platform: ${platform}`,
    `Device: ${device}`,
  ];
  if (context.protocol) details.push(`Protocol: ${context.protocol}`);
  if (context.transport) details.push(`Transport: ${context.transport}`);
  details.push("", `Events (${events.length}):`, "----------------------------------------");

  return `${details.join("\n")}\n${events
    .map((event) => `${event.timestamp} [${event.level.toUpperCase()}] [${event.source}] ${event.message}`)
    .join("\n")}`;
}
