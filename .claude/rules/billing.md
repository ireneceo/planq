---
paths:
  - "dev-backend/services/billing.js"
  - "dev-backend/services/trial.js"
  - "dev-backend/services/plan*.js"
  - "dev-backend/services/refund*.js"
  - "dev-backend/services/stripe*"
  - "dev-backend/routes/plan*.js"
  - "dev-backend/routes/admin_billing.js"
  - "dev-backend/routes/admin_refund.js"
  - "dev-backend/routes/auth*.js"
  - "dev-backend/routes/stripe*.js"
  - "dev-backend/config/plans.js"
  - "dev-frontend/src/pages/Settings/PlanSettings.tsx"
  - "dev-frontend/src/pages/Settings/BillingSettings.tsx"
  - "dev-frontend/src/pages/Settings/CheckoutModal.tsx"
  - "dev-frontend/src/pages/Register/**"
  - "dev-frontend/src/pages/Admin/**"
---

<!-- CLAUDE.md 에서 옮긴 규칙 (2026-10-23). 이 경로의 파일을 읽거나 고칠 때 자동으로 실린다. 문장은 옮기기만 했다. -->
# 체험·선결제·체험 중 환불

## 체험 선택지 — 「무료 14일」 vs 「지금 결제하고 1개월 추가」 (2026-09-23 박제)

> Irene: *"결제를 지금 하면 1달 무료가 되는 거 추가하고 … 2달 후 결제되는 거지."* ·
> *"카드 결제 자동구독이 중요한게 아니라 결제를 시키는 것이 중요한건데"*

**선불 상품이다. 자동청구(카드 정기결제)는 이 기능에 필요 없다.** 지금 1개월치를 받고
**첫 기간만 2개월**로 주면 끝이고, 2개월 뒤에는 기존 갱신 흐름(`ensureRenewalPayment`)이
그대로 청구를 만든다. 자동청구를 끌어들이면 R=1(해외 법인 정기과금·정기결제 사전고지)이 되는데
**이 요구사항은 그것을 필요로 하지 않는다** — 내가 한 번 범위를 부풀렸다가 되돌렸다.

- **기간 공식은 `services/billing.js computePeriodEnd()` 하나다.** 보너스는 `markPaymentPaid` 의
  **`wasFirst`(pending → active)일 때만** 더한다. 갱신에도 더하면 한 번 고른 사람이 영원히
  1개월씩 공짜가 된다. 라우트나 cron 이 기간을 따로 계산하기 시작하면 갈라진다.
- **개월 수의 정본은 `config/plans.js TRIAL_OPTIONS` 다.** 라우트는 **선택지 코드**만 받는다 —
  본문으로 개월 수를 받으면 `bonus_months: 12` 를 적어 1년을 가져간다. 모르는 코드는 **0**(fail-closed).
- **자격도 서버가 판정한다** — `billing.isFirstPlanPayment()`(그 워크스페이스에 `kind='plan'` ·
  `status='paid'` 결제가 0건). 안 걸면 해지 후 재결제로 무한히 1개월씩 받는다.
  화면은 `status.prepay_bonus.available` 만 본다(결제 이력을 스스로 세지 않는다).
- **결제 수단과 무관하다.** 선불이라 카드·계좌이체 둘 다 된다 — 2026-09-23 실측으로 **돈 내는 6건이
  전원 계좌이체**인데 카드 전용으로 두면 실제 고객이 아무도 못 고른다.
- **결제를 안 하면 새로 만들 게 없다** — 기존 체험 흐름 그대로 D+14 `past_due` → D+21 잠금.
  「결제 안 하면 취소」가 이미 성립한다(실측으로 확인).
- **문구** — 「2개월 뒤 다음 결제 · 그 전에 해지하면 추가 청구 없음」 + **이미 낸 1개월치는 환불
  대상이 아님**을 같이 적는다. 「2달 안에 취소하면 된다」만 쓰면 «돈이 안 나간다» 로 읽혀
  청약철회 7일과 부딪힌다.
- 회귀: `node scripts/e2e/run.js --suite prepay` (3폭 · 카드 가시성 · 문구 보간 · 모달이 «2개월» 을
  말하는가 · **검사기가 만든 pending 결제 원복**). 자격 없는 계정에서는 **안 보이는 것이 정답**이라
  그대로 판정한다.

