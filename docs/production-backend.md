# 운영 데이터베이스 설계

## 현재 결정: Supabase PostgreSQL

GitHub Pages는 정적 파일만 배포하지만, 브라우저에서 Supabase Auth와 Data API를 HTTPS로 호출할 수 있습니다. 현재 단계에서는 다음 구성이 가장 단순합니다.

```text
GitHub Pages (React)
  └─ Supabase
      ├─ Social Auth (Google / Apple / custom:naver)
      ├─ PostgreSQL
      │   ├─ public.users
      │   ├─ public.messages
      │   └─ public.message_translations
      ├─ Edge Function (도달 시 번역·캐시)
      └─ RPC + RLS (발송, 배정, 열기, 처리)
          └─ Azure Translator
```

Firebase도 무료 쿼터와 정적 웹 지원이 좋아 빠른 MVP에 적합합니다. 다만 이 서비스는 발신 UID를 숨긴 채 메시지를 원자적으로 배정하고, 향후 관리자 통계와 Docker 이전을 고려해야 합니다. PostgreSQL 함수, 트랜잭션, RLS를 그대로 쓸 수 있는 Supabase가 현재 요구에 더 잘 맞습니다.

## 테이블

### public.users

Supabase Auth의 `auth.users.id`와 같은 UUID를 기본 키로 사용합니다. 국가와 언어를 별도 필드로 두고, 바다, 상태, 일일 발송량, 다음 수신 시각, 현재 잡은 메시지 ID를 저장합니다. 로그인 제공자와 토큰은 이 테이블이 아니라 Supabase Auth가 관리합니다.

### public.messages

본문, 불변 원문 언어, 서명, 바다, 작성자 UID와 함께 `drifting`, `available`, `delivered`, `kept`, `deleted`, `reported` 상태를 저장합니다. 사용자가 버린 메시지는 `deleted`로 전환할 뿐 행을 삭제하지 않습니다.

### public.message_translations

`message_id + target_language`를 기본 키로 Azure 번역 본문을 저장합니다. 일반 브라우저에는 직접 읽기·쓰기 권한이 없고 Edge Function의 service role만 캐시를 추가합니다. 원문과 캐시는 재표류 시 삭제하지 않습니다.

브라우저에는 두 테이블의 직접 읽기·쓰기 권한이 없습니다. `ocean_*` DB 함수만 `authenticated` 역할에 공개하며, 함수가 `auth.uid()`와 행 잠금을 확인합니다. 따라서 일반 사용자가 API 요청을 조작해도 다른 사용자의 UID나 미개봉 본문을 직접 조회할 수 없습니다.

## 설치

