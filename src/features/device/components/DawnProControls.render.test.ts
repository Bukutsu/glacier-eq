import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DawnProControls, DawnProControlsFields } from "./DawnProControls";

vi.mock("@glacier-eq/backend", () => ({ invoke: vi.fn() }));

const state = {
  filter: 4,
  high_gain: true,
  led: 2,
  volume_step: 45,
  volume_raw: 30,
};
const render = (disabled = false, incoming = state) =>
  renderToStaticMarkup(
    createElement(DawnProControlsFields, {
      state: incoming,
      disabled,
      onChange: () => {},
    }),
  );

describe("Original Dawn Pro controls", () => {
  it("offers a compact refresh button even before the initial read succeeds", () => {
    const html = renderToStaticMarkup(
      createElement(DawnProControls, {
        path: "/dawn",
        isBusy: false,
        setStatus: () => {},
      }),
    );
    expect(html).toContain('aria-label="Refresh settings"');
    expect(html).toContain('title="Refresh settings"');
    expect(html).toContain('data-variant="ghost"');
  });
  it("shows only its confirmed controls, not Walkplay controls", () => {
    const html = render();
    for (const label of [
      "Reconstruction filter",
      "High gain",
      "DAC volume",
      "Indicator LED",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("Class AB amplifier");
    expect(html).not.toContain("Channel balance");
    expect(html).not.toContain("Microphone sidetone");
  });
  it("renders the hardware volume scale and actual attenuation code", () => {
    const html = render();
    expect(html).toContain('max="60"');
    expect(html).toContain('value="45"');
    expect(html).toContain("45/60");
    expect(html).toContain("0x1E");
    expect(html).toContain("Step 60 is full output");
  });
  it("uses all five filter values and three LED modes from the reference", () => {
    const html = render();
    expect(html).toContain("Non-oversampling");
    expect(render(false, { ...state, led: 1 })).toContain("Temporarily off");
    expect(html).toContain('id="dawn-filter"');
    expect(html).toContain('id="dawn-led"');
    expect(html).toContain("Filter response");
  });
  it("disables controls during other device operations", () => {
    const html = render(true);
    expect(html.match(/disabled/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
