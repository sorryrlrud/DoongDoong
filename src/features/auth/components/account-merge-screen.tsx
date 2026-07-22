import { useEffect, useState } from "react";
import type { AccountMergePreview, SocialAuthProvider } from "@/features/auth/types/auth";
import { useI18n } from "@/i18n/i18n";
import { PageHeading } from "@/shared/page-heading";

interface AccountMergeScreenProps {
  onPreview: () => Promise<AccountMergePreview>;
  onComplete: () => Promise<void>;
  onCancel: () => Promise<void>;
  onResumeSignIn: (provider: SocialAuthProvider) => Promise<void>;
}

export function AccountMergeScreen({
  onPreview,
  onComplete,
  onCancel,
  onResumeSignIn,
}: AccountMergeScreenProps) {
  const { languageCode } = useI18n();
  const korean = languageCode === "ko";
  const [preview, setPreview] = useState<AccountMergePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void onPreview()
      .then((nextPreview) => {
        if (active) setPreview(nextPreview);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [onPreview]);

  const cancel = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onCancel();
    } catch {
      setError(true);
      setSubmitting(false);
    }
  };

  const complete = async () => {
    if (submitting || !preview || preview.blockedReason) return;
    setSubmitting(true);
    try {
      await onComplete();
      await onResumeSignIn(preview.provider);
    } catch {
      setError(true);
      setSubmitting(false);
    }
  };

  const blockedCopy = preview?.blockedReason === "ACTIVE_BOTTLE_CONFLICT"
    ? (korean
      ? "두 계정 모두 처리 중인 병이 있어요. 한쪽의 병을 먼저 처리한 뒤 다시 시도해 주세요."
      : "Both accounts have a bottle in progress. Handle one of them before trying again.")
    : preview?.blockedReason === "ADMIN_ACCOUNT"
      ? (korean ? "관리자 계정은 병합할 수 없어요." : "Administrator accounts cannot be merged.")
      : preview?.blockedReason === "ACCOUNT_INACTIVE"
        ? (korean ? "사용할 수 없는 계정이 있어 병합할 수 없어요." : "An inactive account cannot be merged.")
        : null;

  return (
    <main className="screen settings-screen account-merge-screen" aria-live="polite">
      <div className="screen-header">
        <PageHeading>{korean ? "계정 병합" : "Merge accounts"}</PageHeading>
      </div>
      {loading ? <p>{korean ? "병합할 정보를 확인하는 중…" : "Checking the accounts to merge…"}</p> : null}
      {error ? <div className="alert" role="alert">{korean ? "계정 병합을 진행하지 못했어요. 다시 로그인한 뒤 시도해 주세요." : "We couldn't continue the account merge. Sign in again and try once more."}</div> : null}
      {preview ? (
        <section className="setting-section" aria-labelledby="account-merge-summary">
          <h2 id="account-merge-summary">{korean ? "네이버 계정 연결" : "Connect your Naver account"}</h2>
          <p>
            {korean
              ? "병합을 시작했을 때 로그인했던 계정이 유지됩니다. 지금 인증한 네이버 계정의 프로필과 설정은 삭제되며, 편지 기록은 하나로 합쳐집니다."
              : "The account used to start this merge will be kept. The Naver account you just verified will have its profile and settings removed, while its letters are combined."}
          </p>
          <ul>
            <li>{korean ? `보낼 편지 ${preview.sourceMessages.sent}개` : `${preview.sourceMessages.sent} sent letters`}</li>
            <li>{korean ? `받은 편지 ${preview.sourceMessages.received}개` : `${preview.sourceMessages.received} received letters`}</li>
            <li>{korean ? `보관한 편지 ${preview.sourceMessages.kept}개` : `${preview.sourceMessages.kept} kept letters`}</li>
          </ul>
          {blockedCopy ? <div className="alert" role="alert">{blockedCopy}</div> : null}
          <div className="settings-dialog__actions">
            <button className="button button--ghost" type="button" disabled={submitting} onClick={() => void cancel()}>
              {korean ? "취소하고 로그인 화면으로" : "Cancel and return to sign in"}
            </button>
            <button className="button button--primary" type="button" disabled={submitting || Boolean(blockedCopy)} onClick={() => void complete()}>
              {submitting
                ? (korean ? "병합하는 중…" : "Merging…")
                : (korean ? "계정 병합" : "Merge accounts")}
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
