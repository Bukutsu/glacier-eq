import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Bands } from "./Bands";
import { buildDevDummyPeq, DEV_DUMMY_DEVICE } from "../lib/devDevice";

const selectOptions = vi.hoisted(() => [] as { value: string; label: string }[][]);
vi.mock("./Select", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./Select")>();
  return { ...actual, Select: (props: import("./Select").SelectProps<string>) => {
    selectOptions.push(props.options);
    return createElement(actual.Select, props);
  }};
});

function renderEditor(props: Partial<Parameters<typeof Bands>[0]> = {}) {
  selectOptions.length = 0;
  const peq = buildDevDummyPeq();
  const html = renderToStaticMarkup(createElement(Bands, {
    peq,
    committedPeq: peq,
    capabilities: DEV_DUMMY_DEVICE,
    onFilterChange: () => {},
    onStartChange: () => {},
    activeBandIndex: 0,
    isMobile: true,
    ...props,
  }));
  return html.split('<section class="bands-mobile-editor">')[1];
}

describe("Band editor markup", () => {
  it("shows all 4 controls side by side on desktop without disclosure", () => {
    const html = renderEditor({ isMobile: false });
    expect(html).not.toContain('<details class="band-more-settings">');
    expect(html).toContain('class="band-field band-type-field"');
    expect(html).toContain('aria-label="Band 1 Q"');
  });

  it("shows gain first and keeps filter type and Q in a closed disclosure on mobile", () => {
    const html = renderEditor();
    const gain = html.indexOf('aria-label="Band 1 gain"');
    const frequency = html.indexOf('aria-label="Band 1 frequency"');
    const details = html.indexOf('<details class="band-more-settings">');
    expect(gain).toBeGreaterThan(-1);
    expect(gain).toBeLessThan(frequency);
    expect(frequency).toBeLessThan(details);
    expect(html).toContain('<summary>More band settings');
    expect(html.indexOf('class="band-field band-type-field"')).toBeGreaterThan(details);
    expect(html.indexOf('aria-label="Band 1 Q"')).toBeGreaterThan(details);
    expect(html).not.toContain('<details class="band-more-settings" open');
  });

  it("disables every mobile edit and reset during a device operation", () => {
    const html = renderEditor({ disabled: true });
    expect(html).toContain('class="mobile-filter-reset" disabled=""');
    expect(html).toContain('aria-label="Remove band 1" disabled=""');
    expect(html.match(/<input(?=[^>]*type="range")(?=[^>]*disabled="")[^>]*>/g)).toHaveLength(3);
    expect(html).toMatch(/<button(?=[^>]*role="combobox")(?=[^>]*disabled="")[^>]*>/);
  });

  it("uses a labelled combobox with readable filter names", () => {
    const html = renderEditor();
    expect(html).toContain('<label class="band-field band-type-field">');
    expect(html.match(/role="combobox"/g)).toHaveLength(1);
    expect(html).toContain('class="app-select-value">Low shelf</span>');
    expect(selectOptions.at(-1)?.map((option) => option.label)).toEqual(
      expect.arrayContaining(["Low shelf", "Bell", "High shelf", "High pass", "Low pass"]),
    );
    expect(html).not.toContain("type-buttons");
  });

  it("offers only the connected device's supported filter types", () => {
    renderEditor({
      capabilities: { ...DEV_DUMMY_DEVICE, supported_filter_types: ["Peak", "LowShelf"] },
    });
    expect(selectOptions.at(-1)).toEqual([
      { value: "Peak", label: "Bell" },
      { value: "LowShelf", label: "Low shelf" },
    ]);
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

  it("keeps the capacity state readable without a redundant local undo toast", () => {
    const peq = buildDevDummyPeq();
    peq.filters = peq.filters.map((filter) => ({ ...filter, enabled: true }));
    const html = renderEditor({ peq, activeBandIndex: 0 });
    expect(html).toContain('class="add-filter-chip at-limit"');
    expect(html).toContain('aria-label="Add filter (all bands in use)"');
    expect(html).toContain('title="All filter bands are in use"');
    expect(html).not.toContain("band-undo-toast");
  });
});
