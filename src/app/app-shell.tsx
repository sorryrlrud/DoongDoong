import type { ReactNode } from "react";
import type { AppRoute } from "@/app/use-hash-route";
import type { OceanSnapshot } from "@/features/ocean/types/ocean";

interface AppShellProps {
  route: AppRoute;
  snapshot: OceanSnapshot;
  notice: string | null;
  onNavigate: (route: AppRoute) => void;
  children: ReactNode;
}

const NAV_ITEMS: Array<{ route: AppRoute; label: string }> = [
  { route: "home", label: "바다" },
  { route: "write", label: "띄우기" },
  { route: "catch", label: "건지기" },
  { route: "kept", label: "보관함" },
];

export function AppShell({ route, snapshot, notice, onNavigate, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>
      <header className="site-header">
        <button className="brand" type="button" onClick={() => onNavigate("home")} aria-label="둥둥 홈">
          <span className="brand__ko">둥둥</span>
          <span className="brand__en">DOONGDOONG</span>
        </button>
        <nav className="desktop-nav" aria-label="주요 메뉴">
          {NAV_ITEMS.filter((item) => item.route !== "home").map((item) => (
            <button
              key={item.route}
              className={route === item.route ? "nav-link nav-link--active" : "nav-link"}
              type="button"
              onClick={() => onNavigate(item.route)}
              aria-current={route === item.route ? "page" : undefined}
            >
              {item.label}
              {item.route === "kept" && snapshot.keptBottles.length > 0 ? (
                <span className="nav-count" aria-label={`${snapshot.keptBottles.length}개`}>
                  {snapshot.keptBottles.length}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <span className="demo-stamp" title="현재 기기에서 작동하는 체험판">
            DEMO
          </span>
          <button className="text-button" type="button" onClick={() => onNavigate("guide")}>
            이용안내
          </button>
          <button className="text-button" type="button" onClick={() => onNavigate("settings")}>
            설정
          </button>
        </div>
      </header>

      <main id="main-content" className="main-content">
        {children}
      </main>

      <nav className="mobile-nav" aria-label="모바일 주요 메뉴">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.route}
            className={route === item.route ? "mobile-nav__item mobile-nav__item--active" : "mobile-nav__item"}
            type="button"
            onClick={() => onNavigate(item.route)}
            aria-current={route === item.route ? "page" : undefined}
          >
            <span>{item.label}</span>
            {item.route === "kept" && snapshot.keptBottles.length > 0 ? (
              <span className="nav-count" aria-hidden="true">
                {snapshot.keptBottles.length}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="sr-live" aria-live="polite" aria-atomic="true">
        {notice}
      </div>
    </div>
  );
}