> ★ **Stripe 는 «카드 1회 결제» 까지만 붙어 있다** (2026-09-23 전수 확인). `mode:'subscription'` 0건 ·
> `stripe.subscriptions`·`setupIntents`·`off_session` 0건 · webhook 은 `checkout.session.completed` 와
> `payment_intent.succeeded` 둘만 받는다. 「Stripe 카드결제 완료」(2026-07-08) 보고는 **사실**이고,
> 자동 정기청구는 로드맵상 뒤 단계다. 둘을 같은 말로 쓰지 말 것 — 「결제가 안 된다」로 읽힌다.

## 체험 플랜은 **가입 때 고른다** — 혼자 Starter · 팀 Basic · 큰 팀 Pro (2026-10-09 박제)

> Irene: *"처음에 혼자 쓸지 말지 선택 가능한거 아니야? 플랜마다 다른 거잖아."* (Starter 1명 체험이라 새 팀이 첫날 초대에서 막혔다)

- **새 워크스페이스의 체험 필드는 `config/plans.newTrialBusinessFields(planCode)` 하나**가 만든다(가입·구글/애플·두 번째 워크스페이스).
  모르는 값·없는 값 → **starter**(가장 좁은 쪽). 화면 기본 선택은 basic(요금제 «추천»). `plan: 'starter'`·`14 * 24 * …` 리터럴은 가드 `--category=trialplan` 이 막는다.
- **체험 중 플랜 바꾸기는 `POST /api/plan/:biz/trial-plan` 하나**(옛 start-trial 도 같은 처리기). 판정 `planEngine.canSwitchTrialPlan`(체험 중 ∧ 기간 안 ∧
  플랜 결제 0건 ∧ 면제 아님) = /status `trial_plan_switch`. 체험 종료일은 바뀌지 않는다 · 내릴 때 인원 등이 넘으면 409 `over_limit` ·
  옛 금액 사전청구는 `billing.replacePendingCheckout` 로 닫는다(cron 이 다음 날 새 플랜으로 다시 만든다).
- **체험 중 비용 캡** — Cue 월 50·녹음 60분(`TRIAL_COST_CAPS`)은 플랜과 무관. `getEffectiveLimits` 가 덮으므로 게이트가 실제로 막는다.
  화면의 사용량·남은 횟수는 `/status.effective_limits` 를 읽는다(`plan.limits` 는 정가라 캡을 모른다).
  ★ 남은 구멍: 체험이 끝난 미결제 유예 7일엔 캡이 풀린다(Fable 비차단 — 다음 사이클).
- 이력 reason 은 ENUM 이라 `trial_start` + 메모로 남기고, 감사 `plan.trial_plan_change` 로 가른다(운영 스키마 변경 없이).

## 체험 중 결제는 **체험이 끝나기 전에 해지하면 전액 환불**한다 (2026-10-09 박제)

> Irene: *"결제를 먼저 하면 +1달 주는 거 안내해서 결제유도 하자. 체험기간은 그대로 주고 체험기간엔 환불 가능."* → A안 *"권고대로 설계해"*
> 설계 정본: `docs/TRIAL_REFUND_DESIGN.md` (Fable 설계)

- **자격은 `billing.trialRefundability` 한 함수** — «체험 중 결제» = 낸 돈의 유료 기간이 아직 시작 안 됨(`period_start == trial_ends_at` ∧ `> 기준 시각`) ∧ 그 구독이 active ∧ 체험 환불 0건(워크스페이스당 1회).
  요청·`/status.trial_refund`·관리자 처리가 같이 쓴다. 관리자 처리의 기준 시각은 **사용자가 요청한 시각**이다.
- **요청은 상태를 바꾸지 않는다**(payments 의 `refund_requested_*` 칸만 — 결제 paid·서비스 그대로). 되돌리는 문은 **`services/refund.refundPayment` 하나**:
  mode `trial` = 결제 refunded · 구독 canceled(`trial_refund`) · 워크스페이스 trialing(종료일 불변, 이미 끝났으면 past_due + 유예 7일) ·
  mode `manual` = 옛 관리자 [환불] 그대로(결제만). Stripe 카드 환불은 `via_stripe:true` 일 때만, 트랜잭션 **밖에서 먼저**(idempotencyKey).
- **환불 계좌는 `payments.refund_account_enc` 암호문** — 읽는 문은 관리자 `GET /api/admin/payments/:id/refund-account` 하나(열람 감사), 처리·취소 때 파기.
  회귀 `health-check --category=secrets`(응답 원문에 계좌번호 0).
- 운영: `scripts/migrate-trial-refund.js`(멱등, 배포 슬롯 등록 — 모델이 SELECT 하므로 코드보다 먼저). 약관 제4조에 한 줄 추가(버전은 안 올림 — 이용자에게 유리한 변경).

