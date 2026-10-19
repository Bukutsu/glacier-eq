import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TuningPanel } from "./TuningPanel";
import { BUILTIN_TARGETS } from "@/features/traces/lib/builtinTargets";
import type { MeasurementTrace } from "@/types";

vi.mock("@glacier-eq/backend", () => ({
  invoke: vi.fn(),
  listen: vi.fn(async () => () => {}),
}));

const props: Parameters<typeof TuningPanel>[0] = {
  measurements: [],
  allTargets: BUILTIN_TARGETS,
  activeTargetIds: [],
  onImportPEQ: () => true,
  setStatus: () => {},
  getAsyncContext: () => ({
    editorRevision: 0,
    connectionRevision: 0,
    operationRevision: 0,
  }),
  onAddMeasurement: () => {},
};

const measurement: MeasurementTrace = {
  id: "headphone",
  name: "Headphone",
  color: "red",
  visible: true,
  points: [
    { freq: 20, db: 0 },
    { freq: 1000, db: 0 },
  ],
};

function render(overrides: Partial<typeof props> = {}) {
  return renderToStaticMarkup(
    createElement(TuningPanel, { ...props, ...overrides }),
  );
}

function submitButton(html: string) {
  return html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "";
}

describe("Tuning workflow", () => {
  it("puts inputs before settings and generation, without the numbered stepper", () => {
    const html = render();
    expect(html).toContain('<h2 id="tuning-title">Headphone tuning</h2>');
    expect(html.indexOf(">Measurement</span>")).toBeLessThan(
      html.indexOf(">Target curve</label>"),
    );
    expect(html.indexOf(">Target curve</label>")).toBeLessThan(
      html.indexOf(">Filter bands</label>"),
    );
    expect(html.indexOf(">Filter bands</label>")).toBeLessThan(
      html.indexOf(">Generate EQ</button>"),
    );
    expect(html).not.toContain("tuning-step-number");
    expect(html).toContain("Add measurement or target</button>");
    expect(html).toContain(
      "Search the database or import a frequency-response file.",
    );
    expect(submitButton(html)).toContain('disabled=""');
    expect(html).toContain("Add a measurement to generate EQ.");
  });

  it("uses shared buttons and a named native form with valid inputs", () => {
    const html = render({ measurements: [measurement] });
    expect(html).toContain(
      '<form class="tuning-form" aria-labelledby="tuning-title" aria-busy="false">',
    );
    expect(submitButton(html)).toContain('data-slot="button"');
    expect(submitButton(html)).toContain('data-variant="primary"');
    expect(submitButton(html)).not.toContain('disabled=""');
    expect(html).toContain('for="autoeq-measurement">Measurement</label>');
    expect(html).toContain('class="app-select-value">Headphone</span>');
    expect(html).toContain('name="autoeq-measurement" value="headphone"');
    expect(html).toContain("Add measurement or target</button>");
    expect(html).not.toContain("Add another");
    const inputs =
      html.match(/<fieldset class="tuning-fields"[\s\S]*?<\/fieldset>/)?.[0] ??
      "";
    expect(inputs.match(/data-slot="button"/g)).toHaveLength(1);
    expect(inputs.indexOf("Add measurement or target")).toBeGreaterThan(
      inputs.indexOf('name="autoeq-target"'),
    );
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain('aria-describedby="tuning-destination"');
    expect(html).toContain("Loads EQ into the editor, not the DAC.");
  });

  it("keeps the shared add action available when targets are missing", () => {
    const html = render({ measurements: [measurement], allTargets: [] });
    expect(html).toContain("Add a target to continue");
    expect(html).toContain("Add measurement or target</button>");
    expect(submitButton(html)).toContain('disabled=""');
  });

  it("keeps smoothing choices visible with an explicit pressed state", () => {
    const html = render();
    expect(html).toContain(
      'role="group" aria-labelledby="tuning-smoothing-label"',
    );
    for (const [label, pressed] of [
      ["In-ear", true],
      ["Over-ear", false],
      ["Off", false],
    ]) {
      const button = html.match(
        new RegExp(
          '<button[^>]*aria-pressed="' +
            pressed +
            '"[^>]*>' +
            label +
            "</button>",
        ),
      );
      expect(button, String(label)).not.toBeNull();
    }
  });

  it("keeps advanced settings collapsed without a duplicate graph curve library", () => {
    const html = render();
    expect(html).toContain("Advanced settings");
    expect(
      html.match(
        /<button(?=[^>]*class="app-collapse-trigger")(?=[^>]*aria-expanded="false")[^>]*>/g,
      ),
    ).toHaveLength(1);
    expect(html.match(/class="app-collapse-content" hidden=""/g)).toHaveLength(
      1,
    );
    expect(html).not.toContain("Compare curves");
    expect(html).not.toContain("trace-list");
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

  it.each([1, 5])(
    "warns about limited-band AutoEQ at %i bands without blocking generation",
    (maxBands) => {
      const html = render({ measurements: [measurement], maxBands });
      expect(html).toContain("Limited-band AutoEQ");
      expect(html).toContain("large, opposing corrections");
      expect(html).toContain('id="tuning-band-warning"');
      expect(submitButton(html)).toContain(
        'aria-describedby="tuning-destination tuning-band-warning"',
      );
      expect(submitButton(html)).not.toContain('disabled=""');
    },
  );

  it("does not warn for higher band counts", () => {
    expect(render({ maxBands: 6 })).not.toContain("Limited-band AutoEQ");
    expect(render({ maxBands: 10 })).not.toContain("Limited-band AutoEQ");
  });

  it("respects the device band limit and DSP sample rate", () => {
    const html = render({
      measurements: [measurement],
      maxBands: 5,
      dspSampleRate: 48000,
    });
    expect(html).toContain("Up to 5 bands");
    expect(html).toContain('aria-valuemax="5" aria-valuenow="5"');
    expect(html).toContain('name="autoeq-fs" value="48000"');
  });

  it("keeps the selected measurement usable even when its curve is not shown", () => {
    // The graph follows the AutoEQ dropdown and the curve manager overrides
    // it; hiding a measurement never blocks it as the optimization input.
    const html = render({
      measurements: [{ ...measurement, visible: false }],
      activeTargetIds: [BUILTIN_TARGETS[1].id],
    });
    expect(html).toContain('class="app-select-value">Headphone</span>');
    expect(html).toContain('name="autoeq-measurement" value="headphone"');
    expect(submitButton(html)).not.toContain('disabled=""');
  });
});
