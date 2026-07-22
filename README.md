# 둥둥 · DOONGDOONG

> 읽혔으면 좋겠지만, 남고 싶지는 않은 말.

둥둥은 글을 병에 담아 이름 없는 누군가에게 띄우는 익명 병편지 웹 서비스입니다. 답장, 좋아요, 프로필, 읽음 표시가 없고, 읽은 병은 다시 띄우거나 버리거나 30일 동안만 보관할 수 있습니다.

## 지금 구현된 것

- 모바일·데스크톱 반응형 웹 UI
- Google·Apple·Naver 소셜 로그인, 설정 화면의 추가 계정 연동과 기기별 로그아웃
- 첫 이용 국가·언어 분리 선택과 모든 바다 대상 익명 병 수신
- 12개 UI 언어와 수신자 언어 기준 Azure 자동 번역·메시지별 캐시
- 국가 기준 기본 발신 바다와 작성 시 바다 변경
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

`OceanGateway`와 `SafetyProvider`가 외부 서비스 경계입니다. 운영 환경에서는 Supabase PostgreSQL RPC, Edge Function, Azure Translator와 보수적 로컬 검사를 연결합니다.

## 관리자 페이지

운영 환경에서 단일 관리자 주소인 `#/admin`으로 접속하면 GitHub 전용 관리자 로그인을 거쳐 사용자·메시지 통계, UID·국가·수신 가능 쿨타임 조회와 메시지 상태를 확인할 수 있습니다. 사용자와 관련 메시지 완전 삭제, 개별 메시지 완전 삭제, 발신·수신 제한 초기화, 표류 메시지 즉시 도달 가능 처리를 지원합니다. 관리자 함수는 GitHub identity가 연결되고 `public.users.role = 'admin'`, `status = 'active'`인 계정만 실행할 수 있습니다. 최초 GitHub 로그인 후 관리자 화면에 표시되는 UID만 관리자 역할로 승격합니다.

일반 로그인은 브라우저 공용 저장소를, 관리자 로그인은 해당 탭의 세션 저장소를 사용합니다. 따라서 같은 브라우저의 일반 탭에서 Google·Apple·Naver 계정으로 로그인한 상태를 유지하면서 다른 탭에서 별도 GitHub 관리자 계정으로 로그인할 수 있습니다. 관리자 탭을 닫으면 해당 탭의 관리자 세션도 종료됩니다.

관리자 페이지는 Supabase 무료 티어의 Database·월간 활성 사용자·Storage·앱에서 추적한 번역 Edge Function 호출과 Azure Translator F0의 월간 번역 문자 사용량을 함께 표시합니다. Provider 관리 키를 브라우저에 노출하지 않고 관리자 전용 RPC에서 사용량과 무료 한도 대비 잔여량을 계산합니다. 월간 수치는 UTC 기준으로 매월 1일 초기화되며, 배포 전 Edge Function 실패·캐시 적중 호출은 소급 집계할 수 없어 실제 Provider 청구 화면과 소폭 차이가 날 수 있습니다.

일반 클라이언트에는 `users`, `messages` 테이블 직접 조회 권한이 없으며, 관리자 전용 RPC가 서버에서 역할을 다시 검사합니다. 사용자가 버린 메시지는 상태와 함께 데이터베이스에 보존되지만, 관리자는 명시적인 완전 삭제 작업으로 사용자·관련 메시지 또는 개별 메시지를 영구 삭제할 수 있습니다.

관리자가 사용자를 완전 삭제한 뒤 해당 브라우저가 다시 접속하면 남아 있던 세션을 제거하고 소셜 로그인 화면으로 돌아갑니다.

## 소셜 로그인 운영 설정

일반 클라이언트는 `google`, `apple`, `custom:naver` 세 provider만 사용하고 관리자 클라이언트는 GitHub만 사용합니다. Provider credential과 Apple signing key는 저장소나 브라우저 환경변수에 넣지 않고 Supabase Authentication 설정에만 저장합니다. Naver의 중첩된 프로필 응답은 `naver-userinfo` Edge Function이 표준 userinfo 형태로 변환합니다.

정확한 provider 등록값, Callback URL, Edge Function 배포 순서와 전체 사용자 초기화 절차는 [운영 데이터베이스 설계](docs/production-backend.md#소셜-로그인-설정)에 정리되어 있습니다.

## 번역

앱 UI는 한국어, 영어, 일본어, 중국어 간체·번체, 스페인어, 프랑스어, 독일어, 포르투갈어, 러시아어, 아랍어, 힌디어 12개 언어를 정적 번역 사전으로 제공합니다. 국가와 언어는 별도로 저장합니다.

편지 원문 언어는 최초 작성자의 설정 언어로 고정됩니다. 수신자에게 병이 도달할 때 Supabase Edge Function이 Azure Translator를 호출하며, 결과는 `message_id + target_language` 기준으로 캐시합니다. 다시 띄워도 원문과 기존 번역은 유지되고, 다음 수신자의 언어 캐시만 조회하거나 추가합니다.

Azure 키는 정적 웹 번들에 넣지 않고 Supabase Edge Function secret으로만 관리합니다. 번역 서비스가 잠시 실패하면 원문을 보여 주며, 병을 열 때 한 번 더 캐시 생성을 시도합니다.

## 그래픽

사이트의 바다·메시지 보틀·소셜 카드 그래픽은 AI로 생성한 raster 이미지입니다. 코드로 만든 SVG 일러스트레이션은 사용하지 않습니다.

## 음원

바다 배경음과 갈매기·도착 파도·전송 풍덩 효과음은 외부 음원을 사용하지 않고 이 저장소의 `scripts/generate-audio-assets.mjs`로 직접 생성한 WAV 파일입니다. 음원을 바꾸려면 `public/assets/audio/` 안의 동명 파일을 교체하면 됩니다.

## 배포

이 서비스는 별도 개발 배포 없이 production 하나만 운영합니다. `main`에 push하면
`.github/workflows/deploy-pages.yml`이 production Environment의 운영 Supabase 설정으로
lint, test, build를 실행한 뒤 이 저장소의 GitHub Pages에 배포합니다.

배포 후 지원 브라우저의 주소창 메뉴에서 **앱 설치**를 선택하면 독립 창으로 열 수 있습니다. 첫 방문 뒤에는 핵심 화면과 정적 자산이 캐시되어 네트워크가 잠시 끊겨도 다시 열 수 있습니다.
