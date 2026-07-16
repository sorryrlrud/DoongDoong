import { useState } from "react";
import type { AppRoute } from "@/app/use-hash-route";
import { oceanGateway } from "@/features/ocean/services/runtime";
import { countryName } from "@/features/ocean/countries";
import type { BottleResolution, OceanSnapshot } from "@/features/ocean/types/ocean";
import { formatExpiry } from "@/features/ocean/utils/time";
import { PageHeading } from "@/shared/page-heading";

interface KeptScreenProps {
  snapshot: OceanSnapshot;
  now: number;
  onNavigate: (route: AppRoute) => void;
  onSnapshot: (snapshot: OceanSnapshot) => void;
}

export function KeptScreen({ snapshot, now, onNavigate, onSnapshot }: KeptScreenProps) {
  const [pendingDiscardId, setPendingDiscardId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolve = async (id: string, resolution: Extract<BottleResolution, "redrift" | "discard">) => {
    setBusyId(id);
    setError(null);
    try {
      onSnapshot(await oceanGateway.resolveBottle(id, resolution));
      setPendingDiscardId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "병을 처리하지 못했어요.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="screen kept-screen">
      <div className="screen-header">
        <PageHeading>보관함</PageHeading>
        <p>보관한 병은 30일 뒤 사라져요.</p>
      </div>

      {error ? <div className="alert" role="alert">{error}</div> : null}

      {snapshot.keptBottles.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state__stamp" aria-hidden="true">비었어요</span>
          <h2>잠시 곁에 둔 병이 없어요.</h2>
          <button className="button button--primary" type="button" onClick={() => onNavigate("home")}>
            해변으로 돌아가기
          </button>
        </div>
      ) : (
        <div className="kept-list">
          {snapshot.keptBottles.map((bottle) => (
            <article className="kept-letter" key={bottle.id} dir="auto">
              <div className="kept-letter__top">
                <span className="expiry-tag">{formatExpiry(bottle.expiresAt, now)}</span>
                <div>
                  {bottle.senderCountryCode ? <span className="kept-letter__origin">발신 국가 · {countryName(bottle.senderCountryCode)}</span> : null}
                  {bottle.dateLabel ? <time>{bottle.dateLabel}</time> : null}
                </div>
              </div>
              <p>{bottle.body}</p>
              {bottle.signature ? <footer>{bottle.signature}</footer> : null}
              <div className="kept-letter__actions">
                <button
                  className="link-button link-button--strong"
                  type="button"
                  onClick={() => void resolve(bottle.id, "redrift")}
                  disabled={busyId === bottle.id}
                >
                  다시 띄우기
                </button>
                <button className="link-button" type="button" onClick={() => setPendingDiscardId(bottle.id)}>
                  버리기
                </button>
              </div>
              {pendingDiscardId === bottle.id ? (
                <div className="inline-confirm" role="group" aria-label="보관한 병 처리 확인" aria-live="polite">
                  <p>버리면 이 글은 지금 바로 사라져요.</p>
                  <div>
                    <button className="button button--small button--ghost" type="button" onClick={() => setPendingDiscardId(null)}>
                      취소
                    </button>
                    <button
                      className="button button--small button--danger"
                      type="button"
                      onClick={() => resolve(bottle.id, "discard")}
                      disabled={busyId === bottle.id}
                    >
                      버리기
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
