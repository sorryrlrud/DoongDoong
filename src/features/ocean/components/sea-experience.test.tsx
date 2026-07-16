import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CatchScreen } from "@/features/ocean/components/catch-screen";
import { HomeScreen } from "@/features/ocean/components/home-screen";
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
  it("shows the gull waiting state only when the ocean has no message to receive", () => {
    const html = renderToStaticMarkup(
      <HomeScreen snapshot={waitingSnapshot} catching={false} onNavigate={() => undefined} onCatch={async () => undefined} />,
    );

    expect(html).toContain("새 소식을 기다리는 중 …");
    expect(html).toContain("waiting-news__gull");
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
});
