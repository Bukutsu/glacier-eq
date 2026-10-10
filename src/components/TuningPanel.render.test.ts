import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TuningPanel } from "./TuningPanel";
import { BUILTIN_TARGETS } from "../lib/builtinTargets";
import type { MeasurementTrace } from "../types";

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

const measurement: MeasurementTrace = {
  id: "headphone", name: "Headphone", color: "red", visible: true,
  points: [{ freq: 20, db: 0 }, { freq: 1000, db: 0 }],
};

function render(overrides: Partial<typeof props> = {}) {
  return renderToStaticMarkup(createElement(TuningPanel, { ...props, ...overrides }));
}

function submitButton(html: string) {
  return html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "";
}

describe("Tuning workflow", () => {
  it("puts inputs before settings and generation, without the numbered stepper", () => {
    const html = render();
    expect(html).toContain('<h2 id="tuning-title">Headphone tuning</h2>');
    expect(html.indexOf(">Measurement</span>")).toBeLessThan(html.indexOf(">Target curve</label>"));
    expect(html.indexOf(">Target curve</label>")).toBeLessThan(html.indexOf(">Filter bands</label>"));
    expect(html.indexOf(">Filter bands</label>")).toBeLessThan(html.indexOf(">Generate EQ</button>"));
    expect(html).not.toContain("tuning-step-number");
    expect(html).toContain("Add measurement</button>");
    expect(html).toContain("Search the database or import a frequency-response file.");
    expect(submitButton(html)).toContain('disabled=""');
    expect(html).toContain("Add a measurement to generate EQ.");
  });

  it("uses shared buttons and a named native form with valid inputs", () => {
    const html = render({ measurements: [measurement] });
    expect(html).toContain('<form class="tuning-form" aria-labelledby="tuning-title" aria-busy="false">');
    expect(submitButton(html)).toContain('data-slot="button"');
    expect(submitButton(html)).toContain('data-variant="primary"');
    expect(submitButton(html)).not.toContain('disabled=""');
    expect(html).toContain('for="autoeq-measurement">Measurement</label>');
    expect(html).toContain('class="app-select-value">Headphone</span>');
    expect(html).toContain('name="autoeq-measurement" value="headphone"');
    expect(html).toContain("Add another</button>");
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain('aria-describedby="tuning-destination"');
    expect(html).toContain("Loads EQ into the editor, not the DAC.");
  });

  it("offers a direct add action when targets are missing", () => {
    const html = render({ measurements: [measurement], allTargets: [] });
    expect(html).toContain("Add a target to continue");
    expect(html).toContain("Add target</button>");
    expect(submitButton(html)).toContain('disabled=""');
  });

  it("keeps smoothing choices visible with an explicit pressed state", () => {
    const html = render();
    expect(html).toContain('role="group" aria-labelledby="tuning-smoothing-label"');
    for (const [label, pressed] of [["In-ear", true], ["Over-ear", false], ["Off", false]]) {
      const button = html.match(new RegExp('<button[^>]*aria-pressed="' + pressed + '"[^>]*>' + label + '</button>'));
      expect(button, String(label)).not.toBeNull();
    }
  });

  it("keeps advanced controls and graph comparisons behind separate disclosures", () => {
    const html = render();
    expect(html).toContain("Advanced settings");
    expect(html).toContain("Compare curves");
    expect(html.match(/<button(?=[^>]*class="app-collapse-trigger")(?=[^>]*aria-expanded="false")[^>]*>/g)).toHaveLength(2);
    expect(html.match(/class="app-collapse-content" hidden=""/g)).toHaveLength(2);
    expect(html.indexOf(">Generate EQ</button>")).toBeLessThan(html.indexOf("Compare curves"));
    expect(html).toContain("Show curves on the graph without changing the EQ inputs.");
  });

  it("keeps optimizer details inside advanced settings rather than the closed heading", () => {
    const html = render({ dspSampleRate: 44100 });
    expect(html).toContain('class="app-collapse tuning-advanced"');
    expect(html).not.toContain("tuning-advanced-summary");
    expect(html).toContain("More steps take longer to calculate.");
    expect(html).toContain("Use the DAC&#x27;s DSP sample rate.");
    expect(html).toContain('name="autoeq-steps" value="2000"');
    expect(html).toContain('name="autoeq-fs" value="44100"');
  });

  it("respects the device band limit and DSP sample rate", () => {
    const html = render({ measurements: [measurement], maxBands: 5, dspSampleRate: 48000 });
    expect(html).toContain("Up to 5 bands");
    expect(html).toContain('aria-valuemax="5" aria-valuenow="5"');
    expect(html).toContain('name="autoeq-fs" value="48000"');
  });

  it("keeps selected EQ inputs independent from graph visibility", () => {
    const html = render({
      measurements: [{ ...measurement, visible: false }],
      activeTargetIds: [BUILTIN_TARGETS[1].id],
    });
    expect(html).toContain('class="app-select-value">Headphone</span>');
    expect(html).toContain('name="autoeq-measurement" value="headphone"');
    expect(html).toContain("1 shown");
    expect(submitButton(html)).not.toContain('disabled=""');
    expect(html).not.toContain('aria-label="Measurement: Headphone (2 points)" checked');
    expect(html).toContain('aria-label="Target: Diffuse Field" checked=""');
  });

  it("groups the curve library and only permits deleting custom targets", () => {
    const customTarget = { ...BUILTIN_TARGETS[0], id: "custom", name: "My target", builtIn: false };
    const html = render({ measurements: [measurement], allTargets: [BUILTIN_TARGETS[0], customTarget] });
    expect(html).toContain('aria-label="Delete Headphone"');
    expect(html).toContain('aria-label="Delete My target"');
    expect(html).not.toContain(`aria-label="Delete ${BUILTIN_TARGETS[0].name}"`);
    expect(html).toContain("Clear measurements</button>");
    expect(html).toContain('class="tuning-library-heading">Measurements');
    expect(html).toContain('class="tuning-library-heading">Targets');
  });
});
