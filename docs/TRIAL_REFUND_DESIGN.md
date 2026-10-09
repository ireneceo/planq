# 체험 중 결제 → «해지하고 환불 요청» 설계

- 날짜: 2026-10-09 · 설계 [Fable] · 구현 [Opus] (방 58947e65)
- Irene 원문: *"결제를 먼저 하면 +1달 주는 거 안내해서 결제유도 하자. 체험기간은 그대로 주고 체험기간엔 환불 가능. 체험 끝나는 시점부터 유료 적용 2달 되는 거지."* → 선택지 A *"권고대로 설계해"*
- A = 체험 중 [해지하고 환불 요청] 버튼 → 관리자 «확인 필요» → 관리자 [환불] 이면 구독이 체험 상태로 돌아가고 돈은 관리자가 돌려줌.

## 0. 전제(저장소 사실)
- `payments` 에 이미 «고객 통보 → 관리자 처리» 트랙이 있다(`notify_paid_at` → todo `deposit_plan`). 환불 요청도 같은 모양(새 표 없음).
- `BusinessPlanHistory.reason` ENUM 에 `'refund'` 가 있다. `Subscription.cancel_reason` 은 STRING.
- 전역 toJSON 이 `*_enc` 를 응답에서 내린다 → 환불 계좌는 `refund_account_enc`.
- 비용 캡(`getEffectiveLimits`)은 `subscription_status==='trialing'` 하나로 켜진다 → 상태만 되돌리면 캡도 돌아온다.
- 관리자 매출 합은 `status='paid'` 만 → refunded 는 자동 제외.

## 1. 자격 — `billing.trialRefundability({ payment, sub, biz, at, trialRefundsUsed })` 한 함수
«체험 중 결제» = 낸 돈의 유료 기간이 아직 시작되지 않았다.
1. `kind==='plan' ∧ status==='paid'`
2. `biz.trial_ends_at` 존재 ∧ `payment.period_start` 가 그 시각과 같다(±1초) — 체험 중 첫 결제의 지문(갱신 결제는 걸러진다)
3. `payment.period_start > at`
4. `sub.id===payment.subscription_id ∧ sub.status==='active'`
5. 이 워크스페이스에 `refund_kind='trial'` 환불 0건 (체험 환불 1회)
6. 요청 단계: `refund_requested_at` 있으면 `already_requested` · 처리 단계: 필수(`not_requested`)
- 선결제만이 아니라 체험 중 일반 결제·연간 결제도 같은 술어.
- `at` = 요청 땐 now, **관리자 처리 땐 `refund_requested_at`**(사용자가 누른 시각이 기준).
- reason: `not_plan_payment | not_paid | not_trial_payment | period_started | subscription_superseded | trial_refund_used | already_requested | not_requested`
- `/status.trial_refund: { available, reason, payment_id, amount, currency, method, requested_at, trial_ends_at }`

## 2. 요청 상태 — payments 컬럼 6개(`scripts/migrate-trial-refund.js`, 멱등, 코드 배포 전)
`refund_requested_at DATETIME` · `refund_requested_by INT` · `refund_request_note VARCHAR(255)` · `refund_account_enc TEXT` · `refund_kind ENUM('trial','manual')` · `stripe_refund_id VARCHAR(255)`
- 요청 중에도 `status='paid'`, 서비스 그대로(되돌리는 것은 관리자 [환불] 한 번뿐).
- 요청 취소 가능(owner) → 요청 칸 전부 NULL + 감사 `payment.refund_request_canceled`. 이미 환불됐으면 409.
- 권한: owner 또는 platform_admin.
- 라우트: `POST/DELETE /api/plan/:biz/payments/:id/refund-request` body `{ note?, refund_account?: {bank, number, holder} }`
- 요청 시 플랫폼 관리자 알림 + 관리자 «확인 필요» type `refund_request`(결제 메뉴 배지에 합산).
- 동시 요청: 조건부 UPDATE(`refund_requested_at IS NULL ∧ status='paid'`) affected==1 아니면 409.

