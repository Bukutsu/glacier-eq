import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EqEditor } from "./useEqEditor";
import { useMobileRecovery } from "./useMobileRecovery";

const h = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as { current: unknown }[],
  effects: [] as (() => void)[], si: 0, ri: 0,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = h.si++;
    if (!(index in h.states)) h.states[index] = initial;
    return [h.states[index], (value: unknown) => { h.states[index] = value; }];
  },
  useRef: (current: unknown) => (h.refs[h.ri++] ??= { current }),
  useEffect: (effect: () => void) => h.effects.push(effect),
}));

function setup() {
  const restoreDraft = vi.fn(async () => true);
  const discardRestoredDraft = vi.fn();
  const editor = {
    pendingDraft: {}, draftInvalid: false, dirty: true,
    restoreDraft, discardRestoredDraft,
  } as unknown as EqEditor;
  function render(enabled = true, connected = false) {
    h.si = h.ri = 0;
    h.effects = [];
    const recovery = useMobileRecovery(editor, connected, enabled);
    for (const effect of h.effects) effect();
    return recovery;
  }
  return { editor, restoreDraft, discardRestoredDraft, render };
}
beforeEach(() => {
  h.states = [];
  h.refs = [];
});

describe("mobile recovery lifecycle", () => {
  it("restores only on mobile and only once across renders and layout switches", async () => {
    const s = setup();
    s.render(false);
    expect(s.restoreDraft).not.toHaveBeenCalled();
    s.render();
    await Promise.resolve();
    expect(s.render().restored).toBe(true);
    s.render(false);
    s.render();
    expect(s.restoreDraft).toHaveBeenCalledOnce();
  });

  it("leaves unreadable drafts for explicit recovery", () => {
    const s = setup();
    s.editor.draftInvalid = true;
    expect(s.render().autoRestoreDone).toBe(false);
    expect(s.restoreDraft).not.toHaveBeenCalled();
  });

  it("offers manual recovery when the automatic attempt cannot restore", async () => {
    const s = setup();
    s.restoreDraft.mockResolvedValue(false);
    s.render();
    await Promise.resolve();
    const recovery = s.render();
    expect(recovery.restored).toBe(false);
    expect(recovery.autoRestoreDone).toBe(true);
    expect(s.restoreDraft).toHaveBeenCalledOnce();
  });

  it("keeps restored edits without discarding, and discards only on request", async () => {
    const s = setup();
    s.render();
    await Promise.resolve();
    s.render().keep();
    expect(s.render().restored).toBe(false);
    expect(s.discardRestoredDraft).not.toHaveBeenCalled();
    s.render().discard();
    expect(s.discardRestoredDraft).toHaveBeenCalledOnce();
  });

  it.each(["clean", "connected"])("clears the notice when the editor is %s", async (condition) => {
    const s = setup();
    s.render();
    await Promise.resolve();
    expect(s.render().restored).toBe(true);
    if (condition === "clean") s.editor.dirty = false;
    s.render(true, condition === "connected");
    expect(s.render(true, condition === "connected").restored).toBe(false);
  });
});
