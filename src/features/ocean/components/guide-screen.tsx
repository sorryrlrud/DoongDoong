import type { AppRoute } from "@/app/use-hash-route";
import { PageHeading } from "@/shared/page-heading";

interface GuideScreenProps {
  onNavigate: (route: AppRoute) => void;
}

export function GuideScreen({ onNavigate }: GuideScreenProps) {
  return (
    <section className="screen guide-screen">
      <div className="screen-header">
        <p className="eyebrow">이용안내</p>
        <PageHeading>둥둥의 약속</PageHeading>
      </div>

      <div className="guide-grid">
        <article className="guide-card guide-card--blue">
          <span>01</span>
          <div>
            <h2>한 병, 한 사람</h2>
            <p>읽은 뒤 다시 띄우면 다음 사람에게 가요.</p>
          </div>
        </article>
        <article className="guide-card guide-card--coral">
          <span>02</span>
          <div>
            <h2>완전한 블라인드</h2>
            <p>작성자·독자·이동 경로를 알 수 없어요.</p>
          </div>
        </article>
        <article className="guide-card guide-card--mustard">
          <span>03</span>
          <div>
            <h2>답장 없는 만남</h2>
            <p>답장·좋아요·읽음 표시가 없어요.</p>
          </div>
        </article>
        <article className="guide-card guide-card--cream">
          <span>04</span>
          <div>
            <h2>언젠가는 사라짐</h2>
            <p>버리면 즉시, 보관하면 30일 뒤 사라져요.</p>
          </div>
        </article>
      </div>

      <div className="safety-panel">
        <div>
          <p className="eyebrow">안전한 바다를 위해</p>
          <h2>나를 알아볼 정보는 적지 말아요.</h2>
        </div>
        <ul>
          <li>실명, 전화번호, 이메일, SNS 계정, 주소, 학교는 쓰지 않아요.</li>
          <li>성적 표현, 혐오, 위협, 범죄·자해의 구체적 내용, 광고는 띄울 수 없어요.</li>
          <li>불쾌하거나 위험한 병은 읽기 화면에서 바로 신고할 수 있어요.</li>
          <li>화면 캡처 같은 수신자의 행동까지 기술적으로 막을 수는 없어요.</li>
        </ul>
      </div>

      <div className="guide-cta">
        <button className="button button--secondary" type="button" onClick={() => onNavigate("settings")}>
          설정
        </button>
      </div>
    </section>
  );
}
