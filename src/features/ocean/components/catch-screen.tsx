import { useEffect, useState, type MouseEvent } from "react";
import type { AppRoute } from "@/app/use-hash-route";
import { oceanGateway } from "@/features/ocean/services/runtime";
import { countryName } from "@/features/ocean/countries";
import type { BottleResolution, OceanSnapshot } from "@/features/ocean/types/ocean";
import { BEACH_IMAGE, BOTTLE_WITH_LETTER_IMAGE } from "@/shared/brand";
import { PageHeading } from "@/shared/page-heading";

interface CatchScreenProps {
  snapshot: OceanSnapshot;
  reduceMotion: boolean;
  onNavigate: (route: AppRoute) => void;
  onSnapshot: (snapshot: OceanSnapshot) => void;
  onBusyChange: (busy: boolean) => void;
}

type CatchResolution = Exclude<BottleResolution, "discard">;

const wait = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));

export function CatchScreen({
  snapshot,
  reduceMotion,
  onNavigate,
  onSnapshot,
  onBusyChange,
}: CatchScreenProps) {
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"report" | null>(null);

  useEffect(() => {
    if (!snapshot.activeBottle) onNavigate("home");
  }, [snapshot.activeBottle, onNavigate]);

  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const openBottle = async () => {
    const active = snapshot.activeBottle;
    if (!active || busy) return;
    setBusy(true);
    onBusyChange(true);
    setOpening(true);
    setError(null);
    try {
      const motionOff = reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const [nextSnapshot] = await Promise.all([
        oceanGateway.openBottle(active.id),
        wait(motionOff ? 0 : 680),
      ]);
      onSnapshot(nextSnapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "병을 열지 못했어요.");
    } finally {
      setOpening(false);
      setBusy(false);
      onBusyChange(false);
    }
  };

  const resolveBottle = async (resolution: CatchResolution) => {
    const active = snapshot.activeBottle;
    if (!active || busy) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const nextSnapshot = await oceanGateway.resolveBottle(active.id, resolution);
      onSnapshot(nextSnapshot);
      setConfirming(null);
      if (window.location.hash.replace(/^#\/?/, "") === "catch") onNavigate("home");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "병을 처리하지 못했어요.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  const active = snapshot.activeBottle;
  if (!active) {
    return (
      <section className="shore-scene">
        <img className="scene-background" src={BEACH_IMAGE} alt="" />
      </section>
    );
  }

  if (!active.opened || !active.content) {
    return (
      <section className="catch-stage">
        <img className="scene-background" src={BEACH_IMAGE} alt="" />
        <PageHeading className="sr-only">
          주운 병 열어보기
        </PageHeading>

        {error ? <div className="scene-alert" role="alert">{error}</div> : null}

        <button
          className={opening ? "catch-bottle catch-bottle--opening" : "catch-bottle"}
          type="button"
          onClick={() => void openBottle()}
          disabled={busy}
          aria-label="병을 열어 편지 꺼내기"
          aria-busy={opening}
        >
          <img src={BOTTLE_WITH_LETTER_IMAGE} alt="" />
        </button>

        <button
          className="scene-text-action"
          type="button"
          onClick={() => void resolveBottle("redrift")}
          disabled={busy}
        >
          그대로 띄우기
        </button>
        <p className="sr-only" aria-live="polite">
          {opening ? "병을 열고 있어요." : ""}
        </p>
      </section>
    );
  }

  const content = active.content;
  const returnToShore = (event: MouseEvent<HTMLElement>) => {
    if (!busy && !confirming && event.target === event.currentTarget) onNavigate("home");
  };

  return (
    <section className="opened-letter-scene" onClick={returnToShore}>
      <img className="scene-background" src={BEACH_IMAGE} alt="" />
      <PageHeading className="sr-only">
        받은 편지
      </PageHeading>

      {error ? <div className="scene-alert" role="alert">{error}</div> : null}

      <img className="opened-letter-scene__bottle" src={BOTTLE_WITH_LETTER_IMAGE} alt="" />
      <article className="catch-letter" dir="auto">
        {content.senderCountryCode ? <p className="catch-letter__origin">발신 국가 · {countryName(content.senderCountryCode)}</p> : null}
        {content.dateLabel ? <time>{content.dateLabel}</time> : null}
        <p>{content.body}</p>
        {content.signature ? <footer>{content.signature}</footer> : null}
      </article>

      <div className="letter-actions" aria-label="받은 편지 처리">
        <button type="button" onClick={() => void resolveBottle("redrift")} disabled={busy || Boolean(confirming)}>
          다시 띄우기
        </button>
        <button type="button" onClick={() => void resolveBottle("keep")} disabled={busy || Boolean(confirming)}>
          보관하기
        </button>
      </div>

      <div className="scene-report">
        {confirming !== "report" ? (
          <button className="link-button" type="button" onClick={() => setConfirming("report")} disabled={busy || Boolean(confirming)}>
            신고
          </button>
        ) : null}
      </div>

      {confirming === "report" ? (
        <div className="scene-confirm" role="group" aria-label="신고 확인" aria-live="polite">
          <p>신고하면 이 병은 즉시 사라져요.</p>
          <div>
            <button type="button" onClick={() => setConfirming(null)}>취소</button>
            <button type="button" onClick={() => void resolveBottle("report")} disabled={busy}>신고</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
