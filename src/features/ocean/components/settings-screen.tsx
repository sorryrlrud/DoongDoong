import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { oceanGateway } from "@/features/ocean/services/runtime";
import { COUNTRY_OPTIONS, countryName } from "@/features/ocean/countries";
import type { OceanSnapshot } from "@/features/ocean/types/ocean";
import { PageHeading } from "@/shared/page-heading";
import { useI18n } from "@/i18n/i18n";
import type { MessageKey } from "@/i18n/messages/en";
import { SUPPORTED_LANGUAGES, type LanguageCode } from "@/i18n/languages";
import type { SocialAuthProvider } from "@/features/auth/types/auth";
import {
  PushSetupError,
  notificationPermission,
} from "@/features/ocean/services/push-notifications";

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
  identityLinkConflict: SocialAuthProvider | null;
  onStartAccountMerge: (provider: SocialAuthProvider) => Promise<void>;
  onDismissIdentityLinkConflict: () => void;
  onSignOut: () => Promise<void>;
  notificationEnabled: boolean;
  onNotificationPreferenceChange: (enabled: boolean) => Promise<boolean>;
  canInstall: boolean;
  showIosInstallHelp: boolean;
  onInstall: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
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
  identityLinkConflict,
  onStartAccountMerge,
  onDismissIdentityLinkConflict,
  onSignOut,
  notificationEnabled,
  onNotificationPreferenceChange,
  canInstall,
  showIosInstallHelp,
  onInstall,
  onDeleteAccount,
}: SettingsScreenProps) {
  const { t, languageCode: uiLanguageCode } = useI18n();
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
  const [startingAccountMerge, setStartingAccountMerge] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const deleteConfirmationRef = useRef<HTMLInputElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const wasConfirmingDeletion = useRef(false);
  const pushPermission = notificationPermission();
  const pushSupported = pushPermission !== "unsupported";

  useEffect(() => {
    setDraftCountryCode(countryCode);
    setSavedCountryCode(countryCode);
  }, [countryCode]);
  useEffect(() => setDraftLanguageCode(languageCode), [languageCode]);
  useEffect(() => {
    if (confirmingDeletion) {
      deleteConfirmationRef.current?.focus();
    } else if (wasConfirmingDeletion.current) {
      deleteTriggerRef.current?.focus();
    }
    wasConfirmingDeletion.current = confirmingDeletion;
  }, [confirmingDeletion]);

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

  const startAccountMerge = async () => {
    if (!identityLinkConflict || startingAccountMerge) return;
    setStartingAccountMerge(true);
    setError(null);
    try {
      await onStartAccountMerge(identityLinkConflict);
    } catch {
      setError("settings.socialError");
      setStartingAccountMerge(false);
    }
  };

  const saveNotificationPreference = async (enabled: boolean) => {
    if (savingNotifications || (!pushSupported && enabled)) return;
    setSavingNotifications(true);
    setError(null);
    setNotice(null);
    try {
      await onNotificationPreferenceChange(enabled);
      setNotice(enabled ? "settings.notificationsEnabled" : "settings.notificationsDisabled");
    } catch (caught) {
      if (caught instanceof PushSetupError) {
        const problemKeys: Record<PushSetupError["problem"], MessageKey> = {
          unsupported: "settings.notificationsUnsupported",
          "permission-denied": "settings.notificationsPermissionDenied",
          "missing-public-key": "settings.notificationsUnavailable",
          "subscription-invalid": "settings.notificationsUnavailable",
        };
        setError(problemKeys[caught.problem]);
      } else {
        setError("settings.notificationsError");
      }
    } finally {
      setSavingNotifications(false);
    }
  };

  const deleteAccount = async () => {
    if (deletingAccount || deleteConfirmation !== "DELETE") return;
    setDeletingAccount(true);
    setError(null);
    try {
      await onDeleteAccount();
    } catch {
      setError("settings.deleteError");
      setDeletingAccount(false);
    }
  };

  const trapDeletionDialogFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]",
    )];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <section className="screen settings-screen">
      <div className="screen-header">
        <PageHeading>{t("settings.title")}</PageHeading>
      </div>

      {error ? <div className="alert" role="alert">{t(error)}</div> : null}
      {notice ? <div className="alert" role="status">{t(notice)}</div> : null}

      {identityLinkConflict === "naver" ? (
        <section className="setting-section" aria-labelledby="account-merge-title">
          <div>
            <h2 id="account-merge-title">{uiLanguageCode === "ko" ? "네이버 계정 병합" : "Merge Naver account"}</h2>
            <p>
              {uiLanguageCode === "ko"
                ? "이 네이버 계정은 이미 다른 둥둥 계정에 연결되어 있어요. 지금 로그인한 계정을 기준으로 병합하면, 다른 계정의 프로필과 설정은 삭제되고 보낸·받은·보관한 편지는 합쳐져요."
                : "This Naver account is already connected to another DoongDoong account. Merging keeps the account you are signed in to, removes the other profile and settings, and combines sent, received, and kept letters."}
            </p>
            <p>{uiLanguageCode === "ko"
              ? "방향을 바꾸려면 취소한 뒤, 유지할 다른 계정으로 로그인해 다시 시도해 주세요."
              : "To merge in the other direction, cancel, sign in to the account you want to keep, and try again."}</p>
          </div>
          <div className="settings-dialog__actions">
            <button
              className="button button--ghost"
              type="button"
              disabled={startingAccountMerge}
              onClick={onDismissIdentityLinkConflict}
            >
              {t("common.cancel")}
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={startingAccountMerge}
              onClick={() => void startAccountMerge()}
            >
              {startingAccountMerge
                ? (uiLanguageCode === "ko" ? "네이버 확인 중…" : "Checking Naver…")
                : t("common.continue")}
            </button>
          </div>
        </section>
      ) : null}

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

        <section className="setting-section setting-section--row" aria-labelledby="setting-notifications-title">
          <div>
            <h2 id="setting-notifications-title">{t("settings.notificationsTitle")}</h2>
            <p>{t("settings.notificationsDescription")}</p>
            {!pushSupported ? <p className="setting-hint">{t("settings.notificationsUnsupported")}</p> : null}
            {pushPermission === "denied" ? <p className="setting-hint">{t("settings.notificationsPermissionDenied")}</p> : null}
          </div>
          <button
            className={notificationEnabled ? "toggle toggle--on" : "toggle"}
            type="button"
            role="switch"
            aria-checked={notificationEnabled}
            disabled={savingNotifications || (!pushSupported && !notificationEnabled)}
            onClick={() => void saveNotificationPreference(!notificationEnabled)}
          >
            <span aria-hidden="true" />
            <strong>{notificationEnabled ? t("common.on") : t("common.off")}</strong>
          </button>
        </section>

        {canInstall || showIosInstallHelp ? (
          <section className="setting-section setting-section--row" aria-labelledby="setting-install-title">
            <div>
              <h2 id="setting-install-title">{t("settings.installTitle")}</h2>
              <p>{showIosInstallHelp ? t("settings.iosInstallDescription") : t("settings.installDescription")}</p>
            </div>
            {canInstall ? (
              <button className="button button--secondary" type="button" onClick={() => void onInstall()}>
                {t("settings.install")}
              </button>
            ) : null}
          </section>
        ) : null}

        <section className="setting-section setting-section--row" aria-labelledby="setting-account-title">
          <div>
            <h2 id="setting-account-title">{t("settings.accountTitle")}</h2>
            <p>{t("settings.accountDescription")}</p>
          </div>
          <div className="settings-account-actions">
            <button
              className="button button--ghost"
              type="button"
              disabled={signingOut || deletingAccount}
              onClick={() => void signOut()}
            >
              {signingOut ? t("settings.signingOut") : t("settings.signOut")}
            </button>
            <button
              ref={deleteTriggerRef}
              className="button button--danger"
              type="button"
              disabled={signingOut || deletingAccount}
              onClick={() => {
                setDeleteConfirmation("");
                setConfirmingDeletion(true);
              }}
            >
              {t("settings.deleteAccount")}
            </button>
          </div>
        </section>
      </div>

      {confirmingDeletion ? (
        <div
          className="settings-dialog-layer"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !deletingAccount) setConfirmingDeletion(false);
          }}
        >
          <section
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            aria-describedby="delete-account-description"
            onKeyDown={trapDeletionDialogFocus}
          >
            <h2 id="delete-account-title">{t("settings.deleteConfirmTitle")}</h2>
            <p id="delete-account-description">{t("settings.deleteConfirmDescription")}</p>
            <label className="settings-delete-confirmation" htmlFor="delete-account-confirmation">
              <span>{t("settings.deleteConfirmationLabel")}</span>
              <input
                ref={deleteConfirmationRef}
                id="delete-account-confirmation"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={deletingAccount}
              />
            </label>
            <div className="settings-dialog__actions">
              <button
                className="button button--ghost"
                type="button"
                disabled={deletingAccount}
                onClick={() => setConfirmingDeletion(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="button button--danger"
                type="button"
                disabled={deletingAccount || deleteConfirmation !== "DELETE"}
                onClick={() => void deleteAccount()}
              >
                {deletingAccount ? t("settings.deleting") : t("settings.deleteAccount")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
