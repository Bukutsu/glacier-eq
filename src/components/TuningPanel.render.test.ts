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

describe("Tuning workflow", () => {
  it("guides the user through measurement, target, and generation in order", () => {
    const html = render();
    expect(html).toContain('<h2 id="tuning-title">Headphone tuning</h2>');
    const steps = [...html.matchAll(/<legend>.*?<\/span>([^<]+)<\/legend>/g)]
      .map(([, title]) => title);
    expect(steps).toEqual(["Measurement", "Target curve", "Generate EQ"]);
    expect(html.match(/<fieldset/g)).toHaveLength(3);
    expect(html).toContain("Add a headphone measurement");
    expect(html).toContain("Add measurement</button>");
    expect(html).toContain("Search the measurement database or import a frequency-response file.");
    expect(html).toContain('class="btn filled tuning-generate" disabled=""');
  });

  it("uses a named native form and enables generation with valid inputs", () => {
    const html = render({ measurements: [measurement] });
    expect(html).toContain('<form class="tuning-form" aria-labelledby="tuning-title" aria-busy="false">');
    expect(html).toContain('type="submit" class="btn filled tuning-generate"');
    expect(html).not.toContain('class="btn filled tuning-generate" disabled');
    expect(html).toMatch(/<option value="headphone"[^>]* selected=""/);
    expect(html).toContain("2 frequency points");
    expect(html).toContain("Add another</button>");
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain("The DAC is not changed.");
  });

  it("offers a direct add action when targets are missing", () => {
    const html = render({ measurements: [measurement], allTargets: [] });
    expect(html).toContain("Add a target to continue");
    expect(html).toContain("Add target</button>");
    expect(html).toContain('class="btn filled tuning-generate" disabled=""');
  });

  it("keeps headphone type visible with plain labels and an explicit selection", () => {
    const html = render();
    expect(html).toContain('role="group" aria-labelledby="tuning-smoothing-label"');
    expect(html).toContain('aria-pressed="true" class="active">In-ear</button>');
    expect(html).toContain('aria-pressed="false" class="">Over-ear</button>');
    expect(html).toContain('aria-pressed="false" class="">Off</button>');
  });

  it("puts advanced controls and graph comparisons behind separate disclosures", () => {
    const html = render();
    expect(html).toContain("Advanced settings");
    expect(html).toContain("Compare curves");
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
    expect(html.match(/class="app-collapse-content" hidden=""/g)).toHaveLength(2);
    expect(html.indexOf("Generate EQ")).toBeLessThan(html.indexOf("Compare curves"));
    expect(html).toContain("This does not change the inputs used to generate EQ.");
  });

  it("previews advanced values without the old boxed compact disclosure", () => {
    const html = render({ dspSampleRate: 44100 });
    expect(html).toContain('class="app-collapse tuning-advanced"');
    expect(html).toContain("2,000 steps at 44.1 kHz");
    expect(html).toContain("Additional steps increase calculation time.");
    expect(html).toContain("Use the DAC’s DSP sample rate.");
    expect(html.match(/class="tuning-advanced-field"/g)).toHaveLength(2);
  });

  it("respects the device band limit and DSP sample rate", () => {
    const html = render({ measurements: [measurement], maxBands: 5, dspSampleRate: 48000 });
    expect(html).toContain("Maximum: 5 bands.");
    expect(html).toContain('aria-valuemax="5" aria-valuenow="5"');
    expect(html).toMatch(/<option value="48000"[^>]* selected=""/);
  });

  it("keeps selected EQ inputs independent from graph visibility", () => {
    const html = render({
      measurements: [{ ...measurement, visible: false }],
      activeTargetIds: [BUILTIN_TARGETS[1].id],
    });
    expect(html).toMatch(/<option value="headphone"[^>]* selected=""/);
    expect(html).toContain("1 shown");
    expect(html).not.toContain('class="btn filled tuning-generate" disabled');
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
