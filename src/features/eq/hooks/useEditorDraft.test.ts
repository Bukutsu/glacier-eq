import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorDraft } from "./useEditorDraft";
import { EDITOR_DRAFT_KEY } from "@/features/eq/lib/editorDraft";
import { buildDefaultState } from "@/features/eq/lib/peq";
import { useToastStore } from "@/stores/toastStore";

// Drive the hook's committed render/effect boundary without a DOM dependency.
const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
}));
vi.mock("react", async () => ({
  ...(await vi.importActual("react")),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) {
      hooks.states[index] =
        typeof initial === "function" ? (initial as () => unknown)() : initial;
    }
    return [
      hooks.states[index],
      (value: unknown) => {
        hooks.states[index] = value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++;
    return (hooks.refs[index] ??= { current: initial });
  },
  useEffect: (effect: () => void) => {
    hooks.effects.push(effect);
  },
}));

let values: Map<string, string>;
let setItem: ReturnType<typeof vi.fn>;
let notify: ReturnType<typeof vi.spyOn>;
const peq = buildDefaultState();

function render(dirty = false) {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  hooks.effects.length = 0;
  const result = useEditorDraft(peq, dirty, { current: "My EQ" });
  hooks.effects.forEach((effect) => effect());
  return result;
}

beforeEach(() => {
  hooks.states.length = 0;
  hooks.refs.length = 0;
  values = new Map();
  setItem = vi.fn((key: string, value: string) => {
    values.set(key, value);
  });
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem,
    },
  });
  notify = vi
    .spyOn(useToastStore.getState(), "setStatus")
    .mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("editor draft persistence", () => {
  it("does not create a draft or write storage on a pristine launch", () => {
    expect(render().pendingDraft).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
  });
  it("saves committed dirty edits immediately and avoids duplicate writes", () => {
    render(true);
    expect(JSON.parse(values.get(EDITOR_DRAFT_KEY)!)).toEqual({
      version: 1,
      name: "My EQ",
      peq,
    });
    render(true);
    expect(setItem).toHaveBeenCalledTimes(1);
  });
  it("clears recovery when edits return to a clean state", () => {
    render(true);
    render(false);
    expect(values.get(EDITOR_DRAFT_KEY)).toBe("null");
  });
  it("does not overwrite an unresolved draft at startup", () => {
    const saved = JSON.stringify({ version: 1, name: "Previous EQ", peq });
    values.set(EDITOR_DRAFT_KEY, saved);
    expect(render().pendingDraft?.name).toBe("Previous EQ");
    render();
    expect(setItem).not.toHaveBeenCalled();
  });
  it("discards an old draft without changing the editor", () => {
    values.set(
      EDITOR_DRAFT_KEY,
      JSON.stringify({ version: 1, name: "Previous EQ", peq }),
    );
    render().resolveDraft();
    expect(render().pendingDraft).toBeNull();
    expect(values.get(EDITOR_DRAFT_KEY)).toBe("null");
  });
  it("preserves a damaged record until explicitly discarded", () => {
    values.set(EDITOR_DRAFT_KEY, "{broken");
    const recovery = render();
    expect(recovery.draftInvalid).toBe(true);
    expect(values.get(EDITOR_DRAFT_KEY)).toBe("{broken");
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("kept"),
      "error",
    );
    recovery.resolveDraft();
    expect(render().draftInvalid).toBe(false);
    expect(values.get(EDITOR_DRAFT_KEY)).toBe("null");
    render(true);
    expect(JSON.parse(values.get(EDITOR_DRAFT_KEY)!)).toHaveProperty(
      "peq",
      peq,
    );
  });
  it("reports storage failure once, then retries rather than claiming it saved", () => {
    setItem.mockImplementation(() => {
      throw new Error("quota");
    });
    render(true);
    render(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Save a profile"),
      "error",
    );
    setItem.mockImplementation((key: string, value: string) => {
      values.set(key, value);
    });
    render(true);
    expect(JSON.parse(values.get(EDITOR_DRAFT_KEY)!)).toHaveProperty(
      "peq",
      peq,
    );
  });
});
