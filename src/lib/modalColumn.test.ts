// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const layout = readFileSync(new URL("../styles/layout.css", import.meta.url), "utf8");
const chooserStyles = readFileSync(new URL("../styles/device-selection.css", import.meta.url), "utf8");
const rule = (css: string, selector: string) =>
  css.match(new RegExp(`${selector}\\s*\\{[^}]*\\}`))?.[0] ?? "";

describe("Connect DAC modal column", () => {
  it("uses one 16px inset for the title, scrollable content and footer", () => {
    expect(rule(layout, "\\.modal-header")).toMatch(/padding:\s*14px 16px 10px/);
    expect(rule(layout, "\\.device-modal \\.modal-body")).toMatch(/padding:\s*0/);
    expect(rule(chooserStyles, "\\.device-chooser-content")).toMatch(/padding:\s*var\(--space-4\)/);
    expect(rule(chooserStyles, "\\.device-connect-footer")).toMatch(/padding:\s*var\(--space-3\) var\(--space-4\)/);
  });

  it("confines scrolling to the content, not the header or footer", () => {
    expect(rule(layout, "dialog\\.modal-content\\.device-modal")).toMatch(/overflow:\s*hidden/);
    expect(rule(layout, "\\.device-modal \\.modal-body")).toMatch(/overflow:\s*hidden/);
    expect(rule(chooserStyles, "\\.device-chooser-content")).toMatch(/overflow-y:\s*auto/);
    expect(rule(chooserStyles, "\\.device-connect-footer")).toMatch(/flex-shrink:\s*0/);
  });
});
