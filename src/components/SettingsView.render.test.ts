import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { SettingsView } from "./SettingsView";
import type { AppSettings } from "../types";

vi.mock("@glacier-eq/backend", () => ({
  invoke: vi.fn(async () => {
    throw new Error("not connected");
  }),
  listen: vi.fn(async () => () => {}),
}));

const baseSettings: AppSettings = {
  auto_pull_on_connect: true,
  skip_push_verification: false,
  theme: "auto",
  snap_to_iso_frequencies: true,
  floating_graph_preview: true,
};

function renderSettingsView(props: Partial<Parameters<typeof SettingsView>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/settings"] },
      createElement(SettingsView, {
        settings: baseSettings,
        onSettingChange: () => {},
        ...props,
      }),
    ),
  );
}

describe("SettingsView markup", () => {
  it("renders plain navigation without category headers on the root section", () => {
    const html = renderSettingsView();
    expect(html).toContain("settings-navigation");
    expect(html).toContain("Behavior &amp; audio");
    expect(html).toContain("Diagnostics &amp; permissions");
    expect(html).not.toContain("stack-category-header");
  });

  it("renders behavior toggles as quiet rows", () => {
    const html = renderSettingsView({ section: "general" });
    expect(html).toContain("Auto-pull EQ on connect");
    expect(html).toContain("stack-card");
  });

  it("renders shortcuts as a plain section without card chrome", () => {
    const html = renderSettingsView({ section: "diagnostics" });
    expect(html).toContain("shortcuts-card");
    expect(html).toContain("Keyboard shortcuts");
    expect(html).toContain("shortcut-list");
    expect(html).not.toContain("settings-card");
  });
});
