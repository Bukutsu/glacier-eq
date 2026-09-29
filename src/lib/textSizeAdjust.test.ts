// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Android WebView applies font boosting / text autosizing unless the page opts
 * out, rendering text — and anything sized off it, like the min-height on the
 * connect button and the 44px mobile stepper — larger than the stylesheets
 * specify. This is the whole app, so the opt-out belongs in the global reset
 * rather than on individual components.
 */
describe("text autosizing is opted out of", () => {
  const base = readFileSync(
    new URL("../styles/base.css", import.meta.url),
    "utf8",
  );

  it("pins text size to the CSS value", () => {
    expect(base).toMatch(
      /html\s*\{[^}]*-webkit-text-size-adjust:\s*100%[^}]*\}/,
    );
    // The standard property is ignored by WebView but keeps the rule honest
    // for engines that honour it.
    expect(base).toMatch(/text-size-adjust:\s*100%/);
  });

  it("puts it in the global reset, not on a single component", () => {
    // A component-scoped opt-out would leave the rest of the app boosted.
    const scoped = base.match(/^\s*\.[a-z-]+\s*\{[^}]*text-size-adjust/gm);
    expect(scoped).toBeNull();
  });
});
