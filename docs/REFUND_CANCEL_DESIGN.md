# 고객 요청 환불 → 구독 해지 — 설계 초안 (Fable 설계 판정 대기)

> 2026-10-19 · [Opus] 사실 묶음 · 설계 판정은 Fable(공용 기준 ①설계 ②돈·상태 전이)
> Irene: *"권고대로 진행해 줘"* — 권고 A: **전액 환불이면 구독도 해지**(돈은 돌려줬는데 유료 기능이 열려 있으면 장부와 서비스가 어긋난다).
> 앞선 일: 커밋 0eeeef09 — 환불 요청을 결제에 묶음(routes/plan_refund 일반 요청 · 관리자 처리 창 [환불 처리]/[반려]).

## 1. 지금 사실 (코드 기준)

| 무엇 | 지금 | 위치 |
|---|---|---|
| 일반 환불 처리 | `refundPayment({ mode:'manual' })` — 결제만 `refunded`, 구독·워크스페이스 **불변** | `services/refund.js` |
| 체험 중 환불 | mode `trial` — 구독 canceled(`trial_refund`) · 워크스페이스 trialing(또는 past_due+7일) | 같은 함수 |
| 무료로 내리기 | `billing.downgradeToFree({ businessId, userId, reason })` — plan free · 활성 구독 전부 `demoted` · 이력 · 관리자 알림 | `services/billing.js:603` |
| 관리자 처리 창 | 일반 요청이면 mode manual + (카드면) «Stripe 로 카드 환불 실행» 체크 | `components/Admin/TrialRefundModal.tsx` |
| 약관 제4조 | 월간 7일 이내 전액 · 7일 뒤 불가 · 연간 14일 이내 전액 · 14일 뒤 일할 · 접수는 «[해지하고 환불 요청] 버튼 또는 지원 이메일» | `locales/*/legal.json terms.s4` |
| 일할(부분) 환불 | **없음** — `refundPayment` 는 전액만, 금액 칸 없음 | — |

## 2. Fable 이 정할 것 (작업 모델이 정하지 않는다)

1. **어떤 환불이 해지를 부르나** — 후보: (a) 관리자가 처리 창에서 «구독도 해지» 를 고른다(기본 켬) (b) 그 결제가 *지금 살아 있는 구독의 결제* 이고 전액이면 자동 (c) 항상.
   지난 갱신분(이미 지나간 기간)·애드온 결제(`kind addon`)를 환불할 때는 구독을 건드리면 안 될 수 있다.
2. **해지의 모양** — 즉시 무료(`downgradeToFree`, 구독 `demoted`) vs 구독 `canceled` + 사유 `refund` vs 기간 끝까지 유지 후 만료(전액 환불인데 기간을 주는 것은 A 의 취지와 어긋남).
   `cancel_reason` ENUM 에 값 추가가 필요하면 운영 마이그레이션(배포 슬롯) — 체험 환불은 `trial_refund`.
3. **트랜잭션 경계** — `refundPayment` 트랜잭션 안에서 해지까지 한 번에(체험 모드처럼) vs 환불 뒤 별도 호출. 카드(Stripe)는 «돈 먼저, 장부 나중» 이 이미 있다.
4. **대기 청구** — 해지할 때 남은 pending 결제(갱신 사전청구)를 닫는가(`closeDeadPendingPayments` — 체험 모드가 부른다).
5. **일할 환불** — 연간 14일 뒤 일할은 약관이 약속한다. 이번에 금액 입력(부분 환불)을 넣을지, «전액 환불 + 해지» 만 하고 일할은 다음으로 둘지. 부분 환불이면 해지는 하지 않는 것이 맞는지.
6. **알림·문구** — 처리 뒤 대표 알림(지금 앱 알림 «환불이 처리됐습니다»)에 «무료로 바뀌었습니다» 를 붙인다. 고객 요청 창·관리자 창 문구. 약관 제4조 마지막 줄(접수 경로)이 지금과 다르다 — 결제 이력 [환불 요청] 으로 바뀜.

## 3. 검증 설계 (Fable 이 고칠 수 있음)

