import type { AppRoute } from "@/app/use-hash-route";
import type { OceanSnapshot } from "@/features/ocean/types/ocean";
import { formatCountdown } from "@/features/ocean/utils/time";
import { HERO_IMAGE, SEA_LABELS } from "@/shared/brand";
import { PageHeading } from "@/shared/page-heading";

interface HomeScreenProps {
  snapshot: OceanSnapshot;
  now: number;
  onNavigate: (route: AppRoute) => void;
}

export function HomeScreen({ snapshot, now, onNavigate }: HomeScreenProps) {
  const canCatch = !snapshot.nextCatchAt || snapshot.nextCatchAt <= now || snapshot.activeBottle;

  return (
    <section className="home-hero">
      <img className="home-hero__art" src={HERO_IMAGE} alt="" />
      <div className="home-hero__wash" />
      <div className="home-hero__content">
        <p className="eyebrow eyebrow--dark">익명으로 떠도는 한 편의 편지</p>
        <PageHeading>
          읽혔으면 좋겠지만,
          <br />
          <span>남고 싶지는 않은 말.</span>
        </PageHeading>
        <p className="home-hero__lead">
          누구에게 닿을지 모르는 글을 병에 담아 띄워보세요.
          <br />
          답장도, 읽음 표시도, 남는 기록도 없습니다.
        </p>
        <div className="hero-actions">
          <button
            className="button button--coral button--large"
            type="button"
            onClick={() => onNavigate("write")}
            disabled={snapshot.remainingSends === 0}
          >
            병 띄우기
            <span>{snapshot.remainingSends}/2 남음</span>
          </button>
          <button className="button button--cream button--large" type="button" onClick={() => onNavigate("catch")}>
            {snapshot.activeBottle ? "건진 병 보기" : "병 건져보기"}
            <span>{canCatch ? "지금 가능" : formatCountdown(snapshot.nextCatchAt, now)}</span>
          </button>
        </div>
        <p className="demo-note">지금은 이 기기에서 흐름을 체험하는 데모예요. 띄운 글은 저장하지 않아요.</p>
      </div>

      <div className="ocean-status" aria-label="현재 이용 상태">
        <div>
          <span className="status-label">건지는 바다</span>
          <strong>{SEA_LABELS[snapshot.seaId]}</strong>
        </div>
        <div>
          <span className="status-label">다음 병</span>
          <strong>{snapshot.activeBottle ? "손에 있어요" : formatCountdown(snapshot.nextCatchAt, now)}</strong>
        </div>
        <div>
          <span className="status-label">잠시 보관 중</span>
          <strong>{snapshot.keptBottles.length}병</strong>
        </div>
      </div>
    </section>
  );
}
