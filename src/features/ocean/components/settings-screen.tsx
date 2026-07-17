import { useEffect, useState } from "react";
import { oceanGateway } from "@/features/ocean/services/runtime";
import { COUNTRY_OPTIONS, countryName } from "@/features/ocean/countries";
import type { OceanSnapshot } from "@/features/ocean/types/ocean";
import { PageHeading } from "@/shared/page-heading";
import { useI18n } from "@/i18n/i18n";
import type { MessageKey } from "@/i18n/messages/en";
import { SUPPORTED_LANGUAGES, type LanguageCode } from "@/i18n/languages";

interface SettingsScreenProps {
  countryCode: string;
  languageCode: LanguageCode;
  reduceMotion: boolean;
  onReduceMotionChange: (value: boolean) => void;
  defaultSignature: string;
  autoIncludeDate: boolean;
  onProfileChange: (snapshot: OceanSnapshot, languageCode: LanguageCode) => void;
  onWritingDefaultsChange: (value: {
    defaultSignature: string;
    autoIncludeDate: boolean;
  }) => void;
}

export function SettingsScreen({
  countryCode,
  languageCode,
  reduceMotion,
  onReduceMotionChange,
  defaultSignature,
  autoIncludeDate,
  onProfileChange,
  onWritingDefaultsChange,
}: SettingsScreenProps) {
  const { t } = useI18n();
  const [draftCountryCode, setDraftCountryCode] = useState(countryCode);
  const [draftLanguageCode, setDraftLanguageCode] = useState(languageCode);
  const [savingProfile, setSavingProfile] = useState(false);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);

  useEffect(() => setDraftCountryCode(countryCode), [countryCode]);
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
      setNotice("settings.profileSaved");
    } catch {
      setError("settings.profileError");
    } finally {
      setSavingProfile(false);
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
                onChange={(event) => setDraftLanguageCode(event.target.value as LanguageCode)}
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
              disabled={savingProfile || (draftCountryCode === countryCode && draftLanguageCode === languageCode)}
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
                onChange={(event) => onWritingDefaultsChange({
                  defaultSignature: event.target.value,
                  autoIncludeDate,
                })}
              />
            </label>
            <div className="writing-defaults__date">
              <span>{t("settings.date")}</span>
              <button
                className={autoIncludeDate ? "toggle toggle--on" : "toggle"}
                type="button"
                role="switch"
                aria-checked={autoIncludeDate}
                onClick={() => onWritingDefaultsChange({
                  defaultSignature,
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
            onClick={() => onReduceMotionChange(!reduceMotion)}
          >
            <span aria-hidden="true" />
            <strong>{reduceMotion ? t("common.on") : t("common.off")}</strong>
          </button>
        </section>
      </div>
    </section>
  );
}
