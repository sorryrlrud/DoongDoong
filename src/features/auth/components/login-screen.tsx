import type { SocialAuthProvider } from "@/features/auth/types/auth";
import { useI18n } from "@/i18n/i18n";
import { BEACH_IMAGE } from "@/shared/brand";

interface LoginScreenProps {
  busyProvider: SocialAuthProvider | null;
  error: string | null;
  onSignIn: (provider: SocialAuthProvider) => void;
}

const PROVIDERS: Array<{
  id: SocialAuthProvider;
  label: "auth.google" | "auth.apple" | "auth.naver";
}> = [
  { id: "google", label: "auth.google" },
  { id: "apple", label: "auth.apple" },
  { id: "naver", label: "auth.naver" },
];

export function LoginScreen({ busyProvider, error, onSignIn }: LoginScreenProps) {
  const { t } = useI18n();

  return (
    <main className="login-screen">
      <img className="login-screen__art" src={BEACH_IMAGE} alt="" />
      <section className="login-screen__panel" aria-labelledby="login-title">
        <div className="login-screen__brand">{t("brand.name")}</div>
        <p className="login-screen__eyebrow">{t("auth.eyebrow")}</p>
        <h1 id="login-title">{t("auth.title")}</h1>
        <p className="login-screen__description">{t("auth.description")}</p>

        {error ? <div className="alert" role="alert">{error}</div> : null}

        <div className="login-screen__providers" aria-label={t("auth.providers")}>
          {PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              className={`social-login social-login--${provider.id}`}
              type="button"
              disabled={busyProvider !== null}
              onClick={() => onSignIn(provider.id)}
            >
              <span className="social-login__mark" aria-hidden="true">
                {provider.id === "google" ? "G" : provider.id === "apple" ? "A" : "N"}
              </span>
              <strong>
                {busyProvider === provider.id ? t("auth.redirecting") : t(provider.label)}
              </strong>
            </button>
          ))}
        </div>

        <p className="login-screen__notice">{t("auth.notice")}</p>
      </section>
    </main>
  );
}
