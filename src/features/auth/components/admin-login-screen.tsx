import { BEACH_IMAGE } from "@/shared/brand";

interface AdminLoginScreenProps {
  busy: boolean;
  error: boolean;
  onSignIn: () => void;
  onExit: () => void;
}

export function AdminLoginScreen({ busy, error, onSignIn, onExit }: AdminLoginScreenProps) {
  return (
    <main className="login-screen">
      <img className="login-screen__art" src={BEACH_IMAGE} alt="" />
      <section className="login-screen__panel" aria-labelledby="admin-login-title">
        <div className="login-screen__brand">둥둥 운영</div>
        <p className="login-screen__eyebrow">관리자 전용</p>
        <h1 id="admin-login-title">GitHub로 관리자 인증</h1>
        <p className="login-screen__description">
          관리자 기능은 승인된 GitHub 계정으로만 접근할 수 있습니다.
        </p>
        {error ? <div className="alert" role="alert">GitHub 인증에 실패했습니다. 다시 시도해 주세요.</div> : null}
        <div className="login-screen__providers" aria-label="관리자 로그인">
          <button
            className="social-login social-login--github"
            type="button"
            disabled={busy}
            onClick={onSignIn}
          >
            <span className="social-login__mark" aria-hidden="true">GH</span>
            <strong>{busy ? "GitHub 로그인 여는 중…" : "GitHub로 관리자 로그인"}</strong>
          </button>
        </div>
        <button className="text-button" type="button" onClick={onExit}>일반 로그인으로 돌아가기</button>
      </section>
    </main>
  );
}
