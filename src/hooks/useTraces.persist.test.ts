import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savePersistedJson } from "./useTraces";

type StorageLike = { setItem: (key: string, value: string) => void };

const originalWindow = (globalThis as { window?: unknown }).window;

function stubStorage(setItem: StorageLike["setItem"]) {
  (globalThis as { window?: unknown }).window = { localStorage: { setItem } };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
  vi.restoreAllMocks();
});

describe("savePersistedJson", () => {
  it("persists the value without notifying", () => {
    const setItem = vi.fn();
    stubStorage(setItem);
    const notify = vi.fn();

    savePersistedJson("glacier-measurements", [{ id: "m1" }], notify);

    expect(setItem).toHaveBeenCalledWith(
      "glacier-measurements",
      JSON.stringify([{ id: "m1" }]),
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("surfaces quota failures to the user instead of console-only", () => {
    stubStorage(() => {
      const quota = new Error("quota") as Error & { name: string };
      quota.name = "QuotaExceededError";
      throw quota;
    });
    const notify = vi.fn();

    savePersistedJson("glacier-measurements", [], notify);

    expect(notify).toHaveBeenCalledTimes(1);
    const message = notify.mock.calls[0][0] as string;
    expect(message).toContain("glacier-measurements");
    expect(message).toContain("storage is full");
  });

  it("surfaces unexpected write failures to the user", () => {
    stubStorage(() => {
      throw new Error("denied by policy");
    });
    const notify = vi.fn();

    savePersistedJson("glacier-user-targets", [], notify);

    expect(notify).toHaveBeenCalledTimes(1);
    const message = notify.mock.calls[0][0] as string;
    expect(message).toContain("glacier-user-targets");
    expect(message).toContain("denied by policy");
  });

  it("stays soft when no notifier is provided", () => {
    stubStorage(() => {
      throw new Error("boom");
    });
    expect(() => savePersistedJson("glacier-active-targets", [])).not.toThrow();
  });
});
