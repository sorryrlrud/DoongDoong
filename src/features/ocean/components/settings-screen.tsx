import { useEffect, useState } from "react";
import { oceanGateway } from "@/features/ocean/services/runtime";
import { COUNTRY_OPTIONS, countryName } from "@/features/ocean/countries";
import type { OceanSnapshot } from "@/features/ocean/types/ocean";
import { PageHeading } from "@/shared/page-heading";
import { useI18n } from "@/i18n/i18n";
import type { MessageKey } from "@/i18n/messages/en";
import { SUPPORTED_LANGUAGES, type LanguageCode } from "@/i18n/languages";
import type { SocialAuthProvider } from "@/features/auth/types/auth";

const SOCIAL_PROVIDERS: Array<{
  id: SocialAuthProvider;
  authProvider: string;
  label: string;
}> = [
  { id: "naver", authProvider: "custom:naver", label: "NAVER" },
  { id: "google", authProvider: "google", label: "Google" },
  { id: "apple", authProvider: "apple", label: "Apple" },
];

interface SettingsScreenProps {
  linkedProviders: string[];
  countryCode: string;
  languageCode: LanguageCode;
  reduceMotion: boolean;
  defaultSignature: string;
  autoIncludeDate: boolean;
  onLanguagePreview: (languageCode: LanguageCode) => void;
  onProfileChange: (snapshot: OceanSnapshot, languageCode: LanguageCode) => void;
  onDefaultSignatureChange: (value: string) => void;
  onAppPreferencesChange: (value: {
    reduceMotion: boolean;
    autoIncludeDate: boolean;
  }) => Promise<void>;
  onLinkIdentity: (provider: SocialAuthProvider) => Promise<void>;
  onSignOut: () => Promise<void>;
}

