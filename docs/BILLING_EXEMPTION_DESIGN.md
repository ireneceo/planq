# 결제 면제(billing exemption) 설계 — 내부 워크스페이스 · 테스터 고객

운영 피드백 **#275** (2026-08-13, Irene): *"테스터 고객은 계속 무료로 써야 해. 나도 마찬가지고.
우리 워크스페이스나 테스터 고객의 경우 무료로 사용하게 어떻게 설정 기능을 넣지?"*
추가 지시 (2026-08-17, Irene): *"이전 결제도 워크스페이스에서 한 거 다 실제 아니야. 매출로 잡히면 안 돼."*

> **개정 2 (Fable 설계 게이트 1차 FAIL 반영)** — 게이트 위치를 **라우트에서 서비스로 내렸고**,
> 빠져 있던 결제 생성·확정 경로 2개(트라이얼 cron · 애드온)를 편입했으며,
> 구독 복원을 **단일 헬퍼 1개**로 합치고, 백필에서 id 하드코딩을 제거했다.

---

## 1. 현재 상태 (운영 실측 2026-08-17)

| biz | 이름 | plan | subscription_status | 증상 |
|---|---|---|---|---|
| 1 | 워프로랩 (irene) | basic | **past_due** · grace→08-23 | 08-16 생성 pending 39,000원 → **지금 뜨는 결제 요구** |
| 2 | 워프로랩 (lua) | free | active | 07-23 **demoted** (강등당함) · pending 9,900원 |
| 4 | 세일즈맵 | starter | canceled | trial 만료 |
| 5 | withMIN lab | starter | canceled | trial 만료 |
| 6 | 유피트 | starter | past_due | trial 만료 · pending 9,900원 |

**매출로 잘못 잡힌 내부 결제 (payments.status='paid', biz 1·2)** — id 1·2·3·5·7·8, **합계 155,800원**.
전부 내부 결제 테스트다. 실제 입금이 아니며 플랫폼 매출이 아니다.

---

## 2. 불변식 (되돌리지 말 것)

1. **면제 판정은 단일 착지점 1곳** — `services/plan.js getBusinessPlan()`.
   라우트·컴포넌트·cron 마다 따로 판정하면 반드시 갈라진다
   (memory `feedback_predicate_must_match_both_sides`).
2. **게이트는 라우트가 아니라 서비스에 둔다** — 청구를 만드는 진입점은 라우트(체크아웃)와
   cron(`trial.js`) **둘 다**다. 라우트에만 걸면 cron 이 그대로 지나간다. (Fable C2)
3. **매출 여부는 결제 확정 시점에 payment 행에 박제** — Business 플래그로 조인 판정하면
   면제를 끄는 순간 과거 내부 결제가 매출로 되살아난다(시점 오염).
   박제 지점은 **`markPaymentPaid` 와 `markAddonPaid` 둘 다**. (Fable C1)
4. **구독을 active 로 만드는 모든 경로는 단일-active 를 보장한다** —
   복원 로직을 두 곳에 적지 않고 `restoreExemptSubscription()` 헬퍼 1개로 합친다. (Fable C4)
5. **숨기지 않고 분리한다** — 관리자 화면에서 비매출 금액을 0으로 만들지 않고
   "실매출 / 비매출(내부·테스터)" 로 노출하고, **행 단위로도** `is_revenue` 를 표시한다.
   숫자가 사라지는 것도 오정보다.
6. **SaaS ↔ Q Bill 5불변식 유지** — 이 작업은 `payments`/`subscriptions`/`businesses` 만 만진다.
   `invoices`/`invoice_payments`(Q Bill 워크스페이스→고객 매출)와 `services/stats.js` 는
   **한 줄도 손대지 않는다** (memory `project_subscription_payment_plan`).
7. **면제 만료는 정상 경로 복귀** — `billing_exempt_until` 이 지나면 자동으로 일반 구독 사이클로
   돌아간다. 면제가 영구 백도어가 되지 않게 한다.

