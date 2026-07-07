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

**마지막 작업:** PlanQ 구독결제에 **Stripe(카드) 결제** 이식 중. POS(`/var/www/dev-backend`, Read 가능) 패턴 그대로 가져와 이식. Stripe 키 보안 Fable 검토 → F1(PUT 암호문 유출)·F2(audit 암호문 저장)·F3(암호화 키 fallback)·F6(merchant alias) **전부 수정·재검증 완료** (commit 1eb1c1e).

**바로 다음 작업 (라이브 배선, Fable 게이트):**
1. **F4: 관리자 결제설정에 Stripe 입력란** — `AdminBillingSettingsPage.tsx` 에 publishable/secret(write-only)/webhook 입력 추가 (백엔드 PUT/GET·암호화는 이미 완료, UI만 없음)
2. **server.js webhook 마운트** — `app.use('/api/stripe/webhook', express.raw({type:'application/json'}), require('./routes/stripeWebhook'))` **json 파서 前에** (마운트 순서 주의 = Fable 게이트)
3. **plan.js Stripe 체크아웃 엔드포인트** — pending Payment → `stripeCheckoutService.startPlatformSubscriptionCheckout` → session.url 반환
4. **CheckoutModal "카드로 결제" 버튼** — 위 엔드포인트 호출 → Stripe 페이지 리다이렉트
5. Stripe 대시보드 webhook 등록 + 관리자에 webhook secret 입력
6. **운영 소액 실결제+환불** 스모크(Irene 결정: 결제 테스트는 운영에서)

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
