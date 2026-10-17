import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemePicker, THEME_PREVIEWS } from "./ThemePicker";
import { themeOptions } from "@/features/settings/lib/theme";

describe("theme previews", () => {
  it("renders one labeled native radio per theme and one explicit selection", () => {
    const html = renderToStaticMarkup(
      createElement(ThemePicker, {
        value: "tokyo-night",
        options: themeOptions(true),
        onChange: () => {},
      }),
    );
    expect(html.match(/type="radio"/g)).toHaveLength(themeOptions(true).length);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toMatch(
      /<input(?=[^>]*value="tokyo-night")(?=[^>]*checked="")[^>]*>/,
    );
    expect(html).toContain("Color theme");
    expect(html).toContain("System (Material You)");
    expect(html).toContain("background-color:#20212b");
  });
  it("does not offer system palette on the web", () => {
    const html = renderToStaticMarkup(
      createElement(ThemePicker, {
        value: "auto",
        options: themeOptions(false),
        onChange: () => {},
      }),
    );
    expect(html).not.toContain('value="material-you"');
    expect(html).toContain("Auto (system theme)");
  });
  it("provides samples for every static theme", () => {
    for (const option of themeOptions(false)) {
      if (option.value === "auto") continue;
      expect(THEME_PREVIEWS[option.value]).toHaveLength(3);
    }
  });
});