---

## 3. 스키마 변경

### 3.1 `businesses` — 면제 7컬럼

```sql
ALTER TABLE businesses
  ADD COLUMN billing_exempt        TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN billing_exempt_kind   ENUM('internal','tester','partner') NULL DEFAULT NULL,
  ADD COLUMN billing_exempt_plan   VARCHAR(32)  NULL DEFAULT NULL,
  ADD COLUMN billing_exempt_until  DATETIME     NULL DEFAULT NULL,
  ADD COLUMN billing_exempt_note   VARCHAR(255) NULL DEFAULT NULL,
  ADD COLUMN billing_exempt_set_by INT          NULL DEFAULT NULL,
  ADD COLUMN billing_exempt_set_at DATETIME     NULL DEFAULT NULL;
```

- `billing_exempt_plan` — 면제 중 부여할 플랜 코드. `NULL` 이면 현재 `businesses.plan` 유지.
- `billing_exempt_until` — `NULL` = 무기한(내부), 날짜 지정(테스터 기간 한정).
- Business 컬럼인 이유: `getBusinessPlan()` 이 이미 Business 를 단일 조회한다 → **추가 쿼리 0**.

### 3.2 `payments` — 매출 분리 + 취소 사유 2컬럼

```sql
ALTER TABLE payments
  ADD COLUMN is_revenue    TINYINT(1)   NOT NULL DEFAULT 1,
  ADD COLUMN cancel_reason VARCHAR(255) NULL DEFAULT NULL;
```

- `is_revenue` — `1` = 실매출, `0` = 비매출(내부·테스터 결제 테스트). 확정 시점에 박제.
- `cancel_reason` — **신설**. `models/Payment.js` 에는 `refund_reason` 만 있고 `cancel_reason` 은
  없다(Payment.js:82). `cancel_reason` 은 Subscription 모델 전용이었다. (Fable C3 — 실측 확인)

### 3.3 모델 정의 (Fable M1)

SQL ALTER 만으로는 부족하다. dev 는 `sync-database.js`(모델 기반) 경로다.
- `models/Business.js` — 위 7컬럼 정의 추가
- `models/Payment.js` — `is_revenue`, `cancel_reason` 정의 추가

> 운영은 `sync-database.js` 64키 한도 이슈가 있다(memory `feedback_sync_alter_too_many_keys`).
> **운영은 위 ALTER 를 수동 실행**한다. 인덱스는 추가하지 않는다(면제 대상이 소수).

---

## 4. 코드 변경

### 4.1 `services/plan.js` — 면제 단일 착지점 ★

`getBusinessPlan()` 의 `attributes`(plan.js:39-44)에 면제 7컬럼 추가. 계산부:

```js
const exemptActive = !!biz.billing_exempt
  && (!biz.billing_exempt_until || new Date(biz.billing_exempt_until) > now);

if (exemptActive) {
  const code = biz.billing_exempt_plan || biz.plan || 'free';
  result = {
    plan: getPlan(code), biz,
    active: true,              // 무조건 활성 — can() 의 subscription_inactive 자동 해소
    inTrial: false, inGrace: false,
    trialEndsAt: null, graceEndsAt: null,
    exempt: true,
    exemptKind: biz.billing_exempt_kind || 'internal',
    exemptUntil: biz.billing_exempt_until || null,
  };
}
```

이 한 곳으로 `can()`(plan.js:212)의 모든 게이트가 통과한다. 비면제 경로는 **한 줄도 안 바뀐다**.

**캐시**: PM2 `planq-dev-backend` 는 fork 단일 인스턴스라 프로세스 간 캐시 분기 없음(Fable 실측).
면제 토글 시 `invalidateBusinessCache(id)` 필수.

**순환참조 없음**: `plan.js` 는 `billing.js` 를 require 하지 않고, `billing.js` 는 이미
lazy require 패턴(billing.js:240,310,452)이다 → `isBillingExempt` 의 lazy require 안전(Fable 실측).

