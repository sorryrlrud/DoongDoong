import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/app/app-shell";
import type { AdminGateway } from "@/features/admin/types/admin";
import type { AuthGateway, AuthUser, SocialAuthProvider } from "@/features/auth/types/auth";
import {
  loadPreferences,
  resetPreferences,
  savePreferences,
  shouldShowOnboarding,
  type AppPreferences,
} from "@/app/preferences";
import { readAppRoute, useHashRoute } from "@/app/use-hash-route";
import { LoginScreen } from "@/features/auth/components/login-screen";
import { AccountMergeScreen } from "@/features/auth/components/account-merge-screen";
import { HomeScreen } from "@/features/ocean/components/home-screen";
import { AuthenticationRequiredError } from "@/features/ocean/services/errors";
import type { OceanGateway, OceanSnapshot } from "@/features/ocean/types/ocean";
import { LOGIN_BEACH_IMAGE } from "@/shared/brand";
import { playIncomingWave, playSeagullCall } from "@/features/ocean/services/ocean-audio";
import { recommendedSeaForCountry } from "@/features/ocean/countries";
import {
  clearBrowserPushSubscription,
  getExistingPushSubscription,
  isIosDevice,
  isStandalonePwa,
  onPushSubscriptionChange,
  requestPushSubscription,
} from "@/features/ocean/services/push-notifications";
import { getBrowserTimeZone } from "@/features/ocean/services/time-zone";
import { I18nProvider, useI18n } from "@/i18n/i18n";

const wait = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));

const AdminScreen = lazy(async () => ({ default: (await import("@/features/admin/components/admin-screen")).AdminScreen }));
const AdminLoginScreen = lazy(async () => ({ default: (await import("@/features/auth/components/admin-login-screen")).AdminLoginScreen }));
const CatchScreen = lazy(async () => ({ default: (await import("@/features/ocean/components/catch-screen")).CatchScreen }));
const GuideScreen = lazy(async () => ({ default: (await import("@/features/ocean/components/guide-screen")).GuideScreen }));
const KeptScreen = lazy(async () => ({ default: (await import("@/features/ocean/components/kept-screen")).KeptScreen }));
const Onboarding = lazy(async () => ({ default: (await import("@/features/ocean/components/onboarding")).Onboarding }));
const SettingsScreen = lazy(async () => ({ default: (await import("@/features/ocean/components/settings-screen")).SettingsScreen }));
const WriteScreen = lazy(async () => ({ default: (await import("@/features/ocean/components/write-screen")).WriteScreen }));

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface AppExperienceProps {
  preferences: AppPreferences;
  updatePreferences: (next: AppPreferences) => void;
  syncServerPreferences: (snapshot: OceanSnapshot) => void;
  canInstall: boolean;
  showIosInstallHelp: boolean;
  onInstall: () => Promise<void>;
}

interface RuntimeGateways {
  authGateway: AuthGateway | null;
  adminAuthGateway: AuthGateway | null;
  oceanGateway: OceanGateway;
  adminGateway: AdminGateway | null;
}

