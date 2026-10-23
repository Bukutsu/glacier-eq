import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./Alert";
import { ErrorNotice } from "../feedback/ErrorNotice";

describe("shadcn Alert", () => {
  it("composes a semantic alert with title, description, and a recovery action", () => {
    const html = renderToStaticMarkup(
      createElement(
        Alert,
        { variant: "destructive" },
        createElement(AlertTitle, null, "Could not read EQ"),
        createElement(AlertDescription, null, "Reconnect the DAC."),
        createElement(
          AlertAction,
          null,
          createElement("button", null, "Retry"),
        ),
      ),
    );
    for (const slot of [
      "alert",
      "alert-title",
      "alert-description",
      "alert-action",
    ])
      expect(html).toContain(`data-slot="${slot}"`);
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-variant="destructive"');
    expect(html).toContain("Reconnect the DAC.");
    expect(html).toContain(">Retry</button>");
  });
  it("permits polite notifications without a second nested alert", () => {
    const html = renderToStaticMarkup(
      createElement(Alert, { role: "status" }, "Saved"),
    );
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });
  it("keeps error content selectable, escaped, and free of a timed dismissal", () => {
    const html = renderToStaticMarkup(
      createElement(
        ErrorNotice,
        {
          title: "Device unavailable",
          action: createElement("button", null, "Retry"),
        },
        "<bad packet>",
      ),
    );
    expect(html).toContain("&lt;bad packet&gt;");
    expect(html).toContain("Device unavailable");
    expect(html).toContain('aria-hidden="true"');
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html).not.toContain("Dismiss");
    expect(html).not.toContain("style=");
  });
});
