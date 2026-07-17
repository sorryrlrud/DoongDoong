import type { AppRoute } from "@/app/use-hash-route";
import { PageHeading } from "@/shared/page-heading";
import { useI18n } from "@/i18n/i18n";

interface GuideScreenProps {
  onNavigate: (route: AppRoute) => void;
}

export function GuideScreen({ onNavigate }: GuideScreenProps) {
  const { t } = useI18n();
  return (
    <section className="screen guide-screen">
      <div className="screen-header">
        <p className="eyebrow">{t("guide.eyebrow")}</p>
        <PageHeading>{t("guide.title")}</PageHeading>
      </div>

      <div className="guide-grid">
        <article className="guide-card guide-card--blue">
          <span>01</span>
          <div>
            <h2>{t("guide.oneTitle")}</h2>
            <p>{t("guide.oneBody")}</p>
          </div>
        </article>
        <article className="guide-card guide-card--coral">
          <span>02</span>
          <div>
            <h2>{t("guide.blindTitle")}</h2>
            <p>{t("guide.blindBody")}</p>
          </div>
        </article>
        <article className="guide-card guide-card--mustard">
          <span>03</span>
          <div>
            <h2>{t("guide.noReplyTitle")}</h2>
            <p>{t("guide.noReplyBody")}</p>
          </div>
        </article>
        <article className="guide-card guide-card--cream">
          <span>04</span>
          <div>
            <h2>{t("guide.goneTitle")}</h2>
            <p>{t("guide.goneBody")}</p>
          </div>
        </article>
      </div>

      <div className="safety-panel">
        <div>
          <p className="eyebrow">{t("guide.safetyEyebrow")}</p>
          <h2>{t("guide.safetyTitle")}</h2>
        </div>
        <ul>
          <li>{t("guide.safety1")}</li>
          <li>{t("guide.safety2")}</li>
          <li>{t("guide.safety3")}</li>
          <li>{t("guide.safety4")}</li>
        </ul>
      </div>

      <div className="guide-cta">
        <button className="button button--secondary" type="button" onClick={() => onNavigate("settings")}>
          {t("common.settings")}
        </button>
      </div>
    </section>
  );
}
