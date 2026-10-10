import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AutoEqTab } from "./TuningPanel";
import { BUILTIN_TARGETS } from "../lib/builtinTargets";
import type { useAutoEq } from "../features/tuning/useAutoEq";

const state = vi.hoisted(() => ({
  overrides: {} as Partial<ReturnType<typeof useAutoEq>>,
}));
vi.mock("@glacier-eq/backend", () => ({ invoke: vi.fn(), listen: vi.fn(async () => () => {}) }));
vi.mock("../features/tuning/useAutoEq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/tuning/useAutoEq")>();
  return {
    ...actual,
    useAutoEq: (props: Parameters<typeof actual.useAutoEq>[0]) => ({
      ...actual.useAutoEq(props), ...state.overrides,
    }),
  };
});

const props: Parameters<typeof AutoEqTab>[0] = {
  measurements: [{ id: "headphone", name: "Headphone", color: "red", visible: true,
    points: [{ freq: 20, db: 0 }, { freq: 1000, db: 0 }] }],
  allTargets: BUILTIN_TARGETS,
  onImportPEQ: () => true,
  setStatus: () => {},
  getAsyncContext: () => ({ editorRevision: 0, connectionRevision: 0, operationRevision: 0 }),
  onReviewEq: () => {},
};
const render = () => renderToStaticMarkup(createElement(AutoEqTab, props));
beforeEach(() => { state.overrides = {}; });

describe("Tuning feedback", () => {
  it("disables inputs and submission while announcing generation", () => {
    state.overrides = { isOptimizing: true };
    const html = render();
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/<fieldset[^>]*disabled=""/g)).toHaveLength(2);
    expect(html).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>/);
    expect(html).toContain("Generating EQ…");
    expect(html).not.toContain(">Generate EQ</button>");
  });

  it("announces success and offers a direct route to review the editor", () => {
    state.overrides = { resultMessage: "EQ loaded into the editor. Review before writing to the DAC." };
    const html = render();
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(html).toContain("<strong>EQ generated</strong>");
    expect(html).toContain("Review EQ</button>");
    expect(html).not.toContain('role="alert"');
  });

  it("exposes actionable errors as alerts without a false success", () => {
    state.overrides = { errorMessage: "Could not generate EQ. Import another measurement and try again." };
    const html = render();
    expect(html).toContain('<p class="tuning-error" role="alert">Could not generate EQ.');
    expect(html).not.toContain("<strong>EQ generated</strong>");
    expect(html).not.toContain("Review EQ</button>");
  });

  it("keeps warnings beside the result rather than hiding them in advanced settings", () => {
    state.overrides = { resultMessage: "EQ loaded.", warnings: ["Check the low-frequency boost."] };
    const html = render();
    expect(html).toContain("<strong>Review before applying</strong>");
    expect(html).toContain("<li>Check the low-frequency boost.</li>");
    expect(html.indexOf('class="tuning-warnings"')).toBeGreaterThan(html.indexOf("</form>"));
  });
});
