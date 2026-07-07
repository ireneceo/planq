# 통합 결제 아키텍처 — 솔루션 구독 ⊇ 고객 결제 (같은 엔진, 발행자/수신자만 스왑)

> **작성 (Irene 지시 2026-07-07):** "발행자·수신자가 완전 바뀌는 것만 빼면, 우리 솔루션 구독(PlanQ→워크스페이스)과 고객이 쓰는 결제·구독(워크스페이스→고객, Q Bill)이 같아야 한다." → **결제수단·구독엔진·UX는 하나로 통합, 돈·데이터는 분리 유지.**
> 게이트: 돈·신규시스템 = **Fable 게이트**(Phase 2·3). 분리 canonical `SAAS_BILLING_VS_QBILL_SEPARATION.md`.

---

## 0. 핵심 — 무엇을 합치고 무엇을 분리하나

| | 통합 (공유) | 분리 (절대 안 섞음) |
|---|---|---|
| 대상 | 결제수단 추상화 · 구독 엔진 · 공개결제 UI 컴포넌트 · "설정하면 켜짐" 로직 | **돈·데이터·계좌·세금계산서 발행주체** |
| 이유 | 중복 구현 금지, POS처럼 일관 UX | 멀티테넌트·세무·회계 무결성 (Fable 검증됨) |

**한 문장:** "결제받는 방식"은 공통 엔진 하나, "누가 누구에게 얼마를 받아 어디로"는 파라미터(merchant)로 분기.

---

## 1. Merchant 추상화 — 발행자/수신자 스왑의 정체

결제 프로필의 주인 = **merchant**. 스코프 2개:

| merchant | 저장 | 돈 받는 주체 | 돈 내는 쪽 | 저장 테이블(돈) |
|----------|------|-------------|-----------|----------------|
| **platform** (PlanQ 구독) | `platform_settings` | PlanQ(워프로랩) | 워크스페이스 | `subscriptions`/`payments` |
| **workspace** (Q Bill) | `businesses` (Business.*) | 워크스페이스 | 그 워크스페이스의 고객 | `invoices`/`invoice_payments` |

→ 같은 결제수단 3종·같은 구독엔진을 `merchant` 만 바꿔 재사용. **"발행자·수신자 스왑" = merchant 스코프 스왑 그 이상도 이하도 아님.**

---

## 2. 결제수단 3종 (순서 고정) — "설정하면 켜짐" (POS 방식)

payer(결제하는 쪽)에게 보이는 순서: **① 은행송금 → ② 별도 결제링크 → ③ 스트라이프.**
각 수단은 **merchant가 설정을 채우면 자동 활성**, 비우면 숨김. (POS의 "Stripe/PayPal 키 넣으면 켜짐"과 동일)

### ① 은행송금 (bank_transfer) — 이미 있음
- 설정: `bank_name/account/holder` (+ `_en`/`swift_code` 영어·해외). platform=`platform_settings`, workspace=`Business.*`.
- 활성 조건: 계좌번호 존재.
- 흐름: payer 송금 → merchant가 입금 확인 마킹. (SaaS=`markPaymentPaid`(platform_admin), Q Bill=invoice mark-paid(owner))
- 상태: **SaaS·Q Bill 양쪽 라이브.** 계좌 복사버튼·영문표기(Phase 0) 완료.

