import type { AppRoute } from "@/app/use-hash-route";
import type { OceanSnapshot } from "@/features/ocean/types/ocean";
import {
  BEACH_IMAGE,
  BOTTLE_WITH_LETTER_IMAGE,
  EMPTY_BOTTLE_IMAGE,
  GUIDE_SIGN_IMAGE,
  KEEPSAKE_IMAGE,
  SEAGULL_IMAGE,
  WRITING_SET_IMAGE,
} from "@/shared/brand";
import { PageHeading } from "@/shared/page-heading";

interface HomeScreenProps {
  snapshot: OceanSnapshot;
  catching: boolean;
  onNavigate: (route: AppRoute) => void;
  onCatch: () => Promise<void>;
}

export function HomeScreen({ snapshot, catching, onNavigate, onCatch }: HomeScreenProps) {
  return (
    <section className="shore-scene" aria-label="둥둥 해변">
      <PageHeading className="sr-only">
        둥둥 해변
      </PageHeading>
      <img className="scene-background" src={BEACH_IMAGE} alt="" />

      {snapshot.remainingSends > 0 ? (
        <button
          className="scene-object scene-object--write"
          type="button"
          onClick={() => onNavigate("write")}
          disabled={catching}
          aria-label="편지 쓰기"
        >
          <img src={WRITING_SET_IMAGE} alt="" />
          <img className="scene-object__empty-bottle" src={EMPTY_BOTTLE_IMAGE} alt="" />
        </button>
      ) : null}

      {snapshot.bottleAvailable ? (
        <button
          className={catching ? "scene-object scene-object--bottle scene-object--lifting" : "scene-object scene-object--bottle"}
          type="button"
          onClick={() => void onCatch()}
          disabled={catching}
          aria-label={snapshot.activeBottle ? "건져 둔 병 보기" : "물가의 병 줍기"}
          aria-busy={catching}
        >
          <img src={BOTTLE_WITH_LETTER_IMAGE} alt="" />
        </button>
      ) : null}

      {snapshot.waitingForNews && !snapshot.activeBottle ? (
        <div className="waiting-news" role="status" aria-live="polite">
          <img className="waiting-news__gull" src={SEAGULL_IMAGE} alt="" />
          <span>새 소식을 기다리는 중 …</span>
        </div>
      ) : null}

      {snapshot.keptBottles.length > 0 ? (
        <button
          className="scene-object scene-object--kept"
          type="button"
          onClick={() => onNavigate("kept")}
          disabled={catching}
          aria-label={`보관한 편지 ${snapshot.keptBottles.length}개 보기`}
        >
          <img src={KEEPSAKE_IMAGE} alt="" />
        </button>
      ) : null}

      <button
        className="scene-object scene-object--guide"
        type="button"
        onClick={() => onNavigate("guide")}
        disabled={catching}
        aria-label="둥둥 이용안내와 안전 안내 보기"
      >
        <img src={GUIDE_SIGN_IMAGE} alt="" />
      </button>

      <p className="sr-only" aria-live="polite">
        {snapshot.bottleAvailable ? "물가에 주울 병이 있습니다." : "지금 물가에는 병이 없습니다."}
      </p>
    </section>
  );
}
