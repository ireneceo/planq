# 0단계 0-A(돈·구독) · 0-B(청구 정합) 구현 설계 — Fable 설계 판정 (2026-10-08)

> 근거: `docs/FABLE_PRODUCT_AUDIT_2026-10-07.md` C·0-A/0-B · `docs/audit-2026-10-07/revenue.md` §5-1·2·3·6·11·13·14·15·16·19.
> R=1 묶음이라 **이 문서의 판정이 곧 게이트**다. Opus 는 여기 적힌 파일·함수·순서대로 구현하고, 설계 밖 변경을 시작하지 않는다.
> 갈림길은 전부 §8 에 판정으로 적었다(Irene «권고대로» 위임). 다시 묻지 않는다.
> 소스는 아직 손대지 않았다(설계만). 줄 번호는 2026-10-08 HEAD 기준.

---

## 0. 요약

| # | 결함 | 한 줄 판정 | 핵심 변경 지점 |
|---|---|---|---|
| A-① | 결제 링크 30일 뒤 소실 | 청구서는 **canceled · 안 보낸 draft** 만 정리, **paid 는 입금 후 180일**, sent/overdue/partial 은 절대 안 지움 | `services/shareTokenCleanup.js:25,34-43` |
| A-② | 잠긴 워크스페이스 복구 500 | 잠금으로 canceled 된 구독은 **후계 구독이 없고 플랜이 같으면 되살린다**(markPaymentPaid 한 함수). 운영 고아 4건은 **데이터 변경 없이** 코드만으로 결제 가능 상태가 된다 | `services/billing.js:292-299,302-309,368-375` · `routes/plan.js:76-79` · `routes/admin_billing.js:160,347` |
| A-③ | 다운그레이드 예약 미적용 | 저장 위치는 **`businesses.scheduled_plan`** 이다(`subscriptions` 에는 원래 없다 — 운영 관측은 표를 잘못 봤다). 적용은 **갱신 시 예약 플랜의 pending 구독을 만들어** 기존 결제확정 경로로 전환 | `services/billing.js:500-554` · `models/Business.js:151` · 죽은 `scripts/plan-expiry-check.js` 삭제 |
| A-④ | 애드온 갱신 미합산 | 갱신 결제 금액 = 플랜 + Σ애드온(연간은 ×12). 내역은 `payments.line_items JSON` 에 박제 | `services/addonBilling.js`(새 `renewalAddonLines`) · `services/billing.js ensureRenewalPayment` |
| A-⑤ | 체험 중 결제 시 잔여일 소멸 | 첫 결제의 기간 시작 = **max(now, trial_ends_at)**. 보너스는 그 위에 더한다. 결제창이 «다음 결제일» 을 서버 값으로 보여준다 | `services/billing.js:302-304` · `routes/plan.js /checkout` 응답 · `CheckoutModal.tsx:216-228` |
| B-① | 외화 정수 절단 | `invoices.total_amount·tax_amount·grand_total` · `invoice_items.unit_price·amount` → **DECIMAL(14,2)**. 반올림은 `services/money.js roundMoney(n, currency)` 한 곳(KRW/JPY 0자리·그 외 2자리) | `models/Invoice.js:29-40` · `models/InvoiceItem.js:30-37` · `scripts/migrate-invoice-money.js`(신규) |
| B-② | 번호 전역 채번 · 동시성 | `invoice_number_counters(business_id, year, last_no)` 를 **트랜잭션 안 UPDATE 로 잠가** 채번. 네 생성 경로가 `services/invoiceNumber.nextInvoiceNumber` 하나. UNIQUE 는 `(business_id, invoice_number)`. **기존 번호 유지, 앞으로만**(Irene ③-a) | `routes/invoices.js:107-120,748,899` · `services/recurring_invoice.js:20-37` · `services/clientSubscriptionBilling.js:11-27` |
| B-③ | client_id·project_id 회사 미검증 | `services/tenantRef.js assertClientInBusiness / assertProjectInBusiness` → 400 `client_not_in_workspace` | `routes/invoices.js:904,918,1272` |
| B-④ | 공개 응답에 출처 문서 토큰 | `source_post.share_token` 제거(프론트 미사용 확인: `PublicInvoicePage.tsx:74` 타입만) | `routes/invoices.js:186-189` |
| B-⑤ | 공개 토큰으로 고객 마스터 덮어쓰기 | 공개 제출은 **청구서의 `receipt_profile` 에만** 쓴다. 다음 청구서 prefill 은 **그 고객의 직전 제출본(history)** 에서 — 마스터는 멤버만 고친다 | `routes/invoices.js:560-583` · `services/receiptsDue.js:344-378` |

마이그레이션 2개(멱등·`--dry`·배포 슬롯): `migrate-invoice-money.js`(B-①②) · `migrate-billing-0a.js`(A-③④). 롤백은 **코드만** 되돌린다(스키마는 넓히기만 했으므로 옛 코드와 호환).

---

## 1. 공통 — 범위·운영 확인·배포·롤백

### 1-1. 범위 밖 (이번에 하지 않는다 — 다른 묶음·후속)
- 미입금 애드온 한도 **회수**(revenue 5-15 후반) — 정책 결정 필요. 0-A 는 «갱신 합산» 까지.
- `inTrial` 배지(0-G) · 매출 공식 두 벌(0-G) · 사용자 해지 버튼 · 환불의 구독 원복 · `setMonth` 월말 넘침 — 0-A 밖. (`computePeriodEnd` 는 건드리지 않는다.)
- `requireMenu('clients')`(0-C) · 영업 방송(0-C).
- 연체 판정이 회차를 모르는 것(revenue 5-9) — 1단계.

### 1-2. 배포 전 운영 SELECT (읽기만 · 결과를 작업기록에 적는다)
```sql
-- A-① 토큰이 사라진 살아 있는 청구서 (2026-10-08 실측: sent 1건 토큰 살아 있음 → 0 기대)
SELECT id, status, sent_at FROM invoices WHERE status IN ('sent','overdue','partially_paid') AND share_token IS NULL AND sent_at IS NOT NULL;
-- A-② 고아 pending (실측 4건) — 되살릴 수 있는 조건(후계 없음·플랜 일치)에 드는지 확인
SELECT p.id, p.business_id, p.amount, s.id sub_id, s.plan_code, s.cancel_reason, b.plan, b.subscription_status,
  (SELECT COUNT(*) FROM subscriptions x WHERE x.business_id=b.id AND x.status IN ('pending','active','past_due','grace')) live_subs
FROM payments p JOIN subscriptions s ON s.id=p.subscription_id JOIN businesses b ON b.id=p.business_id
WHERE p.kind='plan' AND p.status='pending' AND s.status='canceled';
-- A-③ 저장 컬럼 실존 — 반드시 businesses 를 본다 (subscriptions 가 아니다)
SHOW COLUMNS FROM businesses LIKE 'scheduled_plan';
SELECT id, plan, scheduled_plan, plan_expires_at FROM businesses WHERE scheduled_plan IS NOT NULL;
-- B-① 소수 금액(실측 KRW 7건뿐 → 0 기대) · B-② 번호 분포 · 테넌트 교차 중복 0 확인
SELECT currency, COUNT(*) FROM invoices GROUP BY currency;
SELECT business_id, MIN(invoice_number), MAX(invoice_number), COUNT(*) FROM invoices GROUP BY business_id;
SHOW INDEX FROM invoices WHERE Non_unique = 0;
```

