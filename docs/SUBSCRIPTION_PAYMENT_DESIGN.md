# 구독결제 — PortOne 카드 정기결제 연동 설계

> 작성 2026-07-07 (Opus). 상태: **설계 + 안전 stub 선행** (Irene PortOne 키 대기 중, 배포 없음).
> 대상: 워크스페이스 → PlanQ SaaS 구독료를 **카드 빌링키 정기 자동결제**로 받기.
> 게이트: 돈 무결성 → **Fable 게이트 필수** (실배선·배포 전). 로드맵 `docs/ROADMAP_NEXT.md` C-1.

---

## 0. 원칙 — 기존 자체결제 위에 얹는다 (재작성 금지)

계좌이체 트랙(`services/billing.js`)은 이미 라이브·멱등. PortOne은 **결제 "실행부"만 분기**로 추가하고, 성공 시 기존 멱등 함수를 그대로 호출한다.

| 기존 함수 (재사용) | 역할 | PortOne 접점 |
|--------------------|------|--------------|
| `createPendingSubscription` | 구독+pending Payment 생성 | 그대로. method만 분기 |
| **`markPaymentPaid`** (billing.js:140) | 멱등·period·plan·이력·알림 전부 | **PortOne 결제 성공 시 이걸 호출** (webhook·즉시결제 공통 착지점) |
| `ensureRenewalPayment` (:312) | 갱신 pending Payment 멱등 생성 | 그대로. auto_pay면 생성 직후 즉시 재결제 시도 |
| `runDailyBillingCron` (:392) | active→past_due→grace→demoted | **auto_pay 구독은 past_due 진입 전 빌링키 재결제 먼저 시도** |

> 핵심: PortOne 코드가 하는 일은 "카드에서 돈을 빼오는 것"까지. 그 다음 상태 반영은 **전부 `markPaymentPaid` 한 곳**을 통과한다. 이중 경로 금지 → 중복청구·상태불일치 원천 차단.

---

## 1. 버전 — PortOne V2 채택 (기본)

- 신규 연동은 **V2** (`api.portone.io`, SDK v2, `paymentId`/`billingKey` 체계). 콘솔이 V1(구 아임포트 `imp_uid`)로 계약되면 래퍼 내부에서 분기 (설계는 V2 우선, V1은 폴백 어댑터).
- 기존 `Payment.portone_imp_uid`(V1 잔재)는 유지하되 신규는 `portone_payment_id`(V2) 사용.

---

## 2. 결제 흐름 3가지

### (A) 카드 등록 = 빌링키 발급 (1회)
```
[프론트] 결제수단 등록 버튼
  → PortOne SDK v2 requestIssueBillingKey (카드 정보는 PortOne 창에서만 입력, PlanQ 서버 미경유)
  → billingKey 발급 (PortOne 저장, PlanQ엔 토큰만)
  → [프론트] POST /api/plan/:bizId/payment-methods { billingKey, ... }
  → [서버] PortOne API로 billingKey 유효성/카드정보(brand,last4) 조회
         → encrypt(billingKey) 저장 (PaymentMethod row)
```
**PCI: 카드 원번호/CVC는 PlanQ가 절대 저장·경유 안 함. billingKey(토큰)만.**

### (B) 즉시 결제 (플랜 첫 구매 / 업그레이드)
```
createPendingSubscription (method='portone', auto_pay=true, payment_method_id)
  → payWithBillingKey(merchant_uid=UUID, billingKey, amount)
     - 성공 → markPaymentPaid({ paymentId, source:'portone', portoneRes })  ← 기존 멱등
     - 실패 → Payment.status='failed', failure_code 기록, 사용자 안내 (강등 아님)
```

### (C) 정기 자동결제 (갱신)
```
runDailyBillingCron:
  active 구독 current_period_end 도래 (D-day 또는 D-0):
    auto_pay=true & payment_method 있음:
       ensureRenewalPayment(sub) → 생성된 pending Payment 를 즉시 payWithBillingKey
         - 성공 → markPaymentPaid (period 연장, 무중단)
         - 실패 → 재시도 스케줄 (dunning, §5). N회 실패 후 past_due→grace→demoted 기존 경로로 폴백
    auto_pay=false (계좌이체 유지):
       기존 그대로 (past_due 진입 → 수동 mark-paid)
```

