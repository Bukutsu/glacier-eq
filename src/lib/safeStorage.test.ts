import { afterEach, describe, expect, it, vi } from "vitest";
import { readLocalStorage, writeLocalStorage } from "./safeStorage";

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
});
