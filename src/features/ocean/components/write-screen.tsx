import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { AppRoute } from "@/app/use-hash-route";
import { oceanGateway, safetyProvider } from "@/features/ocean/services/runtime";
import { SEA_OPTIONS, type OceanSnapshot, type SeaId } from "@/features/ocean/types/ocean";
import { BEACH_IMAGE, BOTTLE_WITH_LETTER_IMAGE, EMPTY_BOTTLE_IMAGE } from "@/shared/brand";
import { PageHeading } from "@/shared/page-heading";
import { DRAFT_LENGTH_ERROR, hasValidDraft } from "@/features/ocean/utils/write-validation";
import { playSplash } from "@/features/ocean/services/ocean-audio";

interface WriteScreenProps {
  snapshot: OceanSnapshot;
  reduceMotion: boolean;
  defaultSignature: string;
  autoIncludeDate: boolean;
  onNavigate: (route: AppRoute) => void;
  onSnapshot: (snapshot: OceanSnapshot) => void;
  onBusyChange: (busy: boolean) => void;
}

type WriteStage = "editing" | "packing" | "launching";

const wait = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));

export function WriteScreen({
  snapshot,
  reduceMotion,
  defaultSignature,
  autoIncludeDate,
  onNavigate,
  onSnapshot,
  onBusyChange,
}: WriteScreenProps) {
  const [body, setBody] = useState("");
  const [signature, setSignature] = useState(defaultSignature);
  const [includeDate, setIncludeDate] = useState(autoIncludeDate);
  const [seaId, setSeaId] = useState<SeaId>(snapshot.seaId);
  const [stage, setStage] = useState<WriteStage>("editing");
  const [checking, setChecking] = useState(false);
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCrisisHelp, setShowCrisisHelp] = useState(false);
  const sendingRef = useRef(false);

  const canSend = hasValidDraft(body, signature);

  const clearLengthErrorWhenValid = (nextBody: string, nextSignature: string) => {
    if (hasValidDraft(nextBody, nextSignature)) {
      setError((currentError) => currentError === DRAFT_LENGTH_ERROR ? null : currentError);
    }
  };

  useEffect(() => {
    if (snapshot.remainingSends === 0 && stage === "editing") onNavigate("home");
  }, [snapshot.remainingSends, stage, onNavigate]);

  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  useEffect(() => {
    if (error !== DRAFT_LENGTH_ERROR) return;
    const timer = window.setTimeout(() => {
      setError((currentError) => currentError === DRAFT_LENGTH_ERROR ? null : currentError);
    }, 2_600);
    return () => window.clearTimeout(timer);
  }, [error]);

  const packAndLaunch = async () => {
    if (!canSend || checking || sendingRef.current) {
      setError(DRAFT_LENGTH_ERROR);
      return;
    }

    setError(null);
    setShowCrisisHelp(false);
    setChecking(true);
    onBusyChange(true);

    try {
      const safety = await safetyProvider.check(body, signature);
      if (!safety.safe) {
        setError(safety.message ?? "이 글은 띄울 수 없어요. 내용을 다시 살펴봐 주세요.");
        setShowCrisisHelp(Boolean(safety.showCrisisHelp));
        return;
      }
      if (window.location.hash.replace(/^#\/?/, "") !== "write") return;

      sendingRef.current = true;
      setStage("packing");
      const motionOff = reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const packingDelay = wait(motionOff ? 0 : 820);
      const nextSnapshot = await oceanGateway.sendBottle({
        body: body.trim(),
        signature: signature.trim() || undefined,
        includeDate,
        seaId,
      });

      playSplash();
      onSnapshot(nextSnapshot);
      await packingDelay;
      setStage("launching");
      await wait(motionOff ? 0 : 1_450);
      if (window.location.hash.replace(/^#\/?/, "") === "write") {
        onNavigate("home");
      }
    } catch (caught) {
      setStage("editing");
      setError(caught instanceof Error ? caught.message : "병을 띄우지 못했어요. 다시 시도해 주세요.");
    } finally {
      sendingRef.current = false;
      setChecking(false);
      onBusyChange(false);
    }
  };

  const requestSendConfirmation = () => {
    if (!canSend || checking || stage !== "editing") {
      setError(DRAFT_LENGTH_ERROR);
      return;
    }

    setError(null);
    setConfirmingSend(true);
  };

  if (snapshot.remainingSends === 0 && stage === "editing") {
    return (
      <section className="shore-scene">
        <img className="scene-background" src={BEACH_IMAGE} alt="" />
        <PageHeading className="sr-only">오늘 띄울 편지는 모두 사용했어요.</PageHeading>
      </section>
    );
  }

  if (stage === "launching") {
    return (
      <section className="launch-scene" aria-live="polite">
        <img className="scene-background" src={BEACH_IMAGE} alt="" />
        <img className="launch-bottle" src={BOTTLE_WITH_LETTER_IMAGE} alt="" />
        <PageHeading className="sr-only">병이 바다로 떠나고 있어요.</PageHeading>
      </section>
    );
  }

  const returnToShore = (event: MouseEvent<HTMLElement>) => {
    if (stage === "editing" && !checking && event.target === event.currentTarget) onNavigate("home");
  };

  return (
    <section
      className={stage === "packing" ? "write-stage write-stage--packing" : "write-stage"}
      onClick={returnToShore}
    >
      <img className="scene-background" src={BEACH_IMAGE} alt="" />
      <PageHeading className="sr-only">
        편지를 써서 병에 담기
      </PageHeading>

      {error ? (
        <div className="scene-alert" role="alert">
          <strong>{error}</strong>
          {showCrisisHelp ? (
            <span>당장 위험하다면 가까운 사람이나 지역 응급전화에 지금 도움을 요청해 주세요.</span>
          ) : null}
        </div>
      ) : null}

      <form
        id="bottle-letter-form"
        className="write-paper"
        aria-label="병에 담을 편지"
        onSubmit={(event) => {
          event.preventDefault();
          requestSendConfirmation();
        }}
      >
        <label className="sr-only" htmlFor="bottle-body">
          편지 내용
        </label>
        <textarea
          id="bottle-body"
          value={body}
          onChange={(event) => {
            const nextBody = event.target.value;
            setBody(nextBody);
            clearLengthErrorWhenValid(nextBody, signature);
          }}
          placeholder="이름 없는 누군가에게…"
          maxLength={1000}
          rows={10}
          disabled={checking || stage !== "editing"}
        />

        <div className="write-paper__meta">
          <label>
            <input
              type="checkbox"
              checked={includeDate}
              onChange={(event) => setIncludeDate(event.target.checked)}
              disabled={checking || stage !== "editing"}
            />
            <span>오늘 날짜</span>
          </label>
          <input
            type="text"
            value={signature}
            onChange={(event) => {
              const nextSignature = event.target.value;
              setSignature(nextSignature);
              clearLengthErrorWhenValid(body, nextSignature);
            }}
            maxLength={20}
            placeholder="서명 (선택)"
            aria-label="서명"
            disabled={checking || stage !== "editing"}
          />
          <select
            value={seaId}
            onChange={(event) => setSeaId(event.target.value as SeaId)}
            aria-label="띄울 바다"
            disabled={checking || stage !== "editing"}
          >
            {SEA_OPTIONS.map((sea) => (
              <option key={sea.id} value={sea.id}>
                {sea.name}
              </option>
            ))}
          </select>
        </div>

        <p className="write-guardrail">개인정보 금지 · 띄운 뒤 회수 불가</p>
      </form>

      <span className="packing-sheet" aria-hidden="true" />
      <button
        className="write-bottle"
        type="submit"
        form="bottle-letter-form"
        disabled={checking || stage !== "editing"}
        aria-label={checking ? "편지 안전 확인 중" : "편지를 병에 담아 바다에 띄우기"}
        aria-busy={checking || stage === "packing"}
      >
        <img className="write-bottle__empty" src={EMPTY_BOTTLE_IMAGE} alt="" />
        <img className="write-bottle__filled" src={BOTTLE_WITH_LETTER_IMAGE} alt="" />
      </button>

      <p className="sr-only" aria-live="polite">
        {stage === "packing" ? "편지를 병에 담고 있어요." : ""}
      </p>

      {confirmingSend ? (
        <div
          className="send-dialog-layer"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === "Escape") setConfirmingSend(false);
          }}
        >
          <section
            className="send-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="send-dialog-title"
            aria-describedby="send-dialog-description"
          >
            <div className="send-dialog__body">
              <h2 id="send-dialog-title">이 병을 띄울까요?</h2>
              <p id="send-dialog-description">띄워보낸 병은 수정할 수 없어요. 보낼까요?</p>
              <div className="send-dialog__actions">
                <button className="button button--ghost" type="button" onClick={() => setConfirmingSend(false)} autoFocus>
                  취소
                </button>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => {
                    setConfirmingSend(false);
                    void packAndLaunch();
                  }}
                >
                  보내기
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
