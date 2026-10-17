import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const base = readFileSync(
  new URL("../../styles/base.css", import.meta.url),
  "utf8",
);
const mobile = readFileSync(
  new URL("../../styles/mobile.css", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const responsive = readFileSync(
  new URL("../../styles/responsive.css", import.meta.url),
  "utf8",
);

describe("mobile navigation and touch affordances", () => {
  it("uses custom pressed feedback instead of WebView tap overlays", () => {
    expect(base).toContain(
      "html { -webkit-tap-highlight-color: transparent; }",
    );
    expect(base).not.toContain("-webkit-tap-highlight-color: rgb(");
    expect(base).toContain("button:focus-visible");
    expect(mobile).toContain(":active:not(:disabled)");
    expect(mobile).toContain("background: var(--accent)");
  });
  it("remembers the current subsection before switching workspace tabs", () => {
    expect(app).toContain(
      "mobileWorkspacePathsRef.current[currentTab] = location.pathname",
    );
    expect(app).toContain(
      "navigate(mobileWorkspacePathsRef.current[id] ?? workspacePath(id))",
    );
    expect(app).toContain("[navigate, location.pathname]");
  });
  it("honors reduced motion when retapping the current tab", () => {
    expect(app).toMatch(
      /window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\s*\.matches\s*\?\s*"auto"\s*:\s*"smooth"/,
    );
  });
  it("sizes controls by the mobile breakpoint, including hybrid pointers", () => {
    expect(mobile).toContain("(max-width: 850px)");
    expect(mobile).toContain("min-width: var(--touch-md)");
    expect(mobile).toContain("min-height: var(--touch-md)");
    expect(mobile).toContain(".app-select-trigger");
    expect(mobile).toContain(".ui-menu-item");
    expect(mobile).toContain(".graph-collapse-btn");
  });
  it("shows mobile recovery in the workspace without forcing the full header open", () => {
    expect(app).toMatch(
      /const draftRecovery\s*=\s*!isMobile && recoveryPending/,
    );
    expect(app).toContain("<MobileDraftRecovery");
    expect(app).toContain(
      'compact={isMobile && activeTab !== "eq" && !isBusy}',
    );
  });
  it("pins the graph for expanded band settings without covering short screens or the keyboard", () => {
    expect(mobile).toContain("@media (min-height: 600px)");
    expect(mobile).toContain(":root:not(.keyboard-open)");
    expect(mobile).toContain(
      ":has(.band-more-settings[open]) .mobile-graph-eq:not(.collapsed)",
    );
    expect(mobile).toContain("position: sticky;");
    expect(mobile).toContain("scroll-padding-top: clamp(");
  });
  it("keeps mobile graph dots display-only while retaining desktop editing", () => {
    expect(app).toContain(
      "withEditor && !isMobile && !recoveryPending ? graphEditorProps : {}",
    );
  });
  it("allows vertical page scrolling from the horizontal band picker", () => {
    expect(mobile).toContain(".band-picker-scroll { touch-action: auto; }");
  });
  it("keeps compact navigation above the bottom safe area", () => {
    expect(responsive).toContain(
      "calc(56px + var(--safe-area-bottom, 0px) + 16px)",
    );
    expect(responsive).not.toContain("calc(46px + 12px)");
    expect(mobile).toContain(
      "grid-template-columns: repeat(2, minmax(0, 1fr))",
    );
  });
});
