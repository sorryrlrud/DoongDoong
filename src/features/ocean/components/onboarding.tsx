import { useState } from "react";
import { HERO_IMAGE } from "@/shared/brand";
import { SEA_OPTIONS, type SeaId } from "@/features/ocean/types/ocean";

interface OnboardingProps {
  initialSea: SeaId;
  onComplete: (seaId: SeaId) => Promise<void>;
}

const STEPS = ["처음 만나는 둥둥", "아무것도 따라가지 않아요", "안전한 바다를 함께 만들어요"];

export function Onboarding({ initialSea, onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [seaId, setSeaId] = useState<SeaId>(initialSea);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleComplete = async () => {
    if (!accepted || submitting) return;
    setSubmitting(true);
    await onComplete(seaId);
    setSubmitting(false);
  };

  return (
    <main className="onboarding">
      <img className="onboarding__art" src={HERO_IMAGE} alt="" />
      <div className="onboarding__panel">
        <div className="onboarding__brand" aria-label="둥둥, DoongDoong">
          <strong>둥둥</strong>
          <span>DOONGDOONG</span>
        </div>
        <div className="step-dots" aria-label={`${step + 1} / 3 단계`}>
          {STEPS.map((label, index) => (
            <span key={label} className={index === step ? "step-dot step-dot--active" : "step-dot"} />
          ))}
        </div>

        {step === 0 ? (
          <section className="onboarding__copy" aria-labelledby="onboarding-title">
            <p className="eyebrow">세상 어딘가로, 둥둥.</p>
            <h1 id="onboarding-title">읽혔으면 좋겠지만, 남고 싶지는 않은 말.</h1>
            <p>
              꺼내어 쓴 말은 이름 없는 누군가에게 닿고, 답장 없이 다시 떠나거나 조용히 사라집니다.
            </p>
          </section>
        ) : null}

        {step === 1 ? (
          <section className="onboarding__copy" aria-labelledby="onboarding-rules">
            <p className="eyebrow">이름도, 발자국도 없이</p>
            <h1 id="onboarding-rules">누가 쓰고 읽었는지 아무도 알 수 없어요.</h1>
            <ul className="promise-list">
              <li>답장, 좋아요, 읽음 표시가 없어요.</li>
              <li>한 번 띄운 글은 다시 보거나 회수할 수 없어요.</li>
              <li>읽은 병은 다시 띄우거나, 버리거나, 한 달간 보관해요.</li>
            </ul>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="onboarding__copy" aria-labelledby="onboarding-sea">
            <p className="eyebrow">어느 바다에서 건질까요?</p>
            <h1 id="onboarding-sea">실제 위치와 상관없이 바다 하나를 골라요.</h1>
            <div className="sea-picker" role="radiogroup" aria-label="병을 건질 바다">
              {SEA_OPTIONS.map((sea) => (
                <button
                  key={sea.id}
                  className={seaId === sea.id ? "sea-chip sea-chip--selected" : "sea-chip"}
                  type="button"
                  role="radio"
                  aria-checked={seaId === sea.id}
                  onClick={() => setSeaId(sea.id)}
                >
                  {sea.name}
                </button>
              ))}
            </div>
            <label className="check-row">
              <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
              <span>
                이름, 연락처, 주소, 학교처럼 나를 알아볼 수 있는 정보는 쓰지 않을게요. 화면 캡처까지 막을 수
                없다는 점도 이해했어요.
              </span>
            </label>
          </section>
        ) : null}

        <div className="onboarding__actions">
          {step > 0 ? (
            <button className="button button--ghost" type="button" onClick={() => setStep((value) => value - 1)}>
              이전
            </button>
          ) : null}
          {step < 2 ? (
            <button className="button button--primary" type="button" onClick={() => setStep((value) => value + 1)}>
              다음
            </button>
          ) : (
            <button
              className="button button--primary"
              type="button"
              disabled={!accepted || submitting}
              onClick={handleComplete}
            >
              {submitting ? "바다를 고르는 중…" : "둥둥 시작하기"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