### ② 별도 결제링크 (payment_link) — 신규, 저위험(PG 없음)
- 설정: merchant가 **자기 외부 결제 URL** 붙여넣기 (자기 토스 결제링크·카카오페이 송금·PayPal.me·Stripe Payment Link 등).
- 활성 조건: URL 존재. **검증: `new URL().protocol==='https:'`** (운영안정성 규칙 #4, `isAllowedEndpoint` 패턴 재사용).
- 흐름: PlanQ가 "결제하기" 버튼 렌더 → 새 탭 링크 오픈. 외부 결제 후 → merchant 수동 입금확인 마킹(범용 링크는 webhook 없음).
- 신규 컬럼: `platform_settings.payment_link_url` + `businesses.payment_link_url` (+ 라벨 `payment_link_label`).

### ③ 스트라이프 (stripe) — 신규, PG, Fable 게이트
- 설정: merchant가 Stripe 연결 (키 입력 or Stripe Connect). **secret은 AES-256-GCM 암호화**(`services/encryption.js`), 프론트엔 publishable/clientKey만.
- 활성 조건: Stripe 연결됨.
- 흐름: 인라인 카드결제(Stripe Checkout/Elements) → **webhook(서명검증·멱등)** → 자동 입금확인 마킹.
- 신규 컬럼: `stripe_account_id`/`stripe_secret_enc`/`stripe_publishable`/`stripe_webhook_secret` (platform=`platform_settings`, workspace=`businesses`). platform은 **말레이시아 법인 Stripe**(KRW presentment, "해외 결제·세금계산서 미발행" 안내). workspace는 각자 Stripe.
- **주의:** 기존 `Business.portone_*`/`platform_settings.portone_*` 스텁은 이 자리의 선행 흔적 — 실사용은 Stripe 기준으로 채움(PortOne 폐기).

---

## 3. 공유 컴포넌트

- **공개 결제 페이지**: Q Bill `QBill/PublicInvoicePage.tsx` 의 입금안내·복사·수단 렌더를 공통 컴포넌트로 승격 → SaaS `CheckoutModal` 과 공유. 수단 목록을 `enabledMethods(merchant)` 로 렌더(순서 ①②③).
- **결제수단 설정 UI**: 관리자(platform)=`AdminBillingSettingsPage`, 워크스페이스=`Business/settings/billing`. **같은 폼 컴포넌트**, merchant만 다름.
- **구독 엔진**: `services/billing.js`(SaaS) ↔ `services/clientSubscriptionBilling.js`+`ClientSubscription`(Q Bill). 둘 다 "pending 생성 → 결제 → mark-paid → 기간연장" 동형. 공통 인터페이스로 정리하되 **mark-paid 착지점은 축별 1개 유지**(SaaS=`markPaymentPaid`, Q Bill=invoice/InvoicePayment).

---

## 4. 데이터 분리 불변식 (그대로 유지 — Fable 검증됨)

`SAAS_BILLING_VS_QBILL_SEPARATION.md` 5불변식 전부 유효. 통합은 **코드·UX 레이어**에서만; 돈은:
- SaaS 결제 → `payments`/`subscriptions`, PlanQ 계좌·PlanQ Stripe. **`invoices` 안 씀.**
- Q Bill 결제 → `invoices`/`invoice_payments`, 워크스페이스 계좌·워크스페이스 Stripe. **`payments` 안 씀.**
- 공유 컴포넌트는 `merchant` 파라미터로 계좌·키·수신주체를 주입받을 뿐, 반대 축 데이터를 읽지 않는다.

---

## 5. 세무/컴플라이언스 (수단별)

| 수단 | 세금계산서 | 비고 |
|------|-----------|------|
| 은행송금(한국 명의) | ✅ 발행 | SaaS=워프로랩, Q Bill=워크스페이스가 발행 |
| 별도 결제링크 | 링크 제공자 정책 따름 | PlanQ는 추적만 |
| Stripe(말레이시아/해외) | ❌ | "해외 결제·세금계산서 미발행" 명시. 필요 고객은 은행송금으로 유도 |

---

## 6. 단계별 로드맵 + 게이트

- **Phase 0 (완료):** SaaS 송금 라이브 + 계좌·금액 복사버튼 + 영문 계좌표기(`platform_settings.bank_name_en/holder_en/swift`) + 분리 canonical + Fable 승인.
- **Phase 1 (저위험, PG 없음):** 별도 결제링크 수단 — `payment_link_url` 컬럼(platform+business) + https 검증 + 공개결제/CheckoutModal "결제하기" 버튼 + 설정 UI. "설정하면 켜짐". `/검증`.
- **Phase 2 (Fable 게이트):** Stripe 연동 — 암호화 키저장 + Checkout + webhook(멱등). platform=말레이시아 Stripe, workspace=자기 Stripe. 공개결제 페이지 카드버튼.
- **Phase 3 (Fable 게이트):** 구독 엔진 공통화 + 정기결제(Stripe 빌링) 양축. dunning·재시도.

**Fable 게이트:** Phase 2·3 (돈 무결성·PG·신규시스템). Phase 0·1 은 `/검증`.

---

## 7. 재사용 지도 (중복 구현 금지)

- 은행 영문/SWIFT: `Business.bank_name_en/bank_account_name_en/swift_code` (기존) → `platform_settings` 동형 추가(Phase 0 완료).
- 복사 상호작용: `QBill/PublicInvoicePage.tsx` `copy()`/`copyHit` → `CheckoutModal` 재사용(완료).
- PG 스텁: `Business.portone_*`·`platform_settings.portone_*` → Stripe로 대체.
- 구독: `Subscription`(SaaS)·`ClientSubscription`(Q Bill)·`services/billing.js`·`clientSubscriptionBilling.js`.
- 링크 검증: `routes/push.js isAllowedEndpoint()` https 패턴.

관련: `SAAS_BILLING_VS_QBILL_SEPARATION.md`, `SUBSCRIPTION_PAYMENT_DESIGN.md`(PG 메커니즘), 메모리 `project_subscription_payment_plan`·`project_self_billing`·`project_bill_reporting_plan`·`project_client_subscriptions`.
