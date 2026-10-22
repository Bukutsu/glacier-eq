import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { UpdateCard } from "./UpdateSection";
import type { UpdateState } from "@/features/settings/hooks/useAppUpdate";

const noop = () => {};
const render = (state: UpdateState) =>
  renderToStaticMarkup(
    createElement(UpdateCard, {
      state,
      onCheck: noop,
      onDownload: noop,
      onRestart: noop,
    }),
  );

describe("UpdateSection", () => {
  it("renders nothing until support is known", () => {
    expect(render({ phase: "unknown" })).toBe("");
  });

  it("greys out unsupported builds and says why", () => {
    const html = render({ phase: "unsupported", reason: "systemPackage" });
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("package manager");
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).not.toContain("signing key");
  });

  it("links Android to the latest APK instead of a dead button", () => {
    const html = render({ phase: "unsupported", reason: "mobile" });
    expect(html).not.toContain('aria-disabled="true"');
    expect(html).toContain("Get latest APK");
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
    expect(html).not.toContain("signing key");
  });

  it("offers the download with release notes when a build is newer", () => {
    const html = render({
      phase: "available",
      version: "9.9.9",
      notes: "- faster",
    });
    expect(html).not.toContain("aria-disabled");
    expect(html).toContain("Version 9.9.9 is available.");
    expect(html).toContain("Download update");
    expect(html).toContain("- faster");
  });

  it("shows determinate progress while downloading", () => {
    const html = render({
      phase: "downloading",
      version: "9.9.9",
      received: 50,
      total: 200,
    });
    expect(html).toContain('value="25"');
    expect(html).toContain("25%");
  });

  it("asks for a restart once the download is ready", () => {
    expect(render({ phase: "ready", version: "9.9.9" })).toContain(
      "Restart to update",
    );
  });
});
