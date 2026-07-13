import type { AppRoute } from "@/app/use-hash-route";
import { PageHeading } from "@/shared/page-heading";

interface GuideScreenProps {
  onNavigate: (route: AppRoute) => void;
}

export function GuideScreen({ onNavigate }: GuideScreenProps) {
  return (
    <section className="screen guide-screen">
      <div className="screen-header">
        <p className="eyebrow">둥둥이 지키는 약속</p>
        <PageHeading>말은 닿고, 관계는 남지 않아요.</PageHeading>
        <p>누군가에게 읽히길 바라면서도 조용히 흘려보내고 싶은 마음을 위한 작은 바다입니다.</p>
      </div>

      <div className="guide-grid">
        <article className="guide-card guide-card--blue">
          <span>01</span>
          <h2>한 병, 한 사람</h2>
          <p>한 번에 한 사람만 병을 만나요. 읽은 뒤 다시 띄우면 다음 누군가에게 이어집니다.</p>
        </article>
        <article className="guide-card guide-card--coral">
          <span>02</span>
          <h2>완전한 블라인드</h2>
          <p>출발 지역, 언어, 작성자 정보가 보이지 않아요. 작성자도 읽음이나 이동 경로를 알 수 없습니다.</p>
        </article>
        <article className="guide-card guide-card--mustard">
          <span>03</span>
          <h2>답장 없는 만남</h2>
          <p>답장, 좋아요, 댓글, 팔로우가 없어요. 읽었다는 사실조차 작성자에게 전해지지 않습니다.</p>
        </article>
        <article className="guide-card guide-card--cream">
          <span>04</span>
          <h2>언젠가는 사라짐</h2>
          <p>버리면 즉시, 보관하면 30일 뒤 사라져요. 둥둥은 영원히 쌓아 두는 피드가 아닙니다.</p>
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
        <p>이제 마음 하나를 가볍게 띄워볼까요?</p>
        <button className="button button--coral" type="button" onClick={() => onNavigate("write")}>
          병 띄우기
        </button>
      </div>
    </section>
  );
}
