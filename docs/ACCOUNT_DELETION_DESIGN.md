# 계정 삭제(회원 탈퇴) 설계

> 2026-07-20. App Store Guideline 5.1.1(v) — 계정 생성이 가능한 앱은 **앱 안에서** 계정 삭제가 가능해야 한다.
> 현재 PlanQ 에는 탈퇴 기능이 전혀 없다(라우트·UI 0건). 스토어 제출을 막는 유일한 코드 항목.

## 조사에서 확정된 제약

1. **하드 삭제 불가.** `users` 를 참조하는 FK 가 93개 association / 66개 모델에 있고, **onDelete 미지정 = MySQL 기본 RESTRICT 가 약 78개**다. `User.destroy()` 는 FK 에러로 실패한다. → **soft delete + PII 익명화가 유일한 설계.**
2. **감사 로그가 users FK(RESTRICT)를 잡고 있다.** `AuditLog.user_id`. 탈퇴 이력을 남기려면 users row 를 지우면 안 된다 — soft delete 근거가 규정 쪽에서도 성립.
3. **`users.status ENUM('active','suspended','deleted')` 에 `'deleted'` 가 이미 있다.** 현재 아무 코드도 쓰지 않는다. `middleware/auth.js:58` 이 `status !== 'active'` 면 403 → **상태만 바꿔도 즉시 전면 차단**된다. 재사용.
4. **워크스페이스 소유권 이전 기능이 없다.** `businesses.owner_id` 를 바꾸는 라우트 0건. 탈퇴의 선행 조건이므로 **이번에 같이 만든다.**
5. **Q Note 는 별도 FastAPI + SQLite**(`q-note/data/qnote.db`). Node 트랜잭션에 못 들어간다. 생체 정보(`voice_fingerprints`, `speaker_embeddings`)가 있어 삭제 대상 1순위. 브릿지(`routes/qnote_bridge.js`)는 qnote.db 에 접근하지 않으므로 **FastAPI 측 삭제 엔드포인트 신규 필요.**
6. **반출은 이미 다 있다.** `routes/export.js` 의 `me/export-job`·`me/transfer-job`(copy/move, 파일 dedup ref_count 처리 포함) + `models/ExportJob.js`. 탈퇴 앞단에 그대로 붙인다.

## 결정 (Irene 확인 없이 진행하는 기본값 — 다르면 지적해 주세요)

| # | 결정 | 근거 |
|---|------|------|
| **D1** | **유일 owner 인 워크스페이스가 있으면 탈퇴를 차단**하고 "소유권 이전 또는 워크스페이스 삭제" 를 먼저 요구 | 워크스페이스에는 **고객·청구·팀원 데이터**가 있다. 개인 탈퇴가 남의 데이터를 조용히 파괴하면 안 된다. 기존 `businesses.js:1194` 마지막 owner 보호와 같은 사상 |
| **D2** | **30일 유예 후 익명화** (`deletion_scheduled_at`). 즉시 로그인·API 는 차단, 유예 중 본인 재로그인으로 복구 가능 | Apple 은 예약 삭제를 허용한다. 오조작·계정 탈취 후 악의적 삭제 방어. 결제 분쟁 대응 여지 |
| **D3** | **메시지·댓글·업무 이력은 남기고 작성자만 익명화** ("탈퇴한 사용자") | 대화 맥락과 **타인의 업무 기록**이다. 지우면 남의 데이터가 깨진다. RESTRICT FK 구조와도 일치 |
| **D4** | **개인 자산(L1)은 삭제** — `personal_vault` 정의(File visibility='L1' / Post vlevel='L1' / KbDocument scope='private') 그대로 | 온전히 본인 것. `routes/personal_vault.js:22-40` 재사용 |
| **D5** | **미수금 청구서·활성 구독이 있으면 차단** | 돈 문제를 탈퇴로 회피시키지 않는다. 재무 무결성 |
| **D6** | **Q Note 개인 세션·음성 지문은 전량 삭제** | 개인 사적 공간(`feedback_qnote_personal_tool`) + 생체 정보. 보관 명분 없음 |
| **D7** | 탈퇴 전 **셀프 데이터 반출을 강제하지 않되 강하게 안내** (모달에서 `/settings/data-export` 링크 + "반출했습니다" 체크) | 강제하면 이탈 마찰. 안내 없이 삭제하면 분쟁 |

## 상태 모델

```
active ──탈퇴요청──> deleted(+deletion_scheduled_at=+30d)  ──30일 경과(cron)──> 익명화 완료(anonymized_at)
   ^                          │
   └────본인 재로그인 복구─────┘   (유예 중에만. 익명화 후 복구 불가)
```

