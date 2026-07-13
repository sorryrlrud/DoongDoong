import type { ReactNode } from "react";

interface AppShellProps {
  notice: string | null;
  resettingDemo: boolean;
  controlsLocked: boolean;
  onHome: () => void;
  onDemoReset: () => Promise<void>;
  children: ReactNode;
}

export function AppShell({
  notice,
  resettingDemo,
  controlsLocked,
  onHome,
  onDemoReset,
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
        onClick={() => void onDemoReset()}
        disabled={resettingDemo || controlsLocked}
        aria-label="데모를 초기화하고 첫 화면으로 이동"
      >
        {resettingDemo ? "RESET…" : "DEMO ↻"}
      </button>

      <main id="main-content" className="main-content">
        {children}
      </main>

      <div className="sr-live" aria-live="polite" aria-atomic="true">
        {notice}
      </div>
    </div>
  );
}