### 4.2 `services/billing.js` — 서비스 레벨 게이트 + 복원 단일 헬퍼

공유 헬퍼 2개 신설 (중복 판정 금지 — plan 엔진 것을 재사용):

```js
async function isBillingExempt(businessId) {
  const { exempt } = await require('./plan').getBusinessPlan(businessId);
  return !!exempt;
}
```

1. **`createPendingSubscription`(billing.js:44) 최상단 — 서비스 레벨 게이트** ★ (Fable C2)
   ```js
   if (await isBillingExempt(businessId)) {
     const e = new Error('billing_exempt'); e.code = 'billing_exempt'; throw e;
   }
   ```
   라우트(체크아웃)는 이를 `400 billing_exempt` 로 매핑. `trial.js:76` 의 직접 호출은
   기존 per-biz `try/catch`(trial.js:84)가 이미 감싸고 있으나, **조용히 삼키지 않도록**
   `trial.js` 3단계 각각에 명시 `if (await isBillingExempt(biz.id)) { stats.exempt_skipped++; continue; }`
   를 추가한다(관측성 — 로그로 확인 가능해야 한다).

2. **`ensureRenewalPayment(sub)`(billing.js:336) 최상단 가드**
   ```js
   if (await isBillingExempt(sub.business_id))
     return { payment: null, created: false, skipped: 'billing_exempt' };
   ```

3. **`restoreExemptSubscription(businessId, { transaction })` — 신설 단일 헬퍼** ★ (Fable C4)
   cron ②③ 과 admin 토글이 **같은 헬퍼**를 호출한다. 트랜잭션 안에서:
   1. `getCurrentSubscription`(billing.js:536-545) 과 **동일한 `FIELD(status,'active','grace','past_due','pending')`
      정렬**로 대상 구독 1건 선정 (없으면 no-op 반환)
   2. 그 외 `active`/`past_due`/`grace` 구독은 `markPaymentPaid`(billing.js:204-214)와
      **동일한 where 절**로 `status='replaced'` 마크 → 중복 active 원천 차단
   3. 잔존 `pending` 구독도 `replaced` 마크 (권고 1 — admin 목록 유령 제거)
   4. 대상만 `status='active'`, `past_due_at=null`, `grace_started_at=null`, `grace_ends_at=null`,
      `current_period_end = addCycle(max(now, current_period_end), cycle)`,
      `next_billing_at = current_period_end` (Fable M3 — 기준점을 `max(now, ...)` 로 두지 않으면
      과거 period_end 를 매일 1사이클씩 따라잡는 루프가 된다)
   5. `Business.update({ subscription_status:'active', grace_ends_at:null, plan_expires_at:null })`
   6. `invalidateBusinessCache(businessId)`

4. **`runDailyBillingCron()`(billing.js:416) — 4단계 전부 면제 제외 + 정상화**
   - ①`active→past_due`: 면제면 전이 대신 `restoreExemptSubscription` (period_end 무료 연장 포함)
   - ②`past_due→grace`, ③`grace→demoted`: 면제면 skip + `restoreExemptSubscription`
   - ④갱신 청구 백필: 2번 가드로 자동 skip
   - stats 에 `exempt_skipped`, `exempt_restored` 추가

5. **`markPaymentPaid`(billing.js:143) — `is_revenue` 박제**
   ```js
   is_revenue: !(await isBillingExempt(pay.business_id))
   ```
   기존 결제 로직·멱등성·supersede 로직은 무변경.
   `notifyPlatformAdmins` 결제 알림(billing.js:248-255)에 비매출 표기 추가 (권고 2).

### 4.3 `services/addonBilling.js` — 두 번째 paid 쓰기 지점 ★ (Fable C1)

전수 grep 결과 `status:'paid'` 쓰기는 **2곳**이다: `billing.js:180`, **`addonBilling.js:150`**.
(Stripe webhook `routes/stripeWebhook.js:45` 는 `markPaymentPaid` 로 착지 → 안전)

