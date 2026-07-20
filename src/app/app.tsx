import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/app/app-shell";
import { AdminScreen } from "@/features/admin/components/admin-screen";
import { LoginScreen } from "@/features/auth/components/login-screen";
import { AdminLoginScreen } from "@/features/auth/components/admin-login-screen";
import type { AuthUser, SocialAuthProvider } from "@/features/auth/types/auth";
import {
  loadPreferences,
  savePreferences,
  shouldShowOnboarding,
  type AppPreferences,
} from "@/app/preferences";
import { readAppRoute, useHashRoute } from "@/app/use-hash-route";
import { CatchScreen } from "@/features/ocean/components/catch-screen";
import { GuideScreen } from "@/features/ocean/components/guide-screen";
import { HomeScreen } from "@/features/ocean/components/home-screen";
import { KeptScreen } from "@/features/ocean/components/kept-screen";
import { Onboarding } from "@/features/ocean/components/onboarding";
import { SettingsScreen } from "@/features/ocean/components/settings-screen";
import { WriteScreen } from "@/features/ocean/components/write-screen";
import { adminGateway, authGateway, oceanGateway } from "@/features/ocean/services/runtime";
import { AuthenticationRequiredError } from "@/features/ocean/services/supabase-client";
import type { OceanSnapshot } from "@/features/ocean/types/ocean";
import { BEACH_IMAGE } from "@/shared/brand";
import { playIncomingWave, playSeagullCall } from "@/features/ocean/services/ocean-audio";
import { recommendedSeaForCountry } from "@/features/ocean/countries";
import { I18nProvider, useI18n } from "@/i18n/i18n";

const wait = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));

interface AppExperienceProps {
  preferences: AppPreferences;
  updatePreferences: (next: AppPreferences) => void;
  syncServerPreferences: (snapshot: OceanSnapshot) => void;
}

export function App() {
  const [preferences, setPreferences] = useState<AppPreferences>(loadPreferences);
  const updatePreferences = useCallback((next: AppPreferences) => {
    setPreferences(next);
    savePreferences(next);
  }, []);
  const syncServerPreferences = useCallback((snapshot: OceanSnapshot) => {
    setPreferences((current) => {
      const next = {
        ...current,
        onboarded: Boolean(snapshot.countryCode),
        languageCode: snapshot.languageCode,
        defaultSignature: snapshot.defaultSignature ?? "",
        reduceMotion: snapshot.reduceMotion,
        autoIncludeDate: snapshot.autoIncludeDate,
      };
      if (
        current.onboarded === next.onboarded
        && current.languageCode === next.languageCode
        && current.defaultSignature === next.defaultSignature
        && current.reduceMotion === next.reduceMotion
        && current.autoIncludeDate === next.autoIncludeDate
      ) return current;
      savePreferences(next);
      return next;
    });
  }, []);

  return (
    <I18nProvider languageCode={preferences.languageCode}>
      <AuthenticatedApp
        preferences={preferences}
        updatePreferences={updatePreferences}
        syncServerPreferences={syncServerPreferences}
      />
    </I18nProvider>
  );
}

type AuthenticatedAppProps = AppExperienceProps;

const hasOAuthError = (): boolean => {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return query.has("error") || hash.has("error");
};

