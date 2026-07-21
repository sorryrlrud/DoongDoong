import { describe, expect, it } from "vitest";
import { directionForLanguage, normalizeLanguageCode, SUPPORTED_LANGUAGES } from "./languages";
import { translate } from "./i18n";

describe("i18n", () => {
  it("has a usable static translation for every supported language", () => {
    for (const language of SUPPORTED_LANGUAGES) {
      expect(translate(language.code, "onboarding.selectTitle").trim()).not.toBe("");
      expect(translate(language.code, "guide.safety4").trim()).not.toBe("");
      expect(translate(language.code, "home.keptCount", { count: 3 })).toContain("3");
      expect(translate(language.code, "settings.notificationsTitle").trim()).not.toBe("");
      expect(translate(language.code, "settings.deleteAccount").trim()).not.toBe("");
      expect(translate(language.code, "catch.reportReason.spam").trim()).not.toBe("");
    }
  });

  it("normalizes browser locales and preserves right-to-left layout", () => {
    expect(normalizeLanguageCode("zh-TW")).toBe("zh-Hant");
    expect(normalizeLanguageCode("pt-BR")).toBe("pt");
    expect(directionForLanguage("ar")).toBe("rtl");
  });
});
