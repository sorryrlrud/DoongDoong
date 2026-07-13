import { useState } from "react";
import { HERO_IMAGE } from "@/shared/brand";
import { SeaPicker } from "@/features/ocean/components/sea-picker";
import type { SeaId } from "@/features/ocean/types/ocean";

interface OnboardingProps {
  initialSea: SeaId;
  onComplete: (seaId: SeaId) => Promise<void>;
}

export function Onboarding({ initialSea, onComplete }: OnboardingProps) {
  const [seaId, setSeaId] = useState<SeaId>(initialSea);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleComplete = async () => {
    if (!accepted || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onComplete(seaId);
    } catch {
      setError("시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="onboarding">
      <img className="onboarding__art" src={HERO_IMAGE} alt="" />
      <div className="onboarding__panel">
        <div className="onboarding__brand" aria-label="둥둥, DoongDoong">
          <strong>둥둥</strong>
          <span>DOONGDOONG</span>
        </div>
        <section className="onboarding__copy" aria-labelledby="onboarding-title">
          <p className="eyebrow">세상 어딘가로, 둥둥.</p>
          <h1 id="onboarding-title">이름 없이 띄우고, 조용히 사라져요.</h1>
          <ul className="onboarding-points" aria-label="둥둥 이용 원칙">
            <li>답장·좋아요·읽음 표시 없음</li>
            <li>띄운 뒤 확인·회수 불가</li>
            <li>받은 병은 30일까지만 보관</li>
          </ul>

          <fieldset className="onboarding-sea">
            <legend>병을 건질 바다</legend>
            <SeaPicker value={seaId} name="onboarding-sea" label="병을 건질 바다" onChange={setSeaId} />
          </fieldset>

          <label className="check-row">
            <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
            <span>개인정보를 쓰지 않고, 수신자가 화면을 저장할 수 있음을 이해했어요.</span>
          </label>
        </section>

        {error ? <div className="alert onboarding__error" role="alert">{error}</div> : null}

        <div className="onboarding__actions">
          <button
            className="button button--primary"
            type="button"
            disabled={!accepted || submitting}
            onClick={handleComplete}
          >
            {submitting ? "시작하는 중…" : "시작하기"}
          </button>
        </div>
      </div>
    </main>
  );
}
