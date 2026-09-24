# 감사 로그 구멍 4곳 — 결정문 (Fable 판정, 2026-09-24)

> 판정관: Fable · 구현: Opus. 이 문서가 정본이다.

## 0. 운영 실측 (planq_prod_db, SELECT 만)

| 지표 | 값 | 뜻 |
|---|---|---|
| `audit_logs` | **1,432행 · 0.6MB** (2026-05-04~) · 30일 589행(≈20/일) | 원장은 작다. 증식 걱정은 «무엇을» 이지 «크기» 가 아니다 |
| `refresh_tokens` 30일 | **21,991행** — `rotated` 21,241 · active 701 · `superseded_undelivered` 41 · **`logout` 8** | 이미 **로그인 원장**이다. 회전 1건마다 감사 행을 쓰면 30일에 현재 원장의 **36배** |
| 신규 로그인(회전 부모 없는 행) 30일 | **737건 · 8명** ≈ 25/일 | 로그인 성공 감사의 실제 부하 |
| 로그인 **실패** | **측정 불가** — 코드가 한 줄도 안 남긴다 | «실패가 몇 번인가» 를 지금은 아무도 모른다 — 그 자체가 구멍 |
| Stripe | `payments` 16행 전부 `stripe_payment_intent` NULL | **웹훅 착지가 운영에서 한 번도 돌지 않았다.** 검증은 서명 이벤트를 만들어 dev 에서 한다 |
| 결제 감사 기존 행 | `payment.mark_paid` 1 · `admin.subscription.mark_paid` 4 · `payment.notify_paid` 3 | 수동 문은 **라우트**에서 쓰고, 서비스는 "감사는 호출자가" 라고 적어 뒀다 — 웹훅이 그 호출자였는데 안 썼다 |
| 역할 변경 감사 | `member_role.change` 0행 | |
| `project_members` | 21행 / 15프로젝트 | 전면 교체 diff 는 작다 |

## A. 로그인 · 로그아웃 · refresh

**남긴다:** `auth.login`(성공) · `auth.login_failed`(계정이 **있는** 실패만) · `auth.logout` · `auth.refresh_reuse`(`stale_reuse` 401 만).
**안 남긴다:** refresh 회전(소음), `no_cookie`·`jwt_invalid`·`expired`, **없는 이메일 실패**(무인증 INSERT + 계정 열거 흔적 — `authWarn` 한 줄만).

- 실패 행은 audit_logs 에 둔다(별도 테이블 금지). `user_id` 가 잡히는 경우만 → 표면은 «존재하는 계정 수 × limiter» 로 유계.
- 싣는 것: `target_type:'User'`, `target_id:user.id`, `ip`, `new_value:{ reason, client_kind }` / 성공 `{ method, client_kind, remember, ua(80자) }`. **이메일·토큰·해시 없음.**
- **`logAudit`(fire-and-forget).** 로그인 가용성이 이긴다 — 확정 원장은 이미 `refresh_tokens`. `writeAudit` 이면 스탬프 실패 하나가 전원 로그인 장애가 된다.
- **`business_id: NULL`** — 계정 사건이다. 보관은 플랫폼 티어.
- **문은 하나:** `services/authAudit.js` (`signInOk` · `signInFail` · `signOut` · `refreshReuse`). 호출부 — `/login` · `/register` 자동로그인 · `oauth/finish.js` · `/logout`(쿠키로 user_id 를 먼저 잡는다) · `/refresh` stale_reuse.
- 대리 로그인(`user.impersonate`)은 이미 `writeAudit` — 건드리지 않는다.

## B. Stripe 웹훅

**감사는 서비스 한 곳 — 라우트가 아니다.** `billing.markPaymentPaid` · `invoicePayments.markInstallmentPaid` · `markInvoicePaid` 안, **트랜잭션 안 `writeAudit(opts, { transaction })`**, `alreadyPaid` 반환 뒤·commit 앞. 수동 문과 웹훅이 같은 함수를 부르므로 이 한 줄이 모든 문을 덮는다. 라우트의 같은 사건 `logAudit` 은 **지운다**(안 지우면 두 줄).

- 이름: `payment.paid` · `invoice.paid` · `invoice.installment.paid`. 옛 이름 행은 역사로 남긴다.
- `new_value:{ method, pg_provider, pg_transaction_id, amount, source:'stripe_webhook'|'manual'|'admin', was_first }`. 웹훅은 `user_id: NULL` + `source`. 호출부가 `actor:{ userId, ip }` 를 넘긴다.
- 왜 트랜잭션 안·writeAudit: 돈이다. 감사 실패 → 롤백 → 결제 pending → 웹훅 500 → Stripe 재시도. «결제는 됐는데 기록이 없는» 상태가 없다.
- 멱등 재전송: `alreadyPaid` 가 먼저 return → **0행 추가**.
- 서명 실패·metadata 불일치는 감사하지 않는다.

## C. 역할 변경 두 번째 문 (`PATCH /:id/members/:memberId/role`)

소유권 이전 문. **`writeAudit` 트랜잭션 안**(update 직후·commit 앞). PUT 문과 **같은 이름 `member_role.change` · 같은 모양** — `target_type:'business_member'`, `target_id: member.id`, `old_value:{ role, user_id }`, `new_value:{ role }`. 두 문 통합은 범위 밖.

## D. 프로젝트 멤버 전면 교체 (`PUT /projects/:id/members`)

`destroy` 전에 `before` 를 잡고, commit 앞에 `writeAudit({ transaction })`. `project.members.replace`, `target_type:'project'`.
`old_value:{ members:[{user_id, role, is_pm}] }` · `new_value:{ members, added, removed, role_changed, skipped }`. **diff 가 비면 쓰지 않는다.**

## E. 커버리지 가드 — `--category=auditcover` (래칫)

`routes/*.js` 의 변경 핸들러 본문에 `logAudit(|writeAudit(|createAuditLog(` 가 없고 `// audit-exempt: <이유>` 도 없으면 1건. 파일별 카운트 래칫 — 기존 부채 동결, 증가만 실패. 반증 필수(지우면 FAIL, 표식 달면 PASS). 33개 감사 0건 파일 갚기는 후속.

## F. 게이트

**R=1** → Fable 게이트 한 라운드. 실호출 검증 항목:
1. 로그인 ok 1행(business_id NULL, 토큰 문자열 없음) · 틀린 비번 bad_password · **없는 이메일 0행** · 정지 suspended · 로그아웃 · refresh 회전 **0행** · 옛 쿠키 재사용 refresh_reuse 1행 · 음성 대조군(AuditLog.create 가 던져도 로그인 200).
2. Stripe 서명 이벤트 → paid + 1행 · 재전송 → 여전히 1행 · writeAudit 실패 → **pending 유지 + 500** · 수동 mark-paid 정확히 1행.
3. PATCH 역할 이전 1행 · 마지막 owner 강등 400 → 0행 · PUT 과 같은 action·키.
4. PUT 멤버 diff 1행 · 같은 집합 0행 · 비멤버 skipped.
5. 가드 반증 · duproute·auditentry·retention·secrets 초록.
6. 스키마 무변경 · 롤백 코드만.
