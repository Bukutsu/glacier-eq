import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfilesView, type ProfilesViewProps } from "./ProfilesView";
import { DEFAULT_PROFILE_NAME } from "@/features/eq/lib/peq";

vi.mock("@glacier-eq/backend", () => ({
  invoke: vi.fn(),
  listen: vi.fn(async () => () => {}),
}));

const peq = { filters: [], global_gain: -0.05 };
const props: ProfilesViewProps = {
  peq,
  profiles: [{ name: "Daily", data: peq, modified: 1 }],
  selectedPreset: "Daily",
  profileSearch: "",
  setProfileSearch: () => {},
  newProfileName: "",
  setNewProfileName: () => {},
  onSelectProfile: () => {},
  onReloadProfiles: () => {},
  onReset: () => {},
  onSave: () => {},
  onDelete: () => {},
  setStatus: () => {},
  onImportPEQ: () => true,
  onRename: async () => true,
  getAsyncContext: () => ({
    editorRevision: 0,
    connectionRevision: 0,
    operationRevision: 0,
  }),
  runProfileMutation: async (task) => ({ value: await task(), current: true }),
};
const render = (overrides: Partial<ProfilesViewProps> = {}) =>
  renderToStaticMarkup(createElement(ProfilesView, { ...props, ...overrides }));

describe("Profile library", () => {
  it("puts the library before current-editor actions and the read-only preview", () => {
    const html = render({
      preview: createElement("div", { "data-testid": "preview" }),
      onReviewEq: () => {},
    });
    expect(html.indexOf('class="profiles-library"')).toBeLessThan(
      html.indexOf('class="profiles-editor"'),
    );
    expect(html.indexOf('class="profiles-editor"')).toBeLessThan(
      html.indexOf('class="profiles-preview"'),
    );
    expect(html).toContain('aria-label="Current EQ preview"');
    expect(html).toContain("Edit EQ</button>");
    expect(html).toContain("-0.05 dB preamp");
    expect(html).toContain(
      "Loading a profile changes the editor, not the DAC.",
    );
  });

  it("distinguishes a new empty library from a failed search", () => {
    const empty = render({
      profiles: [{ name: DEFAULT_PROFILE_NAME, data: peq, modified: null }],
    });
    expect(empty).toContain("Save your EQ or import a profile to add it here.");
    expect(empty).toContain('aria-label="Load Default EQ into editor"');
    expect(empty).toContain("Flat · read-only");
    expect(empty).not.toContain("No matching profiles");
    const missing = render({ profileSearch: "missing" });
    expect(missing).toContain("No matching profiles");
    expect(missing).toContain("Try another name or clear the search.");
    expect(missing).not.toContain(
      "Save your EQ or import a profile to add it here.",
    );
  });

  it("retains fuzzy search and marks canonical profile names as current", () => {
    const html = render({ selectedPreset: "daily", profileSearch: "dly" });
    expect(html).toContain('class="profiles-item is-current"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("In editor");
  });

  it("shows a disabled saved state until the current profile changes", () => {
    const clean = render();
    expect(clean).toContain(">Saved</span>");
    expect(clean).toMatch(
      /<button(?=[^>]*disabled="")[^>]*>Profile saved<\/button>/,
    );
    const dirty = render({ dirty: true });
    expect(dirty).toContain("Unsaved changes");
    expect(dirty).toContain("Save changes</button>");
    expect(dirty).toContain("Discard changes</button>");
    expect(dirty).toContain('aria-label="Revert to saved Daily"');
    expect(dirty).toContain("Edited</span>");
  });

  it("offers a named save form for unsaved EQ and warns on canonical collisions", () => {
    const html = render({
      dirty: true,
      selectedPreset: "Imported EQ",
      newProfileName: "daily",
    });
    expect(html).toContain("Not saved");
    expect(html).toContain('name="profile-name"');
    expect(html).toContain("Overwrite profile</button>");
    expect(html).toContain("A profile with this name already exists.");
    expect(html).toContain('aria-describedby="profile-overwrite-hint"');
  });

  it("does not enable saving an empty name or offer mutation actions when hidden", () => {
    const empty = render({ selectedPreset: "Imported EQ", dirty: true });
    expect(empty).toMatch(
      /<button(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>/,
    );
    const hidden = render({ showActions: false, dirty: true });
    expect(hidden).not.toContain('class="profile-save-form"');
    expect(hidden).not.toContain("Save changes</button>");
    expect(hidden).not.toContain("Save as copy</button>");
  });

  it("makes the default profile easy to load without making it editable", () => {
    const defaultProfile = {
      name: DEFAULT_PROFILE_NAME,
      data: peq,
      modified: null,
    };
    const available = render({
      profiles: [defaultProfile],
      selectedPreset: "Daily",
      onApplyProfile: () => {},
    });
    expect(available).toContain(
      `aria-label="Load ${DEFAULT_PROFILE_NAME} into editor"`,
    );
    for (const action of ["Apply", "Rename", "Delete"])
      expect(available).not.toContain(
        action === "Apply"
          ? `aria-label="Apply ${DEFAULT_PROFILE_NAME} to DAC temporarily"`
          : `aria-label="${action} ${DEFAULT_PROFILE_NAME}"`,
      );

    const changed = render({
      profiles: [defaultProfile],
      selectedPreset: DEFAULT_PROFILE_NAME,
      dirty: true,
    });
    expect(changed).toContain(
      `aria-label="Revert to saved ${DEFAULT_PROFILE_NAME}"`,
    );
  });

  it("offers rename and delete on every saved row, not only the loaded one", () => {
    const html = render({
      profiles: [
        { name: "Daily", data: peq, modified: 1 },
        { name: "Vocal", data: peq, modified: 1 },
      ],
      selectedPreset: "Daily",
    });
    for (const name of ["Daily", "Vocal"]) {
      expect(html).toContain(`aria-label="Rename ${name}"`);
      expect(html).toContain(`aria-label="Delete ${name}"`);
    }
    const hidden = render({ showActions: false });
    expect(hidden).not.toContain('aria-label="Delete Daily"');
  });

  it("only offers a per-profile DAC apply button when the caller supplies that capability", () => {
    expect(render()).not.toContain(
      'aria-label="Apply Daily to DAC temporarily"',
    );
    expect(render({ onApplyProfile: () => {} })).toContain(
      'aria-label="Apply Daily to DAC temporarily"',
    );
  });

  it("shows file actions only where profiles are files, and omits a disabled graph preference", () => {
    const web = render({});
    expect(web).not.toContain("Refresh</button>");
    expect(web).not.toContain("Open folder</button>");
    expect(web).not.toContain('class="profiles-preview"');
    const android = render({ profilesOnDisk: true });
    expect(android).toContain("Refresh</button>");
    expect(android).not.toContain("Open folder</button>");
    expect(
      render({ profilesOnDisk: true, onOpenProfilesDir: () => {} }),
    ).toContain("Open folder</button>");
  });
});