## 3. 관리자 [환불] — `services/refund.refundPayment({ paymentId, mode, reason, viaStripe, adminUserId, actor })`
mode `trial`(트랜잭션 · 잠금 순서 payment → sub → biz):
1. `paid` 아니면 `refunded` 는 멱등 200(alreadyRefunded) · 그 외 409. 요청 필수 · 자격(at=refund_requested_at). superseded 면 409 → manual 로.
2. 돈 먼저: 카드 ∧ viaStripe 면 트랜잭션 **밖에서** `stripe.refunds.create({payment_intent},{idempotencyKey:'planq-refund-'+id})`. 실패하면 DB 불변.
3. Payment: refunded · refunded_at · refund_reason · refund_kind='trial' · stripe_refund_id · `refund_account_enc=NULL`(파기)
4. Subscription: canceled · cancel_reason 'trial_refund' (+ 매달린 pending 결제 정리)
5. Business: 체험이 남았으면 `trialing`·plan_expires_at NULL·grace NULL·scheduled_plan NULL, **trial_ends_at 불변**, plan = 체험 가능 코드면 그대로(아니면 starter). 체험이 이미 끝났으면 `past_due` + `grace_ends_at = now + 7일`.
6. PlanHistory reason 'refund' · 7. 감사 `payment.refunded`(writeAudit, 트랜잭션 안) · 8. 커밋 후 owner 메일 + 앱 알림(skipChannels email) · `invalidateBusinessCache`
9. 세금계산서 발행됨이면 막지 않고 «수정세금계산서 필요» 표시·감사.
mode `manual` = 기존 동작(결제만 refunded, 구독·워크스페이스 불변) + refund_kind 'manual'. **Stripe 호출은 via_stripe:true 일 때만**(기본 false — 손으로 돌려준 건을 두 번 환불하지 않게).

## 4. 기존 관리자 환불 라우트 — 서비스 하나, 모드 둘
`POST /api/admin/payments/:id/refund` body `mode` 기본 `manual`(옛 호출 무변경) · `via_stripe` 기본 false.

## 5. 돈 돌려주는 경로
- 카드: Stripe API(전액, idempotencyKey). 수수료는 돌아오지 않음.
- 계좌이체: 요청창에서 은행·계좌번호·예금주를 받아 `refund_account_enc`(encrypt JSON). 읽는 문 `GET /api/admin/payments/:id/refund-account` 하나(platform_admin · 감사). 처리·취소 때 파기. 계좌이체면 세 칸 필수(은행·예금주 ≤80자 · 번호 숫자·`-` 6~30자), 카드면 받지 않는다.

## 6. 약관·문구
- legal 제4조 맨 앞: «체험 기간 중 결제: 체험이 끝나기 전에 해지(환불 요청)하면 전액 환불 … 체험 종료 이후에는 아래 기준» · 마지막 줄 «설정 > 요금제의 [해지하고 환불 요청] 버튼 또는 지원 이메일». **약관 버전은 올리지 않는다**(유리한 변경).
- `prepay.refundNote` 교체(지금 문구가 거짓이 된다) · 대시보드 체험 카드 꼬리 «체험이 끝나기 전에 해지하면 전액 환불».
- PlanSettings: `trial_refund.available` 일 때 Danger 보조 버튼 [해지하고 환불 요청](`plan-trial-refund-open`) → 확인창(금액·수단·돌아갈 상태·체험 종료일 불변·체험 중 환불은 1회 · 계좌이체면 세 칸 + 사유) · 요청 뒤 상태줄 + [요청 취소].

## 7. 검증(완료 조건)
양성 1~8 / 음성 9~15 — Fable 원문 그대로: 자격·요청(계좌 원문 0건 응답)·계좌 읽기 감사·trial 환불(상태·캡·플랜전환·이력·감사·매출 제외·todo·메일)·늦은 처리 past_due·재결제 1회 제한·요청 취소·Stripe 경로 / 갱신 결제·체험 후 결제·멤버 403·애드온·동시 요청·옛 manual 호출 보존·이중 처리. 가드 secrets 에 refund_account 1건. 화면 3폭.

## Irene 인지 사항
- 약관 버전은 안 올림(권고) · 카드 환불 수수료는 우리 부담 · 세금계산서 발행 건은 수정세금계산서를 따로 발행.
