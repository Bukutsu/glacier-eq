import { describe, expect, it } from "vitest";
import {
  mergeDiagnosticEvents,
  parseDiagnosticEvent,
  parseDiagnosticHistory,
  type DiagnosticEvent,
} from "./diagnostics";

function diagnostic(message: string): DiagnosticEvent {
  return {
    timestamp: `2026-01-01T00:00:00.${message}Z`,
    level: "Info",
    source: "UI",
    message,
  };
}

describe("diagnostic payload parsing", () => {
  it("validates live events and history arrays", () => {
    const event = diagnostic("valid");
    expect(parseDiagnosticEvent(event)).toEqual(event);
    expect(parseDiagnosticHistory([event])).toEqual([event]);
    expect(() => parseDiagnosticEvent({ ...event, level: "Debug" })).toThrow();
    expect(() => parseDiagnosticHistory({ event })).toThrow();
  });
});

describe("mergeDiagnosticEvents", () => {
  it("keeps history order and appends buffered events", () => {
    expect(mergeDiagnosticEvents(
      [diagnostic("history")],
      [diagnostic("live")],
    ).map((event) => event.message)).toEqual(["history", "live"]);
  });

  it("deduplicates events present in history and the live buffer", () => {
    const overlap = diagnostic("overlap");
    expect(mergeDiagnosticEvents(
      [diagnostic("history"), overlap],
      [overlap, diagnostic("live")],
    ).map((event) => event.message)).toEqual(["history", "overlap", "live"]);
  });

  it("keeps only the newest events at the limit", () => {
    expect(mergeDiagnosticEvents(
      [diagnostic("one"), diagnostic("two")],
      [diagnostic("three")],
      2,
    ).map((event) => event.message)).toEqual(["two", "three"]);
  });
});
