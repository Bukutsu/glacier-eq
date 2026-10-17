import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DacFilterVisual } from "./DacFilterVisual";

describe("filter response domain switch", () => {
  it("exposes the selected domain and keeps accessible context with short labels", () => {
    const html = renderToStaticMarkup(
      createElement(DacFilterVisual, { mode: "FAST-LL" }),
    );
    expect(html).toContain('role="group" aria-label="Graph domain"');
    expect(html).toMatch(/aria-pressed="true" aria-label="Impulse \(time\)"/);
    expect(html).toMatch(
      /aria-pressed="false" aria-label="Roll-off \(frequency\)"/,
    );
    expect(html).toContain(">Impulse</button>");
    expect(html).toContain(">Roll-off</button>");
    expect(html.match(/type="button"/g)).toHaveLength(2);
  });
});
