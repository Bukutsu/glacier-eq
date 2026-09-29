// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * `.device-connect-footer` is a sticky action bar inside `.device-card`, which
 * has `padding: 18px`. It cancelled that padding with `margin: 0 -18px -18px`
 * so the bar bled to the card edges — correct horizontally, wrong vertically.
 * A full-bleed bar only wants a negative bottom margin if it is the card's
 * last child, and it is not: `.supported-list` and `.device-troubleshooting`
 * both follow it. The negative bottom margin pulled them up 18px over a 16px
 * gap, so they overlapped the bar, and the bar's `z-index: var(--z-raised)` plus
 * its 94%-opaque background painted over "SUPPORTED MODELS (12)".
 */
describe("connect footer bleeds sideways only", () => {
  const responsive = readFileSync(
    new URL("../styles/responsive.css", import.meta.url),
    "utf8",
  );
  const chooser = readFileSync(
    new URL("../components/DeviceChooser.tsx", import.meta.url),
    "utf8",
  );

  it("keeps the horizontal bleed and drops the vertical one", () => {
    const rule = responsive.match(
      /\.device-connect-footer\s*\{[^}]*\}/,
    )?.[0];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/margin:\s*0 -18px;/);
    expect(rule).not.toMatch(/margin:[^;]*-\d+px[^;]*-/);
    expect(rule).not.toMatch(/margin-block/);
  });

  it("is not the card's last child", () => {
    // Wiring: if the footer ever moves to the end of the card, a negative
    // bottom margin would be correct and this test is what says so.
    const footer = chooser.indexOf("device-connect-footer");
    const supported = chooser.indexOf("supported-list");
    const trouble = chooser.indexOf("device-troubleshooting");

    expect(footer).toBeGreaterThan(-1);
    expect(supported).toBeGreaterThan(footer);
    expect(trouble).toBeGreaterThan(supported);
  });

  it("still paints above content, so any overlap would be visible", () => {
    // The bar is deliberately raised. That is what turned a 2px overlap into
    // an opaque cover over the supported-models summary.
    const rule = responsive.match(
      /\.device-connect-footer\s*\{[^}]*\}/,
    )?.[0];
    expect(rule).toMatch(/z-index:\s*var\(--z-raised\)/);
    expect(rule).toMatch(/position:\s*sticky/);
  });
});
