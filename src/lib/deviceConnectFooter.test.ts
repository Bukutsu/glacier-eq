// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const chooser = readFileSync(new URL("../components/DeviceChooser.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/device-selection.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../styles/layout.css", import.meta.url), "utf8");

describe("device chooser mobile actions", () => {
  it("places the scrollable list and footer as siblings", () => {
    expect(chooser).toMatch(/<div className="device-chooser-content">[\s\S]*<\/div>\s*<div className="device-connect-footer">/);
    expect(styles).toMatch(/\.device-card\s*\{[^}]*flex-direction:\s*column/);
    expect(styles).toMatch(/\.device-chooser-content\s*\{[^}]*flex:\s*1/);
  });

  it("keeps the action large and above the phone safe area", () => {
    expect(styles).toMatch(/\.device-actions \.btn\s*\{[^}]*min-height:\s*52px/);
    expect(layout).toMatch(/\.device-modal \.device-connect-footer\s*\{[^}]*safe-area-bottom/);
  });

  it("shows selection independently of color", () => {
    expect(chooser).toMatch(/role="radio"[\s\S]*aria-checked=\{selected\}/);
    expect(chooser).toContain('selected ? "radio_button_checked" : "radio_button_unchecked"');
  });
});
