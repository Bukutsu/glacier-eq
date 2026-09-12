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
});
