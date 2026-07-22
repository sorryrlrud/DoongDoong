# dev/prod 분리 배포 설계

## 결론

현재 코드베이스는 dev/prod 분리 배포가 가능하도록 준비되어 있다. 단, 분리의
최소 단위는 **프런트엔드 URL 2개 + Supabase 프로젝트 2개**다. 같은 Supabase
프로젝트에서 스키마나 행의 플래그만 나누는 방식은 마이그레이션, Auth 사용자,
Edge secret, 예약 작업의 실수 반경을 분리하지 못하므로 사용하지 않는다.

```text
develop ─> development GitHub Environment ─> DoongDoong-dev Pages ─> dev Supabase

main ────> production GitHub Environment  ─> GitHub Pages ─────> prod Supabase
```

이 저장소의 GitHub Pages는 운영 URL을 계속 사용한다. GitHub Pages는 저장소당
라이브 사이트가 하나이므로 개발 빌드는 별도 공개 저장소
[`sorryrlrud/DoongDoong-dev`](https://github.com/sorryrlrud/DoongDoong-dev)의 `main`에
정적 산출물만 force-push하고 그 저장소의 Pages가 서비스한다. 원본 소스, migration,
workflow는 `DoongDoong` 한 곳에서만 관리하여 두 코드베이스가 갈라지지 않게 한다.

## 환경 계약

현재 개발 Supabase 프로젝트는 `DoongDoong Dev`이며 project ref는
`xqzcqfdgahvtfrhcpxco`, 리전은 서울(`ap-northeast-2`)이다. 로컬 연결값은 git에서
제외되는 `.env.development.local`에 저장되어 있고, GitHub의 `development`
Environment에도 Project URL, publishable key, project ref와 프런트 URL 변수가
등록되어 있다.

2026-07-22 기준 21개 migration과 `send-message`, `delete-account`,
`translate-message`, `dispatch-web-push`, `naver-userinfo` Edge Function이 dev에
배포되었다. dev 전용 VAPID 키와 scheduler secret도 설정되었고 dispatcher smoke
test가 성공했다. Auth는 manual linking 활성화, anonymous/email 로그인 비활성화
상태다. GitHub Environment의 Supabase access token은 2026-08-21 만료이므로 그 전에
새 토큰으로 교체해야 한다.

외부 공급자 자격증명은 환경 간에 자동 복제하지 않는다. 따라서 Google, Apple,
Naver와 관리자 GitHub OAuth client, Azure Translator, 관리형 moderation provider는
각 공급자에서 dev callback/credential을 별도로 발급한 후 설정해야 한다. 이 값들이
없어도 배포된 번역 함수는 원문 fallback을 유지하지만, `send-message`는 안전을 위해
`MODERATION_UNAVAILABLE`로 fail-closed한다.

| 항목 | development | production |
| --- | --- | --- |
| Git 브랜치 | `develop` | `main` |
| GitHub Environment | `development` | `production` |
| 프런트 URL | `https://sorryrlrud.github.io/DoongDoong-dev/` 권장 | `https://sorryrlrud.github.io/DoongDoong/` |
| Supabase | dev 전용 프로젝트 | prod 전용 프로젝트 |
| 데이터 | 삭제·재생성 허용 | 보존, forward-only 변경 |
| 프런트 배포 | `DoongDoong-dev` GitHub Pages 자동 배포 | `DoongDoong` GitHub Pages 자동 배포 |
| 백엔드 배포 | 수동 `DEPLOY_DEVELOPMENT` | 운영 release runbook 승인 절차 |

다음 조건은 항상 유지한다.

- dev/prod의 Supabase project ref, publishable key, Auth 사용자, Edge secret을 공유하지 않는다.
- `service_role`, DB 비밀번호, VAPID private key, scheduler secret은 `VITE_` 변수로 만들지 않는다.
- production job은 `production` Environment의 secret만, development job은
  `development` Environment의 secret만 읽는다.
- 프런트 배포 전에 대상 Supabase의 Edge endpoint와 DB contract가 먼저 준비되어야 한다.
- 운영 데이터베이스에는 과거 reset 마이그레이션을 재실행하지 않는다.

## GitHub Environment 설정

Repository **Settings → Environments**에서 `development`, `production`을 만든다.
`production`에는 `main`만 허용하고 required reviewer를 두는 것을 권장한다.
`development`에는 `develop`만 허용한다. 기존 `github-pages` Environment는 실제 Pages
업로드 권한용으로 그대로 둔다.

두 Environment에 이름은 같고 값만 다른 secret을 등록한다.
`DEV_PAGES_DEPLOY_KEY`만 development에 등록하며 production에는 만들지 않는다.

| Secret | 용도 |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI 배포 인증 |
| `SUPABASE_DB_PASSWORD` | 대상 dev/prod DB 연결; Environment secret으로만 보관 |
| `SUPABASE_PROJECT_REF` | 대상 프로젝트 식별 및 URL 교차 검증 |
| `VITE_SUPABASE_URL` | 브라우저용 Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 브라우저용 publishable key |
| `VITE_VAPID_PUBLIC_KEY` | 브라우저용 Web Push 공개 키 |
| `SCHEDULED_JOB_SECRET` | 서버 간 예약 작업 인증; 브라우저 빌드에서 사용 금지 |
| `DEV_PAGES_DEPLOY_KEY` | development 전용. `DoongDoong-dev`에만 쓰기 가능한 SSH deploy key |

Environment variable에는 다음을 등록한다.

| Variable | 예시 |
| --- | --- |
| `VITE_PUBLIC_APP_URL` | dev: `https://dev.example.com/`, prod: 운영 URL |
| `VITE_BASE_PATH` | dev: `/` 또는 `/dev/`, prod: `/DoongDoong/` |

`VITE_PUBLIC_APP_URL`의 pathname과 `VITE_BASE_PATH`는 정확히 같아야 한다. 빌드 검증은
Supabase URL의 project ref도 `SUPABASE_PROJECT_REF`와 비교한다. 이 검증 때문에 dev
job에 prod URL을 잘못 넣거나 prod job에 예제 값을 남기면 배포 전에 실패한다.

각 Supabase 프로젝트에는 별도로 다음 Edge secret을 설정한다.

- `MODERATION_ENDPOINT`, `MODERATION_API_KEY`
- `AZURE_TRANSLATOR_KEY`, 필요 시 `AZURE_TRANSLATOR_REGION`과
  `AZURE_TRANSLATOR_ENDPOINT`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- `SCHEDULED_JOB_SECRET`
- `ALLOWED_WEB_ORIGINS`: 해당 환경 프런트 origin. 로컬 QA도 필요하면 쉼표로 추가한다.

## 로컬 사용

일반 로컬 개발은 다음처럼 dev 프로젝트만 연결한다.

```bash
cp .env.development.example .env.development.local
# 실제 dev 값 입력
npm run env:check:dev
npm run dev -- --mode development
```

배포와 동일한 정적 빌드는 다음 명령으로 검증한다.

```bash
npm run build:dev
npm run preview -- --mode development
```

운영 설정을 로컬에서 검증해야 할 때만 `.env.production.local`을 만들고
`npm run env:check:prod` 또는 `npm run build:prod`를 사용한다. 이 파일들은 git에서
무시된다. 운영 key를 일상적인 로컬 개발 파일에 복사하지 않는다.

## 최초 구축 순서

1. 별도 Supabase dev 프로젝트를 만든다.
2. `development` GitHub Environment의 secret과 variable을 등록한다.
3. dev Auth Site URL/Redirect URL, Google·Apple·Naver callback을 dev URL 기준으로
   등록한다. Provider가 dev callback을 추가로 허용하지 않으면 dev용 OAuth app도
   분리한다.
4. dev Supabase Edge secret에 dev origin과 dev 전용 provider key를 넣는다.
5. **Deploy Supabase development** workflow를 `DEPLOY_DEVELOPMENT`로 실행한다.
6. `DoongDoong-dev`에 쓰기 가능한 SSH deploy key의 공개 키를 등록하고, 개인 키를
   `development` Environment의 `DEV_PAGES_DEPLOY_KEY` secret으로 등록한다.
7. **Deploy development release** workflow를 실행한다. 검증된 `dist/`가
   `DoongDoong-dev/main`에 배포되고 Pages URL이
   `VITE_PUBLIC_APP_URL`/`VITE_BASE_PATH`와 일치하는지 확인한다.
8. 수신·Push QA 때 **Dispatch Ocean development jobs**를 수동 실행한다. dev에는
   불필요한 상시 비용과 알림을 피하기 위해 5분 schedule을 기본 활성화하지 않는다.
9. 새 브라우저 프로필에서 로그인, 편지 전송·수신, 번역, Push, 계정 삭제를 점검한다.
10. dev 검증이 끝난 동일 commit을 운영 release runbook 순서로 승격한다.

## 구현된 격리 장치

- Vite가 모드별 base path와 canonical/Open Graph URL을 생성한다.
- 일반 로그인과 관리자 로그인 storage key에 환경과 Supabase host가 모두 들어간다.
- Service Worker cache 이름에 scope가 포함되어 같은 origin의 `/dev/`와 `/prod/`가
  서로의 캐시를 삭제하지 않는다.
- `build:dev`와 `build:prod`는 환경 이름, 공개 URL, base path, Supabase project ref를
  빌드 전에 검증한다.
- 운영 Pages build와 scheduler는 `production` Environment에 고정되어 있다.
- dev DB 배포는 별도 workflow와 별도 concurrency lock을 사용한다.
- dev Pages deploy key는 산출물 저장소 하나에만 쓰기 가능하며 prod 저장소 권한이 없다.

## 운영 승격과 롤백

dev에서 확인한 commit SHA를 기록하고 그 SHA만 `main`으로 승격한다. 운영 백엔드
변경은 `docs/runbooks/ocean-pwa-production-release.md`의 백엔드 우선 순서를 따른다.

prod 프런트 장애는 직전 정상 commit의 Pages workflow를 다시 실행한다. dev 프런트는
직전 정상 development workflow run을 재실행하면 해당 산출물이 다시 force-push된다.
DB migration은
되돌리는 SQL이나 reset 대신 forward fix를 사용한다. dev는 필요할 때 재생성할 수
있지만 prod 백업을 dev에 복원할 경우 개인정보 마스킹과 접근 제한을 먼저 설계해야
하며, 기본 운영에서는 운영 데이터를 dev로 복제하지 않는다.
