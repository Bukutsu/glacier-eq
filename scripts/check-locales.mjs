import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../src/locales/", import.meta.url);
const languages = JSON.parse(
  readFileSync(new URL("languages.json", root), "utf8"),
);
const read = (locale, file) =>
  JSON.parse(readFileSync(new URL(`${locale}/${file}`, root), "utf8"));
export function flattenCatalog(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Expected an object at ${prefix}`);
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const location = prefix ? `${prefix}.${key}` : key;
      if (typeof entry === "string") {
        if (!entry.trim()) throw new Error(`Empty translation: ${location}`);
        return [[location, entry]];
      }
      return Object.entries(flattenCatalog(entry, location));
    }),
  );
}
function variables(value) {
  return [
    ...new Set(
      [...value.matchAll(/{{\s*([^},]+)(?:,[^}]+)?}}/g)].map((match) =>
        match[1].trim(),
      ),
    ),
  ]
    .sort()
    .join(",");
}
function componentTags(value) {
  return [
    ...new Set(
      [...value.matchAll(/<\/?([A-Za-z0-9]+)(?:\s[^>]*)?\/?\s*>/g)].map(
        (match) => match[1],
      ),
    ),
  ]
    .sort()
    .join(",");
}
export function compareCatalogs(source, translated, locale) {
  const failures = [];
  const original = flattenCatalog(source);
  const target = flattenCatalog(translated);
  // Languages have different plural categories. Require their categories below,
  // comparing interpolation against the English "other" form.
  const base = (key) => key.replace(/_(zero|one|two|few|many|other)$/, "");
  for (const [key, value] of Object.entries(original)) {
    if (/_(zero|one|two|few|many|other)$/.test(key)) continue;
    if (!(key in target)) failures.push(`Missing ${locale}:${key}`);
  }
  const pluralBases = new Set(
    Object.keys(original)
      .filter((key) => /_other$/.test(key))
      .map(base),
  );
  for (const key of pluralBases) {
    for (const category of new Intl.PluralRules(locale).resolvedOptions()
      .pluralCategories) {
      const pluralKey = `${key}_${category}`;
      if (!(pluralKey in target))
        failures.push(`Missing ${locale}:${pluralKey}`);
    }
  }
  for (const [key, value] of Object.entries(target)) {
    const sourceValue =
      original[key] ??
      (pluralBases.has(base(key)) ? original[`${base(key)}_other`] : undefined);
    if (sourceValue === undefined) failures.push(`Unknown ${locale}:${key}`);
    else {
      if (variables(sourceValue) !== variables(value))
        failures.push(`Interpolation mismatch ${locale}:${key}`);
      if (componentTags(sourceValue) !== componentTags(value))
        failures.push(`Component tag mismatch ${locale}:${key}`);
    }
  }
  return failures;
}
export function checkLocales() {
  const files = readdirSync(new URL("en/", root))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const errors = [];
  if (!Object.hasOwn(languages, "en"))
    errors.push("Missing source language registration: en");
  for (const [locale, metadata] of Object.entries(languages)) {
    if (Intl.getCanonicalLocales(locale)[0] !== locale)
      errors.push(`Use a canonical language tag: ${locale}`);
    if (
      !metadata ||
      typeof metadata.name !== "string" ||
      !metadata.name.trim() ||
      !["ltr", "rtl"].includes(metadata.direction)
    )
      errors.push(`Invalid language metadata: ${locale}`);
    const actual = readdirSync(new URL(`${locale}/`, root))
      .filter((file) => file.endsWith(".json"))
      .sort();
    if (JSON.stringify(files) !== JSON.stringify(actual))
      errors.push(`Namespace mismatch: ${locale}`);
    for (const file of files) {
      try {
        errors.push(
          ...compareCatalogs(read("en", file), read(locale, file), locale).map(
            (error) => `${file}: ${error}`,
          ),
        );
      } catch (error) {
        errors.push(`${locale}/${file}: ${error.message}`);
      }
    }
  }
  const folders = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const folder of folders)
    if (!(folder in languages))
      errors.push(`Unregistered language folder: ${folder}`);
  if (errors.length) throw new Error(errors.join("\n"));
  return `Catalogs valid: ${Object.keys(languages).length} language(s), ${files.length} namespaces.`;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(checkLocales());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