### 1-3. 배포 순서 (한 번에 · `scripts/deploy-planq.sh` 마이그레이션 슬롯)
1. 위 SELECT → 기록.
2. 커밋에 포함: 백엔드·프론트·마이그레이션 2개·health-check `money` 카테고리·deploy 스크립트 슬롯 2줄.
3. deploy 스크립트가 `sync-database` 뒤 슬롯에서 **코드 reload 앞에** 실행:
   ```bash
   # 2026-10-08 0-A/0-B 돈 묶음 (docs/FIX_0AB_MONEY_DESIGN.md) — 둘 다 멱등. ★ 코드보다 먼저 돈다:
   #   money: 금액 DECIMAL(14,2) · invoice_number_counters 시드 · UNIQUE(business_id, invoice_number) — 없으면 채번 함수가 없는 표를 UPDATE 해 500.
   #   billing-0a: businesses.scheduled_plan 보장 · payments.line_items — 모델이 선언하므로 없으면 결제 조회 500.
   log "Money bundle migrations (0-A/0-B)..."
   prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-invoice-money.js 2>&1 | tail -12"
   prod_run "set -o pipefail; cd $PROD_BE && NODE_ENV=production node scripts/migrate-billing-0a.js 2>&1 | tail -8"
   ```
   ★ `sync-database`(alter) 가 먼저 돌며 새 모델의 DECIMAL·복합 UNIQUE 를 만들 수 있다 — 그래서 마이그레이션은 **있으면 skip** 으로 짠다. 단일 컬럼 UNIQUE 두 개(`invoice_number`·`invoices_invoice_number_unique`)를 **지우는 것은 마이그레이션만** 한다(sync 는 인덱스를 지우지 않는다). 모델 `indexes` 에서 단일 UNIQUE 선언을 **같은 커밋에서 빼야** 다음 sync 가 되살리지 않는다.
4. 배포 뒤: 운영 `SHOW INDEX FROM invoices` 로 복합 UNIQUE 1 · 단일 UNIQUE 0 확인 · `SELECT * FROM invoice_number_counters` 가 워크스페이스별 MAX 와 일치 · dev 에서 `node scripts/health-check.js --category=money,billing,secrets`.

### 1-4. 롤백
- **코드만 되돌린다.** 스키마는 전부 «넓히기»라 옛 코드와 호환된다: DECIMAL(14,2) 는 옛 모델(12,0)이 읽어도 문자열로 온다 · 옛 전역 채번은 전역 최대+1 을 뽑으므로 복합 UNIQUE 에도 안 걸린다 · `invoice_number_counters`·`payments.line_items` 는 읽는 곳이 없으면 무해(다음 마이그레이션 재실행이 `GREATEST(last_no, 실제 MAX)` 로 재동기화한다).
- DECIMAL 을 (12,0) 으로 되돌리지 **않는다** — 소수 자료가 있으면 절단된다.
- A-② 되살림으로 활성화된 구독은 되돌리지 않는다(돈을 받은 것이다).

---

## 2. 0-A 돈·구독

### A-① 청구서 공개 링크를 cron 이 지우지 않는다

**현재** `services/shareTokenCleanup.js:25` 가 Invoice 를 `updated_at < 30일` 하나로 `share_token=NULL`. `routes/invoices.js:1389-1390` 발송 라우트 주석은 «기본 무제한». 두 코드가 모순이고 cron 이 이긴다.

**판정** 청구서 링크의 만료 주인은 `share_expires_at`(발송 시 명시한 경우만) 이다. cron 은 **다시 쓸 일이 없는 것**만 치운다.

| 상태 | cron 처리 |
|---|---|
| `sent` · `overdue` · `partially_paid` | **절대 안 지움**(결제 링크) |
| `paid` | `paid_at < now − 180일` 이면 NULL (고객이 영수·증빙 파일을 내려받는 기간) |
| `canceled` | `updated_at < 30일` 이면 NULL (지금과 같음) |
| `draft` | `sent_at IS NULL AND updated_at < 30일` 이면 NULL (한 번도 안 보낸 미리보기 토큰) |

**변경** `services/shareTokenCleanup.js`
```js
const PAID_INVOICE_LINK_DAYS = 180;
// targets 에서 Invoice 항목을 빼고 아래를 별도 단계로 — 상태를 모르는 공용 루프에 청구서를 두지 않는다.
async function cleanupInvoiceTokens(now = new Date()) {
  const cutoff30 = new Date(now - STALE_DAYS * 86400e3);
  const cutoffPaid = new Date(now - PAID_INVOICE_LINK_DAYS * 86400e3);
  const [n] = await Invoice.update({ share_token: null }, { where: {
    share_token: { [Op.ne]: null },
    [Op.or]: [
      { status: 'canceled', updated_at: { [Op.lt]: cutoff30 } },
      { status: 'draft', sent_at: null, updated_at: { [Op.lt]: cutoff30 } },
      { status: 'paid', paid_at: { [Op.lt]: cutoffPaid } },
    ],
  }});
  return n;
}
module.exports = { runShareTokenCleanup, cleanupInvoiceTokens, STALE_DAYS, PAID_INVOICE_LINK_DAYS };
```
`runShareTokenCleanup` 안에서 `stats.invoices = await cleanupInvoiceTokens()`. 파일 머리 주석(«Invoice — updated_at 기준»)을 이 표로 바꾼다. `routes/invoices.js:1389` 주석은 «cron 은 sent/overdue/partial 을 건드리지 않는다(A-①)» 로.

**경계** `paid_at` 이 NULL 인 paid(옛 데이터) 는 `updated_at` 으로 본다 → where 에 `{ status:'paid', paid_at: null, updated_at: { [Op.lt]: cutoffPaid } }` 한 줄 추가. 이미 지워진 토큰은 복구 불가(난수) — 재발송(`:1613-1615`)이 새 토큰을 만든다. 운영은 살아 있는 sent 1건 토큰이 있으므로 복구할 것이 없다.

### A-② 잠긴 워크스페이스가 송금하면 복구된다

**현재 흐름** 체험 D-7 사전청구 → Subscription(pending)+Payment(pending) → D+21 `trial.js:172-181` 이 Business `canceled` + Subscription `canceled(cancel_reason='trial_expired_no_payment')`, **Payment 는 pending 그대로**. `/status`(`routes/plan.js:76-79`) 는 그 pending 을 내려주고 CheckoutModal(`:86-89`) 은 재사용 → 고객이 송금 → 관리자 [입금 확인] → `markPaymentPaid` `:296-299` 가 `subscription_superseded` throw → 500. 잠금 메일 «결제 후 자동 복구»(`trial.js:36`) 거짓.

**판정 — 되살린다(cancel 하지 않는다).** 고객이 받은 입금 안내(결제 번호·금액)는 그 Payment 것이다. 그것을 닫고 새 체크아웃을 강요하면 «안내대로 입금했는데 확인이 안 되는» 두 번째 사고가 된다. 되살림은 `markPaymentPaid` **한 함수** 안에서 하므로 관리자 2문(`admin_billing.js:160,347`)·Stripe 웹훅(`routes/stripeWebhook.js:46`) 이 같이 고쳐진다. 운영 고아 4건은 **데이터를 건드리지 않고** 코드 배포만으로 결제 확인이 가능해진다.

**N+94 재발 방지 조건(셋 다)** — 되살릴 수 있는 구독은
1. `sub.status === 'canceled' && sub.cancel_reason === 'trial_expired_no_payment'` (잠금이 만든 것만. `replaced`·`demoted`·사용자 해지는 그대로 거절)
2. 그 워크스페이스에 **살아 있는 구독이 없다** — `Subscription.count({business_id, status IN ('pending','active','past_due','grace')}) === 0`
3. `sub.plan_code === biz.plan` (관리자가 그 사이 플랜을 바꿨으면 거절 — `ensureRenewalPayment` 가드 1 과 같은 술어)

