import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LinuxUdevGuide,
  UDEV_INSTALL_COMMAND,
  UDEV_RULES_FILENAME,
  saveUdevRules,
} from "./LinuxUdevGuide";

const backend = vi.hoisted(() => ({
  save: vi.fn(),
  invoke: vi.fn(),
  writeText: vi.fn(),
}));
vi.mock("@/lib/rpc", () => backend);
const rules = readFileSync(
  new URL("../../../../udev/69-glacier-eq.rules", import.meta.url),
  "utf8",
);
beforeEach(() => vi.resetAllMocks());

describe("minimal manual udev installation", () => {
  it("saves exactly the bundled rules through the normal web/desktop file flow", async () => {
    backend.save.mockResolvedValue(UDEV_RULES_FILENAME);
    await saveUdevRules();
    expect(backend.save).toHaveBeenCalledWith({
      defaultPath: "69-glacier-eq.rules",
    });
    expect(backend.invoke).toHaveBeenCalledWith("save_text_file", {
      path: UDEV_RULES_FILENAME,
      content: rules,
    });
  });
  it("does not write when saving is cancelled and surfaces save errors", async () => {
    backend.save.mockResolvedValue(null);
    await saveUdevRules();
    expect(backend.invoke).not.toHaveBeenCalled();
    backend.save.mockResolvedValue(UDEV_RULES_FILENAME);
    backend.invoke.mockRejectedValue(new Error("disk full"));
    await expect(saveUdevRules()).rejects.toThrow("disk full");
  });
  it("shows a save button and tells users to run from the saved file's folder", () => {
    const html = renderToStaticMarkup(createElement(LinuxUdevGuide));
    expect(html).toContain("Save rules file");
    expect(html).toContain("folder where you saved it");
    expect(html).toContain(UDEV_RULES_FILENAME);
    for (const text of [
      "curl",
      "mktemp",
      "sha256sum",
      "trap ",
      "tauri://",
      "udevadm trigger",
    ])
      expect(html).not.toContain(text);
    expect(UDEV_INSTALL_COMMAND.split("\n")).toHaveLength(2);
    expect(UDEV_INSTALL_COMMAND.length).toBeLessThan(120);
  });
  it.skipIf(process.platform === "win32")(
    "runs in a POSIX shell, installs 0644 bytes, and reloads only after success",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "glacier-udev-test-"));
      try {
        const log = join(dir, "calls");
        const output = join(dir, "installed.rules");
        // Replace sudo only for this test. Never touch real udev or /etc.
        writeFileSync(
          join(dir, "sudo"),
          `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_LOG"
if [ "$1" = install ]; then
  [ "$FAIL_INSTALL" != 1 ] || exit 1
  shift
  exec install "$1" "$2" "$TEST_OUTPUT"
fi
[ "$1" = udevadm ] && [ "$2" = control ] && [ "$3" = --reload-rules ]
`,
          { mode: 0o700 },
        );
        writeFileSync(join(dir, UDEV_RULES_FILENAME), rules);
        const env = {
          ...process.env,
          PATH: dir + ":" + process.env.PATH,
          TEST_LOG: log,
          TEST_OUTPUT: output,
        };
        execFileSync("sh", ["-c", UDEV_INSTALL_COMMAND], { cwd: dir, env });
        expect(readFileSync(output, "utf8")).toBe(rules);
        expect(statSync(output).mode & 0o777).toBe(0o644);
        expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
          "install -m644 69-glacier-eq.rules /etc/udev/rules.d/",
          "udevadm control --reload-rules",
        ]);
        writeFileSync(log, "");
        expect(() =>
          execFileSync("sh", ["-c", UDEV_INSTALL_COMMAND], {
            cwd: dir,
            env: { ...env, FAIL_INSTALL: "1" },
          }),
        ).toThrow();
        expect(readFileSync(log, "utf8")).not.toContain("udevadm");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
