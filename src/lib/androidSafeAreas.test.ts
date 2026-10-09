// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const base = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");
const responsive = readFileSync(new URL("../styles/responsive.css", import.meta.url), "utf8");

describe("Android WebView safe areas", () => {
  it("provides a top inset when Android WebView reports no safe area", () => {
    const block = base.match(/body\.is-android\s*\{[^}]*\}/)?.[0] ?? "";
    expect(block).toMatch(
      /--safe-area-top:\s*max\(24px,\s*env\(safe-area-inset-top,\s*0px\)\)/,
    );
    expect(base.match(/#app\s*\{[^}]*\}/)?.[0]).toContain("var(--safe-area-top)");
  });

  it("provides a bottom inset when Android WebView reports no safe area", () => {
    const block = base.match(/body\.is-android\s*\{[^}]*\}/)?.[0] ?? "";
    expect(block).toMatch(
      /--safe-area-bottom:\s*max\(24px,\s*env\(safe-area-inset-bottom,\s*0px\)\)/,
    );
  });

  it("keeps About text inset when the mobile stack has no padding", () => {
    expect(responsive).toMatch(
      /\.mobile-workspace \.stack-content > \.settings-plain > \.settings-plain-title,[\s\S]*?\.mobile-workspace \.stack-content > \.card-note \{\s*padding-inline:\s*16px !important;/,
    );
  });

  it("adds the bottom inset outside the tab buttons", () => {
    const block = responsive.match(
      /\.mobile-tab-bar\s*\{[^}]*height:\s*calc\(var\(--tabbar-h,\s*56px\)\s*\+\s*var\(--safe-area-bottom,\s*0px\)\)[^}]*\}/,
    )?.[0] ?? "";
    expect(block).toContain("padding: 2px");
    expect(block).toContain("var(--safe-area-bottom, 0px)");
  });

  it("keeps the inset in short landscape layouts", () => {
    expect(responsive).toMatch(
      /\.mobile-tab-bar\s*\{\s*height:\s*calc\(46px\s*\+\s*var\(--safe-area-bottom,\s*0px\)\) !important;/,
    );
  });
});
