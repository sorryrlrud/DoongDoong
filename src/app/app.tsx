import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/app/app-shell";
import { loadPreferences, savePreferences, type AppPreferences } from "@/app/preferences";
import { useHashRoute } from "@/app/use-hash-route";
import { CatchScreen } from "@/features/ocean/components/catch-screen";
import { GuideScreen } from "@/features/ocean/components/guide-screen";
import { HomeScreen } from "@/features/ocean/components/home-screen";
import { KeptScreen } from "@/features/ocean/components/kept-screen";
import { Onboarding } from "@/features/ocean/components/onboarding";
import { SettingsScreen } from "@/features/ocean/components/settings-screen";
import { WriteScreen } from "@/features/ocean/components/write-screen";
import { oceanGateway } from "@/features/ocean/services/runtime";
import type { OceanSnapshot, SeaId } from "@/features/ocean/types/ocean";
import { HERO_IMAGE } from "@/shared/brand";

export function App() {
  const { route, navigate } = useHashRoute();
  const [snapshot, setSnapshot] = useState<OceanSnapshot | null>(null);
  const [preferences, setPreferences] = useState<AppPreferences>(loadPreferences);
  const [now, setNow] = useState(Date.now);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    oceanGateway
      .getSnapshot()
      .then(setSnapshot)
      .catch(() => setLoadError("이 브라우저에서는 데모 데이터를 준비할 수 없어요."));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = preferences.reduceMotion ? "true" : "false";
  }, [preferences.reduceMotion]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3_500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const showNotice = useCallback((message: string) => setNotice(message), []);

  const updatePreferences = (next: AppPreferences) => {
    setPreferences(next);
    savePreferences(next);
  };

  const completeOnboarding = async (seaId: SeaId) => {
    const nextSnapshot = await oceanGateway.updateSea(seaId);
    setSnapshot(nextSnapshot);
    updatePreferences({ ...preferences, onboarded: true });
  };

  if (loadError) {
    return (
      <main className="fatal-state">
        <strong>둥둥</strong>
        <h1>바다를 열지 못했어요.</h1>
        <p>{loadError}</p>
        <button className="button button--primary" type="button" onClick={() => window.location.reload()}>
          다시 열기
        </button>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="loading-screen" aria-live="polite">
        <img src={HERO_IMAGE} alt="" />
        <strong>둥둥</strong>
        <span>바다를 불러오는 중…</span>
      </main>
    );
  }

  if (!preferences.onboarded) {
    return <Onboarding initialSea={snapshot.seaId} onComplete={completeOnboarding} />;
  }

  let content;
  if (route === "write") {
    content = (
      <WriteScreen
        snapshot={snapshot}
        onNavigate={navigate}
        onSnapshot={setSnapshot}
        onNotice={showNotice}
      />
    );
  } else if (route === "catch") {
    content = (
      <CatchScreen
        snapshot={snapshot}
        now={now}
        onNavigate={navigate}
        onSnapshot={setSnapshot}
        onNotice={showNotice}
      />
    );
  } else if (route === "kept") {
    content = (
      <KeptScreen
        snapshot={snapshot}
        now={now}
        onNavigate={navigate}
        onSnapshot={setSnapshot}
        onNotice={showNotice}
      />
    );
  } else if (route === "guide") {
    content = <GuideScreen onNavigate={navigate} />;
  } else if (route === "settings") {
    content = (
      <SettingsScreen
        snapshot={snapshot}
        reduceMotion={preferences.reduceMotion}
        onReduceMotionChange={(reduceMotion) => updatePreferences({ ...preferences, reduceMotion })}
        onSnapshot={setSnapshot}
        onNotice={showNotice}
      />
    );
  } else {
    content = <HomeScreen snapshot={snapshot} now={now} onNavigate={navigate} />;
  }

  return (
    <AppShell route={route} snapshot={snapshot} notice={notice} onNavigate={navigate}>
      {content}
    </AppShell>
  );
}
