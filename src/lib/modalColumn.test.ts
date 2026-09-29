// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The Connect DAC modal nests two insets between the dialog and its content:
 *
 *   .modal-header  padding: 14px 16px 10px   -> content at 16px
 *   .modal-body    padding: 16px              -> child at 16px
 *   .device-card   padding: 18px (mobile)     -> content at 34px
 *
 * So the title "Connect DAC" sat 18px left of every element below it. Desktop
 * does not have the problem: .device-card's base padding is 0, so body content
 * lands on the header's 16px. The mobile-only 18px was the single breakpoint
 * that broke it.
 *
 * The rule: a nested container never re-adds an inset its parent supplies,
 * because the header is measured from a different parent than the body.
 */
describe("modal title and body share one left edge", () => {
  const layout = readFileSync(
    new URL("../styles/layout.css", import.meta.url),
    "utf8",
  );
  const responsive = readFileSync(
    new URL("../styles/responsive.css", import.meta.url),
    "utf8",
  );
  const deviceSelection = readFileSync(
    new URL("../styles/device-selection.css", import.meta.url),
    "utf8",
  );

  /** The block of a simple `sel { ... }` rule, or "" if absent. */
  const rule = (css: string, selector: string) =>
    css.match(new RegExp(`${selector}\\s*\\{[^}]*\\}`))?.[0] ?? "";

  /** Parses a CSS length as a number, or NaN if it is not one. */
  const px = (value: string | undefined | null): number =>
    value == null ? Number.NaN : parseFloat(value);

  /**
   * The horizontal components of a `padding` declaration, as [left, right].
   * Handles the 1-4 value shorthand so this reads real CSS rather than
   * matching one specific spelling.
   */
  const horizontalPadding = (block: string): [string, string] | null => {
    const match = block.match(/padding\s*:\s*([^;}]+)/);
    if (!match?.[1]) return null;
    const v = match[1].trim().split(/\s+/);
    if (v.length === 1) return [v[0]!, v[0]!];
    if (v.length === 2) return [v[1]!, v[1]!];
    if (v.length === 3) return [v[1]!, v[1]!];
    return [v[3]!, v[1]!];
  };

  it("computes the shorthand rather than matching one spelling", () => {
    // Guard: if this helper broke it would report NaN/0 and the alignment
    // assertions below could pass for the wrong reason.
    const pad = (decl: string) => horizontalPadding(`.x { ${decl} }`);
    expect(pad("padding: 14px 16px 10px")).toEqual(["16px", "16px"]);
    expect(pad("padding: 16px")).toEqual(["16px", "16px"]);
    expect(pad("padding: 0")).toEqual(["0", "0"]);
    expect(pad("padding: 1px 2px 3px 4px")).toEqual(["4px", "2px"]);
    expect(pad("padding-block: 1px")).toBeNull();
    expect(px("34px")).toBe(34);
    expect(px(undefined)).toBeNaN();
  });

  it("lands body content on the header's edge at both breakpoints", () => {
    const header = px(horizontalPadding(rule(layout, ".modal-header"))?.[0]);
    const body = px(horizontalPadding(rule(layout, ".modal-body"))?.[0]);

    const desktop = px(
      horizontalPadding(rule(deviceSelection, "\\.device-card"))?.[0],
    );
    const mobile = px(
      horizontalPadding(rule(responsive, "\\.device-card"))?.[0],
    );

    // None of these may be missing, or the addition below is meaningless.
    for (const [name, value] of [
      ["header", header],
      ["modal-body", body],
      ["device-card desktop", desktop],
      ["device-card mobile", mobile],
    ] as const) {
      expect(value, `${name} padding did not parse`).not.toBeNaN();
    }

    for (const [where, card] of [
      ["desktop", desktop],
      ["mobile", mobile],
    ] as const) {
      expect(
        body + card,
        `${where}: body content must land on the header's ${header}px`,
      ).toBe(header);
    }
  });

  it("does not add a right-side inset either", () => {
    // Left edge is what the eye checks, but an asymmetric inset would shear
    // the column and make the close button look off-centre.
    const header = px(horizontalPadding(rule(layout, ".modal-header"))?.[1]);
    const body = px(horizontalPadding(rule(layout, ".modal-body"))?.[1]);
    const desktop = px(
      horizontalPadding(rule(deviceSelection, "\\.device-card"))?.[1],
    );
    const mobile = px(
      horizontalPadding(rule(responsive, "\\.device-card"))?.[1],
    );

    for (const card of [desktop, mobile]) {
      expect(body + card).toBe(header);
    }
  });

  it("keeps an explicit zero on the mobile card", () => {
    // The declaration is redundant with the base rule, but it is the guard:
    // someone adding touch padding here re-breaks the header alignment, and
    // this is where the test reads.
    expect(responsive).toMatch(/\.device-card\s*\{[^}]*padding:\s*0\s*;/);
  });
});