**변경 1** `services/billing.js`
```js
// 결제를 확정해도 되는 구독인가 — 살아 있거나, 잠금으로만 닫힌 뒤 후계가 없는 것.
// 세 조건을 한 곳에 둔다: markPaymentPaid(확정) · findPayablePending(/status) 이 같은 함수를 부른다.
async function subscriptionConfirmability(sub, biz, { transaction } = {}) {
  if (LIVE_SUB.includes(sub.status)) return { ok: true, revive: false };
  if (sub.status !== 'canceled' || sub.cancel_reason !== 'trial_expired_no_payment') return { ok: false, reason: 'subscription_superseded' };
  const live = await Subscription.count({ where: { business_id: sub.business_id, status: { [Op.in]: LIVE_SUB } }, transaction });
  if (live > 0) return { ok: false, reason: 'subscription_superseded' };
  if (biz && biz.plan !== sub.plan_code) return { ok: false, reason: 'plan_mismatch' };
  return { ok: true, revive: true };
}
const LIVE_SUB = ['pending', 'active', 'past_due', 'grace'];
```
`markPaymentPaid` (`:292-299`): `const biz = Business.findByPk(sub.business_id, {transaction:t, lock})` 를 **위로 올리고**(지금은 `:366`), `const conf = await subscriptionConfirmability(sub, biz, {transaction:t}); if (!conf.ok) { await t.rollback(); const e = new Error(conf.reason); e.code = conf.reason; e.statusCode = 409; throw e; }`.
`:307` `const wasFirst = sub.status === 'pending';` → `const wasFirst = !sub.started_at;` (되살린 구독은 한 번도 활성화된 적이 없다 — 첫 결제·보너스 자격이 맞다. pending/active 에서는 종전과 같은 값).
`:341-348` sub.update 에 `canceled_at: null, cancel_reason: null` 추가(되살림 흔적은 감사 행 `revived: conf.revive` 로 남긴다 — `:394` newValue 에 추가).
`:368-375` biz.update 에 `grace_ends_at: null` 추가(잠금 뒤 남은 유예 시각이 planActive 를 흐리지 않게).

**변경 2** `/status` 가 보여줄 pending 도 같은 술어 — `services/billing.js`
```js
// 화면이 «결제하세요» 로 띄워도 되는 pending 플랜 결제 — 확정될 수 있는 것만. addon 은 제외(kind 미필터 버그: dev biz 1 의 애드온 pending 이 플랜 결제창을 열고 있었다).
async function findPayablePending(businessId) {
  const rows = await Payment.findAll({ where: { business_id: businessId, kind: 'plan', status: 'pending' }, order: [['created_at','DESC']], limit: 5 });
  const biz = await Business.findByPk(businessId, { attributes: ['id','plan'] });
  for (const p of rows) {
    const sub = await Subscription.findByPk(p.subscription_id);
    if (sub && (await subscriptionConfirmability(sub, biz)).ok) return p;
  }
  return null;
}
```
`routes/plan.js:76-79` 의 `PaymentModel.findOne(...)` → `billing.findPayablePending(businessId)`. 응답 모양 무변경.

**변경 3** 새 체크아웃이 열리면 **확정될 수 없는** pending 을 닫는다 — `createPendingSubscription`(`:186-195` 바로 뒤, 같은 t)
```js
await closeDeadPendingPayments(businessId, t);   // 아래
```
```js
// 살아 있지 않은 구독(replaced/canceled/demoted)에 매달린 pending 플랜 결제를 닫는다. 결제 확정 시(markPaymentPaid 가 다른 active 를 replaced 로 민 뒤)에도 부른다.
async function closeDeadPendingPayments(businessId, transaction) {
  return Payment.update({ status: 'canceled', cancel_reason: 'subscription_not_live' }, { where: {
    business_id: businessId, kind: 'plan', status: 'pending',
    subscription_id: { [Op.in]: sequelize.literal(`(SELECT id FROM subscriptions WHERE business_id = ${Number(businessId)} AND status IN ('replaced','canceled','demoted'))`) },
  }, transaction });
}
```
`markPaymentPaid` `:353-363` supersede 뒤에도 호출. 되살림 대상(잠금 canceled)도 이 시점엔 새 pending 구독이 생겨 «후계 있음» 이 되므로 함께 닫힌다 — 잠긴 오너가 **다른 플랜**을 골라 새로 체크아웃하면 옛 안내는 자동으로 죽는다(의도).

**변경 4** 라우트 오류 매핑 — `routes/admin_billing.js:160,347` 는 `next(err)` 그대로 두되 `err.statusCode=409` 를 서비스가 붙였으므로 `errorHandler`(`middleware/errorHandler.js:73`) 가 409 로 내린다. 웹훅(`stripeWebhook.js:52-54`)은 500 유지(Stripe 재시도가 맞다 — 되살림 조건이 맞으면 재시도에서 성공).

**변경 5** `routes/admin.js:262` PUT plan — 잠긴 워크스페이스(`subscription_status==='canceled'`)에 유료 플랜과 `plan_expires_at` 을 주면 `planEngine.changePlan(..., { subscriptionStatus: 'active', graceEndsAt: null })`. `services/plan.js:396 changePlan` 시그니처에 `subscriptionStatus = null` 추가(`if (subscriptionStatus !== null) patch.subscription_status = subscriptionStatus`). 관리자 우회가 잠금을 못 푸는 결함(revenue 5-13 끝) 닫힘.

**문구** `services/trial.js:36` locked 본문: `'결제가 확인되지 않아 워크스페이스가 잠금 상태로 전환됐습니다. 안내받은 계좌로 입금하고 결제 페이지에서 «입금했어요» 를 누르면 운영팀 확인 후 바로 복구됩니다.'` (서버 ko 문자열 — 0-I 범위에서 i18n).

**경계** · 잠금 뒤 체험 플랜이 `starter` 인데 관리자가 `basic` 으로 바꿔 둔 경우 → `plan_mismatch` 409: 관리자는 새 체크아웃을 안내한다(화면은 pending 을 안 보여주므로 오너가 열면 새 체크아웃이 만들어진다). · 같은 Payment 중복 확정 → 종전 `alreadyPaid`. · Stripe 로 결제한 잠금 워크스페이스: `stripe-checkout` 라우트(`routes/plan.js:420`) 는 `pay.status==='pending'` 만 보므로 그대로 통과 → 웹훅 → 되살림. · 운영 4건: 조건 1·2 는 모두 충족(실측 `live_subs` 를 1-2 SELECT 로 재확인), 조건 3 은 SELECT 의 `plan_code = plan` 으로 확인.

### A-③ 다운그레이드 예약이 실제로 적용된다

**사실 확인(운영 접근 없이 dev 로 추론)** `scheduled_plan` 은 **`businesses.scheduled_plan ENUM('free','starter','basic','pro','enterprise') NULL`** 이다(`models/Business.js:151-154`, dev DB 실존). `subscriptions` 에는 dev 에도 없다 → 운영 관측 «subscriptions 에 없음» 은 정상이다. 운영 `businesses` 에는 있어야 한다(`routes/admin.js:156` 가 그 컬럼을 attributes 로 읽는 관리자 목록이 돌고 있다 — 없으면 이미 500). 그래도 `migrate-billing-0a.js` 가 **없으면 추가** 한다(fail-safe). 전용 마이그레이션 스크립트는 없었고 phase0 sync 로 생겼다.

**현재** 쓰기만 있다: `routes/plan.js:252-273`(예약) · `:330-353`(취소) · `routes/admin.js:294`. 읽어서 적용하는 코드 0. `markPaymentPaid:373` 이 결제 때마다 `scheduled_plan:null` 로 지운다. `dev-backend/scripts/plan-expiry-check.js:82-100` 에 적용 코드가 있지만 **어디서도 실행되지 않는다**(ecosystem·crontab·server.js 전부 미참조) 그리고 체험 종료를 free 로 떨어뜨리는 옛 정책이라 돌려서도 안 된다 → **삭제**.

**판정 — 갱신 시점에 예약 플랜의 pending 구독을 만든다.** Payment 에 플랜 칸을 새로 두지 않는다. 결제 확정(`markPaymentPaid`)은 «pending 구독이 active 가 되며 다른 active 를 밀어내고 Business.plan 을 그 구독 플랜으로 맞춘다» 를 이미 한다. 예약 적용은 그 길을 그대로 탄다.