- `markAddonPaid` 의 `pay.update({...})`(addonBilling.js:149-157)에 동일한
  `is_revenue: !(await isBillingExempt(pay.business_id))` 추가
- `routes/plan.js:585` `POST /addons/request` — 면제면 `400 billing_exempt`.
  면제 워크스페이스의 한도 부여는 admin 전용 `POST /addons/apply`(routes/plan.js:694)로만.

### 4.4 `services/trial.js` — 두 번째 청구 생성 cron ★ (Fable C2)

- `runDailyTrialCron` 3단계(trial.js:66 사전청구 / :96 past_due 전이 / :145 canceled 잠금)
  각각에 면제 skip + `stats.exempt_skipped`
- `routes/plan.js:164` `POST /:businessId/start-trial` — 면제면 `400 billing_exempt`
  (현재는 `biz.plan==='free'` 만 검사)

### 4.5 `routes/admin.js` — 매출 분리 + 면제 설정 라우트

**매출 집계** (Fable M9 — 정정된 라인)
- `GET /admin/overview` — 합계 계산 `:48-50`, 응답 `:66`
- `GET /admin/payments/stats` — `:756-759`
- `month_paid` / `month_revenue` → `where: { status:'paid', is_revenue: true, ... }`
- **신규** `month_nonrevenue` — `is_revenue: false` 합계
- `pending_amount` — pending 행은 박제 전이라 `is_revenue` 필터가 아무것도 거르지 못한다(Fable M4).
  실제 메커니즘은 "면제 토글/백필이 pending 을 canceled 로 만든다" 이다. 방어적으로
  `business_id NOT IN (SELECT id FROM businesses WHERE billing_exempt=1)` 를 건다.
- `GET /admin/payments`(admin.js:696-736) 응답에 `is_revenue` 추가 (Fable M7)
- 구독 KPI(admin.js:30-45)에 `exempt_active` 분리 카운트 (권고 3)

**신규** `PUT /api/admin/businesses/:id/billing-exempt`
- `router.use(authenticateToken, requireRole('platform_admin'))`(admin.js:12) **뒤에** 마운트.
  구현 검증에서 마운트 순서 확인 필수 → owner 자가 면제 경로 없음(Fable 보안 검토)
- body: `{ exempt, kind, plan, until, note }`
- 검증: `kind ∈ (internal|tester|partner)`,
  **`plan ∈ Object.keys(PLANS)` 만** — ADDONS 코드(member, clients_10 …) 배제 (Fable M8),
  `until` ISO 날짜 또는 null
- `billing_exempt_set_by = req.user.id`, `billing_exempt_set_at = now`
- `AuditLog` (`action='business.billing_exempt'`, old/new JSON)
- `planEngine.invalidateBusinessCache(id)`
- **면제 ON 시 즉시 정상화** (cron 을 기다리면 "설정했는데 배너 그대로" 회귀 —
  memory `feedback_fixed_but_unreachable`): 한 트랜잭션 안에서
  ① `restoreExemptSubscription(id)` ② 잔존 `pending` Payment → `canceled`,
  `cancel_reason='billing_exempt'`
- `GET /admin/businesses`(:74) · `GET /admin/businesses/:id`(:109) 응답에 면제 필드 추가

### 4.6 `routes/plan.js` — 상태 노출 + 진입 차단

- `GET /:businessId/status`(:38) 응답에 `exempt`, `exempt_kind`, `exempt_until` 추가
- 면제면 `pending_payment: null` (면제 켜기 전 잔여 pending 이 화면에 뜨지 않게)
- 체크아웃/업그레이드/`start-trial`/`addons/request` — 면제면 `400 billing_exempt`

### 4.7 프론트엔드

