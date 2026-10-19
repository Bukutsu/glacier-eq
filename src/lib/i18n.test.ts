import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLanguagePreference, i18n, setLanguagePreference } from "./i18n";
import { LANGUAGE_STORAGE_KEY, PSEUDO_LANGUAGE } from "./locale";
import languages from "@/locales/languages.json";

describe("bundled English catalogs", () => {
  it("resolves actual text, interpolation, and plurals through fixed translators", () => {
    const t = i18n.getFixedT(null, "editor");
    expect(i18n.resolvedLanguage).toBe("en");
    expect(t("draft.unfinished")).toBe("Unfinished EQ");
    expect(t("curves.measurementName", { name: "Fixture" })).toBe(
      "Measurement: Fixture",
    );
    expect(t("curves.shown", { count: 1 })).toBe("1 curve shown");
    expect(t("curves.shown", { count: 3 })).toBe("3 curves shown");
  });
});

describe("language switching", () => {
  const setItem = vi.fn();
  beforeEach(() => {
    setItem.mockReset();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem });
    vi.stubGlobal("document", { documentElement: { lang: "", dir: "" } });
  });
  afterEach(async () => {
    setItem.mockImplementation(() => {});
    await setLanguagePreference("system");
    vi.unstubAllGlobals();
  });
  it("switches bundled text and document metadata without a reload", async () => {
    expect(await setLanguagePreference(PSEUDO_LANGUAGE)).toBe(true);
    expect(getLanguagePreference()).toBe(PSEUDO_LANGUAGE);
    expect(setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, PSEUDO_LANGUAGE);
    expect(i18n.t("settings:language.title")).toContain("Lángüágë");
    expect(
      i18n.t("editor:curves.measurementName", { name: "My measurement" }),
    ).toContain("My measurement");
    expect(document.documentElement.lang).toBe(PSEUDO_LANGUAGE);
    expect(document.documentElement.dir).toBe("ltr");
    await setLanguagePreference("en");
    expect(i18n.t("settings:language.title")).toBe("Language");
  });
  it.each(Object.keys(languages).filter((language) => language !== "en"))(
    "switches to bundled %s text without English fallback",
    async (language) => {
      expect(await setLanguagePreference(language)).toBe(true);
      expect(i18n.resolvedLanguage).toBe(language);
      expect(document.documentElement.lang).toBe(language);
      expect(document.documentElement.dir).toBe("ltr");
      for (const namespace of [
        "shell",
        "settings",
        "device",
        "editor",
        "library",
      ]) {
        expect(i18n.hasResourceBundle(language, namespace)).toBe(true);
      }
      const title = i18n.getResource(language, "settings", "language.title");
      expect(title).not.toBe("Language");
      expect(i18n.t("settings:language.title")).toBe(title);
      expect(i18n.t("shell:actions.cancel")).not.toBe("Cancel");
      expect(
        i18n.t("editor:curves.measurementName", { name: "My measurement" }),
      ).toContain("My measurement");
      for (const count of [1, 2, 1_000_000]) {
        const category = new Intl.PluralRules(language).select(count);
        const message = i18n.getResource(
          language,
          "editor",
          `curves.shown_${category}`,
        );
        expect(typeof message).toBe("string");
        expect(i18n.t("editor:curves.shown", { count })).toBe(
          message.replace("{{count}}", String(count)),
        );
      }
    },
  );
  it("still switches for this session when persistence is blocked", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    setItem.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(await setLanguagePreference(PSEUDO_LANGUAGE)).toBe(false);
    expect(i18n.language).toBe(PSEUDO_LANGUAGE);
    warning.mockRestore();
  });
  it("rejects unregistered choices without changing the current language", async () => {
    await expect(setLanguagePreference("unknown")).rejects.toThrow(
      "Unsupported language preference",
    );
    expect(i18n.language).toBe("en");
  });
});
