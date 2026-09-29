// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * `.device-card` is rendered inside `.modal-body`, which is inside
 * `dialog.modal-content`. On mobile the dialog caps itself at
 * `100dvh - 16px` and shares that with a sticky header, but the card also
 * asked for `min-height: calc(100dvh - 24px)` — taller than the whole dialog.
 * The card then overflowed its scroll container, the Connect footer spilled
 * past the modal's bottom edge, and the sticky Connect button rendered as a
 * band across the middle of the modal instead of docked at the bottom.
 *
 * The card must size to its content; the dialog owns the viewport budget.
 */
describe("device card cannot outgrow its modal", () => {
  const responsive = readFileSync(
    new URL("../styles/responsive.css", import.meta.url),
    "utf8",
  );
  const layout = readFileSync(
    new URL("../styles/layout.css", import.meta.url),
    "utf8",
  );

  it("sizes the card to its content on mobile", () => {
    const block = responsive.match(/\.device-card\s*\{[^}]*\}/g)?.join("\n") ?? "";
    expect(block).not.toMatch(/min-height/);
    expect(block).not.toMatch(/100dvh|100vh/);
  });

  it("has no viewport-sized height on the card or its scroll container", () => {
    // A min-height driven by the viewport, anywhere between the dialog and the
    // card, is the same overflow wearing a different selector.
    const deviceSelection = readFileSync(
      new URL("../styles/device-selection.css", import.meta.url),
      "utf8",
    );
    const scopedToCard = responsive.match(
      /\.device-card[^{]*\{[^}]*(?:d)?vh[^}]*\}/g,
    );
    expect(scopedToCard).toBeNull();
    expect(deviceSelection).not.toMatch(/\.(device-card|device-actions)[^{]*\{[^}]*min-height:\s*calc\((?:100)?d?vh/);
  });

  it("still lets the dialog own the height budget", () => {
    // If the dialog ever loses its max-height the card is no longer bounded
    // by anything, and this fix would be masking a second overflow.
    expect(layout).toMatch(
      /dialog\.modal-content[\s\S]{0,200}?max-height:\s*calc\(100dvh/,
    );
    expect(layout).toMatch(/\.modal-body\s*\{[^}]*overflow-y:\s*auto/);
  });
});
