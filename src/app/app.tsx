import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/app/app-shell";
import { loadPreferences, savePreferences, type AppPreferences } from "@/app/preferences";
import { readAppRoute, useHashRoute } from "@/app/use-hash-route";
import { CatchScreen } from "@/features/ocean/components/catch-screen";
import { GuideScreen } from "@/features/ocean/components/guide-screen";
import { HomeScreen } from "@/features/ocean/components/home-screen";
import { KeptScreen } from "@/features/ocean/components/kept-screen";
import { SettingsScreen } from "@/features/ocean/components/settings-screen";
import { WriteScreen } from "@/features/ocean/components/write-screen";
import { oceanGateway } from "@/features/ocean/services/runtime";
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
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const operationEpochRef = useRef(0);

  useEffect(() => {
    oceanGateway
      .getSnapshot()
      .then(setSnapshot)
      .catch(() => setLoadError("이 브라우저에서는 데모 데이터를 준비할 수 없어요."));
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

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3_500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const showNotice = useCallback((message: string) => setNotice(message), []);
  const operationEpoch = operationEpochRef.current;
  const acceptSnapshot = useCallback((nextSnapshot: OceanSnapshot) => {
    if (operationEpochRef.current === operationEpoch) setSnapshot(nextSnapshot);
  }, [operationEpoch]);
  const acceptNotice = useCallback((message: string) => {
    if (operationEpochRef.current === operationEpoch) showNotice(message);
  }, [operationEpoch, showNotice]);

  const updatePreferences = (next: AppPreferences) => {
    setPreferences(next);
    savePreferences(next);
  };

  const catchFromHome = async () => {
    if (catching || !snapshot?.bottleAvailable) return;
    setCatching(true);
    const operationEpoch = operationEpochRef.current;
    try {
      const hadBottle = Boolean(snapshot?.activeBottle);
      const reduceMotion =
        preferences.reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const [nextSnapshot] = await Promise.all([
        oceanGateway.catchBottle(),
        wait(reduceMotion ? 0 : 520),
      ]);
      if (operationEpochRef.current !== operationEpoch) return;
      setSnapshot(nextSnapshot);
      showNotice(hadBottle ? "병을 다시 만났어요." : "병을 건졌어요.");
      if (readAppRoute() === "home") navigate("catch");
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : "지금은 병을 건질 수 없어요.");
    } finally {
      setCatching(false);
    }
  };

  const resetDemo = async () => {
    if (resettingDemo || sceneBusy || catching) return;
    operationEpochRef.current += 1;
    setResettingDemo(true);
    try {
      setSnapshot(await oceanGateway.resetDemo());
      navigate("home");
      showNotice("처음 해변으로 돌아왔어요.");
    } catch {
      showNotice("데모를 초기화하지 못했어요.");
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

  let content;
  if (route === "write") {
    content = (
      <WriteScreen
        snapshot={snapshot}
        reduceMotion={preferences.reduceMotion}
        onNavigate={navigate}
        onSnapshot={acceptSnapshot}
        onNotice={acceptNotice}
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
        onNotice={acceptNotice}
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
        onNotice={acceptNotice}
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
        onNotice={acceptNotice}
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
      notice={notice}
      resettingDemo={resettingDemo}
      controlsLocked={sceneBusy || catching}
      onHome={() => navigate("home")}
      onDemoReset={resetDemo}
    >
      {content}
    </AppShell>
  );
}
