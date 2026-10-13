import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EqCurves, EqCurvesList } from "./EqCurves";
import { BUILTIN_TARGETS } from "../lib/builtinTargets";

vi.mock("@glacier-eq/backend", () => ({ invoke: vi.fn(), listen: vi.fn(async () => () => {}) }));

const props: Parameters<typeof EqCurves>[0] = {
  measurements: [],
  allTargets: [],
  activeTargetIds: [],
  onToggleMeasurement: () => {},
  onRemoveMeasurement: () => {},
  onToggleTarget: () => {},
  onRemoveTarget: () => {},
  onAddMeasurement: () => {},
  onAddTarget: () => {},
};
const measurement = { id: "shown", name: "Shown headphone", visible: true, color: "red", points: [{ freq: 1000, db: 0 }] };

describe("EQ curves", () => {
  it("keeps a small popover trigger and add action visible without mounting the list", () => {
    const html = renderToStaticMarkup(createElement(EqCurves, props));
    expect(html).toContain('aria-label="Measurement and target curves"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Add measurement or target"');
    expect(html).toContain('aria-label="0 curves shown"');
    expect(html).not.toContain("eq-curves-list");
    expect(html).not.toContain("Generate EQ");
  });

  it("counts visible curves without including stale target IDs", () => {
    const target = BUILTIN_TARGETS[0]!;
    const html = renderToStaticMarkup(createElement(EqCurves, {
      ...props, measurements: [measurement], allTargets: [target],
      activeTargetIds: [target.id, "missing"],
    }));
    expect(html).toContain('aria-label="2 curves shown"');
  });

  it("groups measurements and targets with checkboxes and protects built-in targets", () => {
    const target = BUILTIN_TARGETS[0]!;
    const html = renderToStaticMarkup(createElement(EqCurvesList, {
      ...props, query: "", measurements: [measurement],
      allTargets: [target, { ...target, id: "custom", name: "Custom target", builtIn: false }],
      activeTargetIds: [target.id],
    }));
    expect(html).toContain("Measurements");
    expect(html).toContain("Targets");
    expect(html).toContain('aria-label="Measurement: Shown headphone"');
    expect(html).toContain('aria-label="Delete Shown headphone"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('aria-label="Delete Custom target"');
    expect(html).not.toContain(`aria-label="Delete ${target.name}"`);
  });

  it("filters names without regard to case or surrounding whitespace", () => {
    const html = renderToStaticMarkup(createElement(EqCurvesList, {
      ...props, query: "  HEADPHONE  ", measurements: [measurement], allTargets: BUILTIN_TARGETS,
    }));
    expect(html).toContain("Shown headphone");
    expect(html).not.toContain("<legend>Targets");
  });

  it("distinguishes an empty library from an empty search", () => {
    const render = (query: string) => renderToStaticMarkup(createElement(EqCurvesList, { ...props, query }));
    expect(render("")).toContain("No curves added yet.");
    expect(render("unknown")).toContain("No matching curves.");
  });
});
