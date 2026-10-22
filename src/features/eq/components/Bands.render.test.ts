import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Bands, nextFreq } from "./Bands";
import {
  buildDevDummyPeq,
  DEV_DUMMY_DEVICE,
} from "@/features/device/lib/devDevice";
import { buildDefaultState } from "@/features/eq/lib/peq";

const selectOptions = vi.hoisted(
  () => [] as { value: string; label: string }[][],
);
vi.mock("@/components/ui/Select", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/Select")>();
  return {
    ...actual,
    Select: (props: import("@/components/ui/Select").SelectProps<string>) => {
      selectOptions.push(props.options);
      return createElement(actual.Select<string>, props);
    },
  };
});

function renderEditor(props: Partial<Parameters<typeof Bands>[0]> = {}) {
  selectOptions.length = 0;
  const peq = buildDevDummyPeq();
  const html = renderToStaticMarkup(
    createElement(Bands, {
      peq,
      committedPeq: peq,
      capabilities: DEV_DUMMY_DEVICE,
      onFilterChange: () => {},
      onStartChange: () => {},
      activeBandIndex: 0,
      isMobile: true,
      ...props,
    }),
  );
  return html.split('<section class="bands-mobile-editor">')[1];
}

describe("nextFreq", () => {
  const range: [number, number] = [20, 20000];

  it("steps by a ratio, so small at 20 Hz and visible at 10 kHz", () => {
    expect(nextFreq(20, 1, false, range, false)).toBe(21);
    expect(nextFreq(10000, 1, false, range, false)).toBe(10595);
    expect(nextFreq(1000, 1, true, range, false)).toBe(1260);
    expect(nextFreq(1000, -1, false, range, false)).toBe(944);
  });

  it("always makes progress at low frequencies", () => {
    let freq = 20;
    for (let i = 0; i < 5; i++) {
      const next = nextFreq(freq, 1, false, range, false);
      expect(next).toBeGreaterThan(freq);
      freq = next;
    }
  });

  it("moves to the next ISO center when snapping", () => {
    expect(nextFreq(1000, 1, false, range, true)).toBe(1250);
    expect(nextFreq(1000, -1, false, range, true)).toBe(800);
  });

  it("stays put at the range edges", () => {
    expect(nextFreq(20000, 1, false, range, false)).toBe(20000);
    expect(nextFreq(20, -1, false, range, false)).toBe(20);
    expect(nextFreq(20000, 1, true, range, true)).toBe(20000);
    expect(nextFreq(20, -1, true, range, true)).toBe(20);
  });
});

describe("Band editor markup", () => {
  it("shows all 4 controls side by side on desktop without disclosure", () => {
    const html = renderEditor({ isMobile: false });
    expect(html).not.toContain('<details class="band-more-settings">');
    expect(html).toContain('class="band-field band-type-field"');
    expect(html).toContain('aria-label="Band 1 Q"');
  });

  it("shows gain, frequency and Q on mobile, with the filter type in the band header", () => {
    const html = renderEditor();
    const type = html.indexOf('aria-label="Band 1 filter type"');
    const gain = html.indexOf('aria-label="Band 1 gain"');
    const frequency = html.indexOf('aria-label="Band 1 frequency"');
    const q = html.indexOf('aria-label="Band 1 Q"');
    expect(type).toBeGreaterThan(-1);
    expect(type).toBeLessThan(gain);
    expect(gain).toBeLessThan(frequency);
    expect(frequency).toBeLessThan(q);
    expect(html).toContain("Q / bandwidth");
    expect(html).not.toContain("<details");
    expect(html).not.toContain('class="band-field band-type-field"');
  });

  it("labels band chips with short frequencies", () => {
    const peq = buildDevDummyPeq();
    peq.filters[1] = { ...peq.filters[1], freq: 4379 };
    const html = renderEditor({ peq });
    expect(html).toContain("<span>4.4k</span>");
    expect(html).not.toContain("4.379k");
  });

  it("disables every mobile edit and reset during a device operation", () => {
    const html = renderEditor({ disabled: true });
    expect(html).toMatch(
      /<button(?=[^>]*class="[^"]*mobile-filter-reset")(?=[^>]*disabled="")[^>]*>/,
    );
    expect(html).toMatch(
      /<button(?=[^>]*aria-label="Remove band 1")(?=[^>]*disabled="")[^>]*>/,
    );
    expect(
      html.match(/<input(?=[^>]*type="range")(?=[^>]*disabled="")[^>]*>/g),
    ).toHaveLength(3);
    expect(html).toMatch(
      /<button(?=[^>]*role="combobox")(?=[^>]*disabled="")[^>]*>/,
    );
  });

  it("uses a labelled combobox with readable filter names", () => {
    const html = renderEditor({ isMobile: false });
    expect(html).toContain('<label class="band-field band-type-field">');
    expect(html.match(/role="combobox"/g)).toHaveLength(1);
    expect(html).toContain('class="app-select-value">Low shelf</span>');
    expect(selectOptions.at(-1)?.map((option) => option.label)).toEqual(
      expect.arrayContaining([
        "Low shelf",
        "Bell",
        "High shelf",
        "High pass",
        "Low pass",
      ]),
    );
    expect(html).not.toContain("type-buttons");
  });

  it("offers only the connected device's supported filter types", () => {
    renderEditor({
      capabilities: {
        ...DEV_DUMMY_DEVICE,
        supported_filter_types: ["Peak", "LowShelf"],
      },
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

  it("falls back to an enabled band and lets the last band be removed", () => {
    const peq = buildDevDummyPeq();
    peq.filters = peq.filters.map((filter) => ({
      ...filter,
      enabled: filter.index === 2,
    }));
    const html = renderEditor({ peq, activeBandIndex: 0 });
    expect(html).toContain('aria-pressed="true" aria-label="Band 3, 125 Hz"');
    expect(html).not.toMatch(
      /<button(?=[^>]*aria-label="Remove band 3")(?=[^>]*disabled="")[^>]*>/,
    );
  });

  it("shows an add-band prompt for a flat EQ instead of a placeholder band", () => {
    const html = renderToStaticMarkup(
      createElement(Bands, {
        peq: buildDefaultState(),
        capabilities: DEV_DUMMY_DEVICE,
        onFilterChange: () => {},
        onStartChange: () => {},
        activeBandIndex: 0,
      }),
    );
    expect(html).not.toContain("bands-mobile-editor");
    expect(html).toContain("No bands yet. The EQ is flat.");
    expect(html).toMatch(
      new RegExp(`Up to ${DEV_DUMMY_DEVICE.num_bands} bands:(?:<!-- -->)? `),
    );
    expect(html).toContain("Bell");
    expect(html).toContain("Add band");
    expect(html).not.toContain("Band 1");
  });

  it("keeps the capacity state readable without a redundant local undo toast", () => {
    const peq = buildDevDummyPeq();
    peq.filters = peq.filters.map((filter) => ({ ...filter, enabled: true }));
    const html = renderEditor({ peq, activeBandIndex: 0 });
    expect(html).not.toContain("add-filter-chip");
    expect(html).not.toContain("band-undo-toast");
    expect(renderEditor()).toContain('class="add-filter-chip"');
  });
});
