import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MelodyControls } from "./MelodyControls";
vi.mock("@glacier-eq/backend", () => ({ invoke: vi.fn() }));
describe("SNOWSKY Melody controls", () => {
  const html = renderToStaticMarkup(
    createElement(MelodyControls, {
      path: "/melody",
      isBusy: false,
      setStatus: vi.fn(),
    }),
  );

  it("offers selection without claiming to know the current preset", () => {
    expect(html).toContain("EQ preset");
    expect(html).toContain("Choose a preset");
    expect(html).toContain("cannot reliably report its current preset");
    expect(html).not.toContain("Jazz");
    expect(html).toContain("Write destination");
    expect(html).toMatch(/<input[^>]*id="melody-name"[^>]*disabled/);
  });

  it("offers a compact refresh icon and quiet notes", () => {
    expect(html).toContain("Changes apply immediately");
    expect(html).toContain('aria-label="Refresh settings"');
  });
});
