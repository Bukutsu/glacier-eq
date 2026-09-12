// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it, beforeEach } from "vitest";
import { useHistoryStore } from "./historyStore";
import { buildDefaultState } from "../lib/peq";

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
});