- `services/plan.ts` `PlanStatus` 에 `exempt` 3필드
- `WorkspaceBillingBanner.tsx` — `pickBanner()` 최상단 `if (status.exempt) return null;`
- `TrialStatusBanner.tsx` (Fable M5) — **로컬 `PlanStatus` 인터페이스(18-26행)에도** `exempt` 추가하고
  면제면 `null` 반환. **+ focus/visibility 재조회 추가** — 현재 mount 1회 조회뿐(43-51행)이라
  면제 ON 직후에도 "워크스페이스 잠금" 이 계속 떠 있다.
  `WorkspaceBillingBanner.tsx:56-61` 패턴 재사용.
- `PlanSettings.tsx` — 면제면 결제 CTA·체크아웃 숨기고 안내 카드 1개
  (kind 별 문구 + **"한도 조정은 관리자에게 문의"** — Fable M6 dead-end 방지)
- `LimitReachedDialog.tsx:58` · `UsageWarningCard`(PlanSettings + DashboardPage) —
  `status.exempt` 면 "지금 업그레이드" Primary CTA 를 문의 안내로 교체 (Fable M6)
- `AdminBusinessesPage.tsx` — 목록 면제 뱃지 + 상세 폼.
  **PlanQSelect + SingleDateField** 사용(raw `<select>` 는 guard-invariants 린트 위반),
  재무 설정이므로 명시 저장 버튼(AutoSaveField 예외 — 사유 주석 명기) (권고 5)
- `AdminDashboardPage.tsx`(:15,71,76) **및 `AdminPaymentsPage.tsx`(:44,165)** 둘 다
  "실매출 / 비매출(내부·테스터)" 표시 + 목록 행 비매출 뱃지 (Fable M7·M9)
- i18n `plan`·`admin`·`common` ko/en 양쪽 (하드코딩 0)

**실시간 반영(CLAUDE.md 16번)**: 면제 토글은 platform_admin 의 저빈도 액션이고
소비 화면이 focus 복귀 시 재조회하므로 socket broadcast 를 두지 않는다.
(아키감사 재론 방지용 사유 명시 — 권고 4)

---

## 5. 운영 백필 — **조건 기반 · id 하드코딩 금지** (Fable C5)

`scripts/backfill-billing-exemption.js` — `--dry-run` 기본, `--apply` 로 실행. 재실행 변경 0.

1. **면제 설정** — biz 선정은 **`slug`(UNIQUE) 매칭**. 시작 시 대상 워크스페이스 이름을 출력해 육안 대조.
   - 워프로랩 2곳 → `exempt=1, kind='internal', plan='pro', until=NULL`
   - **그 외에는 아무것도 넣지 않는다.**

   > ### ★★ 테스터는 백필이 아니라 관리자가 지정한다 (Irene 2026-08-17) ★★
   > *"테스터는 솔루션 관리자가 지정을 해야지. 지금 가입해서 자동으로 스타터가 된 사람을
   > 테스터라고 하면 어떻게 해?"* / *"내부 워크스페이스인지, 테스터인지 설정해야지."*
   >
   > **가입 상태에서 테스터를 추론하지 않는다.** 가입 직후 자동 부여된 스타터 체험이 만료된 것과,
   > 우리가 테스터로 들인 것은 전혀 다른 사실이다. 추론으로 면제를 주면
   > ① 실고객이 조용히 무료가 되어 매출이 새고
   > ② 그 사람은 결제 없이 쓰는 것이 정상인 줄 알게 된다 — 나중에 되돌리는 쪽이 더 큰 사고다.
   >
   > 구분(internal / tester / partner)·부여 플랜·종료일·사유는 platform_admin 이
   > **`/admin/businesses` 상세 → "면제 설정"** 에서 직접 고른다. 누가 언제 지정했는지
   > `AuditLog(action='business.billing_exempt')` 에 남는다. 백필은 그 화면을 대신하지 않는다.
2. **비매출 마킹** — id 열거 없이 조건으로:
   ```sql
   UPDATE payments SET is_revenue = 0
   WHERE status IN ('paid','refunded')
     AND business_id IN (SELECT id FROM businesses
                         WHERE billing_exempt = 1 AND billing_exempt_kind = 'internal');
   ```
   `refunded` 도 포함한다(환불 행이 매출 통계에 음수로 남지 않게).
