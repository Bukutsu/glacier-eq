import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DebugEqBanner } from "./DebugEqBanner";
import { useDebugStore } from "../stores/debugStore";

// Server rendering otherwise reads Zustand's initial snapshot, not current state.
vi.mock("../stores/debugStore", async original => {
  const actual = await original<typeof import("../stores/debugStore")>();
  return { useDebugStore: Object.assign(
    (selector: (state: ReturnType<typeof actual.useDebugStore.getState>) => unknown) =>
      selector(actual.useDebugStore.getState()), actual.useDebugStore,
  ) };
});

afterEach(() => useDebugStore.getState().setAutoDiscardEq(false));

describe("session-only EQ discard mode", () => {
  it("starts off with no banner or persisted setting", () => {
    expect(useDebugStore.getState().autoDiscardEq).toBe(false);
    expect(renderToStaticMarkup(createElement(DebugEqBanner))).toBe("");
    expect(useDebugStore).not.toHaveProperty("persist");
  });

  it("shows a prominent warning with an off button while enabled", () => {
    useDebugStore.getState().setAutoDiscardEq(true);
    const html = renderToStaticMarkup(createElement(DebugEqBanner));
    expect(html).toContain('role="status"');
    expect(html).toContain("Debug mode: auto-discard EQ edits is on");
    expect(html).toContain("replaces unsaved EQ edits without asking");
    expect(html).toContain("Turn off");
    useDebugStore.getState().setAutoDiscardEq(false);
    expect(renderToStaticMarkup(createElement(DebugEqBanner))).toBe("");
  });
});
