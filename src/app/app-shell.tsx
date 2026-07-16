import type { ReactNode } from "react";

interface AppShellProps {
  controlsLocked: boolean;
  onHome: () => void;
  children: ReactNode;
}

export function AppShell({
  controlsLocked,
  onHome,
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
      <main id="main-content" className="main-content">
        {children}
      </main>
    </div>
  );
}
