let cache: Record<string, string> = {};

function resolvedVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const cached = cache[name];
  if (cached !== undefined) return cached;
  const value =
    getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim() || fallback;
  cache[name] = value;
  return value;
}

export function cssVar(name: string, fallback = ""): string {
  return resolvedVar(name, fallback);
}

export function rgbWithAlpha(
  name: string,
  alpha: number,
  fallback = "",
): string {
  const resolved = resolvedVar(name, fallback);
  if (!resolved) return "transparent";

  if (/^-?\d+\s+-?\d+\s+-?\d+$/.test(resolved)) {
    return `rgba(${resolved}, ${alpha})`;
  }

  const hex = resolved.replace("#", "");
  if (hex.length === 6) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return resolved;
}
export function clearThemeCache() {
  cache = {};
}
