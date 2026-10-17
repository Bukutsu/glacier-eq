import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders a quiet, outlined label without a colored status marker", () => {
    const html = renderToStaticMarkup(
      createElement(Badge, { role: "status" }, "Configured"),
    );
    expect(html).toContain('data-slot="badge"');
    expect(html).toContain('role="status"');
    expect(html).toContain("border-input");
    expect(html).toContain("text-muted-foreground");
    expect(html).toContain(">Configured</span>");
    expect(html).not.toContain("uppercase");
    expect(html).not.toContain("status-dot");
  });

  it("forwards span attributes and additional classes", () => {
    const html = renderToStaticMarkup(
      createElement(
        Badge,
        { className: "extra", title: "USB permissions" },
        "Checking…",
      ),
    );
    expect(html).toContain("extra");
    expect(html).toContain('title="USB permissions"');
    expect(html).toContain("Checking…");
  });
});
