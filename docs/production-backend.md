# 운영 데이터베이스 설계

## 현재 결정: Supabase PostgreSQL

GitHub Pages는 정적 파일만 배포하지만, 브라우저에서 Supabase Auth와 Data API를 HTTPS로 호출할 수 있습니다. 현재 단계에서는 다음 구성이 가장 단순합니다.

```text
GitHub Pages (React)
  └─ Supabase
      ├─ Anonymous Auth (추후 Google/Apple 계정 연결)
      ├─ PostgreSQL
      │   ├─ public.users
      │   └─ public.messages
      └─ RPC + RLS (발송, 배정, 열기, 처리)
```

Firebase도 무료 쿼터와 정적 웹 지원이 좋아 빠른 MVP에 적합합니다. 다만 이 서비스는 발신 UID를 숨긴 채 메시지를 원자적으로 배정하고, 향후 관리자 통계와 Docker 이전을 고려해야 합니다. PostgreSQL 함수, 트랜잭션, RLS를 그대로 쓸 수 있는 Supabase가 현재 요구에 더 잘 맞습니다.

## 테이블

### public.users

Supabase Auth의 `auth.users.id`와 같은 UUID를 기본 키로 사용합니다. 바다, 언어, 상태, 일일 발송량, 다음 수신 시각, 현재 잡은 메시지 ID를 저장합니다. 로그인 제공자와 토큰은 이 테이블이 아니라 Supabase Auth가 관리합니다.

### public.messages

본문, 서명, 바다, 작성자 UID와 함께 표류·예약·보관·격리 상태를 저장합니다. 수신자와 예약 만료 시각도 같은 행에 두어 현재는 두 테이블만으로 동작합니다.

브라우저에는 두 테이블의 직접 읽기·쓰기 권한이 없습니다. `ocean_*` DB 함수만 `authenticated` 역할에 공개하며, 함수가 `auth.uid()`와 행 잠금을 확인합니다. 따라서 일반 사용자가 API 요청을 조작해도 다른 사용자의 UID나 미개봉 본문을 직접 조회할 수 없습니다.

## 설치

1. Supabase에서 프로젝트를 만듭니다.
2. Authentication 설정에서 Anonymous Sign-Ins를 활성화합니다.
3. SQL Editor에서 [`202607140001_initial_ocean.sql`](../supabase/migrations/202607140001_initial_ocean.sql)을 실행합니다. Supabase CLI를 사용한다면 `supabase db push`로 적용해도 됩니다.
4. `.env.example`을 `.env.local`로 복사하고 Project URL과 publishable key를 입력합니다.
5. `npm run check`와 `npm run dev`로 확인합니다.

환경변수가 없으면 앱은 기존 로컬 데모로 자동 실행됩니다. `service_role` 키와 DB 비밀번호는 브라우저, `.env`, GitHub Pages 빌드에 절대 넣지 않습니다. 클라이언트에는 publishable key만 사용합니다.

GitHub Pages 운영 빌드에는 저장소의 Actions secrets에 아래 값을 등록합니다.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

## 현재 두 테이블 설계의 범위

신고 시 메시지를 즉시 `quarantined`로 바꾸고 `report_count`를 올릴 수 있지만, 신고 사유·신고자별 중복 방지·처리 이력은 보존하지 않습니다. 관리자 신고 검토를 구현할 때는 `reports`와 `admin_audit_logs`를 별도 테이블로 추가하는 것이 맞습니다. 번역 캐시나 AI 검사 결과도 운영 시 별도 비공개 테이블로 분리하는 편이 안전합니다.

익명 로그인은 브라우저 데이터를 지우면 계정을 복구할 수 없고 제재 우회가 쉽습니다. 공개 범위를 넓히기 전 CAPTCHA/Turnstile을 켜고, Google 또는 Apple 계정 연결을 추가해야 합니다.

## 비용과 이전성

2026-07-14 기준 Supabase Free는 PostgreSQL 500MB, 월간 활성 사용자 50,000명, egress 5GB를 포함하며 1주 비활성 프로젝트는 일시 중지됩니다. 관리형 서비스에서 시작한 뒤 SQL dump를 PostgreSQL 또는 Docker 기반 self-hosted Supabase로 복원할 수 있습니다. self-hosting 이후에는 서버 보안, 백업, 모니터링을 직접 책임져야 합니다.

Firebase Firestore도 저장 1GiB, 일 50,000 reads와 20,000 writes의 무료 쿼터가 있습니다. 다만 안전한 서버 함수 배포는 Blaze 종량제로 운영해야 하며, Firestore 문서 모델에서 PostgreSQL로 옮길 때 데이터·쿼리 계층을 다시 설계해야 합니다.

## 공식 참고자료

- [Supabase 요금](https://supabase.com/pricing)
- [Supabase 익명 로그인](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Docker self-hosting](https://supabase.com/docs/guides/self-hosting)
- [Firebase Firestore 요금](https://firebase.google.com/docs/firestore/pricing)
- [Firebase Cloud Functions 할당량과 Blaze 요금제](https://firebase.google.com/docs/functions/quotas)
