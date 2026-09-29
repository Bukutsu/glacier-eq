// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { create } from "zustand";

export interface Toast {
  id: string;
  message: string;
  type: "info" | "error" | "success";
}

// Error toasts deliberately stay until dismissed, so without a cap distinct
// error messages (device names, import failures) accumulate for the whole
// session. Keep the newest N and let the oldest fall off.
const MAX_TOASTS = 50;

interface ToastStore {
  toasts: Toast[];
  status: string;
  /**
   * `log` is false when the caller has already recorded a diagnostic for this
   * message (reportStatus does), so one user-visible event yields one report
   * line rather than two.
   */
  addToast: (message: string, type?: Toast["type"], log?: boolean) => void;
  setStatus: (message: string) => void;
  removeToast: (id: string) => void;
  clearNonErrorToasts: () => void;
  /**
   * Records a toast as a diagnostic event. App registers the backend call on
   * mount, so a toast raised from anywhere — including a module that has no
   * access to App, such as the online-DB cache recovery — still leaves a
   * reportable trail instead of only a transient notification.
   */
  setDiagnosticSink: (sink: ((message: string, type: Toast["type"]) => void) | null) => void;
}

// Kept outside the store state so registering a sink does not re-render every
// toast subscriber, and so it can be read from inside addToast.
let diagnosticSink: ((message: string, type: Toast["type"]) => void) | null = null;

export const useToastStore = create<ToastStore>()((set, get) => ({
  toasts: [],
  status: "Ready",

  addToast: (message, type = "info", log = true) => {
    if (message === "Ready" || !message.trim()) return;

    let toastType = type;
    const lowerMessage = message.toLowerCase();
    if (
      lowerMessage.includes("failed") ||
      lowerMessage.includes("error") ||
      lowerMessage.includes("unable") ||
      lowerMessage.includes("invalid") ||
      lowerMessage.includes("permission") ||
      lowerMessage.includes("not allowed") ||
      lowerMessage.includes("please enter")
    ) {
      toastType = "error";
    } else if (
      // An explicitly-typed error must not be downgraded by a success
      // keyword later in the message ("...saved...", "...loaded..." — the
      // round-3 recovery toast shipped misclassified because "downloaded"
      // contains "loaded"). Promotion to success stays available for the
      // default info path.
      toastType !== "error" &&
      (lowerMessage.includes("successful") ||
        lowerMessage.includes("synced") ||
        lowerMessage.includes("loaded") ||
        lowerMessage.includes("parsed") ||
        lowerMessage.includes("deleted") ||
        lowerMessage.includes("saved"))
    ) {
      toastType = "success";
    }

    const { toasts } = get();
    // Dedupe on message *and* type. Matching on the text alone let an error
    // swallow a later success that happened to read the same, and because
    // error toasts never auto-dismiss, a permanent error kept suppressing
    // every repeat of itself for the rest of the session — a failure that
    // recurs on every udev auto-connect produced exactly one notification.
    if (toasts.some((t) => t.message === message && t.type === toastType)) return;

    const id = Math.random().toString(36).substring(2, 9);
    const next = [...toasts, { id, message, type: toastType }];
    set({ toasts: next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next });

    if (toastType !== "error") {
      setTimeout(() => {
        get().removeToast(id);
      }, 4000);
    }

    // After the dedupe check, so a suppressed repeat does not double-report.
    if (log) diagnosticSink?.(message, toastType);
  },

  setDiagnosticSink: (sink) => {
    diagnosticSink = sink;
  },

  setStatus: (message) => {
    set({ status: message });
    get().addToast(message);
  },

  removeToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  clearNonErrorToasts: () => {
    set({ toasts: get().toasts.filter((t) => t.type === "error") });
  },
}));