**변경** `services/billing.js ensureRenewalPayment(sub)` (`:500-554`)
```js
const biz = await Business.findByPk(sub.business_id, { attributes: ['id','plan','scheduled_plan', ...ADDON_FIELDS] });
// (가드 1·2 종전대로)
const targetPlan = (biz.scheduled_plan && biz.scheduled_plan !== sub.plan_code) ? biz.scheduled_plan : sub.plan_code;
if (targetPlan === 'free') return { payment: null, created: false, skipped: 'scheduled_free' }; // free 는 폐지 플랜 — 예약돼 있어도 청구를 만들지 않는다(기존 과금 종료 → 유예 → 강등 경로가 처리)
let targetSub = sub;
if (targetPlan !== sub.plan_code) {
  // 멱등: 이미 예약 플랜의 pending 구독이 있으면 재사용
  targetSub = await Subscription.findOne({ where: { business_id: sub.business_id, status: 'pending', plan_code: targetPlan } })
    || await Subscription.create({ business_id: sub.business_id, plan_code: targetPlan, cycle: sub.cycle, status: 'pending',
         price: getPlanPrice(targetPlan, sub.cycle, sub.currency || 'KRW'), currency: sub.currency || 'KRW', bonus_months: 0, created_by: null });
}
const existing = await Payment.findOne({ where: { subscription_id: targetSub.id, status: 'pending' } });  // 기존 `existing` 검사를 targetSub 기준으로 옮긴다
if (existing) return { payment: existing, created: false };
const lines = buildRenewalLines(targetSub, biz);            // A-④
const amount = lines.reduce((s, l) => s + l.amount, 0);
const pay = await Payment.create({ ..., subscription_id: targetSub.id, amount, line_items: lines, ... });
```
`markPaymentPaid:368-375` 의 `scheduled_plan` 처리: `scheduled_plan: (sub.plan_code !== fromPlan) ? null : biz.scheduled_plan` — **플랜이 바뀐 결제만** 예약을 지운다. 같은 플랜 갱신(예약을 유예 중에 건 경우 등)은 예약을 **다음 사이클로 넘긴다**(지금은 조용히 사라졌다).
`routes/plan.js:254` 예약 기준일: `biz.plan_expires_at || sub?.current_period_end || now+30d` — 활성 구독의 기간 끝을 먼저 본다(`billing.getCurrentSubscription`).

**경계** · 예약 플랜 pending 구독이 있는데 사용자가 예약을 취소(`cancel-schedule`) → 라우트에서 `Subscription.update({status:'replaced'}, {where:{business_id, status:'pending', plan_code: scheduled}})` + `closeDeadPendingPayments` → 다음 cron 이 원래 플랜의 갱신 청구를 만든다(멱등). · 예약 플랜 pending 이 있는 채로 **원래 플랜** 결제가 들어오는 일은 없다(원래 구독에는 pending 을 더 만들지 않는다). · 금액은 **예약 플랜 가격**(`price_monthly/yearly[currency]`)이고 선불 보너스는 0.
**삭제** `dev-backend/scripts/plan-expiry-check.js`.

### A-④ 애드온이 갱신 청구에 합산된다

**현재** `addonBilling.js:13` 주석 «정기 갱신은 다음 사이클에 합산» 은 거짓 — `billing.js:533-537` 은 `sub.price` 뿐. 애드온은 첫 일할 결제 뒤 영구 무료. 운영 애드온 결제 0건(dev 2건).

**판정** 갱신 금액 = 플랜 가격 + Σ(애드온 수량 × 월단가 × (yearly ? 12 : 1)). 연간은 할인 없이 ×12(애드온 카탈로그에 `price_yearly` 가 없다 — 새로 정하지 않는다). 내역은 `payments.line_items JSON` 에 박제해 영수증·관리자 화면이 «왜 이 금액인가» 를 말한다.

**변경**
- `services/addonBilling.js` 신규
  ```js
  // 갱신 청구에 실을 애드온 줄들 — Business.addon_* 현재값 기준(해지하면 즉시 0 이므로 «다음 결제부터 빠짐» 이 성립)
  function renewalAddonLines(biz, cycle, currency = 'KRW') {
    const mult = cycle === 'yearly' ? 12 : 1;
    return ADDONS.filter(a => Number(biz[a.field] || 0) > 0).map(a => {
      const qty = Math.ceil(Number(biz[a.field]) / a.unit);
      const unit = a.price_monthly?.[currency] ?? 0;
      return { kind: 'addon', code: a.code, label: a.name_ko || a.name, quantity: qty, unit_price: unit, months: mult, amount: roundMoney(unit * qty * mult, currency) };
    }).filter(l => l.amount > 0);
  }
  ```
  `addonBilling.js:13` 주석을 사실로 고친다.
- `services/billing.js` 신규 `buildRenewalLines(sub, biz)` = `[{ kind:'plan', code: sub.plan_code, label, cycle, amount: planPrice }, ...renewalAddonLines(biz, sub.cycle, sub.currency)]`. `createPendingSubscription` 도 첫 결제에 `line_items: [plan 줄]` 을 적는다(모양 통일; 애드온은 첫 결제엔 없다 — 일할 결제가 따로 있다).
- `models/Payment.js` `line_items: { type: DataTypes.JSON, allowNull: true }` + 마이그레이션.
- 영수증 PDF `billing.js buildReceiptPdf:787-795`: `line_items` 가 있으면 줄마다 한 행(플랜 / 애드온 라벨 × 수량), 없으면 종전 한 줄. `routes/plan.js GET /:biz/payments`(`:566` 부근) 응답에 `line_items` 포함(이 라우트의 `toJSON()` 통째 노출은 revenue 5-18 — 0-A 밖, 손대지 않는다).
- 프론트 `PlanSettings.tsx` 결제 이력 행: `line_items?.length > 1` 이면 금액 아래 작은 글씨 `plan.billing.history.lines` («플랜 39,000원 + 애드온 2건») — 선택이 아니라 **필수**(숫자가 플랜표와 달라지면 사용자는 오류로 읽는다).

**경계** · 애드온이 다음 사이클에 합산되므로 **일할 결제는 지금처럼 한 번**이다(변경 없음). · 애드온 수량이 `unit` 의 배수가 아닌 값(관리자 수기)은 올림. · `currency` 가 USD 인 구독의 애드온 단가는 `price_monthly.USD`(있다). · 미입금 애드온 회수는 범위 밖(§1-1).

### A-⑤ 체험 잔여일이 첫 기간에 이어진다

**현재** `billing.js:302-304` `periodStart = current_period_end > now ? current_period_end : now` — 체험 중(D+3) 결제하면 11일 소멸. 선불 보너스도 같은 공식 위.

**판정** 첫 결제(`wasFirst`)이고 `biz.subscription_status === 'trialing' && biz.trial_ends_at > now` 이면 `periodStart = biz.trial_ends_at`. 그 위에 `computePeriodEnd(periodStart, cycle, bonus)`. **공식은 그대로 하나**(`computePeriodEnd` 무변경) — 시작점만 정한다.

**변경** `services/billing.js`
```js
// 기간 시작 — 한 함수. markPaymentPaid(확정)와 /checkout 미리보기가 같이 쓴다(화면이 따로 계산하면 갈라진다).
function resolvePeriodStart({ sub, biz, now = new Date() }) {
  if (sub.current_period_end && sub.current_period_end > now) return sub.current_period_end;   // 연장
  if (!sub.started_at && biz && biz.subscription_status === 'trialing' && biz.trial_ends_at && biz.trial_ends_at > now) return new Date(biz.trial_ends_at);  // 체험 잔여 승계
  return now;
}
function previewPeriod({ sub, biz, now = new Date() }) {
  const start = resolvePeriodStart({ sub, biz, now });
  const bonus = !sub.started_at ? (Number(sub.bonus_months) || 0) : 0;
  return { period_start: start, period_end: computePeriodEnd(start, sub.cycle, bonus), bonus_months: bonus,
           trial_days_carried: start > now && biz?.subscription_status === 'trialing' ? Math.ceil((start - now) / 86400e3) : 0 };
}
```
`markPaymentPaid:302-304` → `const periodStart = resolvePeriodStart({ sub, biz, now })` (biz 는 A-② 에서 위로 올렸다).
`createPendingSubscription` 반환에 `preview: previewPeriod({sub, biz})` 추가 → `routes/plan.js /checkout` 응답(`:404-412`)에 `period_end_preview`·`trial_days_carried` 추가. `/status`(`:115-`) `pending_payment` 에도 같은 두 값(`findPayablePending` 이 sub·biz 를 이미 들고 있다).

