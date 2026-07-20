# 계정 삭제(회원 탈퇴) 설계

> 2026-07-20. App Store Guideline 5.1.1(v) — 계정 생성이 가능한 앱은 **앱 안에서** 계정 삭제가 가능해야 한다.
> 현재 PlanQ 에는 탈퇴 기능이 전혀 없다(라우트·UI 0건). 스토어 제출을 막는 유일한 코드 항목.
>
> **★ Fable v2(CONDITIONAL PASS) 반영 v3** — 아래 §정정. 초판 🔴5건(v2 반영) + v2 재게이트 🔴2건·🟠8건(v3 반영). FK 실태 교정(RESTRICT 39개 / audit_logs.user_id 는 SET NULL).

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
| **D5** | ~~미수금·활성 구독 차단~~ → **preflight 경고로 강등**(차단 아님) | Fable: Apple "삭제는 straightforward" 요구와 충돌 = 리젝 위험. 유일 owner 차단(D1)이 이미 워크스페이스 정리를 강제해 중복. 거래기록은 계정과 무관하게 invoices/clients row 에 보존 |
| **D6** | **Q Note 개인 세션·음성 지문은 전량 삭제** | 개인 사적 공간(`feedback_qnote_personal_tool`) + 생체 정보. 보관 명분 없음 |
| **D7** | 탈퇴 전 **셀프 데이터 반출을 강제하지 않되 강하게 안내** (모달에서 `/settings/data-export` 링크 + "반출했습니다" 체크) | 강제하면 이탈 마찰. 안내 없이 삭제하면 분쟁 |
| **D8** | **1인(솔로) 워크스페이스는 동반 soft-delete** | Fable 🔴1: 워크스페이스 삭제 라우트가 없어 솔로 owner 는 이전 대상도 삭제 방법도 없다 = 탈퇴 불가 = 리젝. **다른 human 멤버·client·미수금 0 인 워크스페이스만** 동반 삭제. 데이터 있는 워크스페이스는 이전 강제(범용 삭제 기능은 안 만듦 — 스코프 최소화) |
| **D9** | **OAuth 전용 계정은 이메일 OTP 로 본인확인** | Fable 🔴3: Google 가입자는 password_hash 가 sentinel(`$2a$12$oauth_no_password_set`, auth_oauth.js:228)이라 비밀번호 재확인 영구 실패 = OAuth 사용자만 탈퇴 불가. 기존 secondary_email OTP 흐름 재사용 |

## 상태 모델

```
active ──탈퇴요청──> deleted(+deletion_scheduled_at=+30d)  ──30일 경과(cron)──> 익명화 완료(anonymized_at)
   ^                          │
   └────본인 재로그인 복구─────┘   (유예 중에만. 익명화 후 복구 불가)
```

- `users.status='deleted'` 진입 즉시: 로그인 차단(auth.js:58 기존) · refresh/api 토큰 purge · push 구독 해제 · `user:N` socket 강제 disconnect · 진행 중 세션 종료
- **유예 중 복구는 공개 라우트로만 가능** (Fable 🔴2 — auth.js:58/511 이 deleted 를 403 처리해 인증 토큰을 못 얻으므로, 인증 필요한 deletion-cancel 은 자기모순):
  - `POST /api/auth/deletion-recover` **(공개, login 과 동일 5회/15분 rate-limit — Fable 🟠2)** — 이메일+비밀번호(OAuth 는 이메일 OTP, D9) 재인증 → `status='deleted' && deletion_scheduled_at > NOW()` 이면 복원
  - **★ 🔴B(Fable) — 복구는 반쪽이면 안 된다.** deletion-request 가 membership 을 `removed_at` 마크하고 솔로 워크스페이스를 동반 삭제하므로, 복구는 status 만 되살리면 **모든 워크스페이스에서 쫓겨난 상태**가 된다. 복구 시 원복:
    - `status='active'`, `deletion_scheduled_at`/`deletion_requested_at` NULL
    - 이 탈퇴로 removed 된 membership 원복 — 구분 마커 필요: **`business_members.removed_reason='account_deletion'`** 컬럼 신설(마이그레이션에 추가). 복구 시 `removed_reason='account_deletion' AND removed_at >= deletion_requested_at` 인 row 만 `removed_at=NULL, removed_reason=NULL`. (원래 다른 이유로 제거된 membership 은 안 되살림)
    - 동반 삭제된 솔로 워크스페이스 `businesses.deleted_at=NULL` 복원
  - 로그인 라우트(auth.js:511)에 `status='deleted' && 유예중` 특례: 403 대신 **`code:'account_deleted_pending'`** (비밀번호 검증 통과 후 노출 — enumeration 방지, Fable 🟠3). suspended 는 기존 `account_suspended` 유지

