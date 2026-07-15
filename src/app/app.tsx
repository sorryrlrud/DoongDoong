import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/app/app-shell";
import { AdminScreen } from "@/features/admin/components/admin-screen";
import {
  loadPreferences,
  resetPreferences,
  savePreferences,
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

const wait = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));

export function App() {
  const { route, navigate } = useHashRoute();
  const [snapshot, setSnapshot] = useState<OceanSnapshot | null>(null);
  const [preferences, setPreferences] = useState<AppPreferences>(loadPreferences);
  const [now, setNow] = useState(Date.now);
  const [catching, setCatching] = useState(false);
  const [resettingDemo, setResettingDemo] = useState(false);
  const [sceneBusy, setSceneBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const operationEpochRef = useRef(0);

  useEffect(() => {
    oceanGateway
      .getSnapshot()
      .then(setSnapshot)
      .catch(() => setLoadError("바다 데이터를 준비할 수 없어요. 잠시 후 다시 시도해 주세요."));
  }, []);

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
    }, 60_000);
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
  const updatePreferences = (next: AppPreferences) => {
    setPreferences(next);
    savePreferences(next);
  };

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

  const resetDemo = async () => {
    if (resettingDemo || sceneBusy || catching) return;
    operationEpochRef.current += 1;
    setResettingDemo(true);
    try {
      const freshSnapshot = await oceanGateway.resetDemo();
      setSnapshot(freshSnapshot);
      setPreferences(resetPreferences());
      navigate("home");
    } finally {
      setResettingDemo(false);
    }
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
        <img src={BEACH_IMAGE} alt="" />
        <strong>둥둥</strong>
        <span>바다를 불러오는 중…</span>
      </main>
    );
  }

  if (route === "admin") {
    return <AdminScreen gateway={adminGateway} onExit={() => navigate("home")} />;
  }

  if (!preferences.onboarded) {
    return (
      <Onboarding
        initialSea={snapshot.seaId}
        onComplete={async (seaId) => {
          const nextSnapshot = await oceanGateway.updateSea(seaId);
          setSnapshot(nextSnapshot);
          updatePreferences({ ...preferences, onboarded: true });
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
        snapshot={snapshot}
        reduceMotion={preferences.reduceMotion}
        onReduceMotionChange={(reduceMotion) => updatePreferences({ ...preferences, reduceMotion })}
        onSnapshot={acceptSnapshot}
      />
    );
  } else {
    content = (
      <HomeScreen
        snapshot={snapshot}
        catching={catching}
        onNavigate={navigate}
        onCatch={catchFromHome}
      />
    );
  }

  return (
    <AppShell
      isDemo={snapshot.isDemo}
      resettingDemo={resettingDemo}
      controlsLocked={sceneBusy || catching}
      onHome={() => navigate("home")}
      onDemoReset={resetDemo}
    >
      {content}
    </AppShell>
  );
}
