import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { WorkspaceNavigation } from "./WorkspaceNavigation";

function render(mobile: boolean) {
  return renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(WorkspaceNavigation, { mobile, activeTab: "device", onSelect: () => {} }),
  ));
}
describe("workspace navigation links", () => {
  it("shows four mobile tabs and selects Settings for device subsections", () => {
    const html = render(true);
    expect([...html.matchAll(/<a /g)]).toHaveLength(4);
    expect(html).not.toContain('href="/device"');
    expect(html).toMatch(/href="\/settings"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/settings"/);
  });
  it("keeps Device separate on desktop", () => {
    const html = render(false);
    expect([...html.matchAll(/<a /g)]).toHaveLength(5);
    expect(html).toMatch(/href="\/device"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/device"/);
    expect(html).toContain('role="separator"');
  });
});
