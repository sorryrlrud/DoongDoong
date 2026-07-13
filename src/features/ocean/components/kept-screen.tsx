import { useState } from "react";
import type { AppRoute } from "@/app/use-hash-route";
import { oceanGateway } from "@/features/ocean/services/runtime";
import type { BottleResolution, OceanSnapshot } from "@/features/ocean/types/ocean";
import { formatExpiry } from "@/features/ocean/utils/time";
import { PageHeading } from "@/shared/page-heading";

interface KeptScreenProps {
  snapshot: OceanSnapshot;
  now: number;
  onNavigate: (route: AppRoute) => void;
  onSnapshot: (snapshot: OceanSnapshot) => void;
  onNotice: (message: string) => void;
}

interface PendingAction {
  id: string;
  resolution: Extract<BottleResolution, "redrift" | "discard">;
}

export function KeptScreen({ snapshot, now, onNavigate, onSnapshot, onNotice }: KeptScreenProps) {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolve = async (id: string, resolution: PendingAction["resolution"]) => {
    setBusyId(id);
    setError(null);
    try {
      onSnapshot(await oceanGateway.resolveBottle(id, resolution));
      onNotice(resolution === "redrift" ? "병을 다시 띄웠어요." : "병을 버렸어요.");
      setPending(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "병을 처리하지 못했어요.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="screen kept-screen">
      <div className="screen-header">
        <p className="eyebrow">잠깐만 곁에 두는 곳</p>
        <PageHeading>보관함</PageHeading>
        <p>보관한 병도 30일이 지나면 되돌릴 수 없이 사라져요.</p>
      </div>

      {error ? <div className="alert" role="alert">{error}</div> : null}

      {snapshot.keptBottles.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state__stamp" aria-hidden="true">비었어요</span>
          <h2>잠시 곁에 둔 병이 없어요.</h2>
          <p>마음에 머문 글을 한 달 동안만 이곳에 둘 수 있어요.</p>
          <button className="button button--primary" type="button" onClick={() => onNavigate("catch")}>
            병 건져보기
          </button>
        </div>
      ) : (
        <div className="kept-list">
          {snapshot.keptBottles.map((bottle) => (
            <article className="kept-letter" key={bottle.id} dir="auto">
              <div className="kept-letter__top">
                <span className="expiry-tag">{formatExpiry(bottle.expiresAt, now)}</span>
                {bottle.dateLabel ? <time>{bottle.dateLabel}</time> : null}
              </div>
              <p>{bottle.body}</p>
              {bottle.signature ? <footer>{bottle.signature}</footer> : null}
              <div className="kept-letter__actions">
                <button className="link-button link-button--strong" type="button" onClick={() => setPending({ id: bottle.id, resolution: "redrift" })}>
                  다시 띄우기
                </button>
                <button className="link-button" type="button" onClick={() => setPending({ id: bottle.id, resolution: "discard" })}>
                  버리기
                </button>
              </div>
              {pending?.id === bottle.id ? (
                <div className="inline-confirm" role="alertdialog" aria-label="보관한 병 처리 확인">
                  <p>
                    {pending.resolution === "redrift"
                      ? "보관함에서 꺼내 다시 바다에 띄울까요?"
                      : "버리면 이 글은 지금 바로 사라져요."}
                  </p>
                  <div>
                    <button className="button button--small button--ghost" type="button" onClick={() => setPending(null)}>
                      취소
                    </button>
                    <button
                      className={pending.resolution === "discard" ? "button button--small button--danger" : "button button--small button--primary"}
                      type="button"
                      onClick={() => resolve(bottle.id, pending.resolution)}
                      disabled={busyId === bottle.id}
                    >
                      {pending.resolution === "redrift" ? "다시 띄우기" : "버리기"}
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
