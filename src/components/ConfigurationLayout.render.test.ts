import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ConfigurationLayout } from "./ConfigurationLayout";
import { SETTINGS_SECTIONS, DEVICE_SECTIONS } from "../lib/tabs";

const layout = vi.hoisted(() => ({ mobile: true }));
vi.mock("../hooks/useIsMobile", () => ({ useIsMobile: () => layout.mobile }));

function render(kind: "settings" | "device", root: boolean) {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [`/${kind}`] },
    createElement(ConfigurationLayout, {
      kind, root, active: kind === "settings" ? "general" : "overview",
      sections: kind === "settings" ? SETTINGS_SECTIONS : DEVICE_SECTIONS,
      summary: kind === "device" ? createElement("div", null, "Connected DAC summary") : undefined,
      children: createElement("div", null, "Section content"),
    })));
}

describe("configuration navigation", () => {
  it("shows grouped settings rows rather than section content on the mobile root", () => {
    layout.mobile = true;
    const html = render("settings", true);
    expect(html.match(/class="configuration-list-group"/g)).toHaveLength(2);
    expect(html).toContain('href="/settings/appearance"');
    expect(html).toContain("Theme, graph, and display preferences");
    expect(html).not.toContain("Section content");
    expect(html).not.toContain("configuration-nav-link");
  });
  it("shows the device connection summary and section links on its mobile root", () => {
    layout.mobile = true;
    const html = render("device", true);
    expect(html).toContain("Connected DAC summary");
    expect(html).toContain('href="/device/controls"');
    expect(html).not.toContain("Section content");
  });
  it("shows a back action and only the selected page on mobile subroutes", () => {
    layout.mobile = true;
    const html = render("settings", false);
    expect(html).toContain('aria-label="Back to settings"');
    expect(html).toContain("Section content");
    expect(html).not.toContain("configuration-list-group");
  });
  it("preserves desktop navigation and content at the root", () => {
    layout.mobile = false;
    const html = render("settings", true);
    expect(html).toContain("settings-navigation");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Section content");
    expect(html).not.toContain("configuration-list-group");
  });
});
