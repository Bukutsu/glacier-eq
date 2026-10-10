import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NumberInput } from "./NumberInput";

const render = (props: Partial<Parameters<typeof NumberInput>[0]> = {}) =>
  renderToStaticMarkup(createElement(NumberInput, { value: 2.5, onChange: () => {}, ...props }));

describe("NumberInput", () => {
  it("uses shared ghost buttons that cannot submit a surrounding form", () => {
    const html = render();
    expect(html.match(/data-slot="button"/g)).toHaveLength(2);
    expect(html.match(/data-variant="ghost"/g)).toHaveLength(2);
    expect(html.match(/type="button"/g)).toHaveLength(2);
    expect(html).not.toContain('type="submit"');
  });

  it("preserves precision and accessible bounds on the editable value", () => {
    const html = render({ id: "gain", min: -12, max: 12, step: 0.05, precision: 2, "aria-label": "Gain" });
    expect(html).toContain('id="gain"');
    expect(html).toContain('role="spinbutton"');
    expect(html).toContain('aria-valuemin="-12"');
    expect(html).toContain('aria-valuemax="12"');
    expect(html).toContain('aria-valuetext="2.50"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('aria-label="Decrease Gain"');
    expect(html).toContain('aria-label="Increase Gain"');
  });

  it("uses numeric input mode and whole numbers for integer controls", () => {
    const html = render({ value: 10 });
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('aria-valuetext="10"');
  });

  it("disables the entire control without dropping its value", () => {
    const html = render({ value: 4, disabled: true });
    expect(html.match(/\sdisabled=""/g)).toHaveLength(3);
    expect(html).toContain('aria-valuetext="4"');
  });
});
