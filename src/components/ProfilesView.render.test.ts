import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfilesView, type ProfilesViewProps } from "./ProfilesView";
import { DEFAULT_PROFILE_NAME } from "../lib/peq";

vi.mock("@glacier-eq/backend", () => ({ invoke: vi.fn(), listen: vi.fn(async () => () => {}) }));

const peq = { filters: [], global_gain: -0.05 };
const props: ProfilesViewProps = {
  peq, profiles: [{ name: "Daily", data: peq, modified: 1 }],
  selectedPreset: "Daily", profileSearch: "", setProfileSearch: () => {},
  newProfileName: "", setNewProfileName: () => {}, onSelectProfile: () => {},
  onReloadProfiles: () => {}, onReset: () => {}, onSave: () => {}, onDelete: () => {},
  setStatus: () => {}, onImportPEQ: () => true,
  getAsyncContext: () => ({ editorRevision: 0, connectionRevision: 0, operationRevision: 0 }),
  runProfileMutation: async task => ({ value: await task(), current: true }),
};
const render = (overrides: Partial<ProfilesViewProps> = {}) =>
  renderToStaticMarkup(createElement(ProfilesView, { ...props, ...overrides }));

describe("Profile library", () => {
  it("puts the library before current-editor actions and the read-only preview", () => {
    const html = render({ preview: createElement("div", { "data-testid": "preview" }), onReviewEq: () => {} });
    expect(html.indexOf('class="profiles-library"')).toBeLessThan(html.indexOf('class="profiles-editor"'));
    expect(html.indexOf('class="profiles-editor"')).toBeLessThan(html.indexOf('class="profiles-preview"'));
    expect(html).toContain('aria-label="Current EQ preview"');
    expect(html).toContain("Edit EQ</button>");
    expect(html).toContain("-0.05 dB preamp");
    expect(html).toContain("Loading a profile changes the editor, not the DAC.");
  });

  it("distinguishes a new empty library from a failed search", () => {
    const empty = render({ profiles: [{ name: DEFAULT_PROFILE_NAME, data: peq, modified: null }] });
    expect(empty).toContain("No saved profiles yet");
    expect(empty).toContain("Save your current EQ or import a profile");
    expect(empty).toContain("Built-in");
    expect(empty).not.toContain("No matching profiles");
    const missing = render({ profileSearch: "missing" });
    expect(missing).toContain("No matching profiles");
    expect(missing).toContain("Try another name or clear the search.");
    expect(missing).not.toContain("No saved profiles yet");
  });

  it("retains fuzzy search and marks canonical profile names as current", () => {
    const html = render({ selectedPreset: "daily", profileSearch: "dly" });
    expect(html).toContain('class="profiles-item is-current"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("In editor");
  });

  it("shows a disabled saved state until the current profile changes", () => {
    const clean = render();
    expect(clean).toContain("Saved profile");
    expect(clean).toMatch(/<button(?=[^>]*disabled="")[^>]*>Profile saved<\/button>/);
    const dirty = render({ dirty: true });
    expect(dirty).toContain("Unsaved changes");
    expect(dirty).toContain("Save changes</button>");
  });

  it("offers a named save form for unsaved EQ and warns on canonical collisions", () => {
    const html = render({ dirty: true, selectedPreset: "Imported EQ", newProfileName: "daily" });
    expect(html).toContain("Unsaved EQ");
    expect(html).toContain('name="profile-name"');
    expect(html).toContain("Overwrite profile</button>");
    expect(html).toContain("A profile with this name already exists.");
    expect(html).toContain('aria-describedby="profile-overwrite-hint"');
  });

  it("does not enable saving an empty name or offer mutation actions when hidden", () => {
    const empty = render({ selectedPreset: "Imported EQ", dirty: true });
    expect(empty).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>/);
    const hidden = render({ showActions: false, dirty: true });
    expect(hidden).not.toContain('class="profile-save-form"');
    expect(hidden).not.toContain("Save changes</button>");
    expect(hidden).not.toContain("Save as copy</button>");
  });

  it("only offers per-profile DAC menus when the caller supplies that capability", () => {
    expect(render()).not.toContain('aria-label="Actions for Daily"');
    expect(render({ onApplyProfile: () => {} })).toContain('aria-label="Actions for Daily"');
  });

  it("respects Android folder visibility and omits a disabled graph preference", () => {
    const html = render({ onOpenProfilesDir: () => {}, hideProfileFolderButton: true });
    expect(html).not.toContain("Open folder</button>");
    expect(html).not.toContain('class="profiles-preview"');
    expect(render({ onOpenProfilesDir: () => {} })).toContain("Open folder</button>");
  });
});