## 스키마 변경 (멱등 마이그레이션)

```sql
ALTER TABLE users
  ADD COLUMN deletion_requested_at DATETIME NULL,
  ADD COLUMN deletion_scheduled_at DATETIME NULL,
  ADD COLUMN anonymized_at DATETIME NULL;
-- ★ 🔴A(Fable, 코드 확인) — businesses 에 soft-delete 컬럼이 없다(subscription_status ENUM 만).
--   D8 동반 삭제가 구현 불가였다. deleted_at 추가.
ALTER TABLE businesses
  ADD COLUMN deleted_at DATETIME NULL;
-- ★ 🔴B — 복구 시 "이 탈퇴로 removed 된 membership"만 되살리기 위한 구분 마커.
ALTER TABLE business_members
  ADD COLUMN removed_reason VARCHAR(40) NULL;
```
`users.status` ENUM 은 이미 `'deleted'` 포함 — 변경 불필요.

**`businesses.deleted_at` 영향 범위 (전부 `deleted_at IS NULL` 필터 추가 필요 — 누락 시 좀비 워크스페이스 노출):**
- `middleware/access_scope.js`(checkBusinessAccess) · 워크스페이스 목록/조회 라우트
- 정기청구 cron(`clientSubscriptionBilling`) · overdue cron · 주간보고 cron — 삭제된 워크스페이스 제외
- socket business room join
- 동반 삭제되는 워크스페이스의 **Cue 계정**(`is_ai=true`, `cue_user_id`)도 status='deleted' 마크 (익명화 cron 은 `is_ai=false` 만 돌아 방치되면 좀비 — Fable). 단 익명화(PII)는 불필요(시스템 계정).

## 익명화 대상 (PII 마스킹) — ★ Fable 🔴5 반영: users 만으론 부족

**users**: `name` → `탈퇴한 사용자`, `email` → `deleted-{id}@deleted.planq.kr`(UNIQUE 충돌 방지), `username` → `deleted_{id}`, 그리고 NULL 처리: `phone`·`avatar_url`·`bio`·`secondary_email`·`pending_email`·`pending_secondary_email`·`name_localized`·`expertise`·`organization`·`job_title`·`language_levels`·`answer_style_default`·`timezone`·`reference_timezones`·`email_verify_token`·`answer_length_default`. 비밀번호 해시 무효화. `refresh_token`·`*_reset_token`·`*_otp_hash` 전량 NULL.
  - avatar 는 `avatar_url` NULL 로 충분(Fable 교정 — 업로드 라우트 0건, 값은 Google picture 외부 URL 또는 /static/cue.svg. File dedup 무관). 향후 아바타 업로드 도입 시 물리파일 삭제 추가.
  - username UNIQUE 불변 가드(users.js:128-143)는 **PUT 라우트 내부 silently-ignore** 라 cron 의 직접 model.update 는 안 걸림(Fable 확인).

**business_members** (워크스페이스별 프로필 — users 만 익명화하면 화면에 실명 잔존): 그 user 의 모든 membership row 의 `name`·`name_localized`·`bio`·`expertise`·`organization`·`job_title` → NULL.

**clients** (Client 는 users row 를 가짐 — `clients.user_id` FK 실존): 탈퇴자가 Client 로 연결된 row 의 `display_name` → `탈퇴한 고객`, `display_name_localized`·`invite_email` → NULL.

**conversations** (★ 🟠6, Fable 코드 확인): `clientOnboarding.js:46` 이 `client.display_name` 을 대화방 제목(`conversations.title`)에 **박제**한다. clients 만 마스킹하면 대화 목록에 실명 잔존 → 탈퇴자가 Client 인 conversations 의 title 도 마스킹.
  - Message/TaskComment/ProjectNote 에는 작성자명 캐시 컬럼 **없음**(Fable 확인) — join 표시라 users 익명화로 충분.

purge(행 삭제): `refresh_tokens` · `api_tokens` · `push_subscriptions` · `oauth_connections` · `external_connections` · `email_accounts`(+연쇄 email_threads/messages/첨부 물리파일 — CASCADE 범위 구현 시 실측) · `notification_prefs`
삭제: 개인 자산 L1(D4) · Q Note 전량(D6)
보존(작성자만 익명 표시): 메시지 · 댓글 · 업무 · 감사 로그. `email_logs.to_email`·`audit_logs` JSON 내 과거 이름/이메일은 보존(감사 목적) — 트레이드오프 명시, 보관기한은 별도 정책.

