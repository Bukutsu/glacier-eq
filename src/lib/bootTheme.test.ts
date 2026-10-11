import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readBootTheme } from "./bootTheme";

const script = readFileSync(new URL("../../public/boot-theme.js", import.meta.url), "utf8");
const cache = { preference: "tokyo-night-storm", theme: "tokyo-night-storm", background: "#20212b", colorScheme: "dark" };

afterEach(() => vi.unstubAllGlobals());

describe("boot theme", () => {
  it("restores the painted background before the main bundle", () => {
    const root = { dataset: {}, style: { setProperty: vi.fn() } };
    const meta = { setAttribute: vi.fn() };
    runInNewContext(script, {
      localStorage: { getItem: () => JSON.stringify(cache) },
      document: { documentElement: root, querySelector: () => meta },
    });
    expect(root.dataset).toEqual({ theme: "tokyo-night-storm" });
    expect(root.style.setProperty).toHaveBeenCalledWith("--boot-background", "#20212b");
    expect(meta.setAttribute).toHaveBeenCalledWith("content", "#20212b");
  });
  it.each([null, "{broken", "null", JSON.stringify({ ...cache, background: "url(evil)" })])(
    "ignores missing or damaged boot cache", raw => {
      const root = { dataset: {}, style: { setProperty: vi.fn() } };
      expect(() => runInNewContext(script, {
        localStorage: { getItem: () => raw },
        document: { documentElement: root },
      })).not.toThrow();
      expect(root.style.setProperty).not.toHaveBeenCalled();
    },
  );
  it("does not prevent startup when storage is blocked", () => {
    expect(() => runInNewContext(script, {
      localStorage: { getItem: () => { throw new Error("blocked"); } },
    })).not.toThrow();
  });
  it("uses only supported preferences as provisional settings", () => {
    let value = JSON.stringify(cache);
    vi.stubGlobal("window", { localStorage: { getItem: () => value } });
    vi.stubGlobal("navigator", { userAgent: "Android" });
    expect(readBootTheme()).toBe("tokyo-night-storm");
    value = JSON.stringify({ ...cache, preference: "not-a-theme" });
    expect(readBootTheme()).toBeNull();
    value = "{broken";
    expect(readBootTheme()).toBeNull();
  });
});
