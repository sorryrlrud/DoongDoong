import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/app/app-shell";
import { AdminScreen } from "@/features/admin/components/admin-screen";
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
import { adminGateway, oceanGateway } from "@/features/ocean/services/runtime";
import type { OceanSnapshot } from "@/features/ocean/types/ocean";
import { BEACH_IMAGE } from "@/shared/brand";
import { playIncomingWave, playSeagullCall } from "@/features/ocean/services/ocean-audio";
import { recommendedSeaForCountry } from "@/features/ocean/countries";
import { I18nProvider, useI18n } from "@/i18n/i18n";
import type { LanguageCode } from "@/i18n/languages";

const wait = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));

interface AppExperienceProps {
  preferences: AppPreferences;
  updatePreferences: (next: AppPreferences) => void;
  syncLanguage: (languageCode: LanguageCode) => void;
}

export function App() {
  const [preferences, setPreferences] = useState<AppPreferences>(loadPreferences);
  const updatePreferences = useCallback((next: AppPreferences) => {
    setPreferences(next);
    savePreferences(next);
  }, []);
  const syncLanguage = useCallback((languageCode: LanguageCode) => {
    setPreferences((current) => {
      if (current.languageCode === languageCode) return current;
      const next = { ...current, languageCode };
      savePreferences(next);
      return next;
    });
  }, []);

  return (
    <I18nProvider languageCode={preferences.languageCode}>
      <AppExperience
        preferences={preferences}
        updatePreferences={updatePreferences}
        syncLanguage={syncLanguage}
      />
    </I18nProvider>
  );
}

function AppExperience({ preferences, updatePreferences, syncLanguage }: AppExperienceProps) {
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
        if (nextSnapshot.countryCode) syncLanguage(nextSnapshot.languageCode);
      })
      .catch(() => setLoadError(t("fatal.load")));
  }, [syncLanguage, t]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const operationEpoch = operationEpochRef.current;
      setNow(Date.now());
      oceanGateway
        .getSnapshot()
        .then((nextSnapshot) => {
          if (operationEpochRef.current === operationEpoch) setSnapshot(nextSnapshot);
        })
        .catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const syncOtherTab = () => {
      operationEpochRef.current += 1;
      const operationEpoch = operationEpochRef.current;
      oceanGateway
        .getSnapshot()
        .then((nextSnapshot) => {
          if (operationEpochRef.current === operationEpoch) setSnapshot(nextSnapshot);
        })
        .catch(() => undefined);
    };

    window.addEventListener("storage", syncOtherTab);
    return () => window.removeEventListener("storage", syncOtherTab);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = preferences.reduceMotion ? "true" : "false";
  }, [preferences.reduceMotion]);

  const operationEpoch = operationEpochRef.current;
  const acceptSnapshot = useCallback((nextSnapshot: OceanSnapshot) => {
    if (operationEpochRef.current === operationEpoch) setSnapshot(nextSnapshot);
  }, [operationEpoch]);
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
  if (shouldShowOnboarding(preferences, snapshot.countryCode)) {
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
          updatePreferences({ ...preferences, onboarded: true, defaultSignature, languageCode });
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
        countryCode={snapshot.countryCode ?? "ZZ"}
        languageCode={preferences.languageCode}
        reduceMotion={preferences.reduceMotion}
        onReduceMotionChange={(reduceMotion) => updatePreferences({ ...preferences, reduceMotion })}
        defaultSignature={preferences.defaultSignature}
        autoIncludeDate={preferences.autoIncludeDate}
        onProfileChange={(nextSnapshot, languageCode) => {
          setSnapshot(nextSnapshot);
          updatePreferences({ ...preferences, languageCode });
        }}
        onWritingDefaultsChange={(writingDefaults) => updatePreferences({
          ...preferences,
          ...writingDefaults,
        })}
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
      onHome={() => route === "home" ? window.location.reload() : navigate("home")}
    >
      {content}
    </AppShell>
  );
}