## 신규 API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/users/me/deletion-preflight` | **차단 사유**(= 유일 owner 인데 데이터 있는 워크스페이스 → 이전 필요 / 유일 활성 platform_admin) + **경고**(미수금·활성 구독 = 차단 아님, D5) + 삭제될 데이터 요약 + 동반 삭제될 솔로 워크스페이스 목록(D8) |
| POST | `/api/users/me/deletion-request` | 비밀번호 재확인(OAuth 는 이메일 OTP, D9) → `status='deleted'` + 30일 예약. 토큰 purge + socket disconnect. 솔로 워크스페이스 동반 soft-delete(D8). **`is_ai=true` → 400**(Cue 계정 보호). AuditLog `user.deletion_request` |
| POST | `/api/auth/deletion-recover` | **공개** — 유예 중 복구 (위 상태모델. 인증 불필요) |
| POST | `/api/businesses/:id/transfer-ownership` | **신규(부재 기능)** — `owner_id` + BusinessMember.role 동시 변경. owner 만. 대상은 활성 member. `FOR UPDATE` 락 + 트랜잭션 + AuditLog |
| POST | `/api/internal/qnote/purge-user` | q-note FastAPI — 세션·발화·요약·문서·화자·**음성 지문** 삭제 (내부 공유시크릿). 실패 카운트+재시도 상한(cross-DB 라 트랜잭션 밖) |

**차단 조건 (preflight `blockers`)**:
1. 유일 owner + (다른 human 멤버 OR client OR 미수금 invoice OR **유료 활성 구독**) 있는 워크스페이스 → `transfer_required`
   - ★ 🟠1(Fable, 코드 확인) — 신규 가입 기본값이 `subscription_status='trialing'`(businesses.js:100·auth.js:374). trialing 을 "활성"으로 세면 **모든 신규 가입자가 탈퇴 불가** = 초판 결함 재발. **"활성 = subscription_status IN ('active','past_due')" 만** (trialing·canceled 제외). "데이터 있는 워크스페이스"의 다른 조건(멤버·client·미수금)도 함께 판정하므로, 결제 이력 없는 순수 솔로 trial 가입자는 D8 동반삭제로 탈퇴 가능해야 한다.
2. 유일한 활성 platform_admin → `last_platform_admin` (관리 주인 없음 방지)

**경고 조건 (`warnings`, 차단 아님)**: 미수금 청구서, 활성 구독 (D5).

**membership 처리 (Fable 보완)**: deletion-request 시점에 그 user 의 모든 `business_members.removed_at=NOW()` 마크(유예 중 멤버 목록·업무 배정 후보에서 제외). 담당 업무(`tasks.assignee_id` — SET NULL FK)는 익명화 cron 에서 처리 안내.

cron: 일 1회 `status='deleted' AND deletion_scheduled_at <= NOW() AND anonymized_at IS NULL AND is_ai=false` → 익명화 실행 (단계별 멱등, anonymized_at 은 전 단계 성공 후 최후 기록).

## 프론트

- **진입점**: `/profile` 최하단 **Danger Zone** (워크스페이스 설정이 아니라 개인 설정이 맞다)
- 확인 모달: `components/Common/ConfirmDialog.tsx` `variant='danger'` 재사용 + **이메일 타이핑 확인**(신규 — 현재 이 패턴 없음) + 비밀번호 재입력
- 차단 사유가 있으면 삭제 버튼 비활성 + 사유별 해소 링크(소유권 이전 / 청구서 / 구독)
- 소유권 이전 UI: 워크스페이스 설정 멤버 탭
- i18n ko/en 전량. `window.confirm` 금지 준수

## 검증 계획

