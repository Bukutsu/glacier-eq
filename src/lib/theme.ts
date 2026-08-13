export function cssVar(name: string, fallback = ""): string {
  if (typeof document === "undefined") return fallback;
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim() || fallback
  );
}

export function rgbWithAlpha(
  name: string,
  alpha: number,
  fallback = "",
): string {
  const resolved = cssVar(name, fallback);
  if (!resolved) return "transparent";

  if (resolved.startsWith("#")) {
    const hex = Number.parseInt(resolved.slice(1), 16);
    return `rgba(${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}, ${alpha})`;
  }

  // `resolved` is a space-separated triplet (e.g. "122 162 247"); use the
  // modern slash syntax — mixing spaces with a comma is invalid CSS.
  return `rgba(${resolved} / ${alpha})`;
}
