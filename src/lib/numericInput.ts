/** Parse the whole field, accepting either decimal separator but not grouping. */
export function parseNumericInput(raw: string): number | null {
  const text = raw.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}