**화면** `CheckoutModal.tsx:216-228` 보너스 줄 아래에 **항상**(보너스 없어도) 한 줄:
- `checkout.nextBilling`: ko `"다음 결제일 {{date}}"` · en `"Next payment on {{date}}"`
- `trial_days_carried > 0` 이면 `checkout.trialCarry`: ko `"남은 체험 {{days}}일은 그대로 이어집니다"` · en `"Your remaining {{days}} trial days carry over"`
- `checkout.bonusPeriod` 문구는 유지(`--suite prepay` 가 «2개월» 을 본다). 서비스 `services/plan.ts:192 checkout()` 반환 타입에 `period_end_preview?: string; trial_days_carried?: number` 추가, `PlanSettings.tsx:597-598` 가 `existingPaymentId` 와 함께 pending 의 두 값을 모달에 넘긴다.

**경계** · 보너스 + 체험 승계 동시: 시작 = 체험 끝, 끝 = +1개월+보너스(둘 다 적용 — 결정, §8). · 체험 중인데 `started_at` 이 있는 구독(없다 — 체험은 pending 뿐) · 잠금 되살림(A-②)은 `trialing` 이 아니므로 now 시작.

---

## 3. 0-B 청구 정합

### B-① 금액 DECIMAL(14,2) + 통화별 반올림

**현재** `invoices.total_amount/tax_amount/grand_total` DECIMAL(12,0) · `invoice_items.unit_price/amount` DECIMAL(12,0)(`models/Invoice.js:29-40`, `InvoiceItem.js:30-37`, dev DB 동일). 같은 표 안 `subtotal/paid_amount` 는 (14,2), `invoice_installments.amount` (14,2), `invoice_payments.*` (14,2), `quotes/quote_items` (14,2). VAT·회차 반올림은 `Math.round` 정수 7곳(`routes/invoices.js:794,812,945,971,1110,1311,1333`, `recurring_invoice.js:97`, `clientSubscriptionBilling.js:140`).

**판정** 다섯 컬럼을 (14,2) 로 넓히고, **쓰기 시점 반올림을 통화별로 한 함수**로 한다. KRW·JPY 는 0자리(지금 동작 유지), 그 외 2자리. 절단은 0 곳.

**변경**
- 신규 `dev-backend/services/money.js`
  ```js
  const ZERO_DECIMAL = new Set(['KRW','JPY','VND','CLP','KMF','XOF','XAF','BIF','DJF','GNF','PYG','RWF','UGX','VUV','XPF']);  // stripeCheckoutService:9 에서 옮긴다
  function decimalsOf(currency) { return ZERO_DECIMAL.has(String(currency || 'KRW').toUpperCase()) ? 0 : 2; }
  function roundMoney(n, currency) { const f = 10 ** decimalsOf(currency); return Math.round((Number(n) || 0) * f) / f; }
  function toMinorUnits(n, currency) { return Math.round(roundMoney(n, currency) * 10 ** decimalsOf(currency)); }   // Stripe unit_amount
  module.exports = { ZERO_DECIMAL, decimalsOf, roundMoney, toMinorUnits };
  ```
  `services/stripeCheckoutService.js:9-15` 는 `money.js` 를 require 해 `toStripeAmount = toMinorUnits` (export 이름 유지).
- 모델 5 컬럼 `DataTypes.DECIMAL(14, 2)`.
- `routes/invoices.js` 생성(`:923-951`)·수정(`:1293-1315`)·복사(`:778-795`): 품목 `amount = roundMoney(qty × unit_price, currency)`, `unit_price = roundMoney(unit_price, currency)`, `subtotal = Σamount`, `taxAmount = roundMoney(subtotal × vatRate, currency)`, `grandTotal = roundMoney(subtotal + taxAmount, currency)`. 회차(`:971,1333,812`): `roundMoney(grandTotal × pct/100, currency)`, 마지막 회차 `roundMoney(grandTotal − allocated, currency)`. `:1110` supply 역산도 `roundMoney`. `recurring_invoice.js:97`·`clientSubscriptionBilling.js:140` 동일 치환(통화는 그 payload 의 currency).
- 입력 검증(POST/PUT): `unit_price`·`quantity` 가 유한수·≥0 아니면 400 `invalid_amount`(지금은 `Number(x)||0` 으로 삼킨다).
- 프론트 `services/invoices.ts:697 formatMoney`: USD `minimumFractionDigits: 2`; EUR 추가(`de-DE` 2자리) · 그 외 비 KRW/JPY 2자리. 같은 파일에 `roundMoney(n, currency)`(서버와 같은 표) 추가 → `NewInvoiceModal.tsx:967`·소계·VAT 미리보기가 쓴다. `NewInvoiceModal.tsx:879` 단가 입력 `step={currency === 'KRW' || currency === 'JPY' ? 1 : 0.01}`.
- **Irene ②-(a) «KRW 외 숨김»**: 0-B 가 한 배포에 마이그레이션을 싣는다. (a) 가 아직 적용 전이면 **건너뛴다**(이 설계대로 가는 것이 (b)); 그 사이 다른 방이 (a) 를 넣었으면 **같은 커밋에서 되돌린다**(숨김이 남으면 외화 청구가 영영 안 된다).

**마이그레이션** `scripts/migrate-invoice-money.js` (§4-1). 운영 KRW 7건·소수 0건이라 데이터 변환 없음.

**경계** · 옛 행은 정수가 그대로 `x.00` 으로 읽힌다(표시 무변경). · `vat_rate` DECIMAL(4,3) 그대로. · 공개 결제 Stripe 금액은 `toMinorUnits` 로 센트 단위(USD 109.99 → 10999) — 지금은 100 → 10000 으로 틀리게 나갔다.

### B-② 청구서 번호 — 워크스페이스 축 + 동시성 + 한 함수

**현재** 네 생성 경로가 각자 전역 `INV-YYYY-%` 최대값 스캔: `routes/invoices.js:107-120`(POST `:899`·복사 `:748`) · `recurring_invoice.js:20-37` · `clientSubscriptionBilling.js:11-27`. 테넌트끼리 번호가 섞이고(dev biz 5·105·122 실측), 락 없음(csb 만 UNIQUE 충돌 재시도 5회). UNIQUE 는 `invoice_number` 단일 — 같은 이름의 인덱스가 **두 개**(`invoice_number`·`invoices_invoice_number_unique`).

**판정**
- 형식 `INV-YYYY-NNNN` 유지(4자리 패딩, 넘치면 자릿수가 는다 — varchar(20)).
- 축 = `(business_id, year)`. **기존 번호는 그대로**, 각 워크스페이스는 자기 현재 최대 다음부터(biz 105 → 0043, 새 워크스페이스 → 0001).
- 동시성 = **카운터 행을 트랜잭션 안에서 UPDATE** (행 락이 같은 워크스페이스의 동시 생성을 직렬화하고, 롤백이면 번호도 되돌아가 빈 번호가 안 생긴다). `MAX()+1` 은 쓰지 않는다(갭 락에 의존). UNIQUE 충돌은 **벨트**로 3회 재시도(카운터 밖에서 들어온 번호 대비).
- DB UNIQUE = `(business_id, invoice_number)`. 단일 UNIQUE 2개는 **마이그레이션이** 지우고 비유니크 `invoices_invoice_number_idx` 를 남긴다(검색용).
- `payerCodeOf`(`receiptsDue.js:307-311`) 의 «순번 4자리는 연도 내 유일» 은 «워크스페이스별 연도 내 유일» 로 주석 정정 — 입금 코드는 그 워크스페이스 계좌로 들어오므로 축이 맞다.

