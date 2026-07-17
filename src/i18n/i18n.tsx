/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, type PropsWithChildren } from "react";
import { ar } from "./messages/ar";
import { de } from "./messages/de";
import { en, type MessageKey, type Messages } from "./messages/en";
import { es } from "./messages/es";
import { fr } from "./messages/fr";
import { hi } from "./messages/hi";
import { ja } from "./messages/ja";
import { ko } from "./messages/ko";
import { pt } from "./messages/pt";
import { ru } from "./messages/ru";
import { zhHans } from "./messages/zh-hans";
import { zhHant } from "./messages/zh-hant";
import {
  directionForLanguage,
  localeForLanguage,
  type LanguageCode,
} from "./languages";

const MESSAGES: Record<LanguageCode, Messages> = {
  ko,
  en,
  ja,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  es,
  fr,
  de,
  pt,
  ru,
  ar,
  hi,
};

export type TranslationValues = Record<string, string | number>;
export type Translate = (key: MessageKey, values?: TranslationValues) => string;

const interpolate = (template: string, values?: TranslationValues): string => {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match,
  );
};

interface I18nValue {
  languageCode: LanguageCode;
  locale: string;
  direction: "ltr" | "rtl";
  t: Translate;
}

const I18nContext = createContext<I18nValue>({
  languageCode: "ko",
  locale: "ko-KR",
  direction: "ltr",
  t: (key, values) => interpolate(ko[key], values),
});

interface I18nProviderProps extends PropsWithChildren {
  languageCode: LanguageCode;
}

export function I18nProvider({ languageCode, children }: I18nProviderProps) {
  const locale = localeForLanguage(languageCode);
  const direction = directionForLanguage(languageCode);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
  }, [direction, locale]);

  const value = useMemo<I18nValue>(() => ({
    languageCode,
    locale,
    direction,
    t: (key, values) => interpolate(MESSAGES[languageCode][key], values),
  }), [direction, languageCode, locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = (): I18nValue => useContext(I18nContext);

export const translate = (
  languageCode: LanguageCode,
  key: MessageKey,
  values?: TranslationValues,
): string => interpolate(MESSAGES[languageCode][key], values);
