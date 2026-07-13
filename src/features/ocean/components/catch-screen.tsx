import { useState } from "react";
import type { AppRoute } from "@/app/use-hash-route";
import { oceanGateway } from "@/features/ocean/services/runtime";
import type { BottleResolution, OceanSnapshot } from "@/features/ocean/types/ocean";
import { formatCountdown } from "@/features/ocean/utils/time";
import { HERO_IMAGE } from "@/shared/brand";
import { PageHeading } from "@/shared/page-heading";

interface CatchScreenProps {
  snapshot: OceanSnapshot;
  now: number;
  onNavigate: (route: AppRoute) => void;
  onSnapshot: (snapshot: OceanSnapshot) => void;
  onNotice: (message: string) => void;
}

type ResultKind = "redrift" | "keep" | "discard" | "report" | null;

const RESULT_COPY: Record<Exclude<ResultKind, null>, { title: string; body: string }> = {
  redrift: { title: "다시 둥둥 띄웠어요.", body: "조금 더 빠른 물결을 타고 다른 누군가에게 흘러갑니다." },
  keep: { title: "잠시 곁에 두었어요.", body: "30일 동안 보관함에서 다시 읽고, 띄우거나 버릴 수 있어요." },
  discard: { title: "바다에서 사라졌어요.", body: "이 편지는 되돌아오지 않아요." },
  report: { title: "신고하고 숨겼어요.", body: "이 병은 더 이상 바다를 떠돌지 않습니다." },
};

