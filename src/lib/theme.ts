/**
 * Theme utility — reads CSS custom properties at runtime.
 *
 * All color tokens are defined in src/styles/base.css as both hex (--name)
 * and space-separated RGB (--name-rgb) values for rgba() usage.
 *
 * For canvas/JS contexts, use cssVar() to resolve a hex token at runtime.
 * This keeps all colour authority in CSS and enables future theme switching.
 */

let cache: Map<string, string> | null = null;

function resolvedVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  // Use a simple LRU-ish cache — cleared when the DOM is replaced
  if (!cache) cache = new Map();
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const value =
    getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim() || fallback;
  cache.set(name, value);
  return value;
}

/** Read a CSS custom property (e.g. `--cyan`) as a hex string. */
export function cssVar(name: string, fallback = ""): string {
  return resolvedVar(name, fallback);
}

/**
 * Resolve a `--name-rgb` variable to `rgba(r, g, b, alpha)`.
 * Falls back to parsing the hex fallback if the -rgb token is missing.
 */
export function rgbWithAlpha(
  name: string,
  alpha: number,
  fallback = "",
): string {
  const resolved = resolvedVar(name, fallback);
  if (!resolved) return "transparent";

  // If the resolved value is already space-separated RGB, use it directly
  if (/^-?\d+\s+-?\d+\s+-?\d+$/.test(resolved)) {
    return `rgba(${resolved}, ${alpha})`;
  }

  // Otherwise try to parse as hex
  const hex = resolved.replace("#", "");
  if (hex.length === 6) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return resolved;
}


/** Invalidate the theme cache (call after theme/class changes). */
export function clearThemeCache() {
  cache = null;
}