- 월간 7일 이내 요청 → 처리 → 결제 refunded · 워크스페이스 free · 구독 demoted/canceled · 이력 1 · 감사 1 · 대표 알림
- 지난 기간 결제(현재 구독이 아님) 환불 → 구독·플랜 불변
- 애드온 결제 환불 → 플랜 불변(애드온 처리 정책 확인)
- 체험 환불(mode trial) 회귀 없음 — 기존 31검사 경로
- 카드: via_stripe 켬/끔 각각 · 같은 결제 두 번 처리 → `already_refunded`
- 화면 3폭: 처리 창 문구 · 대표 화면 플랜 표시가 free 로


## 5. Fable 설계 판정 (2026-10-22 · DESIGN_OK) — 구현 정본

### §0 전제(2026-10-22 저장소·DB 확인)
- `subscriptions.cancel_reason` 는 **varchar(255)**(ENUM 아님 — §2-2 의 «ENUM 값 추가·마이그레이션» 전제는 틀렸다). 기존 값 `trial_expired_no_payment`·`trial_refund`.
- `business_plan_history.reason` ENUM 에 `'refund'` 이미 있음. `businesses.subscription_status` ENUM(active,past_due,canceled,trialing) — 무료 플랜은 `plan='free'+'active'`(`downgradeToFree` 와 같다). `payments.refund_kind` ENUM(trial,manual) — 건드리지 않는다.
- 애드온은 결제 전 요청 즉시 `Business.addon_X += addon.unit × qty`(`addonBilling.requestAddon`), 해지는 `cancelAddon` 이 같은 산식으로 뺀다. **환불 때 빼는 문은 없다.**
- **마이그레이션 없음. 배포 슬롯 추가 없음.**

### §1 어떤 환불이 해지를 부르나 — 서버 판정, 자동
술어 한 함수 `billing.refundCancelsSubscription({ payment, sub, biz, laterPaidCount })`(trialRefundability 옆):
`payment.kind==='plan' ∧ payment.status==='paid' ∧ sub ∧ sub.id===payment.subscription_id ∧ sub.status ∈ {active,past_due,grace} ∧ biz.plan!=='free' ∧ laterPaidCount===0`
(`laterPaidCount` = 같은 `subscription_id` 에 이 결제보다 뒤(`paid_at` 또는 `id` 큰) `status='paid'` 결제 수 — 호출부가 센다. 시계를 쓰지 않는다.)
- 참 → 해지(§2). 거짓(지난 기간 결제·`replaced` 된 구독의 결제) → 구독·플랜 불변.
- **애드온 결제** → 트랜잭션 안에서 `Business[addon.field] = max(0, 현재 − addon.unit × pay.addon_quantity)`(`cancelAddon` 과 같은 산식, 공통 조각 `addonBilling.revokeUnitsInTx({ biz, addonCode, quantity, t })` 로 빼서 둘이 같이 쓴다).
- 관리자 예외는 한 방향만: body `keep_subscription:true`(보상성 환불 — 서비스 유지)만, 감사에 남긴다. 술어가 거짓인데 해지하는 길은 두지 않는다.
- `mode:'trial'` 은 이 술어를 보지 않는다.
- 관리자 목록 `GET /api/admin/payments` 가 행마다 `refund_cancels_subscription`(같은 함수) — 화면이 판정하지 않는다.

### §2 해지의 모양 — 즉시 무료
- 구독 `status:'canceled', canceled_at:now, cancel_reason:'refund'`(`demoted` 아님). 기간 끝까지 유지하지 않는다.
- 워크스페이스 `plan:'free', subscription_status:'active', plan_expires_at:null, grace_ends_at:null, scheduled_plan:null`. `trial_ends_at` 불변.
- `BusinessPlanHistory { from_plan, to_plan:'free', reason:'refund', changed_by: adminUserId, note:'Payment #<id> 환불 해지' }`.
- `downgradeToFree` 를 부르지 않는다(자기 트랜잭션·demoted·관리자 강등 알림). `billing.cancelToFreeInTx({ biz, sub, t, cancelReason, historyReason, changedBy, note })` 공통 조각을 만들어 refund.js 가 쓴다.

