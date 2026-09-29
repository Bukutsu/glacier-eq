// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * `.device-card` has `padding: 18px` on mobile, so every child sits on the
 * same content column: the setup steps, the browser warning, the scan button,
 * the hint, the device rows, and both <details>. `.device-connect-footer` was
 * the one exception, cancelling the padding with `margin: 0 -18px` so its
 * background, border-top and blur sat 18px past the column on each side. Its
 * Connect button still lined up, because the matching `padding: 0 18px`
 * cancelled the margin exactly — so the misalignment was visible only in the
 * bar's own box, which is what read as a step across the column.
 */
describe("device card children share one column", () => {
  const responsive = readFileSync(
    new URL("../styles/responsive.css", import.meta.url),
    "utf8",
  );
  const chooser = readFileSync(
    new URL("../components/DeviceChooser.tsx", import.meta.url),
    "utf8",
  );

  /** Every child the chooser renders inside .device-card. */
  const children = [
    "device-setup-steps",
    "device-browser-warning",
    "device-scan-btn",
    "device-selection-hint",
    "device-connect-footer",
    "supported-list",
    "device-troubleshooting",
  ];

  const rulesFor = (cls: string) =>
    [...responsive.matchAll(new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`, "g"))].map(
      (m) => m[0],
    );

  /**
   * The inline (left/right) components of a rule's margins, or [] if it has
   * none. Vertical nudges are legitimate here — `.device-selection-hint` uses
   * `margin-top: -2px` to tighten the gap above it — so they are excluded
   * rather than flagged.
   */
  const inlineMargins = (rule: string): string[] => {
    const out: string[] = [];
    for (const m of rule.matchAll(
      /(?<prop>margin|margin-inline|margin-inline-start|margin-inline-end|margin-left|margin-right)\s*:\s*([^;}]+)/g,
    )) {
      const values = (m[2] ?? "").trim().split(/\s+/);
      if (m.groups?.prop === "margin") {
        // 1-4 value shorthand: left is the 2nd, right the 4th.
        if (values.length >= 2) out.push(values[1] ?? "");
        if (values.length >= 4) out.push(values[3] ?? "");
      } else {
        out.push(values[0] ?? "");
      }
    }
    return out;
  };

  it("gives no child a negative horizontal margin", () => {
    // Any negative inline margin on a card child is a horizontal bleed, and
    // it silently widens that one child past the column.
    // The label goes in expect's message argument, never inside the asserted
    // string: /^-/ is anchored, so prefixing the value would make it vacuous.
    for (const cls of children) {
      for (const rule of rulesFor(cls)) {
        for (const value of inlineMargins(rule)) {
          expect(value, `${cls} in ${rule}`).not.toMatch(/^-\d/);
        }
      }
    }
  });

  it("scans more than one child, not just the footer", () => {
    // Guards the loop above: if the per-child list shrank to a single entry
    // the bleed test would still pass while covering almost nothing. A child
    // may legitimately have no mobile override, so this counts the ones that
    // do rather than demanding all of them match.
    const scanned = children.filter((cls) => rulesFor(cls).length > 0);
    expect(scanned.length).toBeGreaterThan(1);
    expect(scanned).toContain("device-connect-footer");
    expect(scanned).toContain("device-selection-hint");
  });

  it("reads margins correctly", () => {
    // Guards the helper itself: if it stopped finding inline values the bleed
    // test would pass vacuously.
    expect(inlineMargins(".x { margin-top: -2px; }")).toEqual([]);
    expect(inlineMargins(".x { margin-block-start: -2px; }")).toEqual([]);
    expect(inlineMargins(".x { margin: 0 -18px; }")).toEqual(["-18px"]);
    expect(inlineMargins(".x { margin: 1px 2px 3px 4px; }")).toEqual([
      "2px",
      "4px",
    ]);
    expect(inlineMargins(".x { margin-left: -4px; }")).toEqual(["-4px"]);
  });

  it("drops the footer's compensating padding too", () => {
    // The margin and the padding cancelled, so the button looked right while
    // the bar did not. Both have to go or the column is still broken.
    const rule = rulesFor("device-connect-footer").find((r) =>
      r.includes("position"),
    );
    expect(rule).toBeDefined();
    expect(rule).toMatch(/margin:\s*0;/);
    expect(rule).toMatch(/padding:\s*10px 0 /);
  });

  it("still pins the bar to the bottom of the card", () => {
    // Losing the bleed must not cost the sticky behaviour the bar exists for.
    const rule = rulesFor("device-connect-footer").find((r) =>
      r.includes("position"),
    );
    expect(rule).toMatch(/position:\s*sticky/);
    expect(rule).toMatch(/bottom:\s*0/);
    expect(rule).toMatch(/z-index:\s*var\(--z-raised\)/);
  });

  it("keeps the safe-area inset on the sticky bar", () => {
    // The home indicator still has to clear the bar, independently of the
    // horizontal alignment.
    const rule = rulesFor("device-connect-footer").find((r) =>
      r.includes("position"),
    );
    expect(rule).toMatch(/var\(--safe-area-bottom/);
  });

  it("checks classes the chooser actually renders", () => {
    // Wiring: a class that no longer exists would make the loop above vacuous.
    for (const cls of children) {
      expect(chooser).toContain(cls);
    }
  });
});
