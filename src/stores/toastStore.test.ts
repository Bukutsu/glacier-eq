// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "./toastStore";

const store = () => useToastStore.getState();
function clear() {
  store().toasts.forEach((t) => store().removeToast(t.id));
  store().setDiagnosticSink(null);
}
describe("toastStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clear();
    useToastStore.setState({ status: "Ready" });
  });
  afterEach(() => {
    clear();
    vi.useRealTimers();
  });

  it("logs each visible notification once and does not double-log an already recorded event", () => {
    const sink = vi.fn();
    store().setDiagnosticSink(sink);
    store().addToast("Could not read EQ", "error");
    store().addToast("Could not read EQ", "error");
    store().addToast("Profile saved", "success", false);
    expect(sink).toHaveBeenCalledExactlyOnceWith("Could not read EQ", "error");
  });
  it("refreshes an actionable message with its latest callback and eight-second timeout", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const originalId = store().addToast("Loaded Alpha", "success", true, {
      label: "Undo",
      onClick: first,
    });
    vi.advanceTimersByTime(1000);
    const latestId = store().addToast("Loaded Alpha", "success", true, {
      label: "Undo",
      onClick: latest,
    });
    expect(latestId).not.toBe(originalId);
    expect(store().toasts).toHaveLength(1);
    store().toasts[0].action?.onClick();
    expect(latest).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    vi.advanceTimersByTime(7999);
    expect(store().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store().toasts).toEqual([]);
  });

  it("infers failures before success keywords and preserves explicitly typed errors", () => {
    store().addToast("Profile saved successfully");
    expect(store().toasts[0].type).toBe("success");
    store().addToast("Could not load saved profile");
    expect(store().toasts[0].type).toBe("error");
    store().addToast(
      "Settings will not be saved until loading succeeds",
      "error",
    );
    expect(store().toasts[0].type).toBe("error");
  });
  it("does not let a message of one type swallow the same text of another", () => {
    store().addToast("Saved EQ to DAC", "error");
    store().addToast("Saved EQ to DAC", "success");
    store().addToast("Saved EQ to DAC", "success");
    expect(store().toasts.map((t) => t.type)).toEqual(["error", "success"]);
  });
  it("replaces routine updates but does not let success dismiss a failure", () => {
    const sink = vi.fn();
    store().setDiagnosticSink(sink);
    store().addToast("Could not save settings");
    store().addToast("First update");
    store().addToast("Second update");
    store().addToast("Profile saved");
    expect(store().toasts.map((t) => t.message)).toEqual([
      "Could not save settings",
      "Profile saved",
    ]);
    expect(sink).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(2);
  });
  it("expires routine notifications at four seconds and errors at six seconds", () => {
    store().addToast("Save failed");
    store().addToast("Profile saved");
    vi.advanceTimersByTime(3999);
    expect(store().toasts).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(store().toasts.map((t) => t.type)).toEqual(["error"]);
    vi.advanceTimersByTime(1999);
    expect(store().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store().toasts).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("pauses for overlapping focus and hover across hosts, then resumes only the remaining time", () => {
    store().addToast("Read failed");
    const id = store().toasts[0].id;
    vi.advanceTimersByTime(1500);
    store().pauseToast(id, "page-hover");
    store().pauseToast(id, "page-hover");
    store().pauseToast(id, "dialog-focus");
    vi.advanceTimersByTime(10_000);
    expect(store().toasts).toHaveLength(1);
    store().resumeToast(id, "page-hover");
    store().resumeToast(id, "unknown-host");
    vi.advanceTimersByTime(10_000);
    expect(store().toasts).toHaveLength(1);
    store().resumeToast(id, "dialog-focus");
    store().resumeToast(id, "dialog-focus");
    vi.advanceTimersByTime(4499);
    expect(store().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store().toasts).toEqual([]);
  });

  it("exposes one lifetime for dismissal and the visual countdown across hosts", () => {
    store().addToast("Loaded Alpha", "success", false, { label: "Undo", onClick: vi.fn() });
    const toast = store().toasts[0];
    expect(toast.lifetime).toEqual({ duration: 8000, remaining: 8000, startedAt: Date.now() });
    vi.advanceTimersByTime(2000);
    store().pauseToast(toast.id, "hover");
    const paused = store().toasts[0].lifetime;
    expect(paused).toEqual({ duration: 8000, remaining: 6000, startedAt: null });
    store().pauseToast(toast.id, "focus");
    vi.advanceTimersByTime(20_000);
    store().resumeToast(toast.id, "hover");
    expect(store().toasts[0].lifetime).toBe(paused);
    store().resumeToast(toast.id, "focus");
    expect(store().toasts[0].lifetime).toEqual({ ...paused, startedAt: Date.now() });
    vi.advanceTimersByTime(1000);
    store().pauseToast(toast.id, "hover");
    expect(store().toasts[0].lifetime.remaining).toBe(5000);
    store().resumeToast(toast.id, "hover");
    vi.advanceTimersByTime(5000);
    expect(store().toasts).toEqual([]);
  });

  it("does not resurrect a paused notification after dismissal or replacement", () => {
    store().addToast("Old failure");
    const id = store().toasts[0].id;
    store().pauseToast(id, "focus");
    store().addToast("New failure");
    store().resumeToast(id, "focus");
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(6000);
    expect(store().toasts).toEqual([]);
  });

  it("does not extend the expiry when the same error repeats or unrelated state changes", () => {
    store().addToast("Could not read from DAC");
    vi.advanceTimersByTime(5000);
    store().addToast("Could not read from DAC");
    store().setStatus("Generating EQ…");
    vi.advanceTimersByTime(1000);
    expect(store().toasts).toEqual([]);
  });
  it("keeps only the newest failure without a backlog that reappears on dismissal", () => {
    const sink = vi.fn();
    store().setDiagnosticSink(sink);
    for (let i = 0; i < 60; i++) store().addToast(`Failed operation ${i}`);
    expect(store().toasts).toHaveLength(1);
    expect(store().toasts[0].message).toBe("Failed operation 59");
    expect(sink).toHaveBeenCalledTimes(60);
    expect(vi.getTimerCount()).toBe(1);
    store().removeToast(store().toasts[0].id);
    expect(store().toasts).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("expires the latest replacement on its own deadline without deleting its diagnostic", () => {
    const sink = vi.fn();
    store().setDiagnosticSink(sink);
    store().addToast("First error");
    vi.advanceTimersByTime(5000);
    store().addToast("Second error");
    vi.advanceTimersByTime(1000);
    expect(store().toasts[0].message).toBe("Second error");
    vi.advanceTimersByTime(5000);
    expect(store().toasts).toEqual([]);
    expect(sink).toHaveBeenCalledTimes(2);
  });
  it("cancels timers on manual dismissal and when routine feedback is cleared", () => {
    store().addToast("Profile saved");
    store().removeToast(store().toasts[0].id);
    expect(vi.getTimerCount()).toBe(0);
    store().addToast("Save failed");
    store().addToast("Another update");
    store().clearNonErrorToasts();
    expect(store().toasts).toHaveLength(1);
    expect(store().toasts[0].type).toBe("error");
    expect(vi.getTimerCount()).toBe(1);
  });
  it("keeps routine status quiet but records diagnostics", () => {
    const sink = vi.fn();
    store().setDiagnosticSink(sink);
    for (const message of [
      "Generating EQ…",
      "EQ generated",
      "Profile saved",
      "Profile deleted",
      "Copied EQ to clipboard",
      "Export cancelled.",
      "Loaded measurement: Headphone",
    ])
      store().setStatus(message);
    expect(store().toasts).toEqual([]);
    expect(sink).toHaveBeenCalledTimes(7);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("still displays failures and explicitly requested device confirmations or guidance", () => {
    store().setStatus("Could not save profile");
    store().setStatus("Saved EQ to DAC", "success");
    expect(store().toasts.map((t) => t.type)).toEqual(["error", "success"]);
    store().setStatus("Enter a profile name before saving.", "info");
    expect(store().toasts[1].message).toBe(
      "Enter a profile name before saving.",
    );
  });
  it("ignores empty and Ready messages", () => {
    const sink = vi.fn();
    store().setDiagnosticSink(sink);
    store().addToast("Ready");
    store().addToast(" ");
    store().setStatus("");
    expect(store().toasts).toEqual([]);
    expect(sink).not.toHaveBeenCalled();
  });
});
