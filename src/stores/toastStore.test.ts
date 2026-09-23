// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it, beforeEach } from "vitest";
import { useToastStore } from "./toastStore";

describe("toastStore", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [], status: "Ready" });
  });

  it("adds toasts and infers types", () => {
    useToastStore.getState().addToast("Profile saved successfully");
    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].type).toBe("success");

    useToastStore.getState().addToast("Failed to connect device");
    const toasts2 = useToastStore.getState().toasts;
    expect(toasts2.length).toBe(2);
    expect(toasts2[1].type).toBe("error");
  });

  it("deduplicates identical messages", () => {
    useToastStore.getState().addToast("Same message");
    useToastStore.getState().addToast("Same message");
    expect(useToastStore.getState().toasts.length).toBe(1);
  });

  it("removes toast by id", () => {
    useToastStore.getState().addToast("Toast to delete");
    const id = useToastStore.getState().toasts[0].id;
    useToastStore.getState().removeToast(id);
    expect(useToastStore.getState().toasts.length).toBe(0);
  });

  it("caps accumulated error toasts at the newest 50", () => {
    // Errors never auto-expire, so distinct messages would pile up forever.
    for (let i = 0; i < 60; i++) {
      useToastStore.getState().addToast(`Failed operation ${i}`);
    }
    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBe(50);
    expect(toasts[0].message).toBe("Failed operation 10");
    expect(toasts[toasts.length - 1].message).toBe("Failed operation 59");
    expect(toasts.every((toast) => toast.type === "error")).toBe(true);
  });

  it("does not downgrade an explicitly-typed error on success keywords", () => {
    // P1 probe-1 latent vector: App settings' load-failure status message
    // contains "saved" — passing it with type "error" must stay an error,
    // not become a green success banner.
    useToastStore
      .getState()
      .addToast("Settings will not be saved until loading succeeds", "error");
    expect(useToastStore.getState().toasts[0].type).toBe("error");

    // Default info path keeps inferring success from the same keyword.
    useToastStore.getState().addToast("Profile saved");
    expect(useToastStore.getState().toasts[1].type).toBe("success");
  });
});
