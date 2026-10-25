import { describe, expect, it, vi } from "vitest";
import { loadProfile } from "./loadProfile";
import { buildDefaultState, DEFAULT_PROFILE_NAME } from "@/features/eq/lib/peq";

function setup(dirty = true) {
  const context = {
    editorRevision: 1,
    connectionRevision: 1,
    operationRevision: 1,
  };
  return {
    profile: {
      name: DEFAULT_PROFILE_NAME,
      data: buildDefaultState(),
      modified: null,
    },
    selectedPreset: DEFAULT_PROFILE_NAME,
    dirty,
    getAsyncContext: () => ({ ...context }),
    confirm: vi.fn(async () => true),
    onSelectProfile: vi.fn(),
    context,
  };
}

describe("profile loading", () => {
  it("loads a dirty editor immediately when no hardware confirmation is supplied", async () => {
    const { confirm, ...t } = setup();
    await loadProfile(t);
    expect(confirm).not.toHaveBeenCalled();
    expect(t.onSelectProfile).toHaveBeenCalledExactlyOnceWith(t.profile);
  });
  it("retains an explicit confirmation for hardware callers", async () => {
    const t = setup();
    await loadProfile(t);
    expect(t.confirm).toHaveBeenCalledOnce();
    expect(t.onSelectProfile).toHaveBeenCalledExactlyOnceWith(t.profile);
  });
  it("does nothing when the same profile is already clean", async () => {
    const t = setup(false);
    await loadProfile(t);
    expect(t.confirm).not.toHaveBeenCalled();
    expect(t.onSelectProfile).not.toHaveBeenCalled();
  });
  it("loads a different clean profile without confirmation", async () => {
    const t = setup(false);
    t.selectedPreset = "Daily";
    await loadProfile(t);
    expect(t.onSelectProfile).toHaveBeenCalledExactlyOnceWith(t.profile);
    expect(t.confirm).not.toHaveBeenCalled();
  });
  it("preserves the editor on cancellation", async () => {
    const t = setup();
    t.confirm.mockResolvedValue(false);
    await loadProfile(t);
    expect(t.onSelectProfile).not.toHaveBeenCalled();
  });
  it.each([
    "editorRevision",
    "connectionRevision",
    "operationRevision",
  ] as const)("cancels when %s changes during confirmation", async (key) => {
    const t = setup();
    t.confirm.mockImplementation(async () => {
      t.context[key]++;
      return true;
    });
    await loadProfile(t);
    expect(t.onSelectProfile).not.toHaveBeenCalled();
  });
});
