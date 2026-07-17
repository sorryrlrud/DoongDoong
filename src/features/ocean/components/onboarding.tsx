import { useState } from "react";
import { COUNTRY_OPTIONS, countryName, suggestedCountryCode } from "@/features/ocean/countries";
import { HERO_IMAGE } from "@/shared/brand";
import { useI18n } from "@/i18n/i18n";
import { SUPPORTED_LANGUAGES, type LanguageCode } from "@/i18n/languages";

interface OnboardingProps {
  initialCountryCode?: string;
  languageCode: LanguageCode;
  onLanguageChange: (languageCode: LanguageCode) => void;
  onComplete: (countryCode: string, defaultSignature: string, languageCode: LanguageCode) => Promise<void>;
}

export function Onboarding({
  initialCountryCode,
  languageCode,
  onLanguageChange,
  onComplete,
}: OnboardingProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<"locale" | "principles">("locale");
  const [countryCode, setCountryCode] = useState(() => initialCountryCode ?? suggestedCountryCode());
  const [accepted, setAccepted] = useState(false);
  const [defaultSignature, setDefaultSignature] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleComplete = async () => {
    if (!accepted || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onComplete(countryCode, defaultSignature.trim(), languageCode);
    } catch {
      setError(t("onboarding.error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="onboarding">
      <img className="onboarding__art" src={HERO_IMAGE} alt="" />
      <div className="onboarding__panel">
        <div className="onboarding__brand" aria-label="DoongDoong">
          <strong>{t("brand.name")}</strong>
          <span>DOONGDOONG</span>
        </div>

        {step === "locale" ? (
          <section className="onboarding__copy" aria-labelledby="locale-title">
            <h1 id="locale-title">{t("onboarding.selectTitle")}</h1>
            <div className="onboarding-locale-grid">
              <label htmlFor="onboarding-language">
                <span>{t("onboarding.language")}</span>
                <select
                  id="onboarding-language"
                  value={languageCode}
                  onChange={(event) => onLanguageChange(event.target.value as LanguageCode)}
                >
                  {SUPPORTED_LANGUAGES.map((language) => (
                    <option key={language.code} value={language.code}>{language.nativeName}</option>
                  ))}
                </select>
              </label>
              <label htmlFor="onboarding-country">
                <span>{t("onboarding.country")}</span>
                <select
                  id="onboarding-country"
                  value={countryCode}
                  onChange={(event) => setCountryCode(event.target.value)}
                >
                  {COUNTRY_OPTIONS.map((country) => (
                    <option key={country.code} value={country.code}>
                      {countryName(country.code, languageCode)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        ) : (
          <section className="onboarding__copy" aria-labelledby="onboarding-title">
            <p className="eyebrow">{t("onboarding.eyebrow")}</p>
            <h1 id="onboarding-title">{t("onboarding.title")}</h1>
            <ul className="onboarding-points" aria-label={t("onboarding.principles")}>
              <li>{t("onboarding.rule1")}</li>
              <li>{t("onboarding.rule2")}</li>
              <li>{t("onboarding.rule3")}</li>
            </ul>

            <label className="onboarding-signature" htmlFor="onboarding-signature">
              <span>{t("onboarding.signature")} <small>{t("common.optional")}</small></span>
              <input
                id="onboarding-signature"
                type="text"
                value={defaultSignature}
                onChange={(event) => setDefaultSignature(event.target.value)}
                maxLength={20}
                placeholder={t("onboarding.signaturePlaceholder")}
              />
            </label>

            <label className="check-row">
              <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
              <span>{t("onboarding.consent")}</span>
            </label>
          </section>
        )}

        {error ? <div className="alert onboarding__error" role="alert">{error}</div> : null}

        <div className="onboarding__actions">
          {step === "principles" ? (
            <button className="button button--ghost" type="button" onClick={() => setStep("locale")}>
              {t("common.back")}
            </button>
          ) : null}
          <button
            className="button button--primary"
            type="button"
            disabled={step === "principles" && (!accepted || submitting)}
            onClick={() => step === "locale" ? setStep("principles") : void handleComplete()}
          >
            {step === "locale" ? t("common.continue") : submitting ? t("onboarding.starting") : t("onboarding.start")}
          </button>
        </div>
      </div>
    </main>
  );
}