export function SettingsScreen({
  linkedProviders,
  countryCode,
  languageCode,
  reduceMotion,
  defaultSignature,
  autoIncludeDate,
  onLanguagePreview,
  onProfileChange,
  onDefaultSignatureChange,
  onAppPreferencesChange,
  onLinkIdentity,
  onSignOut,
}: SettingsScreenProps) {
  const { t } = useI18n();
  const [draftCountryCode, setDraftCountryCode] = useState(countryCode);
  const [draftLanguageCode, setDraftLanguageCode] = useState(languageCode);
  const [savedCountryCode, setSavedCountryCode] = useState(countryCode);
  const [savedLanguageCode, setSavedLanguageCode] = useState(languageCode);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingAppPreferences, setSavingAppPreferences] = useState(false);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [linkingProvider, setLinkingProvider] = useState<SocialAuthProvider | null>(null);

  useEffect(() => {
    setDraftCountryCode(countryCode);
    setSavedCountryCode(countryCode);
  }, [countryCode]);
  useEffect(() => setDraftLanguageCode(languageCode), [languageCode]);

  const syncDefaultSignature = async () => {
    setError(null);
    try {
      await oceanGateway.updateDefaultSignature(defaultSignature);
    } catch {
      setError("settings.signatureError");
    }
  };

  const saveProfile = async () => {
    if (savingProfile) return;
    setSavingProfile(true);
    setError(null);
    setNotice(null);
    try {
      const snapshot = await oceanGateway.updateProfile(draftCountryCode, draftLanguageCode);
      onProfileChange(snapshot, draftLanguageCode);
      setSavedCountryCode(draftCountryCode);
      setSavedLanguageCode(draftLanguageCode);
      setNotice("settings.profileSaved");
    } catch {
      setError("settings.profileError");
    } finally {
      setSavingProfile(false);
    }
  };

  const saveAppPreferences = async (next: {
    reduceMotion: boolean;
    autoIncludeDate: boolean;
  }) => {
    if (savingAppPreferences) return;
    setSavingAppPreferences(true);
    setError(null);
    try {
      await onAppPreferencesChange(next);
    } catch {
      setError("settings.profileError");
    } finally {
      setSavingAppPreferences(false);
    }
  };

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    try {
      await onSignOut();
    } catch {
      setError("settings.signOutError");
      setSigningOut(false);
    }
  };

  const linkIdentity = async (provider: SocialAuthProvider) => {
    if (linkingProvider) return;
    setLinkingProvider(provider);
    setError(null);
    setNotice(null);
    try {
      await onLinkIdentity(provider);
    } catch {
      setError("settings.socialError");
      setLinkingProvider(null);
    }
  };

  return (
    <section className="screen settings-screen">
      <div className="screen-header">
        <PageHeading>{t("settings.title")}</PageHeading>
      </div>

      {error ? <div className="alert" role="alert">{t(error)}</div> : null}
      {notice ? <div className="alert" role="status">{t(notice)}</div> : null}

      <div className="settings-list">
        <section className="setting-section" aria-labelledby="setting-social-title">
          <div>
            <h2 id="setting-social-title">{t("settings.socialTitle")}</h2>
            <p>{t("settings.socialDescription")}</p>
          </div>
          <ul className="social-connections" aria-label={t("settings.socialTitle")}>
            {SOCIAL_PROVIDERS.map((provider) => {
              const connected = linkedProviders.includes(provider.authProvider);
              const linking = linkingProvider === provider.id;
              return (
                <li key={provider.id} className={`social-connection social-connection--${provider.id}`}>
                  <span className="social-connection__mark" aria-hidden="true">
                    {provider.id === "google" ? "G" : provider.id === "apple" ? "A" : "N"}
                  </span>
                  <strong>{provider.label}</strong>
                  {connected ? (
                    <span className="social-connection__status">{t("settings.socialConnected")}</span>
                  ) : (
                    <button
                      className="button button--secondary social-connection__action"
                      type="button"
                      disabled={linkingProvider !== null}
                      onClick={() => void linkIdentity(provider.id)}
                    >
                      {linking ? t("settings.socialConnecting") : t("settings.socialConnect")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="social-connections__notice">{t("settings.socialNotice")}</p>
        </section>

        <section className="setting-section" aria-labelledby="setting-profile-title">
          <div>
            <h2 id="setting-profile-title">{t("settings.profileTitle")}</h2>
            <p>{t("settings.profileDescription")}</p>
          </div>
          <div className="writing-defaults settings-profile-fields">
            <label>
              <span>{t("onboarding.language")}</span>
                <select
                  value={draftLanguageCode}
                  onChange={(event) => {
                    const nextLanguageCode = event.target.value as LanguageCode;
                    setDraftLanguageCode(nextLanguageCode);
                    onLanguagePreview(nextLanguageCode);
                  }}
              >
                {SUPPORTED_LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>{language.nativeName}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("onboarding.country")}</span>
              <select value={draftCountryCode} onChange={(event) => setDraftCountryCode(event.target.value)}>
                {COUNTRY_OPTIONS.map((country) => (
                  <option key={country.code} value={country.code}>
                    {countryName(country.code, draftLanguageCode)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button--secondary"
              type="button"
              disabled={savingProfile || (
                draftCountryCode === savedCountryCode
                && draftLanguageCode === savedLanguageCode
              )}
              onClick={() => void saveProfile()}
            >
              {t("settings.saveProfile")}
            </button>
          </div>
        </section>

        <section className="setting-section" aria-labelledby="setting-writing-title">
          <div>
            <h2 id="setting-writing-title">{t("settings.writingTitle")}</h2>
            <p>{t("settings.writingDescription")}</p>
          </div>
          <div className="writing-defaults">
            <label>
              <span>{t("settings.signature")} <small>{t("common.optional")}</small></span>
              <input
                type="text"
                value={defaultSignature}
                maxLength={20}
                placeholder={t("onboarding.signaturePlaceholder")}
                onBlur={() => void syncDefaultSignature()}
                onChange={(event) => onDefaultSignatureChange(event.target.value)}
              />
            </label>
            <div className="writing-defaults__date">
              <span>{t("settings.date")}</span>
              <button
                className={autoIncludeDate ? "toggle toggle--on" : "toggle"}
                type="button"
                role="switch"
                aria-checked={autoIncludeDate}
                disabled={savingAppPreferences}
                onClick={() => void saveAppPreferences({
                  reduceMotion,
                  autoIncludeDate: !autoIncludeDate,
                })}
              >
                <span aria-hidden="true" />
                <strong>{autoIncludeDate ? t("common.on") : t("common.off")}</strong>
              </button>
            </div>
          </div>
        </section>

        <section className="setting-section setting-section--row" aria-labelledby="setting-motion-title">
          <div><h2 id="setting-motion-title">{t("settings.motion")}</h2></div>
          <button
            className={reduceMotion ? "toggle toggle--on" : "toggle"}
            type="button"
            role="switch"
            aria-checked={reduceMotion}
            disabled={savingAppPreferences}
            onClick={() => void saveAppPreferences({
              reduceMotion: !reduceMotion,
              autoIncludeDate,
            })}
          >
            <span aria-hidden="true" />
            <strong>{reduceMotion ? t("common.on") : t("common.off")}</strong>
          </button>
        </section>

        <section className="setting-section setting-section--row" aria-labelledby="setting-account-title">
          <div>
            <h2 id="setting-account-title">{t("settings.accountTitle")}</h2>
            <p>{t("settings.accountDescription")}</p>
          </div>
          <button
            className="button button--ghost"
            type="button"
            disabled={signingOut}
            onClick={() => void signOut()}
          >
            {signingOut ? t("settings.signingOut") : t("settings.signOut")}
          </button>
        </section>
      </div>
    </section>
  );
}