1. Supabase에서 프로젝트를 만듭니다.
2. 아래 [소셜 로그인 설정](#소셜-로그인-설정)에 따라 Google, Apple, Naver provider를 등록합니다.
3. SQL Editor에서 `supabase/migrations`의 마이그레이션을 파일명 순서대로 실행합니다. Supabase CLI를 사용한다면 `supabase db push`로 적용해도 됩니다.
4. `.env.example`을 `.env.local`로 복사하고 Project URL과 publishable key를 입력합니다.
5. `npm run check`와 `npm run dev`로 확인합니다.

번역을 사용하려면 Azure Translator F0 리소스를 만든 뒤 Edge Function secret과 함수를 배포합니다.

```bash
supabase secrets set AZURE_TRANSLATOR_KEY=... AZURE_TRANSLATOR_REGION=...
supabase functions deploy translate-message
```

전역 단일 서비스 Translator 리소스는 region 헤더가 선택 사항입니다. 사용자 지정 엔드포인트가 필요하면 `AZURE_TRANSLATOR_ENDPOINT`도 secret으로 등록합니다.

환경변수가 없으면 앱은 설정 오류 화면을 표시합니다. `service_role` 키와 DB 비밀번호는 브라우저, `.env`, GitHub Pages 빌드에 절대 넣지 않습니다. 클라이언트에는 publishable key만 사용합니다.

GitHub Pages 운영 빌드에는 저장소의 Actions secrets에 아래 값을 등록합니다.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

## 소셜 로그인 설정

공통으로 Supabase Authentication의 Site URL을 `https://sorryrlrud.github.io/DoongDoong/`로 지정하고 Redirect URLs에 운영 URL과 로컬 개발 URL을 등록합니다. 외부 provider에 등록하는 Callback URL은 앱 URL이 아니라 Supabase Dashboard의 해당 provider 화면에 표시되는 `https://PROJECT_REF.supabase.co/auth/v1/callback`입니다.

설정 화면에서 로그인 계정을 추가로 연동하려면 Authentication 설정의 **Enable Manual Linking**을 활성화해야 합니다. 연동 완료 후 앱의 `#/settings`로 돌아오며, 이미 다른 사용자에게 연결된 provider 계정은 보안을 위해 연동이 거부됩니다.

### Google

Google Cloud에서 Web application OAuth client를 만든 뒤 Supabase Google provider에 Client ID와 Client Secret을 등록합니다. 최소 scope는 `openid`, `userinfo.email`, `userinfo.profile`만 사용합니다.

### Apple

Apple Developer에서 Sign in with Apple이 활성화된 App ID, Services ID, signing key를 만든 뒤 Supabase Apple provider에 Services ID와 생성한 secret을 등록합니다. 웹 OAuth secret은 6개월마다 갱신해야 하므로 만료 전에 교체 일정을 운영해야 합니다.

### Naver

Naver는 중첩된 JSON으로 프로필을 반환하므로 먼저 변환 Edge Function을 JWT 검증 없이 배포합니다. 이 함수는 전달받은 Naver access token을 Naver 프로필 API에만 전달하며 토큰을 저장하거나 기록하지 않습니다.

```bash
supabase functions deploy naver-userinfo --no-verify-jwt
```

Supabase Authentication의 Custom OAuth Providers에서 다음 값으로 OAuth2 provider를 만듭니다.

- Identifier: `custom:naver`
- Authorization URL: `https://nid.naver.com/oauth2.0/authorize`
- Token URL: `https://nid.naver.com/oauth2.0/token`
- UserInfo URL: `https://PROJECT_REF.supabase.co/functions/v1/naver-userinfo`
- Client ID / Secret: Naver Developers에서 발급한 값
- PKCE: 활성화 — Supabase가 생성한 `code_challenge`를 Naver가 정상 처리하는 것을 실제 로그인으로 확인
- Email optional: 활성화 — 사용자가 이메일 제공에 동의하지 않아도 Naver 고유 ID로 로그인 가능

Custom provider 생성 화면에 표시된 Callback URL을 Naver 애플리케이션의 Callback URL로 등록합니다.

세 provider의 실제 로그인을 모두 확인한 뒤 Anonymous Sign-Ins와 Email은 비활성화합니다. GitHub provider는 관리자 전용으로 활성화하되 일반 바다 RPC는 계속 `google`, `apple`, `custom:naver` identity만 허용합니다. 일반 로그인은 브라우저 공용 저장소를 사용하고 GitHub 관리자 로그인은 OAuth를 시작한 탭의 `sessionStorage`를 사용합니다.

### 기존 사용자 전체 초기화

`202607170005_social_auth_providers.sql`을 먼저 적용한 뒤 `202607170006_reset_users_for_social_auth.sql`을 적용합니다. 두 번째 마이그레이션은 모든 병편지와 번역 캐시, 공개 프로필, 관리자 포함 Auth 사용자·identity·session을 영구 삭제하며 복구할 수 없습니다. Provider 설정과 프런트엔드 배포가 준비된 뒤 한 번만 실행합니다.

### 202607160003 적용 이력

`202607160003_country_origin_demo_reset.sql`은 국가·발신 국가 필드를 추가하면서 출시 전 데이터를 한 차례 정리한 과거 마이그레이션입니다. 신규 환경에서 전체 마이그레이션을 다시 적용하면 이 시점에 기존 메시지와 관리자 이외의 Auth/프로필 계정이 삭제되므로 주의해야 합니다.

`202607160007_admin_operations_and_message_states.sql`에서 데모 초기화 RPC를 제거하고 운영 상태 모델과 관리자 작업 RPC로 대체합니다.

`202607160008_admin_permanent_deletion.sql`부터 관리자 사용자 삭제는 Auth 계정, 프로필, 작성·수신·재표류 관련 메시지를 모두 영구 삭제합니다. 일반 사용자의 메시지 버리기와는 달리 복구할 수 없는 운영 작업입니다.

## 현재 설계의 범위

신고 시 메시지를 즉시 `reported`로 바꾸고 `report_count`를 올릴 수 있지만, 신고 사유·신고자별 중복 방지·처리 이력은 보존하지 않습니다. 관리자 신고 검토를 구현할 때는 `reports`와 `admin_audit_logs`를 별도 테이블로 추가하는 것이 맞습니다. AI 검사 결과도 운영 시 별도 비공개 테이블로 분리하는 편이 안전합니다.

일반 사용자는 Google, Apple, Naver 중 하나로 로그인해야 하며 외부 identity와 이메일은 편지 데이터나 수신자에게 노출하지 않습니다. 지원 provider 검사는 브라우저뿐 아니라 DB 함수에서도 다시 수행합니다.

## 관리자 조회

`admin_dashboard`와 관리자 작업 RPC는 호출자의 `public.users.role`, `status`, GitHub identity를 서버에서 확인한 뒤에만 통계 조회나 변경을 수행합니다. 사용자 삭제, 발신·수신 초기화, 메시지 즉시 도달 가능 처리를 일반 사용자가 직접 호출할 수 없습니다.

GitHub provider를 활성화하고 `#/admin`으로 최초 로그인한 뒤 관리자 페이지에 표시되는 GitHub Auth 사용자의 UID로 SQL Editor에서 다음 쿼리를 실행합니다.

```sql
update public.users
set role = 'admin'
where id = '관리자로 지정할 UID';
```

일반 사용자의 버리기는 메시지 행을 물리 삭제하지 않습니다. 관리자 화면의 `완전 삭제`는 별도의 권한 검증 RPC로 사용자·관련 메시지 또는 개별 메시지를 데이터베이스에서 영구 삭제하므로 복구할 수 없습니다.

완전 삭제된 사용자의 기존 JWT가 아직 만료되지 않았더라도 서버는 Auth 계정 존재 여부를 확인해 `ACCOUNT_DELETED`로 거부합니다. 클라이언트는 로컬 세션을 제거하고 소셜 로그인 화면으로 돌아가므로 삭제된 UUID가 다시 생성되지 않습니다.

## 비용과 이전성

2026-07-14 기준 Supabase Free는 PostgreSQL 500MB, 월간 활성 사용자 50,000명, egress 5GB를 포함하며 1주 비활성 프로젝트는 일시 중지됩니다. 관리형 서비스에서 시작한 뒤 SQL dump를 PostgreSQL 또는 Docker 기반 self-hosted Supabase로 복원할 수 있습니다. self-hosting 이후에는 서버 보안, 백업, 모니터링을 직접 책임져야 합니다.

Firebase Firestore도 저장 1GiB, 일 50,000 reads와 20,000 writes의 무료 쿼터가 있습니다. 다만 안전한 서버 함수 배포는 Blaze 종량제로 운영해야 하며, Firestore 문서 모델에서 PostgreSQL로 옮길 때 데이터·쿼리 계층을 다시 설계해야 합니다.

## 공식 참고자료

- [Supabase 요금](https://supabase.com/pricing)
- [Supabase 소셜 로그인](https://supabase.com/docs/guides/auth/social-login)
- [Supabase Custom OAuth/OIDC provider](https://supabase.com/docs/guides/auth/custom-oauth-providers)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Docker self-hosting](https://supabase.com/docs/guides/self-hosting)
- [Firebase Firestore 요금](https://firebase.google.com/docs/firestore/pricing)
- [Firebase Cloud Functions 할당량과 Blaze 요금제](https://firebase.google.com/docs/functions/quotas)
