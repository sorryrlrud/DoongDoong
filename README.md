# 둥둥 · DOONGDOONG

> 읽혔으면 좋겠지만, 남고 싶지는 않은 말.

둥둥은 글을 병에 담아 이름 없는 누군가에게 띄우는 익명 병편지 웹 서비스입니다. 답장, 좋아요, 프로필, 읽음 표시가 없고, 읽은 병은 다시 띄우거나 버리거나 30일 동안만 보관할 수 있습니다.

## 지금 구현된 것

- 모바일·데스크톱 반응형 웹 UI
- 첫 이용 국가 선택과 모든 바다 대상 익명 병 수신
- 편지를 띄울 바다 선택과 기본 발신 바다 설정
- 하루 최대 2병 작성, 선택 날짜·서명, 최종 확인
- 연락처·URL·일부 위험 표현을 막는 보수적 로컬 사전 검사
- 12시간마다 한 병 건지기와 열기 전 완전 블라인드 상태
- 다시 띄우기, 30일 보관, 버리기, 신고하기
- 재표류 횟수에 따라 도착 지연이 짧아지는 로직
- 모션 줄이기, 키보드 포커스, 스크린리더 상태 안내
- 수신 편지의 발신 국가 표시, 새 소식 대기 갈매기 상태
- 설치·오프라인 재방문을 위한 PWA 매니페스트와 서비스 워커
- GitHub Actions 기반 GitHub Pages 자동 배포

이 앱은 Supabase PostgreSQL 운영 게이트웨이를 사용합니다. 설치 방법과 보안 경계는 [운영 데이터베이스 설계](docs/production-backend.md)에 정리되어 있습니다.

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

검증:

```bash
npm run check
```

## 구조

```text
src/
├── app/                         # 앱 셸, 화면 이동, 로컬 환경설정
├── features/ocean/
│   ├── components/              # 작성·수신·보관·안내 화면
│   ├── services/                # 저장소·안전 검사·AI provider 경계
│   ├── types/                   # 도메인 타입과 OceanGateway 인터페이스
│   └── utils/
├── shared/                      # 브랜드 자산 경로와 공용 컴포넌트
└── styles/                      # 반응형 디자인 시스템
```

`OceanGateway`, `SafetyProvider`, `TranslationProvider`가 외부 서비스 경계입니다. 운영 환경에서는 Supabase PostgreSQL RPC와 보수적 로컬 검사를 연결합니다.

## 관리자 페이지

운영 환경에서 `#/admin`으로 접속하면 사용자·메시지 통계, UID·국가·수신 가능 쿨타임 조회와 메시지 상태를 확인할 수 있습니다. 사용자와 관련 메시지 완전 삭제, 개별 메시지 완전 삭제, 발신·수신 제한 초기화, 표류 메시지 즉시 도달 가능 처리를 지원합니다. 관리자 함수는 GitHub identity가 연결되고 `public.users.role = 'admin'`, `status = 'active'`인 계정만 실행할 수 있습니다. 권한이 없는 계정은 GitHub로 로그인한 뒤, 해당 UID만 관리자 역할로 승격합니다.

일반 클라이언트에는 `users`, `messages` 테이블 직접 조회 권한이 없으며, 관리자 전용 RPC가 서버에서 역할을 다시 검사합니다. 사용자가 버린 메시지는 상태와 함께 데이터베이스에 보존되지만, 관리자는 명시적인 완전 삭제 작업으로 사용자·관련 메시지 또는 개별 메시지를 영구 삭제할 수 있습니다.

관리자가 사용자를 완전 삭제한 뒤 해당 브라우저가 다시 접속하면 서버의 빈 프로필을 감지해 기존 로컬 설정과 관계없이 국가·바다 선택 온보딩부터 다시 시작합니다.

## AI 연결 판단

2026-07-13 기준 권장 조합은 다음과 같습니다.

- 유해성 분류: 무료인 [`omni-moderation-latest`](https://developers.openai.com/api/docs/models/omni-moderation-latest)
- 개인정보·광고 등 서비스 정책 보조 분류 및 번역: 저비용 [`gpt-5-nano`](https://developers.openai.com/api/docs/models/gpt-5-nano)

API 키는 정적 웹 번들에 넣지 않습니다. Firebase Function 같은 서버 환경의 Secret Manager에서만 읽어야 하며, ChatGPT 구독과 API 과금은 별개입니다. 현재 Pages 체험판에서는 AI 호출과 번역 UI를 노출하지 않습니다.

## 그래픽

사이트의 바다·메시지 보틀·소셜 카드 그래픽은 AI로 생성한 raster 이미지입니다. 코드로 만든 SVG 일러스트레이션은 사용하지 않습니다.

## 음원

바다 배경음과 갈매기·도착 파도·전송 풍덩 효과음은 외부 음원을 사용하지 않고 이 저장소의 `scripts/generate-audio-assets.mjs`로 직접 생성한 WAV 파일입니다. 음원을 바꾸려면 `public/assets/audio/` 안의 동명 파일을 교체하면 됩니다.

## 배포

`main`에 push하면 `.github/workflows/deploy-pages.yml`이 lint, test, build를 실행한 뒤 `dist/`를 GitHub Pages에 배포합니다.

배포 후 지원 브라우저의 주소창 메뉴에서 **앱 설치**를 선택하면 독립 창으로 열 수 있습니다. 첫 방문 뒤에는 핵심 화면과 정적 자산이 캐시되어 네트워크가 잠시 끊겨도 다시 열 수 있습니다.
