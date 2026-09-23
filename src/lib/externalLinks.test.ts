// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createExternalLinkClickHandler } from "./externalLinks";
import { openUrl } from "./rpc";

vi.mock("./rpc", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

const openUrlMock = vi.mocked(openUrl);

/**
 * Builds the slice of a bubbling MouseEvent the handler observes.
 * `defaultPrevented: true` models a link component whose own onClick ran
 * first (React synthetic handlers fire at the React root, below document)
 * and called preventDefault — the situation that used to open two tabs.
 */
function fakeClick(options: {
  href: string | null;
  defaultPrevented?: boolean;
}) {
  const anchor =
    options.href === null
      ? null
      : { getAttribute: (key: string) => (key === "href" ? options.href : null) };
  const preventDefault = vi.fn();
  const event = {
    defaultPrevented: options.defaultPrevented ?? false,
    target: { closest: (selector: string) => (selector === "a" ? anchor : null) },
    preventDefault,
  } as unknown as MouseEvent;
  return { event, preventDefault };
}

describe("createExternalLinkClickHandler", () => {
  beforeEach(() => {
    openUrlMock.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("skips clicks a component already handled, so the URL opens once", () => {
    const handler = createExternalLinkClickHandler();
    const { event, preventDefault } = fakeClick({
      href: "https://github.com/Bukutsu/glacier-eq",
      defaultPrevented: true,
    });

    handler(event);

    // Before the guard the handler re-opened every bubbled row link: the
    // row opened one tab, the document handler opened a second.
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("opens plain http anchors that have no own handler", () => {
    const handler = createExternalLinkClickHandler();
    const { event, preventDefault } = fakeClick({ href: "https://example.com/docs" });

    handler(event);

    expect(openUrlMock).toHaveBeenCalledWith("https://example.com/docs");
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("opens http:// hrefs too", () => {
    const handler = createExternalLinkClickHandler();
    const { event } = fakeClick({ href: "http://example.com/old" });

    handler(event);

    expect(openUrlMock).toHaveBeenCalledWith("http://example.com/old");
  });

  it("leaves relative hrefs and non-anchor targets alone", () => {
    const handler = createExternalLinkClickHandler();
    const relative = fakeClick({ href: "#settings" });
    handler(relative.event);
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(relative.preventDefault).not.toHaveBeenCalled();

    const nonAnchor = fakeClick({ href: null });
    handler(nonAnchor.event);
    expect(openUrlMock).not.toHaveBeenCalled();
  });
});