export function App() {
  const [preferences, setPreferences] = useState<AppPreferences>(loadPreferences);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [runtime, setRuntime] = useState<RuntimeGateways | null>(null);
  const [runtimeLoadFailed, setRuntimeLoadFailed] = useState(false);
  const updatePreferences = useCallback((next: AppPreferences) => {
    setPreferences(next);
    savePreferences(next);
  }, []);
  const syncServerPreferences = useCallback((snapshot: OceanSnapshot) => {
    setPreferences((current) => {
      const { pendingLanguageCode: currentPendingLanguageCode, ...currentPreferences } = current;
      const pendingLanguageCode = currentPendingLanguageCode === snapshot.languageCode
        ? undefined
        : currentPendingLanguageCode;
      const next = {
        ...currentPreferences,
        onboarded: Boolean(snapshot.countryCode),
        languageCode: pendingLanguageCode ?? snapshot.languageCode,
        defaultSignature: snapshot.defaultSignature ?? "",
        reduceMotion: snapshot.reduceMotion,
        autoIncludeDate: snapshot.autoIncludeDate,
        ...(pendingLanguageCode ? { pendingLanguageCode } : {}),
      };
      if (
        current.onboarded === next.onboarded
        && current.languageCode === next.languageCode
        && current.defaultSignature === next.defaultSignature
        && current.reduceMotion === next.reduceMotion
        && current.autoIncludeDate === next.autoIncludeDate
        && current.pendingLanguageCode === next.pendingLanguageCode
      ) return current;
      savePreferences(next);
      return next;
    });
  }, []);
  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);
  useEffect(() => {
    let active = true;
    // The login shell does not need the database/realtime client. Let the
    // LCP content paint before loading that dependency in the background.
    const timer = window.setTimeout(() => {
      void import("@/features/ocean/services/runtime")
        .then((loaded) => {
          if (!active) return;
          setRuntime({
            authGateway: loaded.authGateway,
            adminAuthGateway: loaded.adminAuthGateway,
            oceanGateway: loaded.oceanGateway,
            adminGateway: loaded.adminGateway,
          });
        })
        .catch(() => {
          if (active) setRuntimeLoadFailed(true);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);
  const install = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }, [installPrompt]);

  return (
    <I18nProvider languageCode={preferences.languageCode}>
      <AuthenticatedApp
        preferences={preferences}
        updatePreferences={updatePreferences}
        syncServerPreferences={syncServerPreferences}
        canInstall={installPrompt !== null}
        showIosInstallHelp={isIosDevice() && !isStandalonePwa()}
        onInstall={install}
        runtime={runtime}
        runtimeLoadFailed={runtimeLoadFailed}
      />
    </I18nProvider>
  );
}

interface AuthenticatedAppProps extends AppExperienceProps {
  runtime: RuntimeGateways | null;
  runtimeLoadFailed: boolean;
}

const hasOAuthError = (): boolean => {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return query.has("error") || hash.has("error");
};

const hasPublicSocialIdentity = (user: AuthUser | null | undefined): boolean =>
  user?.providers.some((provider) => ["google", "apple", "custom:naver"].includes(provider)) ?? false;

function DeferredScreenFallback() {
  const { t } = useI18n();
  return (
    <main className="loading-screen" aria-live="polite">
      <img src={LOGIN_BEACH_IMAGE} width="768" height="512" alt="" />
      <strong>{t("brand.name")}</strong>
      <span>{t("loading.sea")}</span>
    </main>
  );
}

function AuthenticatedApp({
  preferences,
  updatePreferences,
  syncServerPreferences,
  canInstall,
  showIosInstallHelp,
  onInstall,
  runtime,
  runtimeLoadFailed,
}: AuthenticatedAppProps) {
  const { t } = useI18n();
  const { route, navigate } = useHashRoute();
  const isAdminRoute = route === "admin";
  const authGateway = runtime?.authGateway ?? null;
  const adminAuthGateway = runtime?.adminAuthGateway ?? null;
  const activeAuthGateway = isAdminRoute ? adminAuthGateway : authGateway;
  const [authState, setAuthState] = useState<{
    gateway: AuthGateway | null;
    user: AuthUser | null | undefined;
  }>(() => ({ gateway: activeAuthGateway, user: undefined }));
  const user = authState.gateway === activeAuthGateway ? authState.user : undefined;
  const [busyProvider, setBusyProvider] = useState<SocialAuthProvider | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [authFailed, setAuthFailed] = useState(hasOAuthError);
  const [identityLinkConflict, setIdentityLinkConflict] = useState<SocialAuthProvider | null>(null);

  useEffect(() => {
    if (!activeAuthGateway) return;
    let active = true;
    const unsubscribe = activeAuthGateway.onAuthStateChange((user) => {
      if (!active) return;
      setAuthState({ gateway: activeAuthGateway, user });
      setBusyProvider(null);
      setAdminBusy(false);
    });

    activeAuthGateway
      .getCurrentUser()
      .then((user) => {
        if (active) setAuthState({ gateway: activeAuthGateway, user });
      })
      .catch(() => {
        if (active) {
          setAuthState({ gateway: activeAuthGateway, user: null });
          setAuthFailed(true);
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [activeAuthGateway]);

  useEffect(() => {
    if (!authGateway || !user || isAdminRoute) return;
    const conflict = authGateway.consumeIdentityLinkConflict();
    if (conflict) {
      const timer = window.setTimeout(() => {
        setIdentityLinkConflict(conflict);
        setAuthFailed(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [authGateway, isAdminRoute, user]);

  // `?admin=1` is reserved for the OAuth callback because Supabase uses the
  // fragment for its response. Once that response has been consumed, keep the
  // browser on the single public administrator address: `#/admin`.
  useEffect(() => {
    if (isAdminRoute && user !== undefined) navigate("admin");
  }, [isAdminRoute, navigate, user]);

  const signIn = async (provider: SocialAuthProvider) => {
    if (!authGateway || busyProvider) return;
    setBusyProvider(provider);
    setAuthFailed(false);
    try {
      // A GitHub session created by the previous shared-session implementation
      // cannot enter the public app. Clear it before starting a regular login.
      if (user && !hasPublicSocialIdentity(user)) await authGateway.signOut();
      await authGateway.signIn(provider);
    } catch {
      setBusyProvider(null);
      setAuthFailed(true);
    }
  };

  const signOut = async () => {
    if (!authGateway) return;
    await authGateway.signOut();
    updatePreferences({
      ...preferences,
      onboarded: false,
      defaultSignature: "",
      pendingLanguageCode: undefined,
    });
  };
  const linkIdentity = async (provider: SocialAuthProvider) => {
    if (!authGateway) return;
    await authGateway.linkIdentity(provider);
  };
  const startAccountMerge = async (provider: SocialAuthProvider) => {
    if (!authGateway) return;
    setIdentityLinkConflict(null);
    await authGateway.startAccountMerge(provider);
  };
  const signInAdmin = async () => {
    if (!adminAuthGateway || adminBusy) return;
    setAdminBusy(true);
    setAuthFailed(false);
    try {
      if (user) await adminAuthGateway.signOut();
      await adminAuthGateway.signInAdmin();
    } catch {
      setAdminBusy(false);
      setAuthFailed(true);
    }
  };
  const signOutAdmin = async () => {
    if (!adminAuthGateway) return;
    await adminAuthGateway.signOut();
    navigate("home");
  };
  const handleAuthRequired = useCallback(() => {
    setAuthState((current) => ({ ...current, user: null }));
  }, []);

  if (runtimeLoadFailed || (runtime && !activeAuthGateway)) {
    return (
      <main className="fatal-state">
        <strong>{t("brand.name")}</strong>
        <h1>{t("fatal.title")}</h1>
        <p>{t("fatal.load")}</p>
      </main>
    );
  }

  if (!runtime || user === undefined) {
    return (
      <LoginScreen
        busyProvider={null}
        error={null}
        sessionPending
        onSignIn={() => undefined}
      />
    );
  }

  const hasGitHubIdentity = user?.providers.includes("github") ?? false;

  if (isAdminRoute && !hasGitHubIdentity) {
    return (
      <Suspense fallback={<DeferredScreenFallback />}>
        <AdminLoginScreen
          busy={adminBusy}
          error={authFailed}
          onSignIn={() => void signInAdmin()}
          onExit={() => navigate("home")}
        />
      </Suspense>
    );
  }

  if (isAdminRoute && user) {
    return (
      <Suspense fallback={<DeferredScreenFallback />}>
        <AdminScreen gateway={runtime.adminGateway} onExit={() => void signOutAdmin()} />
      </Suspense>
    );
  }

  if (user === null || !hasPublicSocialIdentity(user)) {
    return (
      <Suspense fallback={<DeferredScreenFallback />}>
        <LoginScreen
          busyProvider={busyProvider}
          error={authFailed ? t("auth.error") : null}
          onSignIn={(provider) => void signIn(provider)}
        />
      </Suspense>
    );
  }

  if (!isAdminRoute && authGateway?.hasPendingAccountMerge()) {
    return (
      <AccountMergeScreen
        onPreview={() => authGateway.previewAccountMerge()}
        onComplete={() => authGateway.completeAccountMerge()}
        onCancel={async () => {
          await authGateway.cancelAccountMerge();
          await signOut();
        }}
        onResumeSignIn={(provider) => authGateway.signIn(provider)}
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
      canInstall={canInstall}
      showIosInstallHelp={showIosInstallHelp}
      onInstall={onInstall}
      onLinkIdentity={linkIdentity}
      identityLinkConflict={identityLinkConflict}
      onStartAccountMerge={startAccountMerge}
      onDismissIdentityLinkConflict={() => setIdentityLinkConflict(null)}
      onSignOut={signOut}
      onAuthRequired={handleAuthRequired}
      oceanGateway={runtime.oceanGateway}
    />
  );
}

interface AuthenticatedExperienceProps extends AppExperienceProps {
  user: AuthUser;
  onLinkIdentity: (provider: SocialAuthProvider) => Promise<void>;
  identityLinkConflict: SocialAuthProvider | null;
  onStartAccountMerge: (provider: SocialAuthProvider) => Promise<void>;
  onDismissIdentityLinkConflict: () => void;
  onSignOut: () => Promise<void>;
  onAuthRequired: () => void;
  oceanGateway: OceanGateway;
}

function AppExperience({
  user,
  preferences,
  updatePreferences,
  syncServerPreferences,
  canInstall,
  showIosInstallHelp,
  onInstall,
  onLinkIdentity,
  identityLinkConflict,
  onStartAccountMerge,
  onDismissIdentityLinkConflict,
  onSignOut,
  onAuthRequired,
  oceanGateway,
}: AuthenticatedExperienceProps) {
  const { t } = useI18n();
  const { route, navigate } = useHashRoute();
  const [snapshot, setSnapshot] = useState<OceanSnapshot | null>(null);
  const [now, setNow] = useState(Date.now);
  const [catching, setCatching] = useState(false);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const operationEpochRef = useRef(0);
  const previousIncomingMessageRef = useRef<boolean | null>(null);
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const hasIncomingMessage = snapshot ? Boolean(snapshot.activeBottle) : null;

  useEffect(() => {
    if (previousIncomingMessageRef.current === false && hasIncomingMessage === true) {
      playIncomingWave();
    }
    previousIncomingMessageRef.current = hasIncomingMessage;
  }, [hasIncomingMessage]);

  useEffect(() => {
    const timeZone = getBrowserTimeZone();
    if (!timeZone) return;

    // The server owns date boundaries and validates the IANA value. This is
    // intentionally best effort: a privacy setting, offline browser, or an
    // older deployment must never block onboarding or the ocean experience.
    void oceanGateway.updateTimeZone(timeZone).catch(() => undefined);
  }, [oceanGateway, user.id]);

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
        setLoadError(true);
      });
  }, [oceanGateway, onAuthRequired, syncServerPreferences]);

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
  }, [oceanGateway, syncServerPreferences]);

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
  }, [oceanGateway, syncServerPreferences]);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = preferences.reduceMotion ? "true" : "false";
  }, [preferences.reduceMotion]);

  useEffect(() => {
    if (typeof snapshot?.bottleArrivedEnabled === "boolean") {
      setNotificationEnabled(snapshot.bottleArrivedEnabled);
    }
  }, [snapshot?.bottleArrivedEnabled]);

  const refreshPushSubscription = useCallback(async () => {
    if (!notificationEnabled) return;
    const subscription = await getExistingPushSubscription();
    if (subscription) await oceanGateway.upsertPushSubscription(subscription);
  }, [notificationEnabled, oceanGateway]);

  useEffect(() => {
    void refreshPushSubscription().catch(() => undefined);
  }, [refreshPushSubscription]);

  useEffect(() => onPushSubscriptionChange(() => {
    void refreshPushSubscription().catch(() => undefined);
  }), [refreshPushSubscription]);

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
      // Assignment happens in the scheduled backend worker. Opening the shore
      // must never compete for a global message or mutate its assignment.
      const [nextSnapshot] = await Promise.all([
        snapshot.activeBottle ? Promise.resolve(snapshot) : oceanGateway.getSnapshot(),
        wait(reduceMotion ? 0 : 520),
      ]);
      if (operationEpochRef.current !== operationEpoch) return;
      setSnapshot(nextSnapshot);
      syncServerPreferences(nextSnapshot);
      if (nextSnapshot.activeBottle && readAppRoute() === "home") navigate("catch");
    } catch {
      oceanGateway.getSnapshot().then(setSnapshot).catch(() => undefined);
    } finally {
      setCatching(false);
    }
  };

  const changeBottleArrivalNotifications = async (enabled: boolean): Promise<boolean> => {
    if (enabled) {
      const subscription = await requestPushSubscription();
      await oceanGateway.upsertPushSubscription(subscription);
    }
    const nextPreferences = await oceanGateway.updateNotificationPreferences(enabled);
    setNotificationEnabled(nextPreferences.bottleArrivedEnabled);
    return nextPreferences.bottleArrivedEnabled;
  };

  const deleteAccount = async (): Promise<void> => {
    await oceanGateway.deleteAccount();
    await clearBrowserPushSubscription().catch(() => undefined);
    updatePreferences(resetPreferences());
    onAuthRequired();
  };

  if (loadError) {
    return (
      <main className="fatal-state">
        <strong>{t("brand.name")}</strong>
        <h1>{t("fatal.title")}</h1>
        <p>{t("fatal.load")}</p>
        <button className="button button--primary" type="button" onClick={() => window.location.reload()}>
          {t("fatal.reload")}
        </button>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="loading-screen" aria-live="polite">
        <img src={LOGIN_BEACH_IMAGE} width="768" height="512" alt="" />
        <strong>{t("brand.name")}</strong>
        <span>{t("loading.sea")}</span>
      </main>
    );
  }

  // A permanently deleted account may still have an unexpired browser token.
  // The next snapshot recreates an empty profile, so missing server-side country
  // metadata must take precedence over the old device's onboarding preference.
  if (shouldShowOnboarding(snapshot.countryCode)) {
    return (
      <Suspense fallback={<DeferredScreenFallback />}>
        <Onboarding
          initialCountryCode={snapshot.countryCode}
          languageCode={preferences.languageCode}
          onLanguageChange={(languageCode) => updatePreferences({
            ...preferences,
            languageCode,
            pendingLanguageCode: languageCode,
          })}
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
      </Suspense>
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
        onLanguagePreview={(languageCode) => updatePreferences({
          ...preferences,
          languageCode,
          pendingLanguageCode: languageCode,
        })}
        onProfileChange={(nextSnapshot, languageCode) => {
          setSnapshot({ ...nextSnapshot, languageCode });
          updatePreferences({
            ...preferences,
            languageCode,
            ...(nextSnapshot.languageCode === languageCode ? {} : { pendingLanguageCode: languageCode }),
          });
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
        identityLinkConflict={identityLinkConflict}
        onStartAccountMerge={onStartAccountMerge}
        onDismissIdentityLinkConflict={onDismissIdentityLinkConflict}
        onSignOut={onSignOut}
        notificationEnabled={notificationEnabled}
        onNotificationPreferenceChange={changeBottleArrivalNotifications}
        canInstall={canInstall}
        showIosInstallHelp={showIosInstallHelp}
        onInstall={onInstall}
        onDeleteAccount={deleteAccount}
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
      <Suspense fallback={<DeferredScreenFallback />}>
        {content}
      </Suspense>
    </AppShell>
  );
}
