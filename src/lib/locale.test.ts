import { describe, expect, it } from "vitest";
import {
  isLanguagePreference,
  resolveLanguage,
  languageDirection,
} from "./locale";
import { pseudoLocalize, pseudoResources } from "./pseudoLocale";

describe("language selection", () => {
  it("matches regional system locales to supported parents", () => {
    expect(resolveLanguage("system", ["fr-FR", "en-GB"])).toBe("fr");
    expect(resolveLanguage("system", ["th-TH", "en-US"])).toBe("th");
    expect(resolveLanguage("system", ["es-MX"])).toBe("es");
    expect(resolveLanguage("system", ["EN-us"])).toBe("en");
    expect(resolveLanguage("system", ["invalid_locale", "en-US"])).toBe("en");
  });
  it("matches regional variants without crossing Chinese writing systems", () => {
    expect(resolveLanguage("system", ["pt-PT"])).toBe("pt-BR");
    expect(resolveLanguage("system", ["zh-SG"])).toBe("zh-CN");
    expect(resolveLanguage("system", ["zh-Hans"])).toBe("zh-CN");
    expect(resolveLanguage("system", ["zh"])).toBe("zh-CN");
    expect(resolveLanguage("system", ["zh-TW", "en-US"])).toBe("en");
    expect(resolveLanguage("system", ["zh-Hant", "ja"])).toBe("ja");
  });
  it("uses a supported explicit choice and rejects unknown preferences", () => {
    expect(resolveLanguage("en", ["fr"])).toBe("en");
    expect(resolveLanguage("th", ["en"])).toBe("th");
    expect(isLanguagePreference("pt-BR")).toBe(true);
    expect(resolveLanguage("system", [])).toBe("en");
    expect(isLanguagePreference("system")).toBe(true);
    expect(isLanguagePreference("xx")).toBe(false);
    expect(isLanguagePreference({})).toBe(false);
    expect(languageDirection("en")).toBe("ltr");
  });
});

describe("test language", () => {
  it("expands labels without changing interpolation names or markup", () => {
    const value = pseudoLocalize("Hello <strong>{{name}}</strong>");
    expect(value).toContain("<strong>{{name}}</strong>");
    expect(value).toContain("Hëllô");
    expect(value.length).toBeGreaterThan(30);
    expect(pseudoResources({ section: { label: "Hello" } })).toEqual({
      section: { label: pseudoLocalize("Hello") },
    });
  });
});
