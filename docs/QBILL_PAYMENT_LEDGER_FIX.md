# Q Bill 결제 원장(invoice_payments) 정합 + 구독 owner 가드

> 2026-07-20. 실검증으로 확정된 결함 2건 수정 설계. Fable 게이트 대상(재무 무결성 + DB 마이그레이션 + 권한 경계).

## 확정된 결함 (dev DB 실측)

**A. 매출이 항상 0.** `invoice_payments` 에 **write 하는 코드가 0건**(grep 확인). 그런데 `services/stats.js` 가 4곳(342·416·482·702·877)에서 매출·수금·수익성을 **전부 `InvoicePayment` 합계**로 계산한다. dev DB: paid/부분paid invoice 4건 + paid 회차 7건이 있는데 `invoice_payments` 행 **0** → 대시보드 매출·수익성이 전부 0.

**B. `client_subscriptions` owner 가드 없음.** 5개 mutation 라우트가 `requireMenu('qbill','write')` 만 있고 owner 가드 없음(routes/client_subscriptions.js:74·125·161·177). invoice send 는 `assertInvoiceMutationOwner` 로 owner-only 인데, member 가 구독 `bill-now`(:177)로 **owner-only 발행 정책을 우회**해 invoice 를 발행할 수 있다.

## 현재 결제 확정 경로 (셋 + 회수 둘) — "단일 착지점"이 실은 분산돼 있다

| 경로 | 위치 | 대상 | payment 기록 |
|---|---|---|---|
| markInstallmentPaid | services/invoicePayments.js:100 | 회차 (수동 invoices.js:1652 + webhook) | ❌ |
| markInvoicePaid | services/invoicePayments.js:168 | 단일 (webhook 만) | ❌ |
| PATCH /:id/status = paid | routes/invoices.js:2181 | **단일 수동** (실제 주경로) | ❌ |
| unmark-paid (회차) | routes/invoices.js:1679 | 회차 결제 취소 | ❌ (회수 대상) |
| PATCH status → canceled/sent | routes/invoices.js:2181 | 되돌림 | ❌ (회수 대상) |

## 설계

### D1. `invoice_payments.installment_id` 컬럼 추가 (nullable)
현재 스키마에 installment 참조가 없어 회차별 결제를 원장에 못 건다 → 회차 unmark 시 어떤 payment 를 회수할지 특정 불가. `installment_id INT NULL references invoice_installments(id)` 추가. 단일 invoice 결제는 NULL. 멱등 마이그레이션(`scripts/migrate-invoice-payment-installment.js`, 컬럼 존재검사).

### D2. payment append 를 **결제 확정 트랜잭션 내부**에 넣는다 (멱등은 기존 status 가드가 보장)
- `markInstallmentPaid`: inst.status 를 'paid' 로 바꾸는 트랜잭션 안에서 `InvoicePayment.create({ invoice_id, installment_id, amount: inst.amount, method, paid_at, pg_*, recorded_by, currency })`. **이미 paid 면 함수 진입 자체가 `alreadyPaid` 로 빠지므로**(invoicePayments.js:109) 재호출해도 payment 중복 생성 안 됨 — 자연 멱등.
- `markInvoicePaid`: 동일. amount=grand_total, installment_id=NULL. 이미 paid 면 :172 에서 멱등 반환.
- **PATCH status=paid (단일 수동)**: markInvoicePaid 로 **위임**해 단일 착지점 복원. 단 draft→sent, →overdue, →canceled 등 다른 전이는 기존 인라인 유지, `status==='paid' && 회차 없음` 일 때만 위임. paid 재요청은 markInvoicePaid 멱등이 처리.
  - ⚠️ 회귀 주의: PATCH status 의 기존 부작용(audit·chat card·overdue unpause·bill event)과 markInvoicePaid 의 부작용이 **중복**되지 않게. markInvoicePaid 가 이미 chat card·overdue·bill event 를 수행하므로 위임 시 라우트에서 그 부분을 건너뛴다.

