// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { create } from "zustand";

// Intentionally not persisted: destructive debug shortcuts start off on launch.
export const useDebugStore = create<{
  autoDiscardEq: boolean;
  setAutoDiscardEq: (enabled: boolean) => void;
}>()((set) => ({
  autoDiscardEq: false,
  setAutoDiscardEq: (autoDiscardEq) => set({ autoDiscardEq }),
}));
