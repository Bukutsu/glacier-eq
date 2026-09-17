import { describe, expect, it } from "vitest";
import {
  appendDiagnosticEvent,
  DIAGNOSTIC_EVENT_LIMIT,
  mergeDiagnosticEvents,
  parseDiagnosticEvent,
  parseDiagnosticHistory,
  settleDiagnosticClear,
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

describe("appendDiagnosticEvent", () => {
  it("bounds pending history/clear buffers on every arrival, not only on settlement", () => {
    let buffered: DiagnosticEvent[] = [];
    for (let index = 0; index < 3_000; index += 1) {
      buffered = appendDiagnosticEvent(buffered, diagnostic(String(index)));
      expect(buffered.length).toBe(Math.min(index + 1, DIAGNOSTIC_EVENT_LIMIT));
    }
    expect(buffered[0].message).toBe("2000");
    expect(buffered.at(-1)?.message).toBe("2999");
    expect(mergeDiagnosticEvents([diagnostic("history")], buffered)).toEqual(buffered);
  });

  it("does not mutate the previous displayed events", () => {
    const previous = [diagnostic("old")];
    expect(appendDiagnosticEvent(previous, diagnostic("new"))).toEqual([
      diagnostic("old"), diagnostic("new"),
    ]);
    expect(previous).toEqual([diagnostic("old")]);
  });
});

describe("settleDiagnosticClear", () => {
  it("restores events received during a failed clear alongside the existing log", () => {
    const events = [diagnostic("existing")];
    const buffered = [diagnostic("during clear")];
    expect(settleDiagnosticClear({ events, buffered, outcome: "failed" })).toEqual([
      ...events, ...buffered,
    ]);
    expect(events).toEqual([diagnostic("existing")]);
    expect(buffered).toEqual([diagnostic("during clear")]);
    expect(settleDiagnosticClear({ events, buffered: [], outcome: "failed" })).toEqual(events);
  });

  it("discards only the old log after a successful clear", () => {
    const buffered = [diagnostic("during clear")];
    expect(settleDiagnosticClear({
      events: [diagnostic("existing")], buffered, outcome: "cleared",
    })).toEqual(buffered);
    expect(settleDiagnosticClear({
      events: [diagnostic("existing")], buffered: [], outcome: "cleared",
    })).toEqual([]);
  });

  it("caps restored events at the display retention limit", () => {
    const events = Array.from({ length: DIAGNOSTIC_EVENT_LIMIT }, (_, index) => diagnostic(String(index)));
    const buffered = [diagnostic("during clear")];
    const restored = settleDiagnosticClear({ events, buffered, outcome: "failed" });
    expect(restored).toHaveLength(DIAGNOSTIC_EVENT_LIMIT);
    expect(restored[0]).toEqual(events[1]);
    expect(restored.at(-1)).toEqual(buffered[0]);
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
