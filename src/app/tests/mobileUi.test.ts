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
    expect(app).toContain("[navigate, location.pathname, isMobile]");
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
  it("pins the graph and band chips on tall screens without covering the keyboard", () => {
    expect(mobile).toContain("@media (min-height: 700px)");
    expect(mobile).toContain(":root:not(.keyboard-open)");
    expect(mobile).toContain(
      ":has(.bands-mobile-editor) .mobile-graph-eq:not(.collapsed)",
    );
    expect(mobile).toContain("position: sticky;");
    expect(mobile).toContain("top: var(--mobile-graph-height, 215px);");
    expect(app).toContain('"--mobile-graph-height"');
  });
  it("keeps mobile graph dots display-only while retaining desktop editing", () => {
    expect(app).toContain(
      "withEditor && !isMobile && !recoveryPending ? graphEditorProps : {}",
    );
    expect(app).toContain("? setActiveBandIndex");
  });
  it("shows Device at the top of the Settings tab on phones", () => {
    expect(app).toContain(
      'const MOBILE_BAR_TABS = MOBILE_TABS.filter(({ id }) => id !== "device")',
    );
    expect(app).toContain(
      '<Navigate to={workspacePath("settings")} replace />',
    );
  });
  it("keeps the save bar above the tab bar and out of the keyboard's way", () => {
    expect(mobile).toContain(
      "bottom: calc(var(--tabbar-h, 56px) + var(--safe-area-bottom, 0px));",
    );
    expect(mobile).toContain(
      ".keyboard-open .mobile-save-bar { display: none; }",
    );
    expect(responsive).toContain(".workspace.mobile-workspace.has-save-bar");
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
