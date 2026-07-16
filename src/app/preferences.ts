const PREFERENCES_KEY = "doongdoong.preferences.v1";

export interface AppPreferences {
  onboarded: boolean;
  reduceMotion: boolean;
}

const DEFAULT_PREFERENCES: AppPreferences = {
  onboarded: false,
  reduceMotion: false,
};

export const resetPreferences = (): AppPreferences => {
  try {
    window.localStorage.removeItem(PREFERENCES_KEY);
  } catch {
    // The in-memory default remains usable when storage is blocked.
  }
  return DEFAULT_PREFERENCES;
};

export const loadPreferences = (): AppPreferences => {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    return raw ? { ...DEFAULT_PREFERENCES, ...(JSON.parse(raw) as AppPreferences) } : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
};

export const savePreferences = (preferences: AppPreferences): void => {
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences remain available for the current session when storage is blocked.
  }
};
