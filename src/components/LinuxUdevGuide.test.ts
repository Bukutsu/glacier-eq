import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UDEV_INSTALL_COMMAND, UDEV_RULES_SHA256, UDEV_RULES_URL } from "./LinuxUdevGuide";

describe("manual udev installer", () => {
  it("ships and verifies the rules from this build before installing them as root", () => {
    const rules = readFileSync(new URL("../../udev/69-glacier-eq.rules", import.meta.url));
    expect(UDEV_RULES_SHA256).toBe(createHash("sha256").update(rules).digest("hex"));
    expect(UDEV_RULES_URL).not.toContain("github");
    expect(UDEV_RULES_URL).toContain(".rules");
    expect(UDEV_INSTALL_COMMAND).toContain(UDEV_RULES_SHA256);
    expect(UDEV_INSTALL_COMMAND.indexOf("sha256sum -c")).toBeLessThan(
      UDEV_INSTALL_COMMAND.indexOf("sudo install"),
    );
  });
});
