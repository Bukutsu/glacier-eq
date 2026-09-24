// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { create } from "zustand";
import { peqEquals } from "../lib/peq";
import type { PEQData } from "../types";

const MAX_HISTORY = 50;

type NormalizeSnapshot = (snapshot: PEQData) => PEQData;
const unchangedSnapshot: NormalizeSnapshot = (snapshot) => snapshot;

export interface HistoryMetadata {
  selectedPreset?: string;
  cleanPeq?: PEQData;
}

interface HistoryState {
  past: PEQData[];
  future: PEQData[];
  pastMeta: Array<HistoryMetadata | null>;
  futureMeta: Array<HistoryMetadata | null>;
  redoBase: PEQData | null;
  redoBaseMeta: HistoryMetadata | null;
  lastRestoredMetadata: HistoryMetadata | null;
  pushSnapshot: (current: PEQData, metadata?: HistoryMetadata | null) => void;
  undo: (
    current: PEQData,
    normalize?: NormalizeSnapshot,
    currentMetadata?: HistoryMetadata | null,
  ) => PEQData | null;
  redo: (
    current: PEQData,
    normalize?: NormalizeSnapshot,
    currentMetadata?: HistoryMetadata | null,
  ) => PEQData | null;
  clearFuture: () => void;
}

function metadataEquals(
  left: HistoryMetadata | null | undefined,
  right: HistoryMetadata | null | undefined,
): boolean {
  const leftPreset = left?.selectedPreset ?? null;
  const rightPreset = right?.selectedPreset ?? null;
  if (leftPreset !== rightPreset) return false;
  if (!left?.cleanPeq || !right?.cleanPeq) return !left?.cleanPeq && !right?.cleanPeq;
  return peqEquals(left.cleanPeq, right.cleanPeq);
}

function trim<T>(values: T[]): T[] {
  return values.length > MAX_HISTORY ? values.slice(values.length - MAX_HISTORY) : values;
}

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  past: [],
  future: [],
  pastMeta: [],
  futureMeta: [],
  redoBase: null,
  redoBaseMeta: null,
  lastRestoredMetadata: null,

  pushSnapshot: (current, metadata = null) => {
    const { past, pastMeta, future, futureMeta, redoBase, redoBaseMeta } = get();
    if (
      past.length > 0
      && peqEquals(past[past.length - 1], current)
      && metadataEquals(pastMeta[pastMeta.length - 1], metadata)
    ) return;

    const sittingAtRedoBase =
      future.length > 0
      && redoBase
      && peqEquals(current, redoBase)
      && metadataEquals(redoBaseMeta, metadata);
    const next = [...past, current];
    const nextMeta = [...pastMeta, metadata];
    if (next.length > MAX_HISTORY) {
      next.shift();
      nextMeta.shift();
    }

    set({
      past: next,
      pastMeta: nextMeta,
      future: sittingAtRedoBase ? future : [],
      futureMeta: sittingAtRedoBase ? futureMeta : [],
      redoBase: sittingAtRedoBase ? redoBase : null,
      redoBaseMeta: sittingAtRedoBase ? get().redoBaseMeta : null,
      lastRestoredMetadata: null,
    });
  },

  undo: (current, normalize = unchangedSnapshot, currentMetadata = null) => {
    const { past, pastMeta, future, futureMeta } = get();
    const normalizedPast = past.map(normalize);
    const normalizedPastMeta = pastMeta;
    let idx = normalizedPast.length - 1;
    while (
      idx >= 0
      && peqEquals(normalizedPast[idx], current)
      && metadataEquals(normalizedPastMeta[idx], currentMetadata)
    ) idx -= 1;
    if (idx < 0) return null;

    const prev = normalizedPast[idx];
    const prevMeta = normalizedPastMeta[idx] ?? null;
    const nextFuture = [...future, current];
    const nextFutureMeta = [...futureMeta, currentMetadata];
    set({
      past: normalizedPast.slice(0, idx),
      pastMeta: normalizedPastMeta.slice(0, idx),
      future: trim(nextFuture),
      futureMeta: trim(nextFutureMeta),
      redoBase: prev,
      redoBaseMeta: prevMeta,
      lastRestoredMetadata: prevMeta,
    });
    return prev;
  },

  redo: (current, normalize = unchangedSnapshot, currentMetadata = null) => {
    const { past, pastMeta, future, futureMeta, redoBase, redoBaseMeta } = get();
    if (future.length === 0) return null;
    if (!redoBase || !peqEquals(current, redoBase) || !metadataEquals(redoBaseMeta, currentMetadata)) {
      set({ future: [], futureMeta: [], redoBase: null, redoBaseMeta: null, lastRestoredMetadata: null });
      return null;
    }
    const next = normalize(future[future.length - 1]);
    const nextMeta = futureMeta[futureMeta.length - 1] ?? null;
    set({
      past: [...past, current],
      pastMeta: [...pastMeta, currentMetadata],
      future: future.slice(0, -1),
      futureMeta: futureMeta.slice(0, -1),
      redoBase: next,
      redoBaseMeta: nextMeta,
      lastRestoredMetadata: nextMeta,
    });
    return next;
  },

  clearFuture: () => set({
    future: [],
    futureMeta: [],
    redoBase: null,
    redoBaseMeta: null,
    lastRestoredMetadata: null,
  }),
}));

export function canUndo(past: PEQData[]): boolean {
  return past.length > 0;
}

export function canRedo(future: PEQData[]): boolean {
  return future.length > 0;
}
