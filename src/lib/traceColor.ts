import { mixHex } from "./materialYou";

/** Theme the displayed trace, never its stored color or measured values.
 * CSS-variable colors already follow the theme; leave those and non-hex colors alone. */
export function traceDisplayColor(color: string, neutral: string, mix: number): string {
  return mix > 0 && /^#[0-9a-f]{6}$/i.test(color)
    ? mixHex(color, neutral, mix)
    : color;
}

/** Resolve palette-based traces through the plot palette, not UI accents. */
export function plotTraceColor(color: string): string {
  return color.replace(/^var\(--(red|orange|yellow|green|teal|cyan|blue|purple|teal2|magenta2)\)$/, "var(--plot-$1)");
}

/** CSS resolves this live when the theme changes, including memoized curve lists. */
export function traceSwatchColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color)
    ? `color-mix(in srgb, ${color} calc((1 - var(--trace-color-mix)) * 100%), var(--trace-color-neutral))`
    : plotTraceColor(color);
}
