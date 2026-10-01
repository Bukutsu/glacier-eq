import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TuningPanel } from "./ToolsPanel";
import { BUILTIN_TARGETS } from "../lib/builtinTargets";

vi.mock("@glacier-eq/backend", () => ({ invoke: vi.fn(), listen: vi.fn(async () => () => {}) }));

const props: Parameters<typeof TuningPanel>[0] = {
  measurements: [],
  allTargets: BUILTIN_TARGETS,
  activeTargetIds: [],
  onImportPEQ: () => true,
  setStatus: () => {},
  getAsyncContext: () => ({ editorRevision: 0, connectionRevision: 0, operationRevision: 0 }),
  onRemoveMeasurement: () => {},
  onToggleMeasurement: () => {},
  onClearMeasurements: () => {},
  onRemoveTarget: () => {},
  onToggleTarget: () => {},
  onAddMeasurement: () => {},
};

function render(overrides: Partial<typeof props> = {}) {
  return renderToStaticMarkup(createElement(TuningPanel, { ...props, ...overrides }));
}

describe("Tuning workflow", () => {
  it("puts the match form and add action before the collapsed curve library", () => {
    const html = render();
    expect(html).toContain('<h2 id="autoeq-title">Match to target</h2>');
    expect(html).toContain("Add a measurement to start");
    expect(html).toContain("Add measurement</button>");
    expect(html.indexOf("autoeq-match-card")).toBeLessThan(html.indexOf("tuning-library"));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="app-collapse-content" hidden=""');
    expect(html).toContain("Checked curves are shown on the graph");
  });

  it("uses a named native form and enables generation with valid inputs", () => {
    const html = render({ measurements: [{
      id: "headphone", name: "Headphone", color: "red", visible: true,
      points: [{ freq: 20, db: 0 }, { freq: 1000, db: 0 }],
    }] });
    expect(html).toContain('<form class="tool-card autoeq-match-card" aria-labelledby="autoeq-title">');
    expect(html).toContain('type="submit" class="btn filled autoeq-run-btn"');
    expect(html).not.toContain('class="btn filled autoeq-run-btn" disabled');
    expect(html).toMatch(/<option value="headphone"[^>]* selected=""/);
    expect(html).toContain('role="status" aria-live="polite"');
  });

  it("keeps the empty target boundary usable without enabling generation", () => {
    const html = render({ allTargets: [] });
    expect(html).toContain("Add a target to continue");
    expect(html).toContain('class="btn filled autoeq-run-btn" disabled=""');
  });
});
