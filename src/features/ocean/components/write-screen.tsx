import { useMemo, useState } from "react";
import type { AppRoute } from "@/app/use-hash-route";
import { oceanGateway, safetyProvider } from "@/features/ocean/services/runtime";
import { SEA_OPTIONS, type OceanSnapshot, type SeaId } from "@/features/ocean/types/ocean";
import { PageHeading } from "@/shared/page-heading";

interface WriteScreenProps {
  snapshot: OceanSnapshot;
  onNavigate: (route: AppRoute) => void;
  onSnapshot: (snapshot: OceanSnapshot) => void;
  onNotice: (message: string) => void;
}

type WriteStage = "edit" | "review" | "sent";

export function WriteScreen({ snapshot, onNavigate, onSnapshot, onNotice }: WriteScreenProps) {
  const [stage, setStage] = useState<WriteStage>("edit");
  const [body, setBody] = useState("");
  const [signature, setSignature] = useState("");
  const [includeDate, setIncludeDate] = useState(false);
  const [seaId, setSeaId] = useState<SeaId>(snapshot.seaId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCrisisHelp, setShowCrisisHelp] = useState(false);

  const bodyLength = useMemo(() => Array.from(body).length, [body]);
  const canReview = body.trim().length >= 10 && bodyLength <= 1000 && signature.length <= 20;

  const goToReview = () => {
    if (!canReview) {
      setError("편지는 10자 이상 1,000자 이하로 적어 주세요.");
      return;
    }
    setError(null);
    setStage("review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const sendBottle = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setShowCrisisHelp(false);

    const safety = await safetyProvider.check(body, signature);
    if (!safety.safe) {
      setError(safety.message ?? "지금은 이 글을 띄울 수 없어요. 내용을 다시 살펴봐 주세요.");
      setShowCrisisHelp(Boolean(safety.showCrisisHelp));
      setStage("edit");
      setSubmitting(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    try {
      const nextSnapshot = await oceanGateway.sendBottle({
        body: body.trim(),
        signature: signature.trim() || undefined,
        includeDate,
        seaId,
      });
      onSnapshot(nextSnapshot);
      setBody("");
      setSignature("");
      setStage("sent");
      onNotice("병을 바다에 띄웠어요.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "병을 띄우지 못했어요. 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  if (stage === "sent") {
    return (
      <section className="screen screen--centered sent-screen">
        <div className="success-mark" aria-hidden="true">
          둥둥
        </div>
        <PageHeading>병을 띄웠어요.</PageHeading>
        <p className="screen-lead">
          이제 어디로 흘러갈지는 바다만 알고 있어요.
          <br />이 글은 보낸 기록에 남지 않습니다.
        </p>
        <div className="stack-actions">
          <button className="button button--primary" type="button" onClick={() => onNavigate("home")}>
            바다로 돌아가기
          </button>
          {snapshot.remainingSends > 1 ? (
            <button className="button button--ghost" type="button" onClick={() => setStage("edit")}>
              병 하나 더 띄우기
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  if (snapshot.remainingSends === 0) {
    return (
      <section className="screen screen--centered">
        <p className="eyebrow">오늘의 두 병</p>
        <PageHeading>오늘은 충분히 띄웠어요.</PageHeading>
        <p className="screen-lead">자정이 지나면 다시 두 병을 띄울 수 있어요. 지금은 바다에서 온 병을 만나보세요.</p>
        <button className="button button--primary" type="button" onClick={() => onNavigate("catch")}>
          병 건져보기
        </button>
      </section>
    );
  }

  return (
    <section className="screen write-screen">
      <div className="screen-header">
        <p className="eyebrow">오늘 {snapshot.remainingSends}병 남았어요</p>
        <PageHeading>{stage === "review" ? "이대로 띄울까요?" : "병에 담을 말을 적어보세요."}</PageHeading>
        <p>
          {stage === "review"
            ? "띄운 뒤에는 다시 보거나 회수할 수 없어요."
            : "누군가에게 닿았으면 하지만, 오래 남지 않았으면 하는 말이면 충분해요."}
        </p>
      </div>

      {error ? (
        <div className="alert" role="alert">
          <strong>잠깐만요</strong>
          <p>{error}</p>
          {showCrisisHelp ? (
            <p className="alert__help">
              당장 위험하다면 혼자 있지 말고 가까운 보호자, 지역 응급전화 또는 전문 상담기관에 지금 도움을 요청해
              주세요.
            </p>
          ) : null}
        </div>
      ) : null}

      {stage === "edit" ? (
        <div className="paper-form">
          <label className="field-label" htmlFor="bottle-body">
            편지
          </label>
          <textarea
            id="bottle-body"
            className="letter-textarea"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="이름 없는 누군가에게, 오늘의 마음을 적어보세요."
            maxLength={1000}
            rows={12}
            autoFocus
          />
          <div className="field-meta">
            <span>최소 10자</span>
            <span className={bodyLength > 950 ? "counter counter--near" : "counter"}>{bodyLength} / 1,000</span>
          </div>

          <div className="optional-grid">
            <label className="check-card">
              <input type="checkbox" checked={includeDate} onChange={(event) => setIncludeDate(event.target.checked)} />
              <span>
                <strong>오늘 날짜 남기기</strong>
                <small>편지 안에만 날짜가 적혀요.</small>
              </span>
            </label>
            <label className="signature-field">
              <span>나만의 서명 <small>선택</small></span>
              <input
                type="text"
                value={signature}
                onChange={(event) => setSignature(event.target.value)}
                maxLength={20}
                placeholder="예: 창가의 사람"
              />
              <small>실명·연락처 대신 나만 알아볼 짧은 표시를 권해요.</small>
            </label>
          </div>

          <fieldset className="sea-fieldset">
            <legend>어느 바다에 띄울까요?</legend>
            <div className="sea-picker sea-picker--wide">
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
          </fieldset>

          <div className="form-actions">
            <button className="button button--ghost" type="button" onClick={() => onNavigate("home")}>
              그만두기
            </button>
            <button className="button button--primary" type="button" onClick={goToReview} disabled={!canReview}>
              마지막으로 확인하기
            </button>
          </div>
        </div>
      ) : (
        <div className="review-wrap">
          <article className="letter-paper" dir="auto" aria-label="띄울 편지 미리보기">
            {includeDate ? <time>{new Intl.DateTimeFormat("ko", { dateStyle: "long" }).format(new Date())}</time> : null}
            <p>{body}</p>
            {signature ? <footer>— {signature}</footer> : null}
          </article>
          <div className="review-warning">
            <strong>한 번 더 기억해 주세요.</strong>
            <p>내용·도착·읽음·재표류 여부를 확인할 수 없고, 다시 회수할 수도 없어요.</p>
          </div>
          <div className="form-actions">
            <button className="button button--ghost" type="button" onClick={() => setStage("edit")}>
              조금 더 다듬기
            </button>
            <button className="button button--coral" type="button" onClick={sendBottle} disabled={submitting}>
              {submitting ? "안전하게 살펴보는 중…" : "바다에 띄우기"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
