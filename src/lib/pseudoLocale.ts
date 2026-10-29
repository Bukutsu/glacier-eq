/** Keep interpolation intact so test-language labels still show real data. */
function pseudoLocalize(value: string): string {
  const accents: Record<string, string> = {
    a: "á",
    e: "ë",
    i: "ï",
    o: "ô",
    u: "ü",
    A: "Á",
    E: "Ë",
    I: "Ï",
    O: "Ô",
    U: "Ü",
  };
  const expanded = value
    .split(/({{.*?}}|<[^>]*>)/g)
    .map((part) =>
      part.startsWith("{{") || part.startsWith("<")
        ? part
        : part.replace(/[aeiouAEIOU]/g, (char) => accents[char]),
    )
    .join("");
  return `［${expanded}${"~".repeat(Math.ceil(value.length * 0.3))}］`;
}

export function pseudoResources(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      typeof entry === "string"
        ? pseudoLocalize(entry)
        : pseudoResources(entry as Record<string, unknown>),
    ]),
  );
}