### D3. 회수(정합) 경로
- **회차 unmark-paid**(invoices.js:1679): 트랜잭션 안에서 해당 `installment_id` 의 payment 삭제(hard delete — 결제 취소는 "없던 일"). paid_amount 재계산은 기존 로직 유지.
- **PATCH status → canceled**: 그 invoice 의 payment 전부 삭제. → 매출에서 제외.
- **PATCH status = paid → 다른 상태(sent 등)** 되돌림: 단일 invoice payment 삭제.
- 원칙: **invoice/installment 의 paid 상태와 payment row 존재가 항상 일치**해야 한다(불변식). 이걸 가드로 박제(health-check 또는 guard-invariants).

### D4. 과거 데이터 백필 (`scripts/backfill-invoice-payments.js`, 멱등)
기존 paid 단일 invoice(4건) + paid 회차(7건)에 대해, payment 가 없으면 생성. paid_at 은 invoice.paid_at / inst.paid_at, method 는 inst.payment_method 또는 'bank_transfer', recorded_by 는 marked_by_user_id. **이미 payment 있으면 skip**(멱등). dev + 운영 양쪽 실행.

### D5. `client_subscriptions` owner 가드
5개 mutation 라우트(POST 생성·PUT·DELETE·bill-now)에 invoice 와 동일한 owner 검사 추가. `requireMenu` 는 유지하되 mutation 은 owner/platform_admin 만. GET(read)은 그대로. 헬퍼 재사용 검토 — `assertInvoiceMutationOwner`(req,res) 패턴 또는 req.businessRole 검사.

## method ENUM 매핑
`InvoicePayment.method` = `portone|bank_transfer|cash|other`. 결제 확정의 method 는 `bank_transfer|stripe`. 매핑: stripe → `method='other'`, `pg_provider='stripe'`, `pg_transaction_id=PaymentIntent`. bank_transfer → 그대로. (ENUM 에 stripe 추가하지 않음 — portone 전환 대비 최소 변경)

## 검증 계획 (실HTTP, 데이터 원복)
1. 단일 invoice 수동 mark-paid(PATCH status) → invoice_payments 1행 생성, amount=grand_total, stats 매출 반영 확인
2. 회차 mark-paid × 2 → payment 2행(installment_id 각각), 부분→완납 시 partially_paid→paid
3. **멱등**: 같은 mark-paid 재호출 → payment 추가 안 됨(행 수 불변)
4. 회차 unmark-paid → 그 payment 삭제, 다른 회차 payment 유지
5. invoice canceled → payment 전부 삭제, 매출에서 제외
6. Stripe webhook 시뮬 → method 매핑(other/pg_provider=stripe) 확인
7. 백필 스크립트 → 기존 4+7 건 payment 생성, 재실행 시 중복 0
8. **불변식 가드**: paid 상태 ↔ payment 존재 일치 (일부러 깨서 검출 확인)
9. **owner 가드**: member 토큰으로 구독 생성·bill-now → 403. owner 는 성공
10. 멀티테넌트: 타 워크스페이스 invoice payment 조회 불가

## 위험
① PATCH status 위임 시 부작용 중복(audit/card/event 2회) — 위임 분기에서 라우트측 부작용 건너뛰기 필수
② 백필 method/paid_at 부정확 시 과거 매출 왜곡 — inst/invoice 의 실제 paid_at 사용, 없으면 updated_at fallback + 로그
③ 회수 시 payment 삭제가 감사 이력을 지운다 — 결제 취소는 bill_event(unmark)로 별도 기록되므로 payment hard delete 수용. 단 환불(refund) 은 이번 범위 밖(refunded_amount 필드는 향후)
④ 운영 백필은 배포 후 1회 — deploy 후 수동 실행 또는 멱등이라 deploy 스크립트 편입 검토

---

## ★ Fable 설계검증 반영 (CONDITIONAL PASS → 정정) 2026-07-20

**전제 수치 정정**: mutation 라우트 = **4개**(74·125·161·177, 5 아님). stats 소비처 = **6곳**(342·416·482·702·877·**962** Finance trend). 정기청구(clientSubscriptionBilling)는 **발행만** 하고 paid 마킹 없음 → 자동생성 invoice 의 paid 도 위 3경로로 수렴(표에 명시).

**R1 (🔴 D2 트랜잭션)**: `markInvoicePaid` 는 **트랜잭션이 없다**(단순 invoice.update, :168-196). payment.create 를 붙이려면 **트랜잭션 신설 후 update+create 원자화** 필수. 안 그러면 "paid인데 payment 없음"이 첫날 발생.

