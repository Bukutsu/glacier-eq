import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Slider } from "./Slider";

describe("slider track feedback", () => {
  it("fills positive and negative gain from zero", () => {
    const render = (value: number) => renderToStaticMarkup(createElement(Slider, { min: -12, max: 12, value }));
    expect(render(6)).toContain("--slider-fill-start:50%;--slider-fill-end:75%");
    expect(render(-6)).toContain("--slider-fill-start:25%;--slider-fill-end:50%");
    expect(render(0)).toContain('class="slider-zero-mark" aria-hidden="true"');
  });
  it("fills unipolar controls from their minimum without a zero marker", () => {
    const html = renderToStaticMarkup(createElement(Slider, { min: 0, max: 1000, value: 250 }));
    expect(html).toContain("--slider-fill-start:0%;--slider-fill-end:25%");
    expect(html).not.toContain("slider-zero-mark");
  });
  it("clamps visual feedback at range boundaries", () => {
    const html = renderToStaticMarkup(createElement(Slider, { min: 0, max: 100, value: 200 }));
    expect(html).toContain("--slider-fill-end:100%");
  });
});
