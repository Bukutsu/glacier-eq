import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Bands } from "./Bands";
import { buildDevDummyPeq, DEV_DUMMY_DEVICE } from "../lib/devDevice";

function renderEditor(props: Partial<Parameters<typeof Bands>[0]> = {}) {
  const peq = buildDevDummyPeq();
  const html = renderToStaticMarkup(createElement(Bands, {
    peq,
    committedPeq: peq,
    capabilities: DEV_DUMMY_DEVICE,
    onFilterChange: () => {},
    onStartChange: () => {},
    activeBandIndex: 0,
    ...props,
  }));
  return html.split('<section class="bands-mobile-editor">')[1];
}

describe("Band editor markup", () => {
  it("uses a labelled native select with readable filter names", () => {
    const html = renderEditor();
    expect(html).toContain('<label class="band-field band-type-field">');
    expect(html.match(/<select /g)).toHaveLength(1);
    expect(html).toMatch(/<option value="LowShelf"[^>]* selected="">Low shelf<\/option>/);
    for (const name of ["Bell", "High shelf", "High pass", "Low pass"]) {
      expect(html).toContain(`>${name}</option>`);
    }
    expect(html).not.toContain("type-buttons");
  });

  it("offers only the connected device's supported filter types", () => {
    const html = renderEditor({
      capabilities: { ...DEV_DUMMY_DEVICE, supported_filter_types: ["Peak", "LowShelf"] },
    });
    expect(html.match(/<option /g)).toHaveLength(2);
    expect(html).not.toContain(">High pass</option>");
  });

  it("keeps values in the controls and labels their units", () => {
    const html = renderEditor({ activeBandIndex: 5 });
    expect(html).toContain('aria-pressed="true" aria-label="Band 6, 1000 Hz"');
    expect(html).toContain('aria-label="Band 6 frequency value"');
    expect(html).toContain('Frequency<span class="band-field-unit">Hz</span>');
    expect(html).toContain('Gain<span class="band-field-unit">dB</span>');
    expect(html).not.toContain(" Hz · ");
    expect(html).toContain('aria-label="Reset band 6 to last saved values"');
  });

  it("falls back to an enabled band and keeps the last band from being removed", () => {
    const peq = buildDevDummyPeq();
    peq.filters = peq.filters.map((filter) => ({ ...filter, enabled: filter.index === 2 }));
    const html = renderEditor({ peq, activeBandIndex: 0 });
    expect(html).toContain('aria-pressed="true" aria-label="Band 3, 125 Hz"');
    expect(html).toContain('aria-label="Remove band 3" disabled=""');
  });
});
