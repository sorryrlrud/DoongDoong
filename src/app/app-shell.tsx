import type { ReactNode } from "react";

interface AppShellProps {
  controlsLocked: boolean;
  demoResetting: boolean;
  demoMessage: string | null;
  onHome: () => void;
  onReplayTutorial: () => Promise<void>;
  children: ReactNode;
}

export function AppShell({
  controlsLocked,
  demoResetting,
  demoMessage,
  onHome,
  onReplayTutorial,
  children,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>

      <button
        className="scene-home"
        type="button"
        onClick={onHome}
        disabled={controlsLocked}
        aria-label="둥둥 해변으로 돌아가기"
      >
        둥둥
      </button>
      <button
        className="demo-reset"
        type="button"
        onClick={() => void onReplayTutorial()}
        disabled={controlsLocked}
        aria-label="새 데모 사용자로 처음부터 다시 시작하기"
      >
        {demoResetting ? "초기화 중…" : "DEMO ↻"}
      </button>
      {demoMessage ? <p className="demo-reset-message" role="alert">{demoMessage}</p> : null}
      <main id="main-content" className="main-content">
        {children}
      </main>
    </div>
  );
}
