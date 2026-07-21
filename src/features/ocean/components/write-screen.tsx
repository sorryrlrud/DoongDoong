import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { AppRoute } from "@/app/use-hash-route";
import { oceanGateway, safetyProvider } from "@/features/ocean/services/runtime";
import { OceanError, SEA_OPTIONS, type OceanSnapshot, type SeaId } from "@/features/ocean/types/ocean";
import { BEACH_IMAGE, BOTTLE_WITH_LETTER_IMAGE, EMPTY_BOTTLE_IMAGE } from "@/shared/brand";
import { PageHeading } from "@/shared/page-heading";
import { hasValidDraft } from "@/features/ocean/utils/write-validation";
import { playSplash } from "@/features/ocean/services/ocean-audio";
import { useI18n } from "@/i18n/i18n";
import type { MessageKey } from "@/i18n/messages/en";

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
const SEA_MESSAGE_KEYS: Record<SeaId, MessageKey> = {
  pacific: "sea.pacific",
  atlantic: "sea.atlantic",
  indian: "sea.indian",
  arctic: "sea.arctic",
  southern: "sea.southern",
};

export function WriteScreen({
  snapshot,
  reduceMotion,
  defaultSignature,
  autoIncludeDate,
  onNavigate,
  onSnapshot,
  onBusyChange,
}: WriteScreenProps) {
  const { t } = useI18n();
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
  const lengthError = t("write.lengthError");

  const clearLengthErrorWhenValid = (nextBody: string, nextSignature: string) => {
    if (hasValidDraft(nextBody, nextSignature)) {
      setError((currentError) => currentError === lengthError ? null : currentError);
    }
  };

  useEffect(() => {
    if (snapshot.remainingSends === 0 && stage === "editing") onNavigate("home");
  }, [snapshot.remainingSends, stage, onNavigate]);

  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  useEffect(() => {
    if (error !== lengthError) return;
    const timer = window.setTimeout(() => {
      setError((currentError) => currentError === lengthError ? null : currentError);
    }, 2_600);
    return () => window.clearTimeout(timer);
  }, [error, lengthError]);

  const packAndLaunch = async () => {
    if (!canSend || checking || sendingRef.current) {
      setError(lengthError);
      return;
    }

    setError(null);
    setShowCrisisHelp(false);
    setChecking(true);
    onBusyChange(true);

    try {
      const safety = await safetyProvider.check(body, signature);
      if (!safety.safe) {
        const safetyKey: Record<typeof safety.category, MessageKey> = {
          "personal-info": "write.blockedPersonal",
          sensitive: safety.showCrisisHelp ? "write.blockedCrisis" : "write.blockedSensitive",
          spam: "write.blockedSpam",
          ok: "write.blockedGeneric",
        };
        setError(t(safetyKey[safety.category]));
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
      setError(caught instanceof OceanError && caught.code === "DAILY_LIMIT"
        ? t("write.dailyUsed")
        : caught instanceof OceanError && caught.code === "CONTENT_REJECTED"
          ? t("write.blockedGeneric")
          : caught instanceof OceanError && caught.code === "INVALID_DRAFT"
          ? lengthError
          : t("write.sendError"));
    } finally {
      sendingRef.current = false;
      setChecking(false);
      onBusyChange(false);
    }
  };

  const requestSendConfirmation = () => {
    if (!canSend || checking || stage !== "editing") {
      setError(lengthError);
      return;
    }

    setError(null);
    setConfirmingSend(true);
  };

  if (snapshot.remainingSends === 0 && stage === "editing") {
    return (
      <section className="shore-scene">
        <img className="scene-background" src={BEACH_IMAGE} alt="" />
        <PageHeading className="sr-only">{t("write.dailyUsed")}</PageHeading>
      </section>
    );
  }

  if (stage === "launching") {
    return (
      <section className="launch-scene" aria-live="polite">
        <img className="scene-background" src={BEACH_IMAGE} alt="" />
        <img className="launch-bottle" src={BOTTLE_WITH_LETTER_IMAGE} alt="" />
        <PageHeading className="sr-only">{t("write.launching")}</PageHeading>
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
        {t("write.heading")}
      </PageHeading>

      {error ? (
        <div className="scene-alert" role="alert">
          <strong>{error}</strong>
          {showCrisisHelp ? (
            <span>{t("write.crisisHelp")}</span>
          ) : null}
        </div>
      ) : null}

      <form
        id="bottle-letter-form"
        className="write-paper"
        aria-label={t("write.form")}
        onSubmit={(event) => {
          event.preventDefault();
          requestSendConfirmation();
        }}
      >
        <label className="sr-only" htmlFor="bottle-body">
          {t("write.body")}
        </label>
        <textarea
          id="bottle-body"
          value={body}
          onChange={(event) => {
            const nextBody = event.target.value;
            setBody(nextBody);
            clearLengthErrorWhenValid(nextBody, signature);
          }}
          placeholder={t("write.placeholder")}
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
            <span>{t("write.today")}</span>
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
            placeholder={t("write.signature")}
            aria-label={t("write.signature")}
            disabled={checking || stage !== "editing"}
          />
          <select
            value={seaId}
            onChange={(event) => setSeaId(event.target.value as SeaId)}
            aria-label={t("write.sea")}
            disabled={checking || stage !== "editing"}
          >
            {SEA_OPTIONS.map((sea) => (
              <option key={sea.id} value={sea.id}>
                {t(SEA_MESSAGE_KEYS[sea.id])}
              </option>
            ))}
          </select>
        </div>

        <p className="write-guardrail">{t("write.guardrail")}</p>
      </form>

      <span className="packing-sheet" aria-hidden="true" />
      <button
        className="write-bottle"
        type="submit"
        form="bottle-letter-form"
        disabled={checking || stage !== "editing"}
        aria-label={checking ? t("write.checking") : t("write.launch")}
        aria-busy={checking || stage === "packing"}
      >
        <img className="write-bottle__empty" src={EMPTY_BOTTLE_IMAGE} alt="" />
        <img className="write-bottle__filled" src={BOTTLE_WITH_LETTER_IMAGE} alt="" />
      </button>

      <p className="sr-only" aria-live="polite">
        {stage === "packing" ? t("write.packing") : ""}
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
              <h2 id="send-dialog-title">{t("write.confirmTitle")}</h2>
              <p id="send-dialog-description">{t("write.confirmDescription")}</p>
              <div className="send-dialog__actions">
                <button className="button button--ghost" type="button" onClick={() => setConfirmingSend(false)} autoFocus>
                  {t("common.cancel")}
                </button>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => {
                    setConfirmingSend(false);
                    void packAndLaunch();
                  }}
                >
                  {t("write.send")}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
