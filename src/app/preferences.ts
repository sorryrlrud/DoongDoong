import { isLanguageCode, suggestedLanguageCode, type LanguageCode } from "@/i18n/languages";

const PREFERENCES_KEY = "doongdoong.preferences.v1";

export interface AppPreferences {
  onboarded: boolean;
  reduceMotion: boolean;
  defaultSignature: string;
  autoIncludeDate: boolean;
  languageCode: LanguageCode;
}

const defaultPreferences = (): AppPreferences => ({
  onboarded: false,
  reduceMotion: false,
  defaultSignature: "",
  autoIncludeDate: false,
  languageCode: suggestedLanguageCode(),
});

export const resetPreferences = (): AppPreferences => {
  try {
    window.localStorage.removeItem(PREFERENCES_KEY);
  } catch {
    // The in-memory default remains usable when storage is blocked.
  }
  return defaultPreferences();
};

export const loadPreferences = (): AppPreferences => {
  const defaults = defaultPreferences();
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return defaults;
    const stored = JSON.parse(raw) as Partial<AppPreferences>;
    return {
      ...defaults,
      ...stored,
      languageCode: isLanguageCode(stored.languageCode) ? stored.languageCode : defaults.languageCode,
    };
  } catch {
    return defaults;
  }
};

export const savePreferences = (preferences: AppPreferences): void => {
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences remain available for the current session when storage is blocked.
  }
};

export const shouldShowOnboarding = (
  preferences: Pick<AppPreferences, "onboarded">,
  countryCode?: string,
): boolean => !preferences.onboarded || !countryCode;
