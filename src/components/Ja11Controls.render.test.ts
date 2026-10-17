import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Ja11Controls } from "./Ja11Controls";
vi.mock("@glacier-eq/backend", () => ({ invoke: vi.fn() }));
describe("JA11 controls", () => {
  const html = renderToStaticMarkup(createElement(Ja11Controls, { path: "/ja11", isBusy: false, setStatus: vi.fn() }));

  it("starts with unknown, disabled controls that do not look like confirmed values", () => {
    for (const label of ["Inline microphone", "USB audio mode", "Output volume", "UAC 1.0", "UAC 2.0", 'max="60"']) expect(html).toContain(label);
    // Unknown reads must not look like confirmed Off/UAC 1.0 settings.
    expect(html).toContain('role="switch"');
    expect(html.match(/aria-pressed="true"/g)).toBeNull();
    expect(html.match(/<button[^>]*data-slot="segmented-control"[^>]*disabled/g)).toHaveLength(2);
    expect(html.match(/Not loaded/g)!.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('type="range"');
    expect(html).toContain('aria-valuetext="Not loaded"');
    expect(html).toContain('<output for="ja11-volume"');
  });

  it("keeps notes quiet and offers a compact refresh icon", () => {
    expect(html).toContain("Changes apply immediately");
    expect(html).toContain('aria-label="Refresh settings"');
    expect(html).not.toContain(">Apply<");
    expect(html).not.toContain("Persistence after unplugging has not been verified");
    expect(html).not.toContain("Source-reviewed, not hardware-verified");
  });
});
