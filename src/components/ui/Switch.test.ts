import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Switch } from "./Switch";

describe("Switch", () => {
  it("exposes its name, description, and controlled checked state", () => {
    const html = renderToStaticMarkup(createElement(Switch, {
      id: "verify", label: "Verify writes", descriptionId: "verify-description",
      checked: true, onCheckedChange: () => {},
    }));
    expect(html).toContain('id="verify"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="Verify writes"');
    expect(html).toContain('aria-describedby="verify-description"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('type="button"');
  });

  it("preserves unchecked and disabled state", () => {
    const html = renderToStaticMarkup(createElement(Switch, {
      id: "disabled", label: "DAC control", checked: false, disabled: true, onCheckedChange: () => {},
    }));
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('data-slot="switch"');
  });
});