---

## 3. 스키마 변경 (dev 먼저, 운영은 Fable 게이트 후 수동 ALTER)

### 3-1. 신규 테이블 `payment_methods` (빌링키 = 워크스페이스 결제수단)
| 컬럼 | 타입 | 비고 |
|------|------|------|
| id | INT PK | |
| business_id | INT FK businesses | 멀티테넌트 소유 |
| provider | ENUM('portone') | 확장 여지 |
| billing_key_enc | TEXT | **AES-256-GCM 암호화** (`services/encryption.js`) |
| card_brand | STRING(32) | 표시용 (비민감) |
| card_last4 | STRING(4) | 표시용 |
| pg_provider | STRING(32) | 이니시스/나이스/토스 |
| status | ENUM('active','removed','invalid') | 카드만료/삭제 |
| is_default | BOOLEAN | 워크스페이스 기본 결제수단 |
| created_by | INT FK users | |
| removed_at | DATE null | 소프트 삭제 |

> 빌링키 재발급 시 옛 row `status='removed'`+`removed_at` 마크 후 신규 insert (감사 보존 — 운영안정성 규칙 5).

### 3-2. `subscriptions` 컬럼 추가
- `auto_pay` BOOLEAN default false — 자동결제 ON/OFF (사용자 토글)
- `payment_method_id` INT FK payment_methods null — 어떤 카드로 재결제할지

### 3-3. `payments` 컬럼 추가
- `portone_payment_id` STRING(64) — V2 결제 식별자
- `portone_merchant_uid` **UNIQUE 인덱스** (기존 컬럼에 UNIQUE 추가) — 중복결제 차단 핵심
- `attempt_count` INT default 0 — 재시도 횟수
- `last_attempt_at` DATE null
- `next_retry_at` DATE null — dunning 스케줄
- `failure_code` STRING(64) null / `failure_message` STRING(500) null

> ⚠️ 운영 ALTER 주의: [[feedback_sync_alter_too_many_keys]] MySQL 64키 한도. payments 인덱스 현황 확인 후 UNIQUE 추가. sync-database 는 dev만, 운영은 수동 ALTER 스크립트 + 백필 idempotent.

---

## 4. `services/portone.js` — 안전 래퍼 (키 없으면 stub)

```js
const CONFIGURED = !!(process.env.PORTONE_API_SECRET && process.env.PORTONE_STORE_ID);
function isConfigured() { return CONFIGURED; }

// 키 없으면 명확한 에러 → 라우트가 503 'portone_not_configured' 반환. 절대 조용한 성공 금지.
async function payWithBillingKey({ billingKey, merchantUid, amount, currency, orderName }) {
  if (!CONFIGURED) throw new Error('portone_not_configured');
  // V2: POST https://api.portone.io/payments/{merchantUid}/billing-key ...
}
async function getBillingKeyInfo(billingKey) { if (!CONFIGURED) throw new Error('portone_not_configured'); /* 카드 brand/last4 */ }
async function cancelPayment({ paymentId, amount, reason }) { if (!CONFIGURED) throw new Error('portone_not_configured'); }
function verifyWebhook(rawBody, headers) { /* HMAC 서명 검증 + 타임스탬프 재생공격 차단 */ }

module.exports = { isConfigured, payWithBillingKey, getBillingKeyInfo, cancelPayment, verifyWebhook };
```
- 키 없을 때: 프론트 "카드 자동결제"는 **비활성(계좌이체만 노출)**. 라우트는 503 반환. **stub이 가짜 성공 리턴 절대 금지** (돈 흐름 위조 = 최악).

---

## 5. Dunning (재시도) — 중복청구 0 + 폭주 차단

