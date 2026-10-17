import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

describe("diagnostics viewer", () => {
  it("labels severity filters, search, and the follow-log switch", () => {
    const html = renderToStaticMarkup(createElement(DiagnosticsPanel));
    expect(html).toContain('aria-label="Filter by severity"');
    expect(html).toContain('aria-label="Search logs"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="Follow log"');
    expect(html).toContain('aria-label="Clear logs"');
    expect(html).toContain("Copy report");
    expect(html).toContain("0 errors");
    expect(html).toContain("No logs recorded.");
    expect(html).toContain("Advanced / debug");
    expect(html).toContain("Auto-discard EQ edits");
    expect(html).toContain("Off when the app restarts.");
  });
});
