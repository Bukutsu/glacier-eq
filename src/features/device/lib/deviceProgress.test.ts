import { describe, expect, it } from "vitest";
import { i18n } from "@/lib/i18n";
import { PSEUDO_LANGUAGE } from "@/lib/locale";
import { localizeDeviceProgress } from "./deviceProgress";

describe("device progress translation boundary", () => {
  it("preserves existing English progress and interpolates band counts", () => {
    expect(localizeDeviceProgress("Preparing EQ read…")).toBe(
      "Preparing EQ read…",
    );
    expect(localizeDeviceProgress("Reading band 3/10…")).toBe(
      "Reading band 3/10…",
    );
    expect(localizeDeviceProgress("Writing band 2/5…")).toBe(
      "Writing band 2/5…",
    );
  });
  it("looks up the active language at call time without mutating wire messages", async () => {
    const wireMessage = "Saving EQ to DAC (restart expected)…";
    await i18n.changeLanguage(PSEUDO_LANGUAGE);
    expect(localizeDeviceProgress(wireMessage)).not.toBe(wireMessage);
    expect(wireMessage).toContain("(restart expected)");
    expect(localizeDeviceProgress("Reading band 3/10…")).toContain("3/10");
  });
  it("passes unknown backend messages through unchanged", () => {
    expect(localizeDeviceProgress("Unknown future backend status")).toBe(
      "Unknown future backend status",
    );
  });
});
