// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { create } from "zustand";
import { peqEquals } from "../lib/peq";
import type { PEQData } from "../types";

const MAX_HISTORY = 50;

type NormalizeSnapshot = (snapshot: PEQData) => PEQData;
const unchangedSnapshot: NormalizeSnapshot = (snapshot) => snapshot;

interface HistoryState {
  past: PEQData[];
  future: PEQData[];
  /** PEQ captured when the last undo landed; redo validates against it. */
  redoBase: PEQData | null;
  pushSnapshot: (current: PEQData) => void;
  undo: (current: PEQData, normalize?: NormalizeSnapshot) => PEQData | null;
  redo: (current: PEQData, normalize?: NormalizeSnapshot) => PEQData | null;
  clearFuture: () => void;
}

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  past: [],
  future: [],
  redoBase: null,

  pushSnapshot: (current) => {
    const { past, future, redoBase } = get();
    if (past.length > 0 && peqEquals(past[past.length - 1], current)) return;

    const sittingAtRedoBase =
      future.length > 0 && redoBase && peqEquals(current, redoBase);
    const next = [...past, current];
    if (next.length > MAX_HISTORY) next.shift();

    set({
      past: next,
      future: sittingAtRedoBase ? future : [],
      redoBase: sittingAtRedoBase ? redoBase : null,
    });
  },

  undo: (current, normalize = unchangedSnapshot) => {
    const { past, future } = get();
    // Normalize scanned entries so comparisons and the restored state match
    // what the editor will actually display; normalizers are idempotent.
    const normalizedPast = past.map(normalize);
    let idx = normalizedPast.length - 1;
    while (idx >= 0 && peqEquals(normalizedPast[idx], current)) idx -= 1;
    if (idx < 0) return null;

    // The redo base must be the state actually restored into the editor.
    const prev = normalizedPast[idx];
    set({
      past: normalizedPast.slice(0, idx),
      future: [...future, current],
      redoBase: prev,
    });
    return prev;
  },

  redo: (current, normalize = unchangedSnapshot) => {
    const { past, future, redoBase } = get();
    if (future.length === 0) return null;
    if (!redoBase || !peqEquals(current, redoBase)) {
      set({ future: [], redoBase: null });
      return null;
    }
    const next = normalize(future[future.length - 1]);
    set({
      future: future.slice(0, -1),
      past: [...past, current],
      redoBase: next,
    });
    return next;
  },

  clearFuture: () => set({ future: [], redoBase: null }),
}));

export function canUndo(past: PEQData[]): boolean {
  return past.length > 0;
}

export function canRedo(future: PEQData[]): boolean {
  return future.length > 0;
}
