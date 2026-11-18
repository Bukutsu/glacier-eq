import { createInstance, type Resource } from "i18next";
import { initReactI18next } from "react-i18next";
import { readLocalStorage, writeLocalStorage } from "./safeStorage";
import {
  isLanguagePreference,
  languageOptions,
  LANGUAGE_STORAGE_KEY,
  SYSTEM_LANGUAGE,
  PSEUDO_LANGUAGE,
  resolveLanguage,
  languageDirection,
} from "./locale";
import { pseudoResources } from "./pseudoLocale";

// English is the fallback and ships in the main bundle. Other catalogs are
// separate chunks fetched on demand, so a visitor downloads one language.
const english = import.meta.glob<Record<string, unknown>>(
  "../locales/en/*.json",
  { eager: true, import: "default" },
);
const others = import.meta.glob<Record<string, unknown>>(
  ["../locales/*/*.json", "!../locales/en/*.json"],
  { import: "default" },
);
const resources: Resource = { en: {} };
for (const [path, catalog] of Object.entries(english)) {
  const [, namespace] = path.match(/\/([^/]+)\.json$/)!;
  resources.en[namespace] = catalog;
}
if (import.meta.env.DEV) {
  resources[PSEUDO_LANGUAGE] = pseudoResources(
    resources.en,
  ) as Resource[string];
}

async function loadLanguage(language: string): Promise<void> {
  const loads = Object.entries(others)
    .filter(([path]) => path.includes(`/locales/${language}/`))
    .map(async ([path, load]) => {
      const [, namespace] = path.match(/\/([^/]+)\.json$/)!;
      i18n.addResourceBundle(language, namespace, await load(), true, true);
    });
  await Promise.all(loads);
}

const cached = readLocalStorage(LANGUAGE_STORAGE_KEY);
let preference = isLanguagePreference(cached) ? cached : SYSTEM_LANGUAGE;
function systemLanguages(): readonly string[] {
  return typeof navigator === "undefined"
    ? []
    : (navigator.languages ?? [navigator.language]);
}

export const i18n = createInstance();
const initialLanguage = resolveLanguage(preference, systemLanguages());
void i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  supportedLngs: languageOptions.map(({ value }) => value),
  defaultNS: "shell",
  ns: Object.keys(resources.en),
  initAsync: false,
  returnNull: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false }, // React escapes text, including interpolated user data.
  react: { useSuspense: false },
});

function updateDocument(language: string) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  document.documentElement.dir = languageDirection(language);
}
i18n.on("languageChanged", updateDocument);
updateDocument(i18n.resolvedLanguage ?? "en");

// Catalog loads can finish out of order; only the latest request may apply.
let requestedLanguage = "en";
async function switchLanguage(language: string): Promise<void> {
  requestedLanguage = language;
  await loadLanguage(language);
  if (requestedLanguage === language) await i18n.changeLanguage(language);
}

/** Resolves once the stored language is loaded; render after it to avoid an English flash. */
export const i18nReady: Promise<void> =
  initialLanguage === "en" ? Promise.resolve() : switchLanguage(initialLanguage);

export function getLanguagePreference(): string {
  return preference;
}

export async function setLanguagePreference(value: string): Promise<boolean> {
  if (!isLanguagePreference(value))
    throw new Error(`Unsupported language preference: ${value}`);
  preference = value;
  const saved = writeLocalStorage(LANGUAGE_STORAGE_KEY, value);
  await switchLanguage(resolveLanguage(value, systemLanguages()));
  return saved;
}

if (typeof window !== "undefined") {
  window.addEventListener("languagechange", () => {
    if (preference === SYSTEM_LANGUAGE) {
      void switchLanguage(resolveLanguage(preference, systemLanguages()));
    }
  });
}
