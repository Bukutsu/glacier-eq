import { describe, expect, it } from "vitest";
import {
  UDEV_INSTALL_COMMAND,
  UDEV_RULES_COMMIT,
  UDEV_RULES_SHA256,
  UDEV_RULES_URL,
} from "./LinuxUdevGuide";

describe("manual udev installer", () => {
  it("pins and verifies rules before installing them as root", () => {
    expect(UDEV_RULES_URL).toContain(UDEV_RULES_COMMIT);
    expect(UDEV_RULES_URL).not.toContain("/main/");
    expect(UDEV_INSTALL_COMMAND).toContain(UDEV_RULES_SHA256);
    expect(UDEV_INSTALL_COMMAND.indexOf("sha256sum -c")).toBeLessThan(
      UDEV_INSTALL_COMMAND.indexOf("sudo install"),
    );
  });
});
