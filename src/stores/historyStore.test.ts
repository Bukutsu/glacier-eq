// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it, beforeEach } from "vitest";
import { useHistoryStore } from "./historyStore";
import { buildDefaultState } from "../lib/peq";
import type { PEQData } from "../types";

describe("historyStore", () => {
  beforeEach(() => {
    useHistoryStore.setState({ past: [], future: [], redoBase: null });
  });

  it("pushes snapshots to past", () => {
    const s1 = buildDefaultState();
    const s2 = { ...s1, global_gain: 2.5 };

    useHistoryStore.getState().pushSnapshot(s1);
    expect(useHistoryStore.getState().past.length).toBe(1);

    useHistoryStore.getState().pushSnapshot(s2);
    expect(useHistoryStore.getState().past.length).toBe(2);

    // Duplicate snapshot is ignored
    useHistoryStore.getState().pushSnapshot(s2);
    expect(useHistoryStore.getState().past.length).toBe(2);
  });

  it("handles undo and redo sequence correctly", () => {
    const s1 = buildDefaultState();
    const s2 = { ...s1, global_gain: -3.0 };

    useHistoryStore.getState().pushSnapshot(s1);

    // Undo from s2 -> restores s1
    const undone = useHistoryStore.getState().undo(s2);
    expect(undone?.global_gain).toBe(s1.global_gain);
    expect(useHistoryStore.getState().past.length).toBe(0);
    expect(useHistoryStore.getState().future.length).toBe(1);

    // Redo from s1 -> restores s2
    const redone = useHistoryStore.getState().redo(s1);
    expect(redone?.global_gain).toBe(s2.global_gain);
    expect(useHistoryStore.getState().future.length).toBe(0);
  });

  it("restores the normalized snapshot and records it as the redo base", () => {
    const s1 = buildDefaultState();
    const raw = { ...s1, global_gain: 2.5 };
    const normalized = { ...s1, global_gain: 2 };
    const toNormalized = (snapshot: PEQData) =>
      snapshot.global_gain === 2.5 ? normalized : snapshot;

    useHistoryStore.getState().pushSnapshot(raw);

    // The editor sits at s1; undo restores the normalized form of raw.
    const undone = useHistoryStore.getState().undo(s1, toNormalized);
    expect(undone?.global_gain).toBe(2);
    expect(useHistoryStore.getState().redoBase?.global_gain).toBe(2);

    // Redo from the normalized state succeeds and returns to the pre-undo
    // state (s1) — redo stays usable because the base matches the editor.
    const redone = useHistoryStore.getState().redo(normalized, toNormalized);
    expect(redone?.global_gain).toBe(s1.global_gain);
    expect(useHistoryStore.getState().future.length).toBe(0);
  });

  it("caps the redo stack across repeated undo/edit cycles", () => {
    const base = buildDefaultState();
    useHistoryStore.setState({ past: [base], future: [], redoBase: null });

    // Undo → edit → undo again: pushSnapshot sees the editor sitting at the
    // redo base and preserves `future`, so only `undo` can bound its growth.
    for (let i = 1; i <= 60; i++) {
      const undone = useHistoryStore.getState().undo({ ...base, global_gain: i });
      expect(undone).not.toBeNull();
      useHistoryStore.getState().pushSnapshot(base);
    }

    const { future, past } = useHistoryStore.getState();
    expect(past.length).toBeLessThanOrEqual(50);
    expect(future.length).toBe(50);
    // The most recent undone state is still the next redo.
    expect(future[future.length - 1].global_gain).toBe(60);
  });

  it("invalidates redo when the stored base does not match the editor", () => {
    const s1 = buildDefaultState();
    const raw = { ...s1, global_gain: 2.5 };
    const normalized = { ...s1, global_gain: 2 };
    const identity = (snapshot: PEQData) => snapshot;

    // Pre-fix shape: the base was recorded raw while the editor shows the
    // normalized state, so redo must not apply an unvalidated snapshot.
    useHistoryStore.setState({ past: [], future: [raw], redoBase: raw });
    const { redo } = useHistoryStore.getState();
    expect(redo(normalized, identity)).toBeNull();
    expect(useHistoryStore.getState().future.length).toBe(0);
  });
});
