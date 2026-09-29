// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The About section is a column of sibling blocks inside `.stack-content`, and
 * each one used to declare its own inline padding. `.settings-plain` added 16px
 * on mobile only, `.device-spec-list` added 16px always, and the trailing
 * `.card-note` added none — so the note sat flush against the left edge while
 * the headings above it were inset, and the spec rows stuck out on desktop.
 * `.stack-content` already supplies the 16px inset, so top-level children must
 * add none.
 */
describe("settings column blocks share one left edge", () => {
  const tools = readFileSync(
    new URL("../styles/tools.css", import.meta.url),
    "utf8",
  );

  it("gets the inset from the container", () => {
    // The whole fix depends on the container owning the padding; if that ever
    // changes, neutralising the children would collapse them to the edge.
    expect(tools).toMatch(/\.stack-content\s*\{[^}]*padding:\s*16px/);
  });

  it("stops every top-level block from re-adding it", () => {
    expect(tools).toMatch(
      /\.stack-content > \.settings-plain,\s*\n\s*\.stack-content > \.device-spec-list,\s*\n\s*\.stack-content > \.card-note\s*\{[^}]*padding-inline:\s*0 !important/,
    );
  });

  it("scopes the reset to direct children so cards keep their padding", () => {
    // Nested blocks (`.stack-card > .settings-plain`, `.stack-card > .card-note`)
    // rely on their own inset; a descendant selector would flatten them too.
    expect(tools).not.toMatch(/\.stack-content \.card-note\s*\{/);
    expect(tools).not.toMatch(/\.stack-content \.device-spec-list\s*\{/);
  });

  it("reaches the blocks it is meant to fix", () => {
    // Wiring: the reset only applies to these classes, and only as direct
    // children. If the About blocks get wrapped in a card the rule goes dead.
    const view = readFileSync(
      new URL("../components/SettingsView.tsx", import.meta.url),
      "utf8",
    );
    const about = view.slice(view.indexOf('{section === "about"'));
    expect(about).toBeTruthy();

    for (const cls of ["settings-plain", "device-spec-list", "card-note"]) {
      expect(about).toContain(cls);
    }
    // Nothing between `.stack-content` and these blocks, or the `>` no longer
    // matches and the old per-block padding wins again.
    expect(about).not.toContain("stack-card");
  });
});
