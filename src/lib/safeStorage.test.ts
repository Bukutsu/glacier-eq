import { afterEach, describe, expect, it, vi } from "vitest";
import { readLocalStorage, tryWriteLocalStorage, writeLocalStorage } from "./safeStorage";

const original = globalThis.localStorage;

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
  vi.restoreAllMocks();
});

describe("safe local storage", () => {
  it("falls back when storage reads are denied", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(() => { throw new Error("denied"); }),
        setItem: vi.fn(() => { throw new Error("denied"); }),
      },
    });
    expect(readLocalStorage("setting")).toBeNull();
    expect(writeLocalStorage("setting", "value")).toBe(false);
  });

  it("delegates successful reads and writes", () => {
    const store = { getItem: vi.fn(() => "value"), setItem: vi.fn() };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: store });
    expect(readLocalStorage("setting")).toBe("value");
    expect(writeLocalStorage("setting", "next")).toBe(true);
    expect(store.setItem).toHaveBeenCalledWith("setting", "next");
  });

  it("reports failure when the localStorage getter itself throws", () => {
    // Safari in private mode and a browser with storage blocked throw a
    // SecurityError from the *accessor*, so storage() returns null. Nothing
    // reached that branch: with it returning { ok: true } instead, a write
    // reported success and App.persistUiPreference never warned that the
    // preference will not survive a restart.
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new Error("SecurityError: storage is disabled"); },
    });

    expect(readLocalStorage("setting")).toBeNull();
    expect(writeLocalStorage("setting", "value")).toBe(false);
    expect(tryWriteLocalStorage("setting", "value").ok).toBe(false);
  });
});