- `users.status='deleted'` 진입 즉시: 로그인 차단(auth.js:58 기존) · refresh/api 토큰 purge · push 구독 해제 · 진행 중 세션 종료
- 유예 중 복구는 **이메일+비밀번호 재인증**으로만. 복구 시 `status='active'`, `deletion_scheduled_at=NULL`

## 스키마 변경 (`users` 3컬럼)

```sql
ALTER TABLE users
  ADD COLUMN deletion_requested_at DATETIME NULL,
  ADD COLUMN deletion_scheduled_at DATETIME NULL,
  ADD COLUMN anonymized_at DATETIME NULL;
```
`status` ENUM 은 이미 `'deleted'` 포함 — 변경 불필요. 멱등 마이그레이션 스크립트로 적용.

## 익명화 대상 (PII 마스킹)

`users`: `name` → `탈퇴한 사용자`, `email` → `deleted-{id}@deleted.planq.kr`(UNIQUE 충돌 방지), `username` → `deleted_{id}`, `phone`/`avatar_url`/`bio`/`secondary_email` → NULL, 비밀번호 해시 무효화, `refresh_token`/`*_reset_token`/`*_otp_hash` 전량 NULL.

purge(행 삭제): `refresh_tokens` · `api_tokens` · `push_subscriptions` · `oauth_connections` · `external_connections` · `email_accounts` · `notification_prefs`
삭제: 개인 자산 L1(D4) · Q Note 전량(D6)
보존(작성자만 익명 표시): 메시지 · 댓글 · 업무 · 감사 로그

## 신규 API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/users/me/deletion-preflight` | 차단 사유(유일 owner 워크스페이스 / 미수금 / 활성 구독) + 삭제될 데이터 요약 |
| POST | `/api/users/me/deletion-request` | 비밀번호 재확인 → `status='deleted'` + 30일 예약. 토큰 purge. AuditLog `user.deletion_request` |
| POST | `/api/users/me/deletion-cancel` | 유예 중 복구 |
| POST | `/api/businesses/:id/transfer-ownership` | **신규(부재 기능)** — `owner_id` + BusinessMember.role 동시 변경. owner 만. 대상은 활성 member. 트랜잭션 + AuditLog |
| POST | `/api/internal/qnote/purge-user` | q-note FastAPI — 세션·발화·요약·문서·화자·**음성 지문** 삭제 (내부 공유시크릿) |

cron: 일 1회 `deletion_scheduled_at <= NOW() AND anonymized_at IS NULL` → 익명화 실행 (멱등).

## 프론트

- **진입점**: `/profile` 최하단 **Danger Zone** (워크스페이스 설정이 아니라 개인 설정이 맞다)
- 확인 모달: `components/Common/ConfirmDialog.tsx` `variant='danger'` 재사용 + **이메일 타이핑 확인**(신규 — 현재 이 패턴 없음) + 비밀번호 재입력
- 차단 사유가 있으면 삭제 버튼 비활성 + 사유별 해소 링크(소유권 이전 / 청구서 / 구독)
- 소유권 이전 UI: 워크스페이스 설정 멤버 탭
- i18n ko/en 전량. `window.confirm` 금지 준수

## 검증 계획

- preflight 차단 3종(유일 owner·미수금·활성 구독) 각각 실HTTP 403/차단 확인
- 소유권 이전 → 원 owner 가 member 로, 신 owner 가 owner 로. 트랜잭션 롤백 확인
- 탈퇴 요청 → 즉시 로그인 403 · refresh 토큰 무효 · push 구독 0
- 유예 중 복구 → 정상 로그인
- 익명화 cron → PII 마스킹 + 메시지 작성자가 "탈퇴한 사용자" 로 표시되되 **메시지 본문·업무는 보존**
- Q Note purge → 세션·voice_fingerprints 0
- **멀티테넌트**: 타인 계정 삭제 시도 403, 다른 워크스페이스 데이터 무영향
- 전량 원복(테스트 계정 신규 생성 후 진행, 기존 계정 미사용)

## 위험

① 익명화가 부분 실패하면 PII 가 남는다 → 단계별 멱등 + 실패 시 재시도, `anonymized_at` 은 전 단계 성공 후에만 기록
② Q Note 는 cross-DB 라 트랜잭션 밖 → 실패해도 재시도되게 큐/재실행 가능하게
③ 소유권 이전 중 동시성 → `FOR UPDATE` (기존 `businesses.js:1194` 패턴)
④ `email` UNIQUE 충돌 → `deleted-{id}@` 로 id 기반 유일성 보장
