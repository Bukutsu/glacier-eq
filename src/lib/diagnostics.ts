export interface DiagnosticEvent {
  /** Backend-assigned monotonic ID; absent in legacy payloads. */
  seq?: number;
  timestamp: string;
  level: "Info" | "Warn" | "Error";
  source: "UI" | "Worker" | "HID" | "AutoEQ" | "Device";
  message: string;
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

export function parseDiagnosticEvent(value: unknown): DiagnosticEvent {
  if (
    !isRecord(value) ||
    (value.seq !== undefined &&
      (typeof value.seq !== "number" || !Number.isSafeInteger(value.seq) || value.seq <= 0)) ||
    typeof value.timestamp !== "string" ||
    (value.level !== "Info" && value.level !== "Warn" && value.level !== "Error") ||
    (
      value.source !== "UI" &&
      value.source !== "Worker" &&
      value.source !== "HID" &&
      value.source !== "AutoEQ" &&
      value.source !== "Device"
    ) ||
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
