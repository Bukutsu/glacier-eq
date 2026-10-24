import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  MobileProfilesView,
  type MobileProfilesViewProps,
} from "./MobileProfilesView";
import { buildDefaultState, DEFAULT_PROFILE_NAME } from "@/features/eq/lib/peq";
import type { Profile } from "@/types";

vi.mock("@glacier-eq/backend", () => ({
  invoke: vi.fn(),
  openFileDialog: vi.fn(),
}));

const profiles: Profile[] = [
  { name: DEFAULT_PROFILE_NAME, data: buildDefaultState(), modified: null },
  {
    name: "Evening listening",
    data: { ...buildDefaultState(), global_gain: -3 },
    modified: 1,
  },
];

function render(overrides: Partial<MobileProfilesViewProps> = {}) {
  return renderToStaticMarkup(
    createElement(MobileProfilesView, {
      peq: buildDefaultState(),
      profiles,
      selectedPreset: DEFAULT_PROFILE_NAME,
      profileSearch: "",
      setProfileSearch: () => {},
      newProfileName: "",
      setNewProfileName: () => {},
      onSelectProfile: () => {},
      onImportPEQ: () => true,
      onSave: () => {},
      onDelete: () => {},
      onRename: async () => true,
      onReloadProfiles: () => {},
      setStatus: () => {},
      getAsyncContext: () => ({
        editorRevision: 0,
        connectionRevision: 0,
        operationRevision: 0,
      }),
      ...overrides,
    }),
  );
}

describe("fresh mobile Profiles screen", () => {
  it("keeps fixed DAC banks inside the library above local profiles even during search", () => {
    const html = render({
      dacBanks: createElement(
        "section",
        { "data-testid": "fixed-dac-banks" },
        "User 1, User 2, User 3",
      ),
      profileSearch: "no matching local files",
    });
    const banks = html.indexOf('data-testid="fixed-dac-banks"');
    expect(banks).toBeGreaterThan(
      html.indexOf('id="mobile-profile-library-title"'),
    );
    expect(banks).toBeLessThan(html.indexOf('class="mobile-profile-list"'));
    expect(html.match(/data-testid="fixed-dac-banks"/g)).toHaveLength(1);
  });

  it("puts the editor first and uses shared card, badge, button and input controls", () => {
    const html = render();
    for (const slot of ["card", "badge", "button", "input"])
      expect(html).toContain(`data-slot="${slot}"`);
    expect(html.indexOf("Current editor EQ")).toBeLessThan(
      html.indexOf("Your library"),
    );
    expect(html).toContain("Save as…");
    expect(html).toContain("1 saved profile");
  });

  it("explains the read-only built-in without disabling saving a new profile", () => {
    const html = render();
    expect(html).toContain("Save your edits under a new name.");
    expect(html).toContain("A flat starting point. Always available.");
    expect(html).toContain("Loaded");
    expect(html).not.toContain('aria-label="Delete Default EQ"');
  });

  it("offers Restore, rather than claiming the dirty selected profile is loaded", () => {
    const html = render({ dirty: true });
    expect(html).toContain("Unsaved changes");
    expect(html).toContain("Restore");
    expect(html).not.toContain(">Loaded<");
  });

  it("filters saved rows without losing the current editor summary", () => {
    const html = render({ profileSearch: "EVENING" });
    expect(html).toContain("Evening listening");
    expect(html).not.toContain("A flat starting point.");
    expect(html).toContain("Current editor EQ");
    expect(html).toContain('aria-label="Clear profile search"');
  });

  it("offers a useful empty-search state", () => {
    const html = render({ profileSearch: "no matching name" });
    expect(html).toContain("No matching profiles");
    expect(html).toContain("Clear search");
    expect(html).not.toContain("A flat starting point.");
  });

  it("keeps a clean saved selection distinct from unsaved editor changes", () => {
    const html = render({ selectedPreset: "Evening listening" });
    expect(html).toContain(">Saved</span>");
    expect(html).toContain("In editor");
    expect(html).not.toContain("Unsaved changes");
    expect(html).not.toContain("The built-in profile is read-only.");
  });

  it("makes the optional response preview a closed disclosure", () => {
    const html = render({
      preview: createElement("div", null, "Response graph"),
    });
    expect(html).toContain("EQ preview");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("hidden");
  });

  it("disables profile loads and saving while device work is busy", () => {
    const html = render({ isBusy: true });
    expect(html).toContain('aria-busy="true"');
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map(
      (match) => match[0],
    );
    const primary = buttons.find((button) =>
      button.includes('data-variant="primary"'),
    );
    expect(primary).toContain("disabled");
    expect(html).not.toContain('aria-label="Connect DAC"');
  });

  it("wraps long names as text rather than rendering markup", () => {
    const html = render({
      profiles: [{ ...profiles[1], name: "<script>long-name</script>" }],
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("mobile profile and DAC actions", () => {
  it("shows the active User bank as the save destination", () => {
    const html = render({
      dacEditor: { status: "Unsaved changes", unsaved: true, slot: 160 },
      onSaveEditorToDacBank: async () => true,
      onUseOnDac: async () => {},
    });
    expect(html).toContain("Save to User 1");
    expect(html).not.toContain("Read from DAC");
  });

  it("asks the user to choose a bank when no bank is open", () => {
    const html = render({ onUseOnDac: async () => {} });
    expect(html).toContain("Save to DAC…");
  });
});
