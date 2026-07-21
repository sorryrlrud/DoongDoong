import type { AppRoute } from "@/app/use-hash-route";
import type { OceanSnapshot } from "@/features/ocean/types/ocean";
import {
  ARRIVED_BOTTLE_IMAGE,
  BEACH_IMAGE,
  CRAB_IMAGE,
  EMPTY_BOTTLE_IMAGE,
  GUIDE_SIGN_IMAGE,
  KEEPSAKE_IMAGE,
  SEAGULL_IMAGE,
  WRITING_SET_IMAGE,
} from "@/shared/brand";
import { PageHeading } from "@/shared/page-heading";
import { useI18n } from "@/i18n/i18n";

interface HomeScreenProps {
  snapshot: OceanSnapshot;
  catching: boolean;
  onNavigate: (route: AppRoute) => void;
  onCatch: () => Promise<void>;
  onSeagull: () => void;
}

export function HomeScreen({ snapshot, catching, onNavigate, onCatch, onSeagull }: HomeScreenProps) {
  const { t } = useI18n();
  const hasAssignedBottle = Boolean(snapshot.activeBottle);
  return (
    <section className="shore-scene" aria-label={t("home.shore")}>
      <PageHeading className="sr-only">
        {t("home.shore")}
      </PageHeading>
      <img className="scene-background" src={BEACH_IMAGE} alt="" />

      {snapshot.remainingSends > 0 ? (
        <button
          className="scene-object scene-object--write"
          type="button"
          onClick={() => onNavigate("write")}
          disabled={catching}
          aria-label={t("home.write")}
        >
          <img src={WRITING_SET_IMAGE} alt="" />
          <img className="scene-object__empty-bottle" src={EMPTY_BOTTLE_IMAGE} alt="" />
        </button>
      ) : (
        <div className="writing-rest" role="status">
          <span>{t("home.writingRest")}</span>
          <img className="writing-rest__crab" src={CRAB_IMAGE} alt="" />
        </div>
      )}

      {hasAssignedBottle ? (
        <button
          className={catching ? "scene-object scene-object--bottle scene-object--lifting" : "scene-object scene-object--bottle"}
          type="button"
          onClick={() => void onCatch()}
          disabled={catching}
          aria-label={t("home.heldBottle")}
          aria-busy={catching}
        >
          <img src={ARRIVED_BOTTLE_IMAGE} alt="" />
        </button>
      ) : null}

      {!hasAssignedBottle ? (
        <button
          className="waiting-news"
          type="button"
          onClick={onSeagull}
          disabled={catching}
          aria-label={t("home.seagull")}
        >
          <img className="waiting-news__gull" src={SEAGULL_IMAGE} alt="" />
          <span>{t("home.waiting")}</span>
        </button>
      ) : null}

      {snapshot.keptBottles.length > 0 ? (
        <button
          className="scene-object scene-object--kept"
          type="button"
          onClick={() => onNavigate("kept")}
          disabled={catching}
          aria-label={t("home.keptCount", { count: snapshot.keptBottles.length })}
        >
          <img src={KEEPSAKE_IMAGE} alt="" />
        </button>
      ) : null}

      <button
        className="scene-object scene-object--guide"
        type="button"
        onClick={() => onNavigate("guide")}
        disabled={catching}
        aria-label={t("home.guide")}
      >
        <img src={GUIDE_SIGN_IMAGE} alt="" />
      </button>

      <p className="sr-only" aria-live="polite">
        {hasAssignedBottle ? t("home.available") : t("home.unavailable")}
      </p>
    </section>
  );
}