3. **잔여 pending 정리** — `status='pending' AND business_id IN (면제 집합)` →
   `status='canceled'`, `cancel_reason='billing_exempt'`
4. **구독·워크스페이스 정상화** (Fable M2 — biz 4·5 는 구독이 `canceled` 라 복원 대상이 없다):
   - 면제 biz **전부**: `businesses.subscription_status='active'`,
     `grace_ends_at=NULL`, `plan_expires_at=NULL`
   - 구독 row 가 `active/past_due/grace/pending` 로 있으면 `restoreExemptSubscription` 호출.
     `canceled` 구독은 **그대로 둔다**(이력 보존 — 되살리지 않는다)
5. `invalidateBusinessCache` 전 대상

---

## 6. 검증 (Fable 게이트 ③ 실호출)

1. `node scripts/health-check.js` · `npm run build`(tsc EXIT 0, 파이프 없이 실 exit code) ·
   `node scripts/guard-invariants.js` 전체
2. **실HTTP**: 면제 biz owner 로그인 → `GET /api/plan/:id/status` → `exempt=true`,
   `active=true`, `in_grace=false`, `pending_payment=null`
3. **게이트 양방향 반증**: 면제 전 `subscription_inactive` 로 막히던 액션(파일 업로드 등)이
   면제 후 통과 → 면제 OFF 하면 **다시 막힘**
4. **billing cron 반증**: `runDailyBillingCron()` 를 면제 상태에서 2회 실행 →
   `payments` 신규 0건, 구독 active 유지, `stats.exempt_skipped ≥ 1`
5. **trial cron 반증** (Fable 권고 6c): 면제 biz 를 `subscription_status='trialing'` 로 두고
   `runDailyTrialCron()` 실행 → pending Subscription·Payment 생성 0건, 안내 메일 0건
6. **애드온 반증** (권고 6b): 면제 biz 애드온 `markAddonPaid` → `is_revenue=0`
7. **매출 반증**: `GET /admin/overview`·`/admin/payments/stats` → `month_paid` 에 내부 결제
   미포함, `month_nonrevenue` 에 포함. **비면제 워크스페이스 결제는 `is_revenue=1` 로 그대로 계상**
8. **면제 OFF 후 재과금** (권고 6a): 면제 해제 → cron → period_end 경과 시
   past_due→grace→pending **1건만** 생성(몇 달치 몰아서 청구 없음)
9. **단일-active 반증** (C4): 면제 biz 에 stale 구독을 인위로 2개 만든 뒤
   `restoreExemptSubscription` → `status='active'` 인 구독이 **정확히 1건**
10. **멱등**: 백필 `--apply` 2회 → 두 번째 변경 0건
11. **격리**: Q Bill `invoices`/`invoice_payments` 및 `services/stats.js` 매출 수치
    before/after diff **0**
12. **보안**: `PUT /admin/businesses/:id/billing-exempt` 를 워크스페이스 owner 토큰으로 호출 → **403**.
    admin.js 라우터 마운트 순서 확인
13. **옛 데이터 sample 1건**: biz 4(세일즈맵)처럼 trial 만료 후 `canceled` 인 구독에서도
    면제 ON → 정상 사용 가능
14. **프론트**: 면제 biz 로 대시보드·PlanSettings·쿼터 초과 다이얼로그 진입 →
    결제 유도 CTA 0건, 안내 문구 노출

---

## 7. 롤백

- 코드: `git revert`
- 데이터: 컬럼 `DEFAULT` 가 기존 동작과 동일(`billing_exempt=0`, `is_revenue=1`)이라
  컬럼을 남긴 채 코드만 되돌려도 회귀 없음
- 백필 되돌리기: `billing_exempt=0` + `is_revenue=1` UPDATE (원본 payments 행 미삭제)
