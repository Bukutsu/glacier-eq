// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { create } from "zustand";

export interface Toast {
  id: string;
  message: string;
  type: "info" | "error" | "success";
}

interface ToastStore {
  toasts: Toast[];
  status: string;
  addToast: (message: string, type?: Toast["type"]) => void;
  setStatus: (message: string) => void;
  removeToast: (id: string) => void;
  clearNonErrorToasts: () => void;
}

export const useToastStore = create<ToastStore>()((set, get) => ({
  toasts: [],
  status: "Ready",

  addToast: (message, type = "info") => {
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
      lowerMessage.includes("successful") ||
      lowerMessage.includes("synced") ||
      lowerMessage.includes("loaded") ||
      lowerMessage.includes("parsed") ||
      lowerMessage.includes("deleted") ||
      lowerMessage.includes("saved")
    ) {
      toastType = "success";
    }

    const { toasts } = get();
    if (toasts.some((t) => t.message === message)) return;

    const id = Math.random().toString(36).substring(2, 9);
    set({ toasts: [...toasts, { id, message, type: toastType }] });

    if (toastType !== "error") {
      setTimeout(() => {
        get().removeToast(id);
      }, 4000);
    }
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
