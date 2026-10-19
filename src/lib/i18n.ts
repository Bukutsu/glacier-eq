import { createInstance, type Resource } from "i18next";
import { initReactI18next } from "react-i18next";
import { readLocalStorage, writeLocalStorage } from "./safeStorage";
import {
  isLanguagePreference,
  LANGUAGE_STORAGE_KEY,
  SYSTEM_LANGUAGE,
  PSEUDO_LANGUAGE,
  resolveLanguage,
  languageDirection,
} from "./locale";
import { pseudoResources } from "./pseudoLocale";

// Bundle every catalog: desktop, Android, and web work without a translation server.
const catalogs = import.meta.glob<Record<string, unknown>>(
  "../locales/*/*.json",
  { eager: true, import: "default" },
);
const resources: Resource = {};
for (const [path, catalog] of Object.entries(catalogs)) {
  const [, language, namespace] = path.match(
    /\/locales\/([^/]+)\/([^/]+)\.json$/,
  )!;
  (resources[language] ??= {})[namespace] = catalog;
}
if (import.meta.env.DEV) {
  resources[PSEUDO_LANGUAGE] = pseudoResources(
    resources.en,
  ) as Resource[string];
}

const cached = readLocalStorage(LANGUAGE_STORAGE_KEY);
let preference = isLanguagePreference(cached) ? cached : SYSTEM_LANGUAGE;
function systemLanguages(): readonly string[] {
  return typeof navigator === "undefined"
    ? []
    : (navigator.languages ?? [navigator.language]);
}

export const i18n = createInstance();
void i18n.use(initReactI18next).init({
  resources,
  lng: resolveLanguage(preference, systemLanguages()),
  fallbackLng: "en",
  supportedLngs: Object.keys(resources),
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

export function getLanguagePreference(): string {
  return preference;
}

export async function setLanguagePreference(value: string): Promise<boolean> {
  if (!isLanguagePreference(value))
    throw new Error(`Unsupported language preference: ${value}`);
  preference = value;
  const saved = writeLocalStorage(LANGUAGE_STORAGE_KEY, value);
  await i18n.changeLanguage(resolveLanguage(value, systemLanguages()));
  return saved;
}

if (typeof window !== "undefined") {
  window.addEventListener("languagechange", () => {
    if (preference === SYSTEM_LANGUAGE) {
      void i18n.changeLanguage(resolveLanguage(preference, systemLanguages()));
    }
  });
}
