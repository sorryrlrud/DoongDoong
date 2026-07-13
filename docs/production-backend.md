# 운영 백엔드 설계

## 결정

GitHub Pages는 HTML, CSS, JavaScript만 제공하는 정적 호스팅이므로 공용 파일시스템·메시지 큐·비밀 API 키를 둘 수 없습니다. 실제 무작위 전달은 Firebase를 별도 백엔드로 사용합니다.

```text
GitHub Pages (React)
  ├─ Firebase Anonymous Auth
  ├─ Firebase App Check
  └─ HTTPS Callable Functions
       ├─ Firestore transaction
       ├─ quota / cooldown / moderation
       ├─ random bottle reservation
       ├─ report / ban audit
       └─ OpenAI provider (server secret only)
```

Cloud Functions 배포에는 Firebase Blaze 요금제와 결제 계정 연결이 필요합니다. Firebase 프로젝트 ID, 웹 앱 설정, App Check site key가 준비되기 전에는 운영 모드를 활성화하지 않습니다.

## 외부 스키마

클라이언트가 보는 계약은 `OceanGateway`입니다.

- `getSnapshot()`
- `sendBottle(draft)`
- `catchBottle()`
- `openBottle(id)`
- `resolveBottle(id, redrift | keep | discard | report)`
- `updateSea(seaId)`

클라이언트는 후보 병 목록, 작성자 UID, 신고 수, 재표류 이력을 직접 읽지 않습니다.

## 개념 스키마

### users/{uid}

| 필드 | 형식 | 설명 |
|---|---|---|
| seaId | enum | 수신 바다 |
| nextCatchAt | timestamp | 다음 건지기 시각 |
| dailySendDate | YYYY-MM-DD | 일일 쿼터 기준일 |
| dailySendCount | integer | 0~2 |
| activeBottleId | nullable id | 현재 예약된 한 병 |
| status | active / suspended / banned | 이용 상태 |

### bottles/{bottleId}

| 필드 | 형식 | 설명 |
|---|---|---|
| body | string | 10~1,000자 본문 |
| signature | nullable string | 20자 이하 서명 |
| dateLabel | nullable string | 작성자가 선택한 날짜 |
| seaId | enum | 띄운 바다 |
| status | drifting / reserved / kept / quarantined | 현재 상태 |
| availableAt | timestamp | 배정 가능 시각 |
| reservedTo | nullable uid | 현재 수신자 |
| reservedUntil | nullable timestamp | 24시간 예약 만료 |
| driftCount | integer | 서버 전용 재표류 횟수 |
| expiresAt | nullable timestamp | 보관 만료 시각 |

### bottlePrivateMeta/{bottleId}

| 필드 | 형식 | 설명 |
|---|---|---|
| authorUid | uid | 신고 제재를 위한 작성자 |
| reportCount | integer | 고유 신고자 기준 누적 |
| moderation | object | provider·정책 버전·결과 |
| createdAt | timestamp | 감사 기준 시각 |

### reports/{reportId}

`bottleId`, `reporterUid`, `authorUid`, `reason`, `createdAt`, `reviewStatus`를 저장합니다. `(bottleId, reporterUid)`는 논리적으로 유일해야 합니다.

## 내부 스키마와 인덱스

- `bottles`: `(seaId, status, availableAt)` 복합 인덱스
- `bottles`: `(reservedTo, status)` 복합 인덱스
- `bottles`: `(reservedTo, expiresAt)` 복합 인덱스
- `reports`: `(authorUid, createdAt)` 복합 인덱스
- `users`: 문서 ID를 Firebase Auth UID로 사용

병 본문과 비공개 메타데이터는 클라이언트 Firestore 읽기·쓰기를 전부 거부합니다. Callable Function의 Admin SDK만 접근합니다. Firestore Rules는 필터가 아니며 문서의 특정 필드만 숨길 수도 없기 때문입니다.

## 트랜잭션과 일관성

핵심 작업은 한 Callable Function 요청 안에서 하나의 Firestore transaction으로 처리합니다.

- 병 건지기: 사용자 쿨다운 확인 → 후보 선택 → 병 예약 → 사용자 activeBottle 갱신
- 발송: 정지·쿼터 확인 → 사전 검사 성공 → 병과 private meta 생성 → 쿼터 증가
- 처리: 소유 예약 확인 → 병 상태 변경 → activeBottle 해제
- 신고: 고유 신고 생성 → 병 격리 → 작성자 누적과 상태 갱신

Firestore transaction의 ACID 범위 안에서 한 병이 두 명에게 동시에 배정되지 않도록 합니다. 후보 조회의 무작위성은 완전 균등보다 오래 기다린 병과 재표류 병을 우선하는 가중 선택을 사용합니다. 여러 지역의 읽기 복제본에는 짧은 지연이 있을 수 있지만, 상태 변경은 서버 transaction 결과를 기준으로 합니다.

## 만료

UI와 읽기 함수는 `expiresAt <= now`인 병을 즉시 숨깁니다. Firestore TTL은 물리 정리용이며 삭제가 최대 약 24시간 늦을 수 있으므로 제품 의미의 만료 판단에 사용하지 않습니다.

## AI provider

```ts
interface SafetyProvider {
  check(body: string, signature?: string): Promise<SafetyResult>;
}

interface TranslationProvider {
  translate(text: string, targetLanguage: string): Promise<string>;
}
```

권장 운영 순서:

1. 결정론적 필터로 전화번호, 이메일, URL, SNS ID, 반복 스팸을 차단
2. 무료 `omni-moderation-latest`로 유해성 범주 분류
3. 필요할 때만 `gpt-5-nano` Structured Outputs로 서비스 고유 정책을 2차 판정
4. 번역 요청도 `gpt-5-nano`를 사용하되 언어별 품질 평가 후 노출

OpenAI 키는 Firebase Secret Manager에만 저장합니다. 검사 provider 장애 시에는 fail-closed로 발송을 중단하며 쿼터를 차감하지 않습니다.

## 용량 초안

초기 1,000 DAU, 사용자당 하루 평균 발송 0.5병·수신 1병을 가정하면 하루 신규 병 500개, 병 상태 변경 약 2,000~3,000 writes, snapshot·건지기·보관함 합계 약 5,000~10,000 reads 규모입니다. 실제 공개 전에는 payload 크기, 신고 보존 기간, Functions 호출·AI 토큰 비용을 부하 시험으로 다시 산정합니다.

## 결정 기록

- Pages 단독 저장소는 공용 서비스 요구를 충족하지 못하므로 데모에만 사용한다.
- 익명 Auth는 UX에는 맞지만 브라우저 초기화로 제재를 우회할 수 있어 공개판에서는 비공개 계정 연결 또는 기기 신뢰 정책을 추가 검토한다.
- 보낸 기록은 사용자에게 노출하지 않되, 신고 제재를 위해 작성자 UID는 private meta로 보존한다.
- 모든 UGC 사전 검사가 준비되기 전에는 데모 시드 외의 글을 다른 사용자에게 전달하지 않는다.

## 공식 참고자료

- [GitHub Pages 개요](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Firebase Anonymous Auth](https://firebase.google.com/docs/auth/web/anonymous-auth)
- [Firebase Callable Functions](https://firebase.google.com/docs/functions/callable)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Firestore security](https://firebase.google.com/docs/firestore/security/overview)
- [OpenAI Moderation](https://developers.openai.com/api/docs/guides/moderation)
- [OpenAI API key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety)
