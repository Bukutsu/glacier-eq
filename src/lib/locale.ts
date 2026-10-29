import languages from "@/locales/languages.json";

export const LANGUAGE_STORAGE_KEY = "glacier.language";
export const SYSTEM_LANGUAGE = "system";
export const PSEUDO_LANGUAGE = "en-XA";
type Language = keyof typeof languages;

export const languageOptions: { value: string; label: string }[] = [
  ...Object.entries(languages).map(([value, { name }]) => ({
    value,
    label: name,
  })),
  ...(import.meta.env.DEV
    ? [
        {
          value: PSEUDO_LANGUAGE,
          label: "［Test language · expanded English］",
        },
      ]
    : []),
];

export function isLanguagePreference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value === SYSTEM_LANGUAGE ||
      languageOptions.some(({ value: code }) => code === value))
  );
}

/** Prefer exact tags/parents, then a supported regional variant in the same script. */
export function resolveLanguage(
  preference: string,
  preferred: readonly string[],
): string {
  if (preference !== SYSTEM_LANGUAGE && isLanguagePreference(preference))
    return preference;
  for (const candidate of preferred) {
    let tag: string;
    let requested: Intl.Locale;
    try {
      requested = new Intl.Locale(candidate).maximize();
      tag = Intl.getCanonicalLocales(candidate)[0];
    } catch {
      continue;
    }
    while (tag) {
      const match = Object.keys(languages).find(
        (code) => code.toLowerCase() === tag.toLowerCase(),
      );
      if (match) return match;
      tag = tag.slice(0, tag.lastIndexOf("-") < 0 ? 0 : tag.lastIndexOf("-"));
    }
    // e.g. pt-PT → pt-BR and zh-SG/zh-Hans → zh-CN. Do not map
    // Traditional Chinese (Hant) to Simplified Chinese (Hans).
    const compatible = Object.keys(languages).find((code) => {
      const available = new Intl.Locale(code).maximize();
      return (
        available.language === requested.language &&
        available.script === requested.script
      );
    });
    if (compatible) return compatible;
  }
  return "en";
}

export function languageDirection(language: string): "ltr" | "rtl" {
  return languages[language as Language]?.direction === "rtl" ? "rtl" : "ltr";
}