- 실패 시 지수 백오프: **D+0 즉시 → D+1 → D+3 → D+5** (최대 4회). `next_retry_at`으로 cron이 스케줄.
- 각 재시도는 **같은 `portone_merchant_uid`** 재사용 → PortOne 멱등 + UNIQUE로 이중과금 차단.
- 4회 모두 실패 → 기존 `past_due → grace(7일) → demoted` 경로로 자연 폴백 (별도 강등 로직 안 만듦).
- 성공 시 그 구독의 다른 pending 재시도 Payment는 정리.
- 알림: 실패 1회차부터 owner에게 "카드 결제 실패, 카드 확인" 메일 (검증된 수신자만 — [[feedback_no_automail_unverified]]).

---

## 6. Webhook `POST /api/webhooks/portone` (공개 라우트)

- **라우터 마운트: authenticateToken 앞** (공개). 보안경계 변경 → Fable 대상.
- **서명 검증 필수** (`verifyWebhook`) — 실패 시 401, DB 미변경.
- **멱등**: `portone_payment_id` 또는 `merchant_uid`로 이미 처리된 이벤트면 200 즉시 반환 (재생·중복 webhook 무해).
- 정상 결제완료 이벤트 → 해당 Payment 찾아 `markPaymentPaid` 호출 (즉시결제와 동일 착지).
- raw body 필요 (서명 검증) → express.raw 미들웨어를 이 라우트에만.

---

## 7. 보안·멀티테넌트 체크리스트 (Fable 게이트 항목)

- [ ] billingKey **암호화 저장**, 로그·응답에 평문 노출 0 (마스킹)
- [ ] 카드 원번호/CVC **저장·경유 0** (PortOne 창만) — PCI 범위 최소화
- [ ] `portone_merchant_uid` **UNIQUE** → 중복결제 0
- [ ] 재결제 시 `payment_method.business_id === sub.business_id` 검증 (테넌트 격리)
- [ ] webhook 서명 검증 + 타임스탬프 재생공격 차단
- [ ] 재시도 상한(4회) → 실패 폭주·API 남용 차단
- [ ] 환불(`cancelPayment`) = platform_admin만 (기존 `assertInvoiceMutationOwner` 급 가드)
- [ ] 자체결제(bank_transfer)와 공존 — method 분기, 기존 흐름 무손상

---

## 8. UI (키 확보 후)

- **PlanSettings → 결제수단 카드**: "카드 자동결제 등록" (PortOne 창) / 등록된 카드 brand·****last4 표시 / 삭제·변경 / **자동결제 ON·OFF 토글**
- CheckoutModal: 결제방식 선택 (계좌이체 | 카드자동결제[키 있을 때만])
- 결제 실패 배너: "카드 결제가 실패했어요 — 카드 정보를 확인해주세요" (엔지니어링 용어 금지, [[feedback_user_facing_copy]])
- 키 없을 때: 카드 옵션 자체 숨김 (계좌이체만).

---

## 9. 단계별 착수 순서

| 단계 | 내용 | 키 필요 | 배포 |
|------|------|:------:|:----:|
| **S1** (지금) | 이 설계 + `services/portone.js` stub + 스키마(dev) + 모델/association | ✕ | ✕ |
| S2 | 키 수령 → .env → 래퍼 실API 배선 (V2) + payment-methods 라우트 | ✔ | ✕ |
| S3 | 즉시결제·정기결제 cron 분기 + webhook + dunning | ✔ | ✕ |
| S4 | UI (결제수단 등록/토글/실패배너) | ✔ | ✕ |
| **S5** | **Fable 게이트** (돈 무결성 전항목) → 통과 시 운영 ALTER + 배포 | ✔ | ✔ |

> S1은 **가짜성공 없는 안전 stub**이라 지금 배포해도 무해하지만, 배포는 안 함(로드맵 원칙). 키 오면 S2~S5 연속 진행.

---

## 10. Irene 선행 (별도 안내 완료)
- PortOne 가맹점 가입 + **정기결제(빌링) 지원 PG 계약** (이니시스/나이스/토스, 심사 3~7영업일)
- 전달값: Store ID · API Secret · Webhook Secret · Channel Key · (V1/V2 여부)
