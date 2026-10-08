// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useToastStore } from "./toastStore";

describe("toastStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.getState().toasts.forEach(toast => useToastStore.getState().removeToast(toast.id));
    useToastStore.setState({ toasts: [], status: "Ready" });
    useToastStore.getState().setDiagnosticSink(null);
  });

  afterEach(() => {
    useToastStore.getState().toasts.forEach(toast => useToastStore.getState().removeToast(toast.id));
    vi.useRealTimers();
  });

  it("records every toast through the registered diagnostic sink", () => {
    const seen: Array<{ message: string; type: string }> = [];
    useToastStore.getState().setDiagnosticSink((message, type) => {
      seen.push({ message, type });
    });

    useToastStore.getState().addToast("Curve cache recovery failed: boom", "error");
    expect(seen).toEqual([
      { message: "Curve cache recovery failed: boom", type: "error" },
    ]);

    // A caller that already recorded the event (reportStatus) opts out, so one
    // user-visible event yields one report line.
    useToastStore.getState().addToast("Loaded EQ from DAC", "success", false);
    expect(seen).toHaveLength(1);

    // A deduplicated repeat must not report twice.
    useToastStore.getState().addToast("Curve cache recovery failed: boom", "error");
    expect(seen).toHaveLength(1);

    useToastStore.getState().setDiagnosticSink(null);
    useToastStore.getState().addToast("Loaded EQ from DAC", "success");
    expect(seen).toHaveLength(1);
  });

  it("adds toasts and infers types", () => {
    useToastStore.getState().addToast("Profile saved successfully");
    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].type).toBe("success");

    useToastStore.getState().addToast("Failed to connect device");
    const toasts2 = useToastStore.getState().toasts;
    expect(toasts2.length).toBe(1);
    expect(toasts2[0].type).toBe("error");
  });

  it("deduplicates identical messages", () => {
    useToastStore.getState().addToast("Same message");
    useToastStore.getState().addToast("Same message");
    expect(useToastStore.getState().toasts.length).toBe(1);
  });

  it("does not let a message of one type swallow the same text of another", () => {
    // An error toast never auto-dismisses, so deduping on the text alone let
    // a permanent error suppress every later toast with the same wording —
    // including a success, and including every repeat of a failure that
    // recurs on its own (the udev auto-connect path).
    useToastStore.getState().addToast("Saved EQ to DAC", "error");
    useToastStore.getState().addToast("Saved EQ to DAC", "success");
    const toasts = useToastStore.getState().toasts;
    expect(toasts.map((toast) => toast.type)).toEqual(["error", "success"]);

    // Same type, same text: still deduplicated.
    useToastStore.getState().addToast("Saved EQ to DAC", "success");
    expect(useToastStore.getState().toasts.length).toBe(2);
  });

  it("replaces routine updates while retaining errors and their diagnostic trail", () => {
    const sink = vi.fn();
    useToastStore.getState().setDiagnosticSink(sink);
    const add = useToastStore.getState().addToast;
    add("Could not save settings", "error");
    add("First update");
    add("Second update");
    add("Profile saved");
    expect(useToastStore.getState().toasts.map(toast => toast.message)).toEqual([
      "Could not save settings", "Profile saved",
    ]);
    expect(sink).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("dismisses routine feedback, but never expires an error", () => {
    useToastStore.getState().addToast("Save failed", "error");
    useToastStore.getState().addToast("Profile saved");
    vi.advanceTimersByTime(4000);
    expect(useToastStore.getState().toasts.map(toast => toast.type)).toEqual(["error"]);
  });

  it("pauses dismissal and gives the reader four seconds after leaving", () => {
    useToastStore.getState().addToast("Profile saved");
    const { id } = useToastStore.getState().toasts[0];
    vi.advanceTimersByTime(3000);
    useToastStore.getState().pauseToast(id);
    vi.advanceTimersByTime(10000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    useToastStore.getState().resumeToast(id);
    useToastStore.getState().resumeToast(id);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(3999);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("cancels timers when dismissed or cleared", () => {
    useToastStore.getState().addToast("Profile saved");
    useToastStore.getState().removeToast(useToastStore.getState().toasts[0].id);
    expect(vi.getTimerCount()).toBe(0);
    useToastStore.getState().addToast("Save failed", "error");
    useToastStore.getState().addToast("Another update");
    useToastStore.getState().clearNonErrorToasts();
    expect(vi.getTimerCount()).toBe(0);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("recognizes plain-language failures before success words", () => {
    useToastStore.getState().addToast("Could not save settings");
    expect(useToastStore.getState().toasts[0].type).toBe("error");
    useToastStore.getState().addToast("Cannot load profiles");
    expect(useToastStore.getState().toasts[1].type).toBe("error");
  });

  it("ignores empty and ready messages", () => {
    const sink = vi.fn();
    useToastStore.getState().setDiagnosticSink(sink);
    useToastStore.getState().addToast("Ready");
    useToastStore.getState().addToast(" ");
    expect(sink).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("keeps fast routine actions quiet while preserving status and diagnostics", () => {
    const sink = vi.fn();
    useToastStore.getState().setDiagnosticSink(sink);
    for (const message of [
      "Generating EQ…", "EQ generated", "Profile saved", "Profile deleted",
      "Copied EQ to clipboard", "Export cancelled.", "Loaded measurement: Headphone",
    ]) {
      useToastStore.getState().setStatus(message);
    }
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(useToastStore.getState().status).toBe("Loaded measurement: Headphone");
    expect(sink).toHaveBeenCalledTimes(7);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still shows failures and explicitly requested device confirmations", () => {
    useToastStore.getState().setStatus("Could not save profile");
    expect(useToastStore.getState().toasts[0].type).toBe("error");
    useToastStore.getState().setStatus("Saved EQ to DAC", "success");
    expect(useToastStore.getState().toasts.map(toast => toast.type)).toEqual(["error", "success"]);
  });

  it("keeps validation guidance visible when requested explicitly", () => {
    useToastStore.getState().setStatus("Enter a profile name before saving.", "info");
    expect(useToastStore.getState().toasts[0].message).toBe("Enter a profile name before saving.");
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
