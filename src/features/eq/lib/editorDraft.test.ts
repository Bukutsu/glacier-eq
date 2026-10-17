import { describe, expect, it } from "vitest";
import { hasUnfinishedEdits, parseEditorDraft } from "./editorDraft";
import { buildDefaultState } from "./peq";

const draft = () => ({ version: 1, name: "My EQ", peq: buildDefaultState() });

describe("editor draft validation", () => {
  it.each([null, "null"])("has no recovery for %s", (raw) => {
    expect(parseEditorDraft(raw)).toBeNull();
  });
  it("round-trips enabled and disabled filters, preamp, and the profile name", () => {
    const value = draft();
    value.peq.global_gain = -3.5;
    value.peq.filters[0].gain = -1.25;
    expect(parseEditorDraft(JSON.stringify(value))).toEqual(value);
  });
  it("does not normalize away a device's extra bands or gain range", () => {
    const value = draft();
    value.peq.filters.push({
      ...value.peq.filters[0],
      index: 10,
      enabled: true,
      gain: 15,
    });
    expect(parseEditorDraft(JSON.stringify(value))).toEqual(value);
  });
  it.each(["broken", "{}", "[]", '{"version":2}', "x".repeat(65537)])(
    "rejects malformed or unsupported drafts",
    (raw) => {
      expect(() => parseEditorDraft(raw)).toThrow();
    },
  );
  it.each([
    (value: ReturnType<typeof draft>) => {
      value.peq.filters[0].freq = -1;
    },
    (value: ReturnType<typeof draft>) => {
      value.peq.filters[0].q = 0;
    },
    (value: ReturnType<typeof draft>) => {
      value.peq.filters[0].index = 2;
    },
    (value: ReturnType<typeof draft>) => {
      value.peq.filters = [];
    },
    (value: ReturnType<typeof draft>) => {
      value.name = "x".repeat(257);
    },
    (value: ReturnType<typeof draft>) => {
      value.peq.filters = Array.from({ length: 33 }, (_, index) => ({
        ...value.peq.filters[0],
        index,
      }));
    },
  ])("rejects invalid EQ data", (mutate) => {
    const value = draft();
    mutate(value);
    expect(() => parseEditorDraft(JSON.stringify(value))).toThrow();
  });
});

describe("unfinished edits", () => {
  it("treats an unsaved EQ that equals what was loaded as nothing to recover", () => {
    const loaded = buildDefaultState();
    expect(hasUnfinishedEdits(true, structuredClone(loaded), loaded)).toBe(
      false,
    );
  });
  it("recovers an unsaved EQ that differs from what was loaded", () => {
    const loaded = buildDefaultState();
    const edited = structuredClone(loaded);
    edited.filters[0].gain = 2;
    expect(hasUnfinishedEdits(true, edited, loaded)).toBe(true);
  });
  it("never recovers a saved EQ", () => {
    const loaded = buildDefaultState();
    const edited = structuredClone(loaded);
    edited.global_gain = -2;
    expect(hasUnfinishedEdits(false, edited, loaded)).toBe(false);
  });
});
