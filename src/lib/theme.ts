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

  if (resolved.startsWith("#")) {
    const hex = Number.parseInt(resolved.slice(1), 16);
    return `rgba(${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}, ${alpha})`;
  }

  return `rgba(${resolved}, ${alpha})`;
}
export function clearThemeCache() {
  cache = {};
}
