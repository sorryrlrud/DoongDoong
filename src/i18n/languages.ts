export const SUPPORTED_LANGUAGES = [
  { code: "ko", nativeName: "한국어", locale: "ko-KR", direction: "ltr" },
  { code: "en", nativeName: "English", locale: "en-US", direction: "ltr" },
  { code: "ja", nativeName: "日本語", locale: "ja-JP", direction: "ltr" },
  { code: "zh-Hans", nativeName: "简体中文", locale: "zh-CN", direction: "ltr" },
  { code: "zh-Hant", nativeName: "繁體中文", locale: "zh-TW", direction: "ltr" },
  { code: "es", nativeName: "Español", locale: "es-ES", direction: "ltr" },
  { code: "fr", nativeName: "Français", locale: "fr-FR", direction: "ltr" },
  { code: "de", nativeName: "Deutsch", locale: "de-DE", direction: "ltr" },
  { code: "pt", nativeName: "Português", locale: "pt-BR", direction: "ltr" },
  { code: "ru", nativeName: "Русский", locale: "ru-RU", direction: "ltr" },
  { code: "ar", nativeName: "العربية", locale: "ar-SA", direction: "rtl" },
  { code: "hi", nativeName: "हिन्दी", locale: "hi-IN", direction: "ltr" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

const LANGUAGE_BY_CODE = new Map(SUPPORTED_LANGUAGES.map((language) => [language.code, language]));

export const isLanguageCode = (value: unknown): value is LanguageCode =>
  typeof value === "string" && LANGUAGE_BY_CODE.has(value as LanguageCode);

export const normalizeLanguageCode = (value?: string | null): LanguageCode => {
  if (!value) return "ko";
  if (isLanguageCode(value)) return value;

  const normalized = value.replace("_", "-").toLowerCase();
  if (normalized.startsWith("zh")) {
    return /(?:tw|hk|mo|hant)/i.test(value) ? "zh-Hant" : "zh-Hans";
  }

  const base = normalized.split("-")[0];
  return SUPPORTED_LANGUAGES.find((language) => language.code === base)?.code ?? "en";
};

export const suggestedLanguageCode = (): LanguageCode => {
  const languages = typeof navigator === "undefined" ? [] : navigator.languages;
  for (const language of languages) {
    const normalized = normalizeLanguageCode(language);
    if (normalized !== "en" || /^en(?:-|$)/i.test(language)) return normalized;
  }
  return "en";
};

export const localeForLanguage = (languageCode: LanguageCode): string =>
  LANGUAGE_BY_CODE.get(languageCode)?.locale ?? "en-US";

export const directionForLanguage = (languageCode: LanguageCode): "ltr" | "rtl" =>
  LANGUAGE_BY_CODE.get(languageCode)?.direction ?? "ltr";

export const languageNativeName = (languageCode: LanguageCode): string =>
  LANGUAGE_BY_CODE.get(languageCode)?.nativeName ?? languageCode;

export const languageDisplayName = (languageCode: LanguageCode, displayLanguage: LanguageCode): string => {
  try {
    return new Intl.DisplayNames([localeForLanguage(displayLanguage)], { type: "language" }).of(languageCode) ?? languageNativeName(languageCode);
  } catch {
    return languageNativeName(languageCode);
  }
};