export function CatchScreen({ snapshot, now, onNavigate, onSnapshot, onNotice }: CatchScreenProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultKind>(null);
  const [confirming, setConfirming] = useState<BottleResolution | null>(null);

  const catchBottle = async () => {
    setBusy(true);
    setError(null);
    try {
      onSnapshot(await oceanGateway.catchBottle());
      onNotice("병 하나를 건졌어요.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "병을 건지지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const openBottle = async () => {
    const active = snapshot.activeBottle;
    if (!active) return;
    setBusy(true);
    try {
      onSnapshot(await oceanGateway.openBottle(active.id));
      onNotice("병을 열었어요.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "병을 열지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const resolveBottle = async (resolution: BottleResolution) => {
    const active = snapshot.activeBottle;
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      onSnapshot(await oceanGateway.resolveBottle(active.id, resolution));
      setResult(resolution);
      setConfirming(null);
      onNotice(RESULT_COPY[resolution].title);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "병을 처리하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <section className="screen screen--centered result-screen">
        <div className={`result-token result-token--${result}`} aria-hidden="true">
          {result === "redrift" ? "둥둥" : result === "keep" ? "30일" : result === "report" ? "신고" : "안녕"}
        </div>
        <PageHeading>{RESULT_COPY[result].title}</PageHeading>
        <p className="screen-lead">{RESULT_COPY[result].body}</p>
        <div className="stack-actions">
          <button className="button button--primary" type="button" onClick={() => onNavigate("home")}>
            바다로 돌아가기
          </button>
          {result === "keep" ? (
            <button className="button button--ghost" type="button" onClick={() => onNavigate("kept")}>
              보관함 보기
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const active = snapshot.activeBottle;
  if (!active) {
    const canCatch = !snapshot.nextCatchAt || snapshot.nextCatchAt <= now;
    return (
      <section className="screen catch-empty">
        <div className="catch-visual">
          <img src={HERO_IMAGE} alt="" />
          <span className="catch-visual__label">{canCatch ? "병 하나가 보여요" : "잔잔한 물결뿐이에요"}</span>
        </div>
        <div className="catch-copy">
          <p className="eyebrow">완전히 블라인드로 만나요</p>
          <PageHeading>{canCatch ? "물결 사이에 병 하나가 보여요." : "다음 물결을 기다려요."}</PageHeading>
          <p className="screen-lead">
            {canCatch
              ? "어디에서 왔는지, 어떤 언어인지, 얼마나 긴 글인지도 열기 전에는 알 수 없어요."
              : `다음 병은 ${formatCountdown(snapshot.nextCatchAt, now)} 건질 수 있어요.`}
          </p>
          {error ? <div className="alert" role="alert">{error}</div> : null}
          <button className="button button--coral button--large" type="button" onClick={catchBottle} disabled={!canCatch || busy}>
            {busy ? "물결을 살피는 중…" : canCatch ? "병 건져보기" : formatCountdown(snapshot.nextCatchAt, now)}
          </button>
          <p className="fine-print">병을 건진 순간부터 다음 12시간이 시작돼요.</p>
        </div>
      </section>
    );
  }

  if (!active.opened || !active.content) {
    return (
      <section className="screen closed-bottle-screen">
        <div className="closed-bottle-art">
          <img src={HERO_IMAGE} alt="" />
        </div>
        <div className="closed-bottle-copy">
          <p className="eyebrow">방금 건진 이름 없는 병</p>
          <PageHeading>안을 열어볼까요?</PageHeading>
          <p className="screen-lead">출발한 곳도, 언어도, 날짜도 보이지 않아요. 열지 않고 다시 띄워도 괜찮습니다.</p>
          {error ? <div className="alert" role="alert">{error}</div> : null}
          <div className="stack-actions stack-actions--wide">
            <button className="button button--coral button--large" type="button" onClick={openBottle} disabled={busy}>
              조심히 열어보기
            </button>
            <button className="button button--ghost" type="button" onClick={() => setConfirming("redrift")} disabled={busy}>
              열지 않고 다시 띄우기
            </button>
          </div>
          {confirming === "redrift" ? (
            <div className="inline-confirm" role="alertdialog" aria-label="다시 띄우기 확인">
              <p>안을 보지 않고 다시 띄울까요? 이 병은 다른 누군가에게 흘러갑니다.</p>
              <div>
                <button className="button button--small button--ghost" type="button" onClick={() => setConfirming(null)}>
                  그대로 둘게요
                </button>
                <button className="button button--small button--primary" type="button" onClick={() => resolveBottle("redrift")}>
                  다시 띄우기
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  const content = active.content;
  return (
    <section className="screen opened-bottle-screen">
      <div className="screen-header screen-header--center">
        <p className="eyebrow">어딘가에서 떠밀려온 편지</p>
        <PageHeading>잠시 머물다 갈 문장이에요.</PageHeading>
      </div>
      {error ? <div className="alert" role="alert">{error}</div> : null}
      <article className="letter-paper letter-paper--received" dir="auto">
        {content.dateLabel ? <time>{content.dateLabel}</time> : null}
        <p>{content.body}</p>
        {content.signature ? <footer>{content.signature}</footer> : null}
      </article>

      <div className="bottle-decisions" aria-label="이 병을 어떻게 할까요?">
        <button className="decision-card decision-card--drift" type="button" onClick={() => resolveBottle("redrift")} disabled={busy}>
          <strong>다시 띄우기</strong>
          <span>다른 누군가에게 흘려보내요.</span>
        </button>
        <button className="decision-card decision-card--keep" type="button" onClick={() => resolveBottle("keep")} disabled={busy}>
          <strong>한 달간 보관하기</strong>
          <span>30일 뒤에는 조용히 사라져요.</span>
        </button>
        <button className="decision-card decision-card--discard" type="button" onClick={() => setConfirming("discard")} disabled={busy}>
          <strong>버리기</strong>
          <span>지금 이 바다에서 사라지게 해요.</span>
        </button>
      </div>

      {confirming === "discard" ? (
        <div className="inline-confirm inline-confirm--center" role="alertdialog" aria-label="병 버리기 확인">
          <p>버리면 이 글은 사라지고 되돌릴 수 없어요.</p>
          <div>
            <button className="button button--small button--ghost" type="button" onClick={() => setConfirming(null)}>
              조금 더 둘게요
            </button>
            <button className="button button--small button--danger" type="button" onClick={() => resolveBottle("discard")}>
              버리기
            </button>
          </div>
        </div>
      ) : null}

      <div className="report-area">
        {confirming === "report" ? (
          <div className="inline-confirm inline-confirm--center" role="alertdialog" aria-label="신고 확인">
            <p>불쾌하거나 위험한 내용인가요? 신고하면 즉시 숨겨집니다.</p>
            <div>
              <button className="button button--small button--ghost" type="button" onClick={() => setConfirming(null)}>
                취소
              </button>
              <button className="button button--small button--danger" type="button" onClick={() => resolveBottle("report")}>
                신고하고 숨기기
              </button>
            </div>
          </div>
        ) : (
          <button className="link-button" type="button" onClick={() => setConfirming("report")}>
            이 글 신고하기
          </button>
        )}
      </div>
    </section>
  );
}
