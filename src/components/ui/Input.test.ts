import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Input } from "./Input";

describe("Input", () => {
  it("preserves native search semantics and accessible labels", () => {
    const html = renderToStaticMarkup(createElement(Input, { type: "search", "aria-label": "Search profiles", value: "Daily", readOnly: true }));
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="Search profiles"');
    expect(html).toContain('value="Daily"');
    expect(html).toContain('data-slot="input"');
  });

  it("forwards form names, disabled state, and caller styling", () => {
    const html = renderToStaticMarkup(createElement(Input, { name: "profile-name", disabled: true, className: "pr-11" }));
    expect(html).toContain('name="profile-name"');
    expect(html).toContain('disabled=""');
    expect(html).toContain("pr-11");
  });
});
