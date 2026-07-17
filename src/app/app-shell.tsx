import type { ReactNode } from "react";
import { useI18n } from "@/i18n/i18n";

interface AppShellProps {
  controlsLocked: boolean;
  solidHeader: boolean;
  onHome: () => void;
  children: ReactNode;
}

export function AppShell({
  controlsLocked,
  solidHeader,
  onHome,
  children,
}: AppShellProps) {
  const { t } = useI18n();
  return (
    <div className={solidHeader ? "app-shell app-shell--solid-header" : "app-shell"}>
      <a className="skip-link" href="#main-content">
        {t("common.skip")}
      </a>

      <header className={solidHeader ? "scene-header scene-header--solid" : "scene-header"}>
        <button
          className="scene-home"
          type="button"
          onClick={onHome}
          disabled={controlsLocked}
          aria-label={t("common.home")}
        >
          {t("brand.name")}
        </button>
      </header>
      <main id="main-content" className="main-content">
        {children}
      </main>
    </div>
  );
}