**R2 (🔴 동시성 락)**: "이미 paid면 멱등" 은 순차에서만 참. Stripe 가 `checkout.session.completed`+`payment_intent.succeeded` 2이벤트를 **동시** 발송 → 둘 다 `status='sent'` 스냅샷으로 가드 통과 → payment 2행 이중계상. **필수: findOne 에 `lock: t.LOCK.UPDATE` + 락 후 status 재검사.** markInstallmentPaid(:106)·markInvoicePaid 둘 다. 보조: `pg_transaction_id` 조건부 UNIQUE(같은 PaymentIntent).

**R3 (🔴 canceled↔paid 회차 모순)**: dev 에 **status=canceled 인데 paid 회차 보유 invoice 4건 실존**(8·9·10·24, 회차 7·10·13·26). D3 불변식이 배포 당일 발화한다. **정책 확정: `PATCH status=canceled` 는 paid 회차 또는 paid_amount>0 이면 400 차단**(unmark 선행 강제 — 회차 취소 `cannot_cancel_paid` invoices.js:2159 와 일관, 받은 돈을 장부에서 안 지움). 백필은 canceled 부모의 paid 회차도 **포함**(받은 돈이므로) — 대신 canceled 는 향후 unmark 없이는 payment 존재 허용을 불변식에 명시(가드는 "paid 회차 ↔ payment 존재"만, invoice.status=canceled 는 예외).

**R4 (🔴 백필 이중계상)**: paid/부분paid 4건 중 **2건(34·79)은 split** → invoice-level payment 만들면 2배. **단일 invoice 백필은 `installment_mode='single' && status='paid'` 만**(70·77). split 은 회차만. 단일 amount = **grand_total 필수**(PATCH 경로가 paid_amount 를 안 채워 dev 실측 paid_amount=0).

**R5 (🔴 유령 컬럼)**: `inst.payment_method` **없음**. method 추론 = `stripe_payment_intent NOT NULL → stripe 매핑(other+pg_provider=stripe), else bank_transfer`.

**R6 (🔴 PATCH paid 뒷문)**: 위임 조건 "회차 없음"이면, 회차 있는 invoice 에 API 로 PATCH paid 시 옛 인라인→payment 0 재발. **split invoice 의 PATCH paid 는 400 차단**(회차별 mark-paid 유도). UI 는 이미 `!isSplit` 게이트(InvoiceDetailDrawer.tsx:446)라 API 만 영향.

**보완**:
- D2 부작용 겹침 정확히: status history · chat card · **socket inbox:refresh** · overdue unpause · bill event (5개). 라우트에 남길 것 = **audit 만**(서비스는 의도적으로 audit 안 함). 위임으로 새로 생기는 것 3가지 = ①projectStageEngine 호출(현 PATCH 에 없음 = 버그픽스) ②paid_amount=grand_total(버그픽스) ③draft→paid 차단(UI 안전, API 만).
- installment_id FK = **ON DELETE SET NULL**(PUT 편집이 draft/canceled 회차 destroy/재생성, invoices.js:1168).
- 환불: stats 는 `amount` 만 합산, `refunded_amount` 미차감 — **저비용이므로 `amount - refunded_amount` 합산 선반영** 권고(범위 편입).
- stripe 회차 unmark-paid: payment hard delete 가 pg_raw_response 지움 → bill_event detail 에 payment 스냅샷 보존.
- 다통화: payment.currency 기록 유지, stats 통화 분리는 별도 사이클(기존 왜곡, 범위 밖).

**★ 불변식 가드는 성립 조건**: 원장 유지 판정은 "D3 가드 박제(health-check/guard-invariants)"가 **선택이 아니라 조건**. 가드 없이 원장만 넣으면 이번 결함(스키마 있는데 write 잊음)과 같은 계열 재발. → paid 회차 ↔ payment 존재 일치 가드 + 일부러 깨서 검출 확인([[feedback_guard_must_be_falsified]]).

**구현 순서 (Fable 권고)**: ①D5 owner 가드(독립·즉시) → ②D1 마이그레이션(installment_id + SET NULL) → ③D2 write(락+create+트랜잭션+PATCH 위임) → ④D3 회수+canceled 차단 → ⑤D4 백필 → ⑥불변식 가드+실HTTP 전수검증 → **Fable 재게이트**(webhook 2이벤트 동시도착 시나리오 필수).
