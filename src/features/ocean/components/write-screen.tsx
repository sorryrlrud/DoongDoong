import { useMemo, useRef, useState } from "react";
import type { AppRoute } from "@/app/use-hash-route";
import { SeaPicker } from "@/features/ocean/components/sea-picker";
import { oceanGateway, safetyProvider } from "@/features/ocean/services/runtime";
import type { OceanSnapshot, SeaId } from "@/features/ocean/types/ocean";
import { PageHeading } from "@/shared/page-heading";

interface WriteScreenProps {
  snapshot: OceanSnapshot;
  onNavigate: (route: AppRoute) => void;
  onSnapshot: (snapshot: OceanSnapshot) => void;
  onNotice: (message: string) => void;
}

export function WriteScreen({ snapshot, onNavigate, onSnapshot, onNotice }: WriteScreenProps) {
  const [body, setBody] = useState("");
  const [signature, setSignature] = useState("");
  const [includeDate, setIncludeDate] = useState(false);
  const [seaId, setSeaId] = useState<SeaId>(snapshot.seaId);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCrisisHelp, setShowCrisisHelp] = useState(false);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);

  const bodyLength = useMemo(() => Array.from(body).length, [body]);
  const trimmedBodyLength = useMemo(() => Array.from(body.trim()).length, [body]);
  const canSend = trimmedBodyLength >= 10 && bodyLength <= 1000 && signature.length <= 20;

  const requestSend = async () => {
    if (!canSend || checking) {
      setError("편지는 10자 이상 1,000자 이하로 적어 주세요.");
      return;
    }

    setError(null);
    setShowCrisisHelp(false);
    setChecking(true);

    try {
      const safety = await safetyProvider.check(body, signature);
      if (!safety.safe) {
        setError(safety.message ?? "이 글은 띄울 수 없어요. 내용을 다시 살펴봐 주세요.");
        setShowCrisisHelp(Boolean(safety.showCrisisHelp));
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      confirmDialogRef.current?.showModal();
    } catch {
      setError("지금은 안전 확인을 할 수 없어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setChecking(false);
    }
  };

  const sendBottle = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const nextSnapshot = await oceanGateway.sendBottle({
        body: body.trim(),
        signature: signature.trim() || undefined,
        includeDate,
        seaId,
      });
      onSnapshot(nextSnapshot);
      confirmDialogRef.current?.close();
      onNotice("병을 바다에 띄웠어요.");
      onNavigate("home");
    } catch (caught) {
      confirmDialogRef.current?.close();
      setError(caught instanceof Error ? caught.message : "병을 띄우지 못했어요. 다시 시도해 주세요.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSubmitting(false);
    }
  };

  if (snapshot.remainingSends === 0) {
    return (
      <section className="screen screen--centered">
        <p className="eyebrow">오늘의 두 병</p>
        <PageHeading>오늘은 두 병을 모두 띄웠어요.</PageHeading>
        <p className="screen-lead">자정에 다시 열려요.</p>
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
        <PageHeading>병에 담을 말을 적어보세요.</PageHeading>
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

      <form
        className="paper-form"
        onSubmit={(event) => {
          event.preventDefault();
          void requestSend();
        }}
      >
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
            </label>
          </div>

          <fieldset className="sea-fieldset">
            <legend>어느 바다에 띄울까요?</legend>
            <SeaPicker value={seaId} name="write-sea" label="띄울 바다" wide onChange={setSeaId} />
          </fieldset>

          <div className="write-safety" role="note">
            <strong>주의</strong>
            <span>이름·연락처·주소는 쓰지 마세요. 띄운 글은 다시 확인하거나 회수할 수 없어요.</span>
          </div>

          <div className="form-actions">
            <button className="button button--ghost" type="button" onClick={() => onNavigate("home")}>
              취소
            </button>
            <button className="button button--coral" type="submit" disabled={!canSend || checking || submitting}>
              {checking ? "안전 확인 중…" : "바다에 띄우기"}
            </button>
          </div>
      </form>

      <dialog
        className="send-dialog"
        ref={confirmDialogRef}
        aria-labelledby="send-dialog-title"
        aria-describedby="send-dialog-description"
      >
        <div className="send-dialog__body">
          <p className="eyebrow">마지막 확인</p>
          <h2 id="send-dialog-title">이 병을 띄울까요?</h2>
          <p id="send-dialog-description">띄우면 다시 보거나 회수할 수 없어요.</p>
          <div className="send-dialog__actions">
            <button
              className="button button--ghost"
              type="button"
              onClick={() => confirmDialogRef.current?.close()}
              disabled={submitting}
              autoFocus
            >
              취소
            </button>
            <button className="button button--coral" type="button" onClick={sendBottle} disabled={submitting}>
              {submitting ? "띄우는 중…" : "띄우기"}
            </button>
          </div>
        </div>
      </dialog>
    </section>
  );
}