**변경**
- 신규 `dev-backend/models/InvoiceNumberCounter.js` (`invoice_number_counters`: `business_id INT NOT NULL, year SMALLINT NOT NULL, last_no INT NOT NULL DEFAULT 0, PRIMARY KEY(business_id, year)`, timestamps 없음).
- 신규 `dev-backend/services/invoiceNumber.js`
  ```js
  // 청구서 번호는 **여기서만** 뽑는다(가드 health-check money-7 이 다른 곳의 'INV-' LIKE 스캔을 센다).
  // transaction 은 필수에 가깝다 — 없이 부르면 카운터가 즉시 커밋돼 INSERT 실패 시 빈 번호가 남는다(cron 두 엔진은 트랜잭션으로 감싼다).
  async function nextInvoiceNumber(businessId, { transaction, year = new Date().getFullYear() }) {
    const prefix = `INV-${year}-`;
    await sequelize.query('INSERT IGNORE INTO invoice_number_counters (business_id, year, last_no) VALUES (?, ?, 0)', { replacements: [businessId, year], transaction });
    // 시드: 카운터가 0 이고 그 워크스페이스에 이미 번호가 있으면 MAX 로 끌어올린다(마이그레이션이 시드하지만 새 연도·누락 대비)
    await sequelize.query(`UPDATE invoice_number_counters c SET c.last_no = GREATEST(c.last_no, COALESCE((SELECT MAX(CAST(SUBSTRING_INDEX(invoice_number,'-',-1) AS UNSIGNED)) FROM invoices WHERE business_id = c.business_id AND invoice_number LIKE ?), 0)) WHERE c.business_id = ? AND c.year = ? AND c.last_no = 0`, { replacements: [`${prefix}%`, businessId, year], transaction });
    await sequelize.query('UPDATE invoice_number_counters SET last_no = last_no + 1 WHERE business_id = ? AND year = ?', { replacements: [businessId, year], transaction });   // 행 락 → 커밋까지 직렬화
    const [[row]] = await sequelize.query('SELECT last_no FROM invoice_number_counters WHERE business_id = ? AND year = ?', { replacements: [businessId, year], transaction });
    return `${prefix}${String(row.last_no).padStart(4, '0')}`;
  }
  // UNIQUE 충돌 벨트 — create 콜백을 3번까지 새 번호로 다시 시도. idempotency_key 충돌은 재시도하지 않는다(호출부가 가른다).
  async function withInvoiceNumber(businessId, transaction, createFn) { … }
  module.exports = { nextInvoiceNumber, withInvoiceNumber, INVOICE_NUMBER_RE: /^INV-(\d{4})-(\d{4,})$/ };
  ```
- `routes/invoices.js:107-120` 삭제 → `:899`·`:748` 은 `nextInvoiceNumber(Number(req.params.businessId), { transaction: t })`.
- `recurring_invoice.js:20-37`·`clientSubscriptionBilling.js:11-27` 삭제 → 각 엔진의 `Invoice.create` 를 `sequelize.transaction(async t => { number; create({…}, {transaction:t}) })` 로 감싸고 csb 의 재시도 루프(`:196-215`)는 `withInvoiceNumber` 로 치환(멱등키 충돌 → 종료 분기는 유지).
- `models/Invoice.js:195-199` indexes: `{ unique: true, fields: ['business_id','invoice_number'], name: 'invoices_biz_invoice_number_unique' }` + `{ fields: ['invoice_number'], name: 'invoices_invoice_number_idx' }`; 단일 UNIQUE 선언 제거. 주석(`:180-185`)도 갱신.
- `models/index.js` 에 `InvoiceNumberCounter` 등록.

**경계** · 연도 바뀜: 새 `(biz, year)` 행 → 0001(지금 동작과 같다). · `CB-…`·`L-C-…` 같은 비표준 번호(dev biz 3)는 스캔 정규식에 안 걸려 카운터에 영향 없다. · 복사(`duplicate`)·수기 생성이 동시에 눌려도 같은 카운터 행에서 직렬화. · 롤백 시 옛 코드(전역 MAX+1)가 뽑는 번호는 전역 최대보다 크므로 복합 UNIQUE 에 안 걸린다; 재배포 때 마이그레이션 시드가 `GREATEST` 로 따라잡는다.

### B-③ client_id · project_id 테넌트 검증

**현재** `routes/invoices.js:904,918`(POST)·`:1272`(PUT) 가 본문 id 를 그대로 저장. `source_post_id` 만 검증(`:861`). 남의 client_id 를 넣으면 응답 include 로 그 고객 사업자정보가 나오고 메일이 그 주소로 간다. `routes/client_subscriptions.js:95` 는 검증한다(같은 술어 두 벌).

**변경** 신규 `dev-backend/services/tenantRef.js`
```js
// «이 워크스페이스의 것인가» — 청구서·고객 구독·(앞으로의) 모든 참조 칸이 이 둘을 부른다. 없으면 400 (404 는 존재를 알려준다).
async function assertClientInBusiness(clientId, businessId, { transaction } = {}) {
  if (clientId == null || clientId === '') return null;
  const c = await Client.findOne({ where: { id: Number(clientId), business_id: Number(businessId) }, attributes: ['id'], transaction });
  if (!c) { const e = new Error('client_not_in_workspace'); e.code = 'client_not_in_workspace'; e.statusCode = 400; throw e; }
  return c.id;
}
async function assertProjectInBusiness(projectId, businessId, { transaction } = {}) { … Project … 'project_not_in_workspace' }
```
POST: `client_id: await assertClientInBusiness(client_id, req.params.businessId, {transaction:t})`, `project_id: await assertProjectInBusiness(project_id, …)`. PUT `:1272` 동일(project_id 는 PUT 본문에 없다 — 그대로). `routes/client_subscriptions.js:95` 도 이 함수로 바꾼다(한 벌). 라우트는 try 안이므로 throw → `t.rollback()` 경로(`:1365-1368` 패턴)로 400.
프론트 `utils/apiError.ts` 매핑: `client_not_in_workspace` ko «선택한 고객이 이 워크스페이스에 없습니다» / en «The selected client is not in this workspace» · `project_not_in_workspace` ko «선택한 프로젝트가 이 워크스페이스에 없습니다» / en «The selected project is not in this workspace».

### B-④ 공개 응답에서 출처 문서 토큰 제거

`routes/invoices.js:186-189` `sourcePost = { id, category, title }` 로(`share_token` 제거, `attributes` 에서도 뺀다). `:210` 주석 삭제. 프론트 `PublicInvoicePage.tsx:74` 타입에서 `share_token` 제거(사용처 0). 회귀는 `secrets` 카테고리(§5).

### B-⑤ receipt-request 는 고객 마스터를 건드리지 않는다

**현재** `routes/invoices.js:560-583` 공개 토큰 소지자의 제출이 `Client.update({ biz_name, biz_tax_id, biz_ceo, biz_type, biz_item, biz_address, tax_invoice_email, billing_contact_* })` — 링크가 전달되면 제3자가 고객 마스터·세금계산서 수신 메일을 바꾼다. 동기는 «정기청구 고객이 매번 재입력하지 않게» 였다.

**판정** 공개 제출은 **그 청구서의 `receipt_profile`** 에만 남긴다(이미 한다). 재입력 방지는 **같은 고객의 직전 제출본**으로 prefill 한다 — 고객이 스스로 적은 값으로 고객 자신의 다음 청구서를 채우는 것이라 권한 확대가 없다. 마스터 갱신은 멤버 화면(고객 상세)의 몫이다(이번에 버튼을 새로 만들지 않는다 — 1단계 «증빙정보로 고객정보 갱신» 후보로 적어 둔다).