- preflight — 데이터 있는 유일 owner → `transfer_required` 차단 / 유일 platform_admin → 차단 / 미수금·구독은 **warning(차단 아님)** 확인
- **솔로 워크스페이스(데이터 0) owner 탈퇴 → 동반 soft-delete + 탈퇴 성공**(D8 — 이전 대상 없어도 막히지 않음)
- 소유권 이전 → 원 owner 가 member 로, 신 owner 가 owner 로. 트랜잭션 롤백 확인
- 탈퇴 요청 → 즉시 로그인 `code:'account_deleted_pending'` · refresh 토큰 무효 · push 구독 0 · membership removed
- **유예 중 복구 (공개 라우트)** → 정상 로그인 복원. OAuth 계정은 이메일 OTP 경로
- **OAuth 전용 계정 탈퇴(비번 없음) → 이메일 OTP 로 성공**(D9 — 초판은 이들 영구 탈퇴 불가였음)
- **is_ai(Cue) 계정 탈퇴 시도 → 400**
- 익명화 cron → users + **business_members + clients** PII 마스킹(초판은 users 만) + avatar 물리파일 삭제 + 메시지 작성자 "탈퇴한 사용자" 표시되되 **본문·업무 보존**
- Q Note purge → 세션·voice_fingerprints 0
- **멀티테넌트**: 타인 계정 삭제 시도 403, 다른 워크스페이스 데이터 무영향
- **불변식 가드**(guard 계열): status='deleted'+anonymized_at 있으면 users/business_members/clients 에 원본 PII 잔존 0 — 일부러 남겨서 검출 확인([[feedback_guard_must_be_falsified]])
- 전량 원복(테스트 계정 신규 생성 후 진행, 기존 계정 미사용)

## 규모·게이트
**대** — 신규 시스템 + DB 마이그레이션 + cross-service(q-note) + 보안 경계(인증 상태 전이·공개 복구 라우트). **Fable 게이트 대상**(기준 3·4·5). 구현 후 재게이트 필수.
**구현 순서**(Fable): ①소유권 이전 + 솔로 워크스페이스 동반삭제(독립) → ②users 3컬럼 마이그레이션 + preflight/request + **공개 복구 라우트** + auth code 분기 → ③즉시차단 묶음(토큰 purge·socket disconnect·membership) → ④익명화 cron(users+business_members+clients) + L1 삭제 + q-note purge → ⑤프론트 Danger Zone·이전 UI·i18n → ⑥불변식 가드 + 실HTTP(OAuth·복구·솔로 포함) → Fable 재게이트

## 위험

① 익명화가 부분 실패하면 PII 가 남는다 → 단계별 멱등 + 실패 시 재시도, `anonymized_at` 은 전 단계 성공 후에만 기록
② Q Note 는 cross-DB 라 트랜잭션 밖 → 실패해도 재시도되게 큐/재실행 가능하게 + 재시도 상한
③ 소유권 이전 중 동시성 → `FOR UPDATE` (기존 `businesses.js:1194` 패턴)
④ `email`/`username` UNIQUE 충돌 → `deleted-{id}@`·`deleted_{id}` 로 id 기반 유일성 보장
⑤ socket·q-note 인증은 status 를 안 봄(JWT decode 만) → access token 15분 창 동안 deleted 가 접근 가능. 요청 시점 `user:N` 강제 disconnect 로 완화(15분 잔여 위험 수용). Fable 보완.
⑥ Apple 정책: 앱 내 개시 + 소요기간 고지 시 예약 삭제 허용(2022 가이드) — 모달에 **"30일 후 영구 삭제" 명시 필수**. 정책 원문 재확인 못 함 = 구현 시 확인.

## Fable 정정 이력
**v2 (초판 🔴5건)**: 🔴1 솔로 탈퇴불가→D8 · 🔴2 복구 자기모순→공개라우트+code · 🔴3 OAuth→D9 OTP · 🔴4 미수금차단→경고강등 · 🔴5 익명화구멍→business_members/clients.

**v3 (v2 재게이트 — 코드로 확인된 것만 반영)**:
- 🔴A `businesses.deleted_at` 부재 → 스키마 추가 + 영향범위(access_scope·cron·socket·Cue계정)
- 🔴B 복구 반쪽 → membership 원복(`removed_reason='account_deletion'` 컬럼) + 워크스페이스 복원
- 🟠1 trialing 지뢰 → "활성구독 = active/past_due 만"
- 🟠6 conversations.title 스냅샷 → 마스킹 대상 추가

**구현 시 확인 (Fable 미확인/트레이드오프 — 설계 부풀리지 않음)**:
- OTP 컬럼: `secondary_email_otp_*` 재사용 시 진행 중 인증과 hash 충돌 가능 → 별도 컬럼/purpose. 공개 OTP 발송 라우트는 rate-limit+enumeration 방지.
- `signature_requests.signer_email/name`, `clients.billing_contact_*/tax_invoice_email`: 법적·세무 보존 대상일 수 있음 → 보존/마스킹은 구현 시 법무 확인(email_logs·audit 와 동일 트레이드오프).
- Apple 30일 예약삭제 정책 원문 재확인.
