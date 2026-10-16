import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Ja11Controls } from "./Ja11Controls";
vi.mock("@glacier-eq/backend", () => ({ invoke: vi.fn() }));
describe("JA11 controls", () => {
  it("starts with unknown disabled values, explicit apply, and reconnect warnings", () => {
    const html = renderToStaticMarkup(createElement(Ja11Controls, { path: "/ja11", isBusy: false, setStatus: vi.fn() }));
    for (const label of ["Inline microphone", "USB audio mode", "Output volume", "Reconnect", "Apply", 'max="60"']) expect(html).toContain(label);
    expect(html).not.toContain('value="60"');
    // Unknown reads must not look like confirmed Off/UAC 1.0 settings.
    expect(html.match(/class="app-select-value">Not loaded</g)).toHaveLength(2);
    expect(html.match(/disabled/g)?.length).toBeGreaterThanOrEqual(6);
    expect(html).toContain("Persistence after unplugging has not been verified");
    expect(html).not.toContain('type="range"');
  });
});