**변경**
- `routes/invoices.js:560-583` 블록 **삭제**.
- `services/receiptsDue.js:344 resolveReceiptProfile(inv, client, priorProfile = null)` — 순서 `customer(inv.receipt_profile)` → **`history(priorProfile)`** → `client` → `recipient`. 시그니처만 늘고 기존 호출 3곳은 그대로 동작.
- 같은 파일 신규 `async function loadPriorReceiptProfiles(invoices)` — `client_id` 가 있는 것들에 대해 한 쿼리: `Invoice.findAll({ where: { business_id, client_id IN (...), receipt_profile: {[Op.ne]: null}, id: {[Op.notIn]: ids} }, order: [['receipt_requested_at','DESC']] })` → `Map(client_id → profile)`. 호출: 공개 GET `:248` · 상세 `:1204` · 목록/큐 `:704`(배치) 가 `priorProfile` 을 넘긴다. **같은 함수에 같은 입력**이라 세 표면이 갈라지지 않는다.
- 응답 `receipt.profile_source` 에 `'history'` 값이 추가된다 — 공개 페이지는 source 를 표시하지 않으므로 화면 변경 없음(타입만).

**경계** · 외부 고객(client_id 없음)은 종전대로 `receipt_profile` 또는 `recipient_*`. · 고객이 두 워크스페이스에 각각 등록돼 있어도 `business_id` 를 걸어 섞이지 않는다.

---

## 4. 마이그레이션 스크립트 (둘 다 `dev-backend/scripts/` · 멱등 · `--dry`)

### 4-1. `migrate-invoice-money.js`
```
① invoices.total_amount / tax_amount / grand_total   : SHOW COLUMNS Type 이 'decimal(14,2)' 아니면 MODIFY COLUMN … DECIMAL(14,2) NOT NULL DEFAULT 0.00 (NULL 허용 여부는 현재 Null 값 유지)
② invoice_items.unit_price / amount                  : 같은 방식
③ CREATE TABLE IF NOT EXISTS invoice_number_counters (business_id INT NOT NULL, year SMALLINT NOT NULL, last_no INT NOT NULL DEFAULT 0, PRIMARY KEY (business_id, year)) ENGINE=InnoDB
④ 시드: INSERT INTO invoice_number_counters (business_id, year, last_no)
        SELECT business_id, CAST(SUBSTRING(invoice_number,5,4) AS UNSIGNED), MAX(CAST(SUBSTRING_INDEX(invoice_number,'-',-1) AS UNSIGNED))
        FROM invoices WHERE invoice_number REGEXP '^INV-[0-9]{4}-[0-9]+$' GROUP BY 1,2
        ON DUPLICATE KEY UPDATE last_no = GREATEST(last_no, VALUES(last_no))
⑤ 교차 테넌트 중복 사전 검사: SELECT business_id, invoice_number, COUNT(*) … GROUP BY 1,2 HAVING COUNT(*)>1 → 0건이 아니면 **중단**(exit 1, 사람이 본다)
⑥ SHOW INDEX 에 'invoices_biz_invoice_number_unique' 없으면 ADD UNIQUE INDEX (business_id, invoice_number)
⑦ 'invoices_invoice_number_idx' 없으면 ADD INDEX (invoice_number)
⑧ 단일 UNIQUE 'invoice_number' · 'invoices_invoice_number_unique' 가 있으면 DROP INDEX (⑥ 성공 뒤에만)
⑨ [verify] 컬럼 Type 5개 · 카운터 행 수 == 워크스페이스×연도 수 · 인덱스 상태 출력
```
롤백: 코드만(§1-4). ⑧ 을 되돌릴 일은 없다(옛 코드도 복합 UNIQUE 안에서 산다).

### 4-2. `migrate-billing-0a.js`
```
① businesses.scheduled_plan 없으면 ADD COLUMN scheduled_plan ENUM('free','starter','basic','pro','enterprise') NULL AFTER grace_ends_at (있으면 skip — dev 는 있음)
② payments.line_items 없으면 ADD COLUMN line_items JSON NULL AFTER currency
③ [verify] 두 컬럼 Type 출력 · 고아 pending 수(§1-2 두 번째 SELECT) 출력(정보용 — 데이터는 바꾸지 않는다)
```

---

## 5. 회귀 검사 명세 — `scripts/health-check.js` 새 카테고리 `money` (+ `secrets` 1건 추가)

`CATEGORIES` 에 `'money'` 추가. 픽스처는 기존 패턴(`execSync node -e` 로 dev DB 직접 쓰기, 끝에 **원복**)을 따른다. 돈 픽스처는 health-check 전용 워크스페이스(ctx.businessId)와 **그 검사 안에서 새로 만드는 1회용 워크스페이스**(biz 상태를 canceled 로 만들어야 하므로)만 건드린다. 각 검사는 **양성 대조군**(결함을 되살렸을 때 빨간불)을 같이 둔다.

| id | 검사 | 양성 대조군 |
|---|---|---|
| money-1 | sent·overdue·partially_paid 청구서(updated_at −40일, 토큰 있음) → `cleanupInvoiceTokens()` 뒤 토큰 **그대로**; canceled(−40일) 와 paid(paid_at −200일) 는 NULL; paid(−10일) 는 그대로 | 옛 where(`updated_at<cutoff` 단독)로 돌리면 sent 가 NULL 이 됨 |
| money-2 | 1회용 biz: trialing→잠금 상태 재현(biz canceled · sub canceled/trial_expired_no_payment · pay pending) → `GET /plan/:biz/status` 의 `pending_payment.id` == 그 pay → `markPaymentPaid` → biz active · sub active · `started_at` 설정 · 감사 `revived:true` | sub 를 `replaced` 로 바꾸면 409 `subscription_superseded`; biz.plan 을 다른 플랜으로 바꾸면 409 `plan_mismatch`; 살아 있는 pending 구독을 하나 더 만들면 `/status` 가 새 것을 고르고 옛 것 확정은 409 |
| money-3 | 애드온 pending(kind=addon)만 있는 biz → `/status.pending_payment` 가 **null** | 옛 쿼리(kind 미필터)로는 애드온이 잡힘 |
| money-4 | active sub(기간 끝 지남) + `businesses.scheduled_plan='starter'`(현재 basic) → `ensureRenewalPayment` → pending **Subscription(plan starter)** + Payment(amount == starter 가격) · 두 번 불러도 1건 · 결제 확정 → biz.plan starter · scheduled_plan NULL · 옛 basic sub replaced | scheduled_plan NULL 이면 기존 sub 에 basic 가격 pending; 같은 플랜 갱신 결제는 scheduled_plan 을 **지우지 않는다** |
| money-5 | biz.addon_members=2, addon_cue_actions=1000 → 갱신 Payment.amount == plan + 2×4,900 + 4,900 · `line_items` 3줄 · yearly 는 ×12 | addon 0 이면 plan 가격 그대로(줄 1개) |
| money-6 | trialing(trial_ends_at +10일) 첫 pending 결제 확정 → `sub.current_period_start == trial_ends_at` · `period_end == computePeriodEnd(trial_ends_at, cycle, bonus)` · `/checkout` 응답 `trial_days_carried==10` · `period_end_preview` == 확정 후 `period_end` | trial_ends_at 과거면 now 시작(carried 0) |
| money-7 | 통화별 저장: USD 품목 99.99×1, VAT 10% → `grand_total 109.99`·`tax_amount 10.00`(GET 재조회) · KRW 9999.4 → 9999 · 분할 3회차 합 == grand_total(2자리) · 공개 Stripe 금액 `toMinorUnits(109.99,'USD')==10999` | 옛 모델(12,0)·`Math.round` 로는 100/10/110 |
| money-8 | 번호: 두 1회용 biz 가 각각 첫 생성 → 둘 다 `INV-YYYY-0001`(복합 UNIQUE 통과) · 한 biz 에서 `Promise.all` 6건 동시 POST → 6개 서로 다른 연속 번호 · 기존 번호 있는 biz(ctx)는 `MAX+1` 이어감 · 소스에 `INV-${year}` LIKE 스캔이 `services/invoiceNumber.js` 밖에 0곳(grep) | 카운터 UPDATE 를 빼면 동시 6건 중 중복 발생(또는 409) |
| money-9 | POST 에 다른 워크스페이스 client_id → 400 `client_not_in_workspace` · project_id → 400 `project_not_in_workspace` · PUT 도 동일 · 자기 것은 201 | — |
| money-10 | 공개 `receipt-request` 제출 전후 `clients` 행 JSON 동일 · `invoices.receipt_profile` 저장 · 같은 고객 두 번째 청구서 공개 GET `receipt.profile` == 제출본(`profile_source=='history'`) · 다른 워크스페이스의 같은 이름 고객 청구서는 안 받음 | 옛 코드로는 clients 행이 바뀜 |
| secrets-4 (기존 카테고리에 추가) | 출처 문서(share_token 있음)를 단 청구서의 `GET /invoices/public/:token` 응답 **원문**에 그 토큰 문자열 0회 · `source_post.title` 은 있음(빈 응답 거짓 통과 방지) | — |
| billing(기존) | `--suite prepay` 가 여전히 «2개월» 을 본다 · `--category=billing` 2건 통과 | — |

