import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfilesView } from "./ProfilesView";

vi.mock("@glacier-eq/backend", () => ({ invoke: vi.fn(), listen: vi.fn(async () => () => {}) }));

const props: Parameters<typeof ProfilesView>[0] = {
  peq: { filters: [], global_gain: 0 },
  profiles: [{ name: "Daily", data: { filters: [], global_gain: 0 }, modified: 1 }],
  selectedPreset: "Daily",
  profileSearch: "",
  setProfileSearch: () => {},
  newProfileName: "",
  setNewProfileName: () => {},
  onSelectProfile: () => {},
  onApplyProfile: () => {},
  onReloadProfiles: () => {},
  onReset: () => {},
  onSave: () => {},
  onDelete: () => {},
  setStatus: () => {},
  onImportPEQ: () => true,
  getAsyncContext: () => ({ editorRevision: 0, connectionRevision: 0, operationRevision: 0 }),
  runProfileMutation: async (task) => ({ value: await task(), current: true }),
};

describe("profile keyboard controls", () => {
  it("separates the native load button from the DAC actions menu", () => {
    const html = renderToStaticMarkup(createElement(ProfilesView, props));
    expect(html).toMatch(/<button(?=[^>]*type="button")(?=[^>]*aria-pressed="true")(?=[^>]*aria-label="Load Daily into editor")[^>]*>/);
    expect(html).toMatch(/<button(?=[^>]*aria-label="Actions for Daily")(?=[^>]*aria-haspopup="menu")[^>]*>/);
    expect(html).toContain("In editor");
    // DAC actions are not exposed as one-click row buttons.
    expect(html).not.toContain("Apply temporarily</button>");
    expect(html).not.toContain('role="radio"');
    expect(html).not.toContain('role="radiogroup"');
  });

  it("lets a new profile name submit through a native form", () => {
    const html = renderToStaticMarkup(createElement(ProfilesView, {
      ...props, selectedPreset: "Unsaved EQ", dirty: true, newProfileName: "New profile",
    }));
    expect(html).toContain('<form class="profile-save-form">');
    expect(html).toContain('name="profile-name"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*data-variant="primary")[^>]*>/);
  });
});
