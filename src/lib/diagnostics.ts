export interface DiagnosticEvent {
  timestamp: string;
  level: "Info" | "Warn" | "Error";
  source: "UI" | "Worker" | "HID" | "AutoEQ" | "Device";
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseDiagnosticEvent(value: unknown): DiagnosticEvent {
  if (
    !isRecord(value) ||
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
  limit = 1_000,
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
