import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("defaults to a button that cannot submit a surrounding form", () => {
    const html = renderToStaticMarkup(createElement(Button, null, "Connect DAC"));
    expect(html).toContain('type="button"');
    expect(html).toContain('data-slot="button"');
    expect(html).toContain('data-variant="default"');
    expect(html).toContain("Connect DAC</button>");
  });

  it("preserves submit behavior when explicitly requested", () => {
    const html = renderToStaticMarkup(createElement(Button, { type: "submit" }, "Save"));
    expect(html).toContain('type="submit"');
  });

  it("uses the semantic theme pairing for a primary action", () => {
    const html = renderToStaticMarkup(createElement(Button, { variant: "primary" }, "Write to DAC"));
    expect(html).toContain('data-variant="primary"');
    expect(html).toContain("bg-primary text-foreground");
    expect(html).not.toContain("text-white");
  });

  it("retains native disabled state and accessible icon labels", () => {
    const html = renderToStaticMarkup(createElement(Button, {
      variant: "ghost", size: "icon", disabled: true, "aria-label": "Undo",
    }));
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-label="Undo"');
    expect(html).toContain('data-variant="ghost"');
  });
});
