import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CatchScreen } from "@/features/ocean/components/catch-screen";
import { HomeScreen } from "@/features/ocean/components/home-screen";
import { Onboarding } from "@/features/ocean/components/onboarding";
import { SettingsScreen } from "@/features/ocean/components/settings-screen";
import type { OceanSnapshot } from "@/features/ocean/types/ocean";

const waitingSnapshot: OceanSnapshot = {
  seaId: "pacific",
  countryCode: "KR",
  remainingSends: 2,
  nextCatchAt: null,
  bottleAvailable: false,
  waitingForNews: true,
  activeBottle: null,
  keptBottles: [],
};

describe("sea experience", () => {
  it("does not ask for a receiving sea during onboarding", () => {
    const html = renderToStaticMarkup(
      <Onboarding
        initialCountryCode="KR"
        onComplete={async () => undefined}
      />,
    );

    expect(html).not.toContain("병을 건질 바다");
    expect(html).not.toContain("onboarding-sea");
  });

  it("describes the saved sea as a sending default only", () => {
    const html = renderToStaticMarkup(
      <SettingsScreen
        snapshot={waitingSnapshot}
        reduceMotion={false}
        onReduceMotionChange={() => undefined}
        defaultSignature=""
        autoIncludeDate={false}
        onWritingDefaultsChange={() => undefined}
        onSnapshot={() => undefined}
      />,
    );

    expect(html).toContain("병을 띄울 기본 바다");
    expect(html).toContain("병은 모든 바다에서 도착해요.");
    expect(html).not.toContain("병을 건질 바다");
  });

  it("shows the gull waiting state only when the ocean has no message to receive", () => {
    const html = renderToStaticMarkup(
      <HomeScreen snapshot={waitingSnapshot} catching={false} onNavigate={() => undefined} onCatch={async () => undefined} onSeagull={() => undefined} />,
    );

    expect(html).toContain("새 소식을 기다리는 중 …");
    expect(html).toContain("waiting-news__gull");
  });

  it("keeps the gull visible when a sea has a bottle but the catch cooldown is still active", () => {
    const html = renderToStaticMarkup(
      <HomeScreen
        snapshot={{
          ...waitingSnapshot,
          nextCatchAt: Date.now() + 60_000,
          waitingForNews: false,
        }}
        catching={false}
        onNavigate={() => undefined}
        onCatch={async () => undefined}
        onSeagull={() => undefined}
      />,
    );

    expect(html).toContain("새 소식을 기다리는 중 …");
    expect(html).toContain("waiting-news__gull");
  });

  it("replaces the writing set with a crab after today's letters are used", () => {
    const html = renderToStaticMarkup(
      <HomeScreen
        snapshot={{ ...waitingSnapshot, remainingSends: 0 }}
        catching={false}
        onNavigate={() => undefined}
        onCatch={async () => undefined}
        onSeagull={() => undefined}
      />,
    );

    expect(html).toContain("다음 편지지와 병을 준비하는 중 …");
    expect(html).toContain("doongdoong-crab.png");
    expect(html).not.toContain("doongdoong-writing-set.png");
  });

  it("shows the sender's country after a bottle is opened", () => {
    const html = renderToStaticMarkup(
      <CatchScreen
        snapshot={{
          ...waitingSnapshot,
          activeBottle: {
            id: "message-id",
            opened: true,
            caughtAt: Date.now(),
            content: {
              id: "message-id",
              body: "오늘 하루도 무사히 지나가기를 바라요.",
              senderCountryCode: "IN",
            },
          },
        }}
        reduceMotion
        onNavigate={() => undefined}
        onSnapshot={() => undefined}
        onBusyChange={() => undefined}
      />,
    );

    expect(html).toContain("발신 국가 · 인도");
  });

  it("shows the regular bottle artwork before a caught bottle is opened", () => {
    const html = renderToStaticMarkup(
      <CatchScreen
        snapshot={{
          ...waitingSnapshot,
          activeBottle: {
            id: "message-id",
            opened: false,
            caughtAt: Date.now(),
          },
        }}
        reduceMotion
        onNavigate={() => undefined}
        onSnapshot={() => undefined}
        onBusyChange={() => undefined}
      />,
    );

    expect(html).toContain("doongdoong-bottle-letter.png");
    expect(html).not.toContain("doongdoong-bottle-arrived.png");
  });
});
