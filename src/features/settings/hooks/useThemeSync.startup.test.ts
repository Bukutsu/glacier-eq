import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThemeSync } from "./useThemeSync";

const mocks = vi.hoisted(() => ({
  effect: null as (() => () => void) | null,
  invoke: vi.fn(),
  write: vi.fn(),
}));
vi.mock("react", () => ({
  useState: (initial: () => string) => [initial(), () => {}],
  useEffect: (effect: () => () => void) => {
    mocks.effect = effect;
  },
}));
vi.mock("@/lib/platform", () => ({
  isAndroidDevice: () => true,
  isTauri: () => true,
}));
vi.mock("@/lib/rpc", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/safeStorage", () => ({
  readLocalStorage: () => null,
  writeLocalStorage: mocks.write,
}));
vi.mock("@/features/settings/lib/materialYou", () => ({
  applyMaterialYouVars: vi.fn(),
  clearMaterialYouVars: vi.fn(),
  getMaterialYouColors: vi.fn(),
  materialYouToCssVars: vi.fn(),
}));

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.write.mockReset();
  const root = {
    style: { removeProperty: vi.fn(), colorScheme: "" },
    setAttribute: vi.fn(),
    getAttribute: () => "tokyo-night",
  };
  vi.stubGlobal("document", {
    documentElement: root,
    querySelector: () => ({ setAttribute: vi.fn() }),
  });
  vi.stubGlobal("getComputedStyle", () => ({
    colorScheme: "dark",
    getPropertyValue: (key: string) =>
      key === "--background" ? "#20212b" : "#1a1b26",
  }));
  vi.stubGlobal("window", {
    matchMedia: () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function apply(ready: boolean) {
  useThemeSync("tokyo-night", ready);
  return mocks.effect!();
}

describe("native launch readiness", () => {
  it("does not release before settings readiness; stores the painted UI background", async () => {
    const cleanup = apply(false);
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "plugin:material-you|set_system_bar_appearance",
        { dark: true },
      ),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "plugin:material-you|release_startup_splash",
    );
    expect(JSON.parse(mocks.write.mock.calls[0][1]).background).toBe("#20212b");
    cleanup();
    const finalCleanup = apply(true);
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "plugin:material-you|release_startup_splash",
      ),
    );
    finalCleanup();
  });
  it("waits for essential system-bar sync but fails open if it rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let reject!: (reason: Error) => void;
    mocks.invoke.mockImplementation((command: string) =>
      command.endsWith("set_system_bar_appearance")
        ? new Promise((_, fail) => {
            reject = fail;
          })
        : Promise.resolve(),
    );
    const cleanup = apply(true);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "plugin:material-you|release_startup_splash",
    );
    reject(new Error("system bars unavailable"));
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        "plugin:material-you|release_startup_splash",
      ),
    );
    cleanup();
  });
  it("does not release from a cancelled appearance effect", async () => {
    let resolve!: () => void;
    mocks.invoke.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const cleanup = apply(true);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    cleanup();
    resolve();
    await Promise.resolve();
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "plugin:material-you|release_startup_splash",
    );
  });
});
