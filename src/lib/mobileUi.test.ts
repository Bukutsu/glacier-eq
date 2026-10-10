import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mobile = readFileSync(new URL("../styles/mobile.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const responsive = readFileSync(new URL("../styles/responsive.css", import.meta.url), "utf8");

describe("mobile navigation and touch affordances", () => {
  it("remembers the current subsection before switching workspace tabs", () => {
    expect(app).toContain("mobileWorkspacePathsRef.current[currentTab] = location.pathname");
    expect(app).toContain("navigate(mobileWorkspacePathsRef.current[id] ?? workspacePath(id))");
    expect(app).toContain('[navigate, location.pathname]');
  });
  it("honors reduced motion when retapping the current tab", () => {
    expect(app).toContain('window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"');
  });
  it("sizes controls by the mobile breakpoint, including hybrid pointers", () => {
    expect(mobile).toContain("(max-width: 850px)");
    expect(mobile).toContain("min-width: var(--touch-md)");
    expect(mobile).toContain("min-height: var(--touch-md)");
    expect(mobile).toContain(".app-select-trigger");
    expect(mobile).toContain(".ui-menu-item");
    expect(mobile).toContain(".graph-collapse-btn");
  });
  it("allows vertical page scrolling from the horizontal band picker", () => {
    expect(mobile).toContain(".band-picker-scroll { touch-action: auto; }");
  });
  it("keeps compact navigation above the bottom safe area", () => {
    expect(responsive).toContain("calc(56px + var(--safe-area-bottom, 0px) + 16px)");
    expect(responsive).not.toContain("calc(46px + 12px)");
    expect(mobile).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  });
});
