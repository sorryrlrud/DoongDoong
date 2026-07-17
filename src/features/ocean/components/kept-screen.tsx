import { useState } from "react";
import type { AppRoute } from "@/app/use-hash-route";
import { oceanGateway } from "@/features/ocean/services/runtime";
import { countryName } from "@/features/ocean/countries";
import type { BottleResolution, OceanSnapshot } from "@/features/ocean/types/ocean";
import { formatExpiry } from "@/features/ocean/utils/time";
import { PageHeading } from "@/shared/page-heading";
import { useI18n } from "@/i18n/i18n";
import { languageDisplayName } from "@/i18n/languages";

interface KeptScreenProps {
  snapshot: OceanSnapshot;
  now: number;
  onNavigate: (route: AppRoute) => void;
  onSnapshot: (snapshot: OceanSnapshot) => void;
}

export function KeptScreen({ snapshot, now, onNavigate, onSnapshot }: KeptScreenProps) {
  const { t, languageCode } = useI18n();
  const [pendingDiscardId, setPendingDiscardId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolve = async (id: string, resolution: Extract<BottleResolution, "redrift" | "discard">) => {
    setBusyId(id);
    setError(null);
    try {
      onSnapshot(await oceanGateway.resolveBottle(id, resolution));
      setPendingDiscardId(null);
    } catch {
      setError(t("catch.resolveError"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="screen kept-screen">
      <div className="screen-header">
        <PageHeading>{t("kept.title")}</PageHeading>
        <p>{t("kept.description")}</p>
      </div>

      {error ? <div className="alert" role="alert">{error}</div> : null}

      {snapshot.keptBottles.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state__stamp" aria-hidden="true">{t("kept.emptyStamp")}</span>
          <h2>{t("kept.empty")}</h2>
          <button className="button button--primary" type="button" onClick={() => onNavigate("home")}>
            {t("kept.home")}
          </button>
        </div>
      ) : (
        <div className="kept-list">
          {snapshot.keptBottles.map((bottle) => (
            <article className="kept-letter" key={bottle.id} dir="auto">
              <div className="kept-letter__top">
                <span className="expiry-tag">{formatExpiry(bottle.expiresAt, now, t)}</span>
                <div>
                  {bottle.senderCountryCode ? (
                    <span className="kept-letter__origin">
                      {t("catch.origin", { country: countryName(bottle.senderCountryCode, languageCode) })}
                    </span>
                  ) : null}
                  {bottle.isTranslated && bottle.sourceLanguage ? (
                    <span className="kept-letter__translation">
                      {t("catch.translated", { language: languageDisplayName(bottle.sourceLanguage, languageCode) })}
                    </span>
                  ) : null}
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
                  {t("catch.redrift")}
                </button>
                <button className="link-button" type="button" onClick={() => setPendingDiscardId(bottle.id)}>
                  {t("kept.discard")}
                </button>
              </div>
              {pendingDiscardId === bottle.id ? (
                <div className="inline-confirm" role="group" aria-label={t("kept.confirm")} aria-live="polite">
                  <p>{t("kept.discardWarning")}</p>
                  <div>
                    <button className="button button--small button--ghost" type="button" onClick={() => setPendingDiscardId(null)}>
                      {t("common.cancel")}
                    </button>
                    <button
                      className="button button--small button--danger"
                      type="button"
                      onClick={() => resolve(bottle.id, "discard")}
                      disabled={busyId === bottle.id}
                    >
                      {t("kept.discard")}
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
