import { useState } from "react";
import { COUNTRY_OPTIONS, suggestedCountryCode } from "@/features/ocean/countries";
import { HERO_IMAGE } from "@/shared/brand";

interface OnboardingProps {
  initialCountryCode?: string;
  onComplete: (countryCode: string, defaultSignature: string) => Promise<void>;
}

export function Onboarding({ initialCountryCode, onComplete }: OnboardingProps) {
  const [countryCode, setCountryCode] = useState(() => initialCountryCode ?? suggestedCountryCode());
  const [accepted, setAccepted] = useState(false);
  const [defaultSignature, setDefaultSignature] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleComplete = async () => {
    if (!accepted || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onComplete(countryCode, defaultSignature.trim());
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

          <label className="onboarding-country" htmlFor="onboarding-country">
            <span>어느 나라에서 바다를 열까요?</span>
            <select
              id="onboarding-country"
              value={countryCode}
              onChange={(event) => setCountryCode(event.target.value)}
            >
              {COUNTRY_OPTIONS.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </select>
          </label>

          <label className="onboarding-signature" htmlFor="onboarding-signature">
            <span>편지에 쓸 기본 서명 <small>선택</small></span>
            <input
              id="onboarding-signature"
              type="text"
              value={defaultSignature}
              onChange={(event) => setDefaultSignature(event.target.value)}
              maxLength={20}
              placeholder="예: 어느 밤의 여행자"
            />
          </label>

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
