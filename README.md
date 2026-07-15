# 둥둥 · DOONGDOONG

> 읽혔으면 좋겠지만, 남고 싶지는 않은 말.

둥둥은 글을 병에 담아 이름 없는 누군가에게 띄우는 익명 병편지 웹 서비스입니다. 답장, 좋아요, 프로필, 읽음 표시가 없고, 읽은 병은 다시 띄우거나 버리거나 30일 동안만 보관할 수 있습니다.

## 지금 구현된 것

- 모바일·데스크톱 반응형 웹 UI
- 첫 이용 안내와 바다 선택
- 하루 최대 2병 작성, 선택 날짜·서명, 최종 확인
- 연락처·URL·일부 위험 표현을 막는 보수적 로컬 사전 검사
- 12시간마다 한 병 건지기와 열기 전 완전 블라인드 상태
- 다시 띄우기, 30일 보관, 버리기, 신고하기
- 재표류 횟수에 따라 도착 지연이 짧아지는 로직
- 보낸 편지 내용과 서명을 기기에 남기지 않는 데모 저장소
- 모션 줄이기, 키보드 포커스, 스크린리더 상태 안내
- GitHub Actions 기반 GitHub Pages 자동 배포

환경변수가 없는 공개 페이지는 **안전한 로컬 체험판**입니다. GitHub Pages 자체에는 서버와 공유 데이터베이스가 없으므로, 띄운 편지는 저장하거나 다른 사용자에게 전달하지 않고 검수된 샘플 편지만 수신합니다. Supabase 환경변수를 설정하면 PostgreSQL 운영 게이트웨이로 전환됩니다. 설치 방법과 보안 경계는 [운영 데이터베이스 설계](docs/production-backend.md)에 정리되어 있습니다.

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
│   ├── data/                    # 검수된 데모 편지
│   ├── services/                # 저장소·안전 검사·AI provider 경계
│   ├── types/                   # 도메인 타입과 OceanGateway 인터페이스
│   └── utils/
├── shared/                      # 브랜드 자산 경로와 공용 컴포넌트
└── styles/                      # 반응형 디자인 시스템
```

`OceanGateway`, `SafetyProvider`, `TranslationProvider`가 외부 서비스 경계입니다. 기본값은 `DemoOceanGateway`와 보수적 로컬 검사이며, 운영 환경에서는 같은 계약 뒤에 Supabase PostgreSQL RPC와 OpenAI provider를 연결합니다.

## 관리자 페이지

운영 환경에서 `#/admin`으로 접속하면 사용자·메시지 통계, UID 조회, 메시지 상태와 신고 격리 목록을 확인할 수 있습니다. 관리자 함수는 GitHub identity가 연결되고 `public.users.role = 'admin'`, `status = 'active'`인 계정만 실행할 수 있습니다. 권한이 없는 계정은 GitHub로 로그인한 뒤, 해당 UID만 관리자 역할로 승격합니다.

관리자 페이지는 현재 읽기 전용입니다. 일반 클라이언트에는 `users`, `messages` 테이블 직접 조회 권한이 없으며, 관리자 전용 RPC가 서버에서 역할을 다시 검사합니다.

## AI 연결 판단

2026-07-13 기준 권장 조합은 다음과 같습니다.

- 유해성 분류: 무료인 [`omni-moderation-latest`](https://developers.openai.com/api/docs/models/omni-moderation-latest)
- 개인정보·광고 등 서비스 정책 보조 분류 및 번역: 저비용 [`gpt-5-nano`](https://developers.openai.com/api/docs/models/gpt-5-nano)

API 키는 정적 웹 번들에 넣지 않습니다. Firebase Function 같은 서버 환경의 Secret Manager에서만 읽어야 하며, ChatGPT 구독과 API 과금은 별개입니다. 현재 Pages 체험판에서는 AI 호출과 번역 UI를 노출하지 않습니다.

## 그래픽

사이트의 바다·메시지 보틀·소셜 카드 그래픽은 AI로 생성한 raster 이미지입니다. 코드로 만든 SVG 일러스트레이션은 사용하지 않습니다.

## 배포

`main`에 push하면 `.github/workflows/deploy-pages.yml`이 lint, test, build를 실행한 뒤 `dist/`를 GitHub Pages에 배포합니다.