### §3 트랜잭션 경계 — `refundPayment` 한 트랜잭션 안
(Stripe 는 종전처럼 밖에서 먼저, idempotencyKey) → `pay` FOR UPDATE → `sub`·`biz` FOR UPDATE → `laterPaidCount` → **트랜잭션 안에서 술어 재판정** → §2 해지 또는 애드온 회수 → `closeDeadPendingPayments(business_id, t)` → `pay` refunded(`refund_kind:'manual'`) → `writeAudit payment.refunded` newValue 에 `{ canceled_subscription_id, from_plan, to_plan:'free', keep_subscription, addon_units_removed }` → commit → `invalidateBusinessCache` → 알림(§6).
반환 `restoredTo:'free'`(해지했을 때). 시그니처 `refundPayment({ …, keepSubscription=false })`, 라우트 body `keep_subscription`.

### §4 대기 청구 — 닫는다
구독이 canceled 가 되므로 `closeDeadPendingPayments` 가 그 구독의 갱신 사전청구를 닫는다. 다른 플랜 체크아웃(pending 구독)은 건드리지 않는다.

### §5 일할(부분) 환불 — 이번 범위 밖, 후속 설계(calc)
전액만. 관리자 창이 «전액 환불 + 무료 전환» 임을 말하고, 연간 14일 뒤 건은 [반려] 사유 placeholder 에 «일할 환불은 고객 지원 이메일로 안내» 예문. 약관의 일할 환불 공백은 이 전부터 있던 것 — 작업기록 «나중에».

### §6 알림·문구
- 대표: 해지했으면 `notify({ eventKind:'payment', title:'환불이 처리됐습니다', body:'<금액> 결제가 환불됐고 워크스페이스가 무료 플랜으로 바뀌었습니다. 유료 기능은 다시 결제하면 이어서 쓸 수 있습니다(초과 데이터는 읽기 전용).', link:'/business/settings/plan' })` — **메일 포함**(새 템플릿 없음). 해지 안 했으면 지금 문구·앱만.
- 관리자 처리 창 general: 참 → «처리하면 전액 환불되고 워크스페이스가 무료 플랜으로 바뀝니다(구독 해지)» + 체크박스 «구독은 유지 — 보상성 환불»(기본 꺼짐 → keep_subscription) · 거짓 → «지금 구독의 결제가 아니라 구독은 그대로입니다» · 애드온 → «애드온 한도 <N> 이 돌아갑니다». **옛 [환불] ConfirmDialog 도 같은 규칙의 문구.**
- 고객 요청 창 `refundHelp.subtitle2` 에 «전액 환불이 처리되면 워크스페이스는 무료 플랜으로 바뀝니다» · 관리자 알림 본문 기준 줄 끝에 «처리하면 무료 전환».
- 약관 제4조(ko/en): 접수 줄 → «설정 > 요금제 > 결제 이력의 [환불 요청] 또는 고객 지원 이메일» + «전액 환불이 처리되면 해당 구독은 해지되어 무료 플랜으로 전환됩니다». `terms_version` 올리지 않는다(명문화 — 불리한 변경 아님).

### §7 검증(완료 조건 — 실호출 숫자, 픽스처 원복)
1. 살아 있는 구독의 마지막 paid 결제 → manual 환불 → refunded · 구독 canceled/'refund' · 비즈 free/active · 이력 1 · 감사 1 · pending 갱신청구 닫힘 · 대표 알림 1(메일 로그 1) · /status.plan free
2. 같은 구독의 지난 결제 → 불변, restored_to null
3. replaced 구독의 결제 → 불변
4. 애드온 → 플랜 불변 · addon_X 감소(0 하한 대조군) · 감사 addon_units_removed
5. keep_subscription:true → 결제만 refunded, 감사에 남음
6. 체험 모드 회귀 0
7. 같은 결제 두 번 → already_refunded, 해지·이력 한 번
8. Stripe 실패 모사 → DB 전부 불변
9. 관리자 목록 refund_cancels_subscription = 처리 결과(양성·음성)
10. 화면 3폭: 처리 창 문구 3종 · 옛 [환불] 확인 문구 · 대표 화면 free
11. secrets · guard duproute/agentsurface · 약관 ko/en 패리티
Fable: gate(돈·상태 전이) 완료 검증 1회.
