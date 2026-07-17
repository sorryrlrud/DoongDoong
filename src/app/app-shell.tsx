import type { ReactNode } from "react";
import { useI18n } from "@/i18n/i18n";

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
  const { t } = useI18n();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t("common.skip")}
      </a>

      <button
        className="scene-home"
        type="button"
        onClick={onHome}
        disabled={controlsLocked}
        aria-label={t("common.home")}
      >
        {t("brand.name")}
      </button>
      <main id="main-content" className="main-content">
        {children}
      </main>
    </div>
  );
}
