import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Modal } from "./Modal";

describe("Modal shell", () => {
  it("keeps the native dialog and a named shared close control", () => {
    const html = renderToStaticMarkup(createElement(Modal, {
      title: "Import profile", onClose: () => {}, children: "Preview",
    }));
    expect(html).toContain("<dialog");
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('data-slot="button"');
    expect(html).toContain('aria-label="Close Import profile"');
    expect(html).toContain('data-variant="ghost"');
  });
  it("locks the close control and supports described confirmations", () => {
    const html = renderToStaticMarkup(createElement(Modal, {
      title: "Factory reset", role: "alertdialog", descriptionId: "reset-message",
      closeDisabled: true, onClose: () => {}, children: "Reset",
    }));
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-describedby="reset-message"');
    expect(html).toContain('disabled=""');
  });
});
