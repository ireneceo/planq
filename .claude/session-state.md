# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-07 (Opus, 1M)
**작업 상태:** 중단 (이어서 재개 예정 — 노트북 다음 섹션)

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## 🔖 지금 중단 지점

**마지막 작업:** PlanQ 구독결제 **Stripe(카드) 결제 라이브 배선 완료** (2026-07-08). 토대(services/stripeService·stripeCheckoutService·routes/stripeWebhook) + 키 보안 Fable F1~F6 은 이전 세션(1eb1c1e). 이번 세션에 **F4·webhook 마운트·plan.js 엔드포인트·CheckoutModal 버튼 4종 배선 + 검증 17/17 통과**.

**이번 세션 완료 (dev, 미커밋 — 검증까지 끝난 상태):**
1. ✅ **server.js webhook 마운트** — `app.use('/api/stripe/webhook', express.raw(...), require('./routes/stripeWebhook'))` 을 `express.json` **前(257행, json 260행)** 에 마운트. 순서 검증.
2. ✅ **plan.js 엔드포인트** — `POST /:businessId/payments/:paymentId/stripe-checkout` (owner_only, business 스코프 소유권, pending 검증, success/cancel=APP_URL 서버상수, `stripe_not_configured`→400). + `GET /plan/bank-info` 응답에 `stripe_enabled` 추가(설정하면 켜짐).
3. ✅ **F4 관리자 Stripe 입력란** — `AdminBillingSettingsPage.tsx` Stripe 카드(publishable 평문 / secret·webhook write-only + 설정됨·미설정 배지 + 삭제 버튼). 백엔드 PUT/GET 암호화는 기존.
4. ✅ **CheckoutModal "카드로 결제" 버튼** — `services/plan.ts startStripeCheckout` + stripeEnabled 시에만 노출, session.url 리다이렉트. PlanSettings 가 bank-info.stripe_enabled 전달.
5. ✅ i18n ko/en (admin.billing.stripe*, plan.checkout.stripe.*) + 빌드 EXIT0(error TS 0) + health-check 29/29.

**2026-07-08 후속 — Q Bill 워크스페이스 카드결제 구현(대-규모, Fable 게이트):**
같은 엔진 merchant='workspace' 스왑. 완료:
- 마이그레이션 7컬럼: businesses(stripe_publishable_key/stripe_secret_enc/stripe_webhook_secret_enc), invoices·invoice_installments(stripe_session_id/stripe_payment_intent). 인덱스 여유(64 한도 안전).
- **전역 toJSON `*_enc → *_set` redaction**(models/index.js) — 모든 모델 암호화 시크릿 API 응답 영구 차단.
- `services/invoicePayments.js` 신규 — **markInstallmentPaid/markInvoicePaid 단일 착지점**(구독 markPaymentPaid 대칭). 기존 invoice mark-paid 라우트를 이 코어로 위임 리팩터(recordInvoiceStatusChange·updateInvoiceChatCards 서비스 이관). 멱등.
- `startWorkspaceInvoiceCheckout`(stripeCheckoutService) + 공개 `POST /api/invoices/public/:token/stripe-checkout`(비인증 share_token, IP rate-limit, 회차/단일 분기, 금액 서버값).
- `routes/stripeWorkspaceWebhook.js` + server.js `/api/stripe/webhook/ws/:businessId` 마운트(json 前). business webhook secret 서명검증 → markInstallmentPaid/markInvoicePaid 멱등 착지. metaBiz===businessId 격리.
- 프론트: SettingsTab Stripe 섹션(write-only+set 배지+webhook URL) + PublicInvoicePage 카드 버튼(분할 회차/단일) + i18n ko/en.
- 검증: 실호출 31/31 + F-1/D8 재검증 6/6 + health 29/29 + build EXIT0. **Fable 게이트: F-1(전역 toJSON 이 admin serializePlatformSettings 깨뜨림) 발견→수정→재검증.**
- 운영 배포 시: 각 워크스페이스가 자기 Stripe 대시보드에 `https://planq.kr/api/stripe/webhook/ws/{businessId}` 등록.

**바로 다음 작업 (운영 — Irene 몫):**
1. **노출된 `sk_live` Roll** (채팅 노출분 — 반드시 폐기·재발급)
2. **운영 `EMAIL_ENCRYPTION_KEY` 설정** (없으면 F3 가드가 결제 시크릿 저장 차단, 운영 NODE_ENV=production)
3. **관리자 UI에 Stripe 키 3종 입력** (`/admin/billing-settings` → Stripe 섹션): publishable/secret/webhook
4. **Stripe 대시보드 webhook 등록** — 엔드포인트 `https://planq.kr/api/stripe/webhook`, 이벤트 `checkout.session.completed`·`payment_intent.succeeded` → Signing secret 을 3번 UI에 입력
5. **운영 소액 실결제+환불** 스모크(Irene 결정: 결제 테스트는 운영에서)
6. (후속) Q Bill workspace merchant — Business stripe_* 컬럼 추가 후 활성