function AuthenticatedApp({
  preferences,
  updatePreferences,
  syncServerPreferences,
}: AuthenticatedAppProps) {
  const { t } = useI18n();
  const { route, navigate } = useHashRoute();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [busyProvider, setBusyProvider] = useState<SocialAuthProvider | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [authFailed, setAuthFailed] = useState(hasOAuthError);

  useEffect(() => {
    if (!authGateway) return;
    let active = true;
    const unsubscribe = authGateway.onAuthStateChange((user) => {
      if (!active) return;
      setUser(user);
      setBusyProvider(null);
      setAdminBusy(false);
    });

    authGateway
      .getCurrentUser()
      .then((user) => {
        if (active) setUser(user);
      })
      .catch(() => {
        if (active) {
          setUser(null);
          setAuthFailed(true);
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const signIn = async (provider: SocialAuthProvider) => {
    if (!authGateway || busyProvider) return;
    setBusyProvider(provider);
    setAuthFailed(false);
    try {
      await authGateway.signIn(provider);
    } catch {
      setBusyProvider(null);
      setAuthFailed(true);
    }
  };

  const signOut = async () => {
    if (!authGateway) return;
    await authGateway.signOut();
    updatePreferences({ ...preferences, onboarded: false, defaultSignature: "" });
  };
  const linkIdentity = async (provider: SocialAuthProvider) => {
    if (!authGateway) return;
    await authGateway.linkIdentity(provider);
  };
  const signInAdmin = async () => {
    if (!authGateway || adminBusy) return;
    setAdminBusy(true);
    setAuthFailed(false);
    try {
      if (user) await authGateway.signOut();
      await authGateway.signInAdmin();
    } catch {
      setAdminBusy(false);
      setAuthFailed(true);
    }
  };
  const handleAuthRequired = useCallback(() => setUser(null), []);

  if (!authGateway) {
    return (
      <main className="fatal-state">
        <strong>{t("brand.name")}</strong>
        <h1>{t("fatal.title")}</h1>
        <p>{t("fatal.load")}</p>
      </main>
    );
  }

  if (user === undefined) {
    return (
      <main className="loading-screen" aria-live="polite">
        <img src={BEACH_IMAGE} alt="" />
        <strong>{t("brand.name")}</strong>
        <span>{t("auth.session")}</span>
      </main>
    );
  }

  const isAdminRoute = route === "admin";
  const hasGitHubIdentity = user?.providers.includes("github") ?? false;

  if (isAdminRoute && !hasGitHubIdentity) {
    return (
      <AdminLoginScreen
        busy={adminBusy}
        error={authFailed}
        onSignIn={() => void signInAdmin()}
        onExit={() => navigate("home")}
      />
    );
  }

  if (isAdminRoute && user) {
    return <AdminScreen gateway={adminGateway} onExit={() => void signOut()} />;
  }

  if (user === null) {
    return (
      <LoginScreen
        busyProvider={busyProvider}
        error={authFailed ? t("auth.error") : null}
        onSignIn={(provider) => void signIn(provider)}
      />
    );
  }

  return (
    <AppExperience
      key={user.id}
      user={user}
      preferences={preferences}
      updatePreferences={updatePreferences}
      syncServerPreferences={syncServerPreferences}
      onLinkIdentity={linkIdentity}
      onSignOut={signOut}
      onAuthRequired={handleAuthRequired}
    />
  );
}

interface AuthenticatedExperienceProps extends AuthenticatedAppProps {
  user: AuthUser;
  onLinkIdentity: (provider: SocialAuthProvider) => Promise<void>;
  onSignOut: () => Promise<void>;
  onAuthRequired: () => void;
}

function AppExperience({
  user,
  preferences,
  updatePreferences,
  syncServerPreferences,
  onLinkIdentity,
  onSignOut,
  onAuthRequired,
}: AuthenticatedExperienceProps) {
  const { t } = useI18n();
  const { route, navigate } = useHashRoute();
  const [snapshot, setSnapshot] = useState<OceanSnapshot | null>(null);
  const [now, setNow] = useState(Date.now);
  const [catching, setCatching] = useState(false);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const operationEpochRef = useRef(0);
  const previousIncomingMessageRef = useRef<boolean | null>(null);
  const hasIncomingMessage = snapshot
    ? snapshot.bottleAvailable || (!snapshot.waitingForNews && !snapshot.activeBottle)
    : null;

  useEffect(() => {
    if (previousIncomingMessageRef.current === false && hasIncomingMessage === true) {
      playIncomingWave();
    }
    previousIncomingMessageRef.current = hasIncomingMessage;
  }, [hasIncomingMessage]);

  useEffect(() => {
    oceanGateway
      .getSnapshot()
      .then((nextSnapshot) => {
        setSnapshot(nextSnapshot);
        syncServerPreferences(nextSnapshot);
      })
      .catch((error: unknown) => {
        if (error instanceof AuthenticationRequiredError) {
          onAuthRequired();
          return;
        }
        setLoadError(t("fatal.load"));
      });
  }, [onAuthRequired, syncServerPreferences, t]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const operationEpoch = operationEpochRef.current;
      setNow(Date.now());
      oceanGateway
        .getSnapshot()
        .then((nextSnapshot) => {
          if (operationEpochRef.current === operationEpoch) {
            setSnapshot(nextSnapshot);
            if (readAppRoute() !== "settings") syncServerPreferences(nextSnapshot);
          }
        })
        .catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [syncServerPreferences]);

  useEffect(() => {
    const syncOtherTab = () => {
      operationEpochRef.current += 1;
      const operationEpoch = operationEpochRef.current;
      oceanGateway
        .getSnapshot()
        .then((nextSnapshot) => {
          if (operationEpochRef.current === operationEpoch) {
            setSnapshot(nextSnapshot);
            if (readAppRoute() !== "settings") syncServerPreferences(nextSnapshot);
          }
        })
        .catch(() => undefined);
    };

    window.addEventListener("storage", syncOtherTab);
    return () => window.removeEventListener("storage", syncOtherTab);
  }, [syncServerPreferences]);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = preferences.reduceMotion ? "true" : "false";
  }, [preferences.reduceMotion]);

  const operationEpoch = operationEpochRef.current;
  const acceptSnapshot = useCallback((nextSnapshot: OceanSnapshot) => {
    if (operationEpochRef.current === operationEpoch) {
      setSnapshot(nextSnapshot);
      syncServerPreferences(nextSnapshot);
    }
  }, [operationEpoch, syncServerPreferences]);
  const catchFromHome = async () => {
    if (catching || !snapshot?.bottleAvailable) return;
    setCatching(true);
    const operationEpoch = operationEpochRef.current;
    try {
      const reduceMotion =
        preferences.reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const [nextSnapshot] = await Promise.all([
        oceanGateway.catchBottle(),
        wait(reduceMotion ? 0 : 520),
      ]);
      if (operationEpochRef.current !== operationEpoch) return;
      setSnapshot(nextSnapshot);
      syncServerPreferences(nextSnapshot);
      if (readAppRoute() === "home") navigate("catch");
    } catch {
      oceanGateway.getSnapshot().then(setSnapshot).catch(() => undefined);
    } finally {
      setCatching(false);
    }
  };

  if (loadError) {
    return (
      <main className="fatal-state">
        <strong>{t("brand.name")}</strong>
        <h1>{t("fatal.title")}</h1>
        <p>{loadError}</p>
        <button className="button button--primary" type="button" onClick={() => window.location.reload()}>
          {t("fatal.reload")}
        </button>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="loading-screen" aria-live="polite">
        <img src={BEACH_IMAGE} alt="" />
        <strong>{t("brand.name")}</strong>
        <span>{t("loading.sea")}</span>
      </main>
    );
  }

  if (route === "admin") {
    return <AdminScreen gateway={adminGateway} onExit={() => navigate("home")} />;
  }

  // A permanently deleted account may still have an unexpired browser token.
  // The next snapshot recreates an empty profile, so missing server-side country
  // metadata must take precedence over the old device's onboarding preference.
  if (shouldShowOnboarding(snapshot.countryCode)) {
    return (
      <Onboarding
        initialCountryCode={snapshot.countryCode}
        languageCode={preferences.languageCode}
        onLanguageChange={(languageCode) => updatePreferences({ ...preferences, languageCode })}
        onComplete={async (countryCode, defaultSignature, languageCode) => {
          const nextSnapshot = await oceanGateway.completeOnboarding(
            countryCode,
            recommendedSeaForCountry(countryCode),
            defaultSignature,
            languageCode,
          );
          setSnapshot(nextSnapshot);
          syncServerPreferences(nextSnapshot);
        }}
      />
    );
  }

  let content;
  if (route === "write") {
    content = (
      <WriteScreen
        snapshot={snapshot}
        reduceMotion={preferences.reduceMotion}
        defaultSignature={preferences.defaultSignature}
        autoIncludeDate={preferences.autoIncludeDate}
        onNavigate={navigate}
        onSnapshot={acceptSnapshot}
        onBusyChange={setSceneBusy}
      />
    );
  } else if (route === "catch") {
    content = (
      <CatchScreen
        snapshot={snapshot}
        reduceMotion={preferences.reduceMotion}
        onNavigate={navigate}
        onSnapshot={acceptSnapshot}
        onBusyChange={setSceneBusy}
      />
    );
  } else if (route === "kept") {
    content = (
      <KeptScreen
        snapshot={snapshot}
        now={now}
        onNavigate={navigate}
        onSnapshot={acceptSnapshot}
      />
    );
  } else if (route === "guide") {
    content = <GuideScreen onNavigate={navigate} />;
  } else if (route === "settings") {
    content = (
      <SettingsScreen
        linkedProviders={user.providers}
        countryCode={snapshot.countryCode ?? "ZZ"}
        languageCode={preferences.languageCode}
        reduceMotion={preferences.reduceMotion}
        defaultSignature={preferences.defaultSignature}
        autoIncludeDate={preferences.autoIncludeDate}
        onProfileChange={(nextSnapshot, languageCode) => {
          setSnapshot(nextSnapshot);
          updatePreferences({ ...preferences, languageCode });
        }}
        onDefaultSignatureChange={(defaultSignature) => updatePreferences({
          ...preferences,
          defaultSignature,
        })}
        onAppPreferencesChange={async (appPreferences) => {
          const previousPreferences = preferences;
          const nextPreferences = { ...preferences, ...appPreferences };
          updatePreferences(nextPreferences);
          try {
            const nextSnapshot = await oceanGateway.updateAppPreferences(
              nextPreferences.reduceMotion,
              nextPreferences.autoIncludeDate,
            );
            setSnapshot(nextSnapshot);
            syncServerPreferences(nextSnapshot);
          } catch (error) {
            updatePreferences(previousPreferences);
            throw error;
          }
        }}
        onLinkIdentity={onLinkIdentity}
        onSignOut={onSignOut}
      />
    );
  } else {
    content = (
      <HomeScreen
        snapshot={snapshot}
        catching={catching}
        onNavigate={navigate}
        onCatch={catchFromHome}
        onSeagull={playSeagullCall}
      />
    );
  }

  return (
    <AppShell
      controlsLocked={sceneBusy || catching}
      solidHeader={route === "guide" || route === "settings" || route === "kept"}
      onHome={() => route === "home" ? window.location.reload() : navigate("home")}
    >
      {content}
    </AppShell>
  );
}
