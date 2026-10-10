// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NumberInput } from "../components/NumberInput";

const render = (value: number) =>
  renderToStaticMarkup(
    createElement(NumberInput, {
      value,
      min: 0,
      max: 10,
      onChange: () => {},
    }),
  );

/**
 * `.stepper-btn` is transparent over its container's `--input-bg` so the whole
 * control reads as one uniform field. The global disabled-button rule matched
 * any `button:disabled` and painted an opaque `--surface-disabled` on top, so a
 * stepper that reached min or max split into two visibly different shades —
 * the normal state for the first and last band. It also forced
 * `opacity: 1 !important`, cancelling the stepper's own `opacity: 0.18`.
 */
describe("stepper keeps one uniform fill when a bound is reached", () => {
  const base = readFileSync(
    new URL("../styles/base.css", import.meta.url),
    "utf8",
  );
  const tools = readFileSync(
    new URL("../styles/ui.css", import.meta.url),
    "utf8",
  );

  it("exempts stepper buttons from the global disabled fill", () => {
    expect(base).toMatch(/button:disabled:not\(\.stepper-btn\)/);
    // The bare selector is what leaked; it must not come back.
    const disabledRule = base.match(
      /button:disabled[^{]*\{[^}]*\}/,
    )?.[0];
    expect(disabledRule).toBeDefined();
    expect(disabledRule).toMatch(/:not\(\.stepper-btn\)/);
  });

  it("keeps the stepper's own disabled treatment intact", () => {
    // The exemption is only correct because the stepper defines its own.
    expect(tools).toMatch(
      /\.custom-number-input \.stepper-btn:disabled\s*\{[^}]*opacity:/,
    );
    expect(tools).toMatch(
      /\.custom-number-input \.stepper-btn\s*\{[^}]*background:\s*transparent/,
    );
  });

  it("actually disables a button at each bound", () => {
    // Wiring: the CSS fix is only reachable if the component really sets
    // disabled at min/max. Without this the exemption would be dead code.
    // At min the decrement button is disabled, at max the increment is.
    expect(render(0)).toMatch(/<button(?=[^>]*stepper-btn decrement)(?=[^>]*disabled="")[^>]*>/);
    expect(render(10)).toMatch(/<button(?=[^>]*stepper-btn increment)(?=[^>]*disabled="")[^>]*>/);
    // Mid-range neither is disabled, so nothing is exempt and nothing splits.
    expect(render(5)).not.toContain('disabled=""');
  });
});