**맥락 유지할 것 (중요 결정):**
- **결제수단 3종 (순서 고정): 은행송금 → 별도 결제링크 → 스트라이프.** "설정하면 켜짐"(POS 방식). PlanQ 구독 ⊇ Q Bill 고객결제 = **같은 엔진, 발행자/수신자(merchant)만 스왑**. 돈·데이터는 분리 유지.
- **merchant**: platform(PlanQ 구독, platform_settings, payments/subscriptions) vs workspace(Q Bill, businesses, invoices). `services/stripeService.js getStripeForMerchant`.
- **카드 PG = Stripe** (토스 아님 — 토스 연동 가입비+연관리비 330k+심사 때문에 보류). Stripe = **말레이시아 법인**(KRW presentment, "해외 결제·세금계산서 미발행" 안내). 한국 송금·세금계산서 명의 = **워프로랩/(주)아이린엔컴퍼니**(같은 회사).
- **⚠️ 운영 선결:** ① `EMAIL_ENCRYPTION_KEY` 설정(없으면 F3 가드가 결제시크릿 저장 차단) ② 노출된 `sk_live` **Roll**(채팅 노출) — 코드/git 저장 안 함. ③ Stripe secret 은 관리자 UI 입력 시 AES-256-GCM 암호화 저장.
- **KRW 무소수점**: Stripe unit_amount 330000→330000 (POS MYR ×100과 다름). `stripeCheckoutService.toStripeAmount` 처리됨.
- 설계: `docs/UNIFIED_PAYMENT_ARCHITECTURE.md`, `docs/SAAS_BILLING_VS_QBILL_SEPARATION.md`, `docs/SUBSCRIPTION_PAYMENT_DESIGN.md`.

---

## 📦 이번 세션 작업 요약

- **랜딩 인사이트**: `/blog`→`/insights` URL 이전(옛 URL 301 리다이렉트) + Q위키 14건 인사이트 발행(seed `BLOG_MAP`, 이중언어) + coverage-check 게이트 확장. (검증 완료)
- **구독결제 Phase 0**: CheckoutModal 금액·계좌 복사버튼(Q Bill 패턴) + 영문 계좌표기(`platform_settings.bank_name_en/holder_en/swift` + 관리자 UI + `/plan/bank-info` EN). 안내 이메일 기존. (검증 11/11)
- **SaaS↔Q Bill 분리 canonical** 문서 + Fable 검토 SEPARATION SOUND(문구 3건 수정).
- **Stripe 토대(POS 이식)**: `npm i stripe@20`, `services/stripeService.js`(merchant 리졸버), `services/stripeCheckoutService.js`(SaaS Hosted Checkout, KRW정확, 이중결제 가드), `routes/stripeWebhook.js`(서명검증→markPaymentPaid 멱등, null-safe). `payments` 스키마 stripe method+컬럼. Fable 검토 F1~F6 수정.

**커밋:** `1eb1c1e` chore: 세션 중간 저장 - Stripe 키 보안 Fable 수정. (그 앞은 idle auto-save wip 커밋들에 이미 포함)

---

## 🔑 환경변수 / 인증 현황
- dev 백엔드 port 3003 (irene PM2 `planq-dev-backend`, online). q-note 8000.
- `EMAIL_ENCRYPTION_KEY` **dev 미설정**(JWT_SECRET fallback 사용 중 — 기존 Q Mail creds 가 이 fallback 에 의존하므로 함부로 설정 시 브릭 주의). 운영은 명시 설정 필요.
- Stripe 키: **아직 미저장**(관리자 UI 입력란 F4 미완). POS 는 `stripe ^20.3.1`.
- 배포: `deploy-planq.sh` (운영 87.106.78.146, POS 공존 port 3004). "배포" 명령 시에만.

---

## 📂 주요 문서
- 통합 결제: `docs/UNIFIED_PAYMENT_ARCHITECTURE.md` · 분리: `docs/SAAS_BILLING_VS_QBILL_SEPARATION.md` · PG: `docs/SUBSCRIPTION_PAYMENT_DESIGN.md`
- 위키 유지: `docs/Q_WIKI_MAINTENANCE.md`
- CLAUDE.md (규칙) · 메모리 `project_subscription_payment_plan` (이번 결정 전부 박제)

---

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