실행: `node scripts/health-check.js --category=money,billing,secrets` (dev). 전체 게이트에도 포함되게 CATEGORIES 에 넣는 것으로 끝(별도 배선 없음 — 「게이트에 안 붙은 가드는 없는 가드」).

---

## 6. 문구 (ko/en 동시)

`dev-frontend/public/locales/{ko,en}/plan.json` `checkout`:
| 키 | ko | en |
|---|---|---|
| `checkout.nextBilling` | 다음 결제일 {{date}} | Next payment on {{date}} |
| `checkout.trialCarry` | 남은 체험 {{days}}일은 그대로 이어집니다 | Your remaining {{days}} trial days carry over |
| `billing.history.lines` | 플랜 {{plan}} + 애드온 {{count}}건 | Plan {{plan}} + {{count}} add-on(s) |

`common.json`(apiError 매핑): `errors.client_not_in_workspace` · `errors.project_not_in_workspace` · `errors.subscription_superseded`(ko «이 결제의 구독은 이미 다른 구독으로 바뀌었습니다. 현재 구독의 결제를 확인하세요.» / en «This payment's subscription has been superseded. Confirm the current subscription's payment instead.») · `errors.plan_mismatch`(ko «결제 플랜과 현재 플랜이 다릅니다. 새 결제를 만들어 주세요.» / en «The payment's plan differs from the current plan. Please create a new checkout.»).

서버 ko 문자열(0-I 범위): `trial.js:36` locked 본문(A-② 문구).

---

## 7. 구현 순서 (Opus) — 커밋은 하나, 작업은 이 순서

1. `services/money.js` + 모델 5컬럼 + `migrate-invoice-money.js`(①②⑨만 먼저) → dev 실행 → `routes/invoices.js`·두 cron 엔진 반올림 치환 → FE `formatMoney/roundMoney/step` → money-7.
2. `InvoiceNumberCounter` 모델 + `services/invoiceNumber.js` + 네 경로 치환 + 모델 indexes + 마이그레이션 ③~⑧ → dev 실행 → money-8.
3. `services/tenantRef.js` + POST/PUT/client_subscriptions → money-9. B-④ 한 줄 → secrets-4. B-⑤(`receiptsDue` + 라우트 블록 삭제) → money-10.
4. `shareTokenCleanup.js` → money-1.
5. `billing.js`: `LIVE_SUB`·`subscriptionConfirmability`·`findPayablePending`·`closeDeadPendingPayments`·`resolvePeriodStart`·`previewPeriod` → `markPaymentPaid` 수정(biz 선로드·wasFirst·revive·grace 정리·scheduled 규칙) → `routes/plan.js` /status·/checkout 응답 → `admin.js` PUT plan + `plan.js changePlan` 인자 → money-2·3·6.
6. `migrate-billing-0a.js` + `Payment.line_items` + `addonBilling.renewalAddonLines` + `ensureRenewalPayment` 재작성(예약 플랜 pending 구독·줄 합산) + cancel-schedule 정리 + 영수증 PDF·이력 표시 → money-4·5. `scripts/plan-expiry-check.js` 삭제.
7. CheckoutModal·PlanSettings 문구 2줄 + i18n + apiError → `npm run build`(EXIT 0·`error TS` 0) · `guard-invariants --category=i18n,parity,duproute,finance` · `health-check --category=money,billing,secrets` · `e2e --suite prepay`.
8. deploy 스크립트 슬롯 2줄 · `docs/FABLE_GATE_QUEUE.md` 에 라운드 기록 · 운영 §1-2 SELECT 결과 작업기록.

---

## 8. 갈림길 판정 기록 (Fable)

| # | 갈림길 | 판정 | 왜 |
|---|---|---|---|
| 1 | 청구서 cron: 제외 vs 상태별 | **상태별**(paid 180일, canceled/미발송 draft 30일, 나머지 영구) | paid 링크는 증빙 파일 내려받기 통로(#77). 영구 보존은 토큰 위생 정책과 어긋남 |
| 2 | 잠금 고아 pending: 닫기+새 checkout vs 되살림 | **되살림**(조건 3개) | 고객이 받은 입금 안내가 그 Payment 것이다. 운영 4건 데이터 변경 0. 관리자 2문·웹훅이 한 함수로 같이 고쳐진다. N+94 는 `replaced` 부활이 원인이었고 그 경로는 그대로 막힌다 |
| 3 | scheduled_plan 저장 위치 | **`businesses.scheduled_plan`(현행)**. subscriptions 에 새로 두지 않는다 | 이미 모델·관리자 화면·예약 라우트가 그 컬럼을 쓴다. 운영 관측은 다른 표를 본 것 |
| 4 | 예약 적용 방식: Payment 에 plan 칸 vs 예약 플랜 pending 구독 | **pending 구독** | `markPaymentPaid` 의 전환·승계·이력이 그대로 쓰인다. 새 분기 0 |
| 5 | 애드온 연간 가격 | **월단가 ×12(할인 없음)** | 카탈로그에 연간 단가가 없다. 새 가격을 설계가 정하지 않는다 |
| 6 | 체험 승계 + 선불 보너스 동시 | **둘 다 적용** | 둘은 다른 약속이다(«잔여일은 네 것» · «지금 내면 1개월 더»). 하나를 깎으면 문구가 거짓이 된다. 모달이 «다음 결제일» 을 서버 값으로 적는다 |
| 7 | 반올림 자리 | **KRW/JPY 0 · 그 외 2**, 쓰기 시점 한 함수 | Stripe ZERO_DECIMAL 표와 같은 원천 |
| 8 | 번호 동시성: MAX+1 FOR UPDATE vs 카운터 표 | **카운터 표(트랜잭션 안 UPDATE)** | 갭 락 의존 없이 직렬화·롤백 시 번호 회수. 벨트로 UNIQUE 재시도 3회 |
| 9 | 기존 번호 | **유지, 앞으로만**(Irene ③-a) | 발행된 번호를 바꾸지 않는다 |
| 10 | receipt-request 마스터 갱신 | **중단**, 직전 제출본 prefill | 무인증 쓰기 제거 + 재입력 방지 둘 다 |
| 11 | Irene ②-(a) KRW 외 숨김 | **이 배포에선 불필요**(마이그레이션 동봉). 이미 넣었으면 되돌림 | 숨김이 남으면 외화 청구가 영영 안 된다 |
| 12 | `plan-expiry-check.js` | **삭제** | 미배선 + 폐지 정책(체험 종료→free) |
| 13 | 애드온 미입금 회수 | **범위 밖** | 정책 결정 필요(사용 중 한도를 뺏는 행위) |
