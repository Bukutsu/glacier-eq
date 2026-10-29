// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { create } from "zustand";

export interface Toast {
  id: string;
  message: string;
  type: "info" | "error" | "success";
  action?: { label: string; onClick: () => void };
  lifetime: { duration: number; remaining: number; startedAt: number | null };
}

const toastDuration = (type: Toast["type"]) =>
  type === "error" ? 6000 : 4000;
interface ToastTimer {
  handle: ReturnType<typeof setTimeout> | null;
  pauses: Set<string>;
}
const timers = new Map<string, ToastTimer>();

function cancelTimer(id: string) {
  const timer = timers.get(id);
  if (timer?.handle != null) clearTimeout(timer.handle);
  timers.delete(id);
}

export type StatusReporter = (message: string, type?: Toast["type"]) => void;

function resolveToastType(
  message: string,
  type: Toast["type"] = "info",
): Toast["type"] {
  let toastType = type;
  const lowerMessage = message.toLowerCase();
  if (
    lowerMessage.includes("failed") ||
    lowerMessage.includes("could not") ||
    lowerMessage.includes("cannot") ||
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

  return toastType;
}

interface ToastStore {
  toasts: Toast[];
  status: string;
  /**
   * `log` is false when the caller has already recorded a diagnostic for this
   * message (reportStatus does), so one user-visible event yields one report
   * line rather than two.
   */
  addToast: (
    message: string,
    type?: Toast["type"],
    log?: boolean,
    action?: Toast["action"],
  ) => string | undefined;
  setStatus: StatusReporter;
  removeToast: (id: string) => void;
  pauseToast: (id: string, owner: string) => void;
  resumeToast: (id: string, owner: string) => void;
  clearNonErrorToasts: () => void;
  /**
   * Records a toast as a diagnostic event. App registers the backend call on
   * mount, so a toast raised from anywhere — including a module that has no
   * access to App, such as the online-DB cache recovery — still leaves a
   * reportable trail instead of only a transient notification.
   */
  setDiagnosticSink: (
    sink: ((message: string, type: Toast["type"]) => void) | null,
  ) => void;
}

// Kept outside the store state so registering a sink does not re-render every
// toast subscriber, and so it can be read from inside addToast.
let diagnosticSink: ((message: string, type: Toast["type"]) => void) | null =
  null;

export const useToastStore = create<ToastStore>()((set, get) => ({
  toasts: [],
  status: "Ready",

  addToast: (message, type = "info", log = true, action) => {
    if (message === "Ready" || !message.trim()) return;

    const toastType = resolveToastType(message, type);

    const { toasts } = get();
    // Dedupe on message and type while the notification is visible.
    if (
      !action &&
      toasts.some((t) => t.message === message && t.type === toastType)
    )
      return;

    const id = Math.random().toString(36).substring(2, 9);
    const duration = action ? 8000 : toastDuration(toastType);
    const toast: Toast = {
      id, message, type: toastType, action,
      lifetime: { duration, remaining: duration, startedAt: Date.now() },
    };
    // Routine updates replace each other. Errors are retained independently,
    // so a successful action cannot dismiss an unrelated failure.
    // Only the newest error is retained; older errors cannot resurface.
    const next =
      toastType === "error"
        ? [toast]
        : [...toasts.filter((item) => item.type === "error"), toast];
    for (const previous of toasts) {
      if (!next.some((item) => item.id === previous.id))
        get().removeToast(previous.id);
    }
    set({ toasts: next });
    timers.set(id, {
      handle: setTimeout(() => get().removeToast(id), duration),
      pauses: new Set(),
    });

    // After the dedupe check, so a suppressed repeat does not double-report.
    if (log) diagnosticSink?.(message, toastType);
    return id;
  },

  setDiagnosticSink: (sink) => {
    diagnosticSink = sink;
  },

  setStatus: (message, type) => {
    set({ status: message });
    if (message === "Ready" || !message.trim()) return;
    const resolved = resolveToastType(message, type);
    // Status changes are quiet by default. Only failures or an explicit
    // request for a toast appear; routine actions still reach diagnostics.
    if (type !== undefined || resolved === "error") {
      get().addToast(message, resolved);
    } else {
      diagnosticSink?.(message, resolved);
    }
  },

  pauseToast: (id, owner) => {
    const timer = timers.get(id);
    if (!timer || timer.pauses.has(owner)) return;
    timer.pauses.add(owner);
    if (timer.handle === null) return;
    clearTimeout(timer.handle);
    timer.handle = null;
    set({
      toasts: get().toasts.map((toast) => {
        if (toast.id !== id || toast.lifetime.startedAt === null) return toast;
        return {
          ...toast,
          lifetime: {
            ...toast.lifetime,
            remaining: Math.max(
              0,
              toast.lifetime.remaining - (Date.now() - toast.lifetime.startedAt),
            ),
            startedAt: null,
          },
        };
      }),
    });
  },

  resumeToast: (id, owner) => {
    const timer = timers.get(id);
    if (!timer || !timer.pauses.delete(owner) || timer.pauses.size > 0) return;
    const toast = get().toasts.find((item) => item.id === id);
    if (!toast) return;
    const lifetime = { ...toast.lifetime, startedAt: Date.now() };
    timer.handle = setTimeout(() => get().removeToast(id), lifetime.remaining);
    set({
      toasts: get().toasts.map((item) =>
        item.id === id ? { ...item, lifetime } : item,
      ),
    });
  },

  removeToast: (id) => {
    cancelTimer(id);
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  clearNonErrorToasts: () => {
    for (const toast of get().toasts) {
      if (toast.type !== "error") get().removeToast(toast.id);
    }
    set({ toasts: get().toasts.filter((t) => t.type === "error") });
  },
}));
