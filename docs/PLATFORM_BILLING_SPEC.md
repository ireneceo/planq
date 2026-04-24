# PlanQ 플랫폼 구독 결제 (Platform Billing Spec)

> **PlanQ (법인) ↔ 워크스페이스 구독 결제 전 과정.**
> 상위 지도: `INTEGRATED_ARCHITECTURE.md §2 (내향 축)` · `§5 Phase 6`
> 구분: 이 문서는 **내향** (PlanQ 가 돈 받음). 외향(워크스페이스→고객)은 `Q_BILL_SPEC.md`.
>
> 작성: 2026-04-24 · 상태: Phase 6 진입 전 스펙 확정

---

## 1. 철학

1. **두 포트원 계정 분리** — PlanQ 자체 포트원 `store_id` vs 워크스페이스 개별 `portone_store_id` (businesses.portone_*). 섞이면 재앙.
2. **per-seat 하이브리드 (옵션 C 확정)** — 포함 seat 안에서는 평플랜, 초과 시 seat 단가 추가. 월정산.
3. **Fail-safe 다운그레이드** — 결제 3회 실패 → grace 7일 → Free 다운그레이드 + 읽기 전용 30일. 데이터 삭제는 절대 자동 하지 않음.
4. **투명 미리보기** — 요금 변경(플랜 업/다운, seat 추가)은 **실제 결제 전 금액 확인 모달** 필수.
5. **세금계산서 자동 발행** — 국내 워크스페이스에는 팝빌로 자동 발행, 해외는 영문 invoice PDF.

---

## 2. 데이터 모델

### 2.1 `platform_billing_keys` (신규)

워크스페이스의 카드 등록 = 빌링키 1개. 재등록 시 덮어쓰기.

```sql
CREATE TABLE platform_billing_keys (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  provider ENUM('portone','stripe') NOT NULL,
  billing_key VARCHAR(200) NOT NULL,          -- 포트원/Stripe 발급 토큰
  card_brand VARCHAR(50),                     -- 'Visa'/'MasterCard'/'신한' 등 UI 표시용
  card_last4 VARCHAR(4),                      -- 마지막 4자리
  card_holder_name VARCHAR(100),
  card_expires VARCHAR(7),                    -- 'MM/YY'
  registered_by_user_id INT NOT NULL,
  registered_at DATETIME,
  last_used_at DATETIME,
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME, updated_at DATETIME,
  INDEX idx_biz (business_id, is_active)
);
```

### 2.2 `platform_billings` (신규)

월별 과금 내역. idempotency + audit 용.

```sql
CREATE TABLE platform_billings (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  -- 주기
  cycle_start DATE NOT NULL,
  cycle_end DATE NOT NULL,
  billing_date DATE NOT NULL,
  -- 금액 (옵션 C 상세 내역)
  plan_code ENUM('free','starter','basic','pro','enterprise') NOT NULL,
  base_amount DECIMAL(10,2) NOT NULL,             -- 플랜 기본료
  included_seats INT NOT NULL,                    -- 포함 seat
  used_seats INT NOT NULL,                        -- 과금 시점 활성 seat (business_members WHERE role IN ('owner','member') AND removed_at IS NULL)
  extra_seats INT NOT NULL,                       -- max(0, used_seats - included_seats)
  extra_seat_unit_price DECIMAL(10,2) NOT NULL,   -- ₩9,000 or ₩12,000
  extra_amount DECIMAL(12,2) NOT NULL,            -- extra_seats × extra_seat_unit_price
  vat_rate DECIMAL(4,3) DEFAULT 0.100,
  vat_amount DECIMAL(12,2) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'KRW',
  -- 결제 상태
  status ENUM('scheduled','charged','failed','refunded','canceled') DEFAULT 'scheduled',
  charged_at DATETIME NULL,
  pg_transaction_id VARCHAR(200) NULL,
  pg_raw_response JSON NULL,
  retry_count INT DEFAULT 0,
  last_retry_at DATETIME NULL,
  failed_reason VARCHAR(500) NULL,
  -- 세금계산서 (팝빌)
  tax_invoice_status ENUM('none','pending','issued','failed') DEFAULT 'none',
  tax_invoice_id VARCHAR(100) NULL,
  tax_invoice_issued_at DATETIME NULL,
  -- 환불
  refunded_amount DECIMAL(12,2) DEFAULT 0,
  refunded_at DATETIME NULL,
  refund_reason VARCHAR(500) NULL,
  -- 감사
  created_at DATETIME, updated_at DATETIME,
  UNIQUE KEY uniq_biz_cycle (business_id, cycle_start),
  INDEX idx_billing_date (billing_date, status),
  INDEX idx_status (status, charged_at)
);
```

**멱등성 핵심**: `UNIQUE (business_id, cycle_start)` → 같은 워크스페이스의 같은 주기 중복 과금 방지.

### 2.3 기존 `businesses` 확장 (Phase 6)

```sql
ALTER TABLE businesses
  ADD COLUMN plan_anniversary_day INT DEFAULT 1,       -- 매월 과금일 (1-28)
  ADD COLUMN plan_grace_started_at DATETIME NULL,      -- grace 시작 시각 (결제 3회 실패 시)
  ADD COLUMN plan_downgrade_at DATETIME NULL,          -- grace 끝 예정일 (Free 전환 예정)
  ADD COLUMN plan_read_only_until DATETIME NULL;       -- Free 전환 후 30일 읽기 전용 종료일
```

### 2.4 기존 `contact_inquiries` 재사용

Enterprise 문의는 Phase 1.3 에서 구축. Platform Billing 은 별도 DB 불필요, 기존 흐름(문의 → platform_admin 수동 계약 → 플랜 수동 변경) 유지.

---

## 3. 옵션 C 과금 계산 (Phase 1 재검증 확정)

### 3.1 카탈로그 (Phase 1 에서 config/plans.js 재설계 적용)

| 플랜 | 월가격 | 포함 seat | 추가 seat | 고객 | Cue AI | Q Note | 스토리지 |
|---|---:|:---:|---:|:---:|---:|---:|---:|
| Free | ₩0 | 1 | 불가 | 3 | 30 | 1h | 200MB |
| Starter | ₩9,900 | 1 | **불가** | 20 | 300 | 5h | 1GB |
| Basic | ₩29,000 | 5 | +₩9,000 | 50 | 1,500 | 25h | 5GB |
| Pro | ₩79,000 | 15 | +₩12,000 | 200 | 7,500 | 150h | 20GB |
| Enterprise | 문의 | 맞춤 | 맞춤 | 무제한 | 맞춤 | 맞춤 | 맞춤 |

### 3.2 월 금액 계산식

```
used_seats = COUNT(business_members WHERE role IN ('owner','member') AND removed_at IS NULL)
                 AT cycle_start 시점
extra_seats = MAX(0, used_seats - plan.included_seats)
extra_amount = extra_seats × plan.extra_seat_unit_price
base_amount = plan.price_monthly[currency]
subtotal = base_amount + extra_amount
vat_amount = FLOOR(subtotal × vat_rate)     -- 국내 10%
total_amount = subtotal + vat_amount
```

### 3.3 업/다운그레이드 prorate

- **업그레이드**: 즉시 적용. **차액만** 일할 계산하여 즉시 과금.
  - 예: Basic(₩29,000) 사용 중 10일째 Pro(₩79,000) 업 → 차액 ₩50,000 × (남은 일수 ÷ 한 달) 즉시 과금.
- **다운그레이드**: 현 결제 주기 종료까지 현 플랜 유지. 다음 주기부터 새 플랜 (Irene 결정 #11).

### 3.4 일할 (prorate) 공식

```
days_in_cycle = DAYS_BETWEEN(cycle_start, cycle_end) + 1
days_remaining = DAYS_BETWEEN(TODAY, cycle_end) + 1
prorate_factor = days_remaining / days_in_cycle
prorate_amount = (new_plan.base - current_plan.base) × prorate_factor
```

### 3.5 Seat 추가 시 즉시 과금

팀원 11번째 초대 시 (Basic 포함 5 + 이미 10명 = 초과 5명 상태에서 +1)
- UI 모달: "11번째 시트 ₩9,000 × 남은 N일 = ₩X 즉시 결제"
- 확인 시 `platform_billings` (type='seat_addition') 단독 레코드 생성 후 즉시 과금. 다음 정기 cycle 과 별개.

---

## 4. 결제 플로우

### 4.1 빌링키 최초 등록

```
[설정 > 구독 플랜 > 결제 수단]
    │
    ▼
"카드 등록" 클릭 → 포트원 SDK 로드
    │
    ▼
카드정보 입력 (포트원 UI) → 인증 (ISP/3DS)
    │
    ▼
포트원 → 서버 webhook (billing_key 반환)
    │
    ▼
platform_billing_keys INSERT/UPDATE
    │
    ▼
등록 완료 메시지 + 다음 정기 결제일 안내
```

### 4.2 자동 월 결제 (cron)

```
매일 03:00 KST — subscription-charge cron
    │
    ▼
billing_date <= TODAY + status='scheduled' 인 platform_billings 조회
    │
    ▼
각 레코드에 대해:
    - 빌링키 조회 (platform_billing_keys)
    - 포트원 V2 API: POST /payments/{id}/billing (subscription charge)
    - 성공 시: status='charged', charged_at, pg_transaction_id, raw_response
    - 실패 시: status='failed', retry_count++, failed_reason
    │
    ▼
세금계산서 자동 발행 (국내 사업자만, 팝빌 API)
    │
    ▼
이메일 영수증 발송 (결제 성공) 또는 재시도 안내 (실패)
```

### 4.3 결제 실패 처리

| 차수 | 타이밍 | 동작 |
|---|---|---|
| 1차 (D) | billing_date 당일 03:00 | 실패 → owner 이메일 "카드 확인 필요" |
| 2차 (D+3) | 3일 후 03:00 | 재시도. 실패 시 재이메일 |
| 3차 (D+7) | 7일 후 03:00 | 재시도. 실패 시 **grace 진입** (plan_grace_started_at = NOW) |
| Grace +7일 (D+14) | — | **Free 로 자동 다운그레이드** + plan_read_only_until = NOW + 30일 |
| +30일 (D+44) | — | 읽기 전용 해제 후 계속 Free. **데이터는 보존** |

### 4.4 Grace 중 UI 경고

상단 전역 배너 (dismissable 불가):
```
[경고] 결제 실패로 7일 후 Free 플랜으로 전환됩니다. 카드를 확인해주세요. [카드 업데이트]
```

---

## 5. 해외 (Stripe) 분기

**분기 기준**: `businesses.country` (Irene 결정 #12). 카드 국가 무관 — 세금계산서·VAT 는 사업자 소재지 기준이므로.

| country | PG | VAT | 영수증/세금계산서 |
|---|---|---|---|
| `KR` | 포트원 (토스) | 10% | 팝빌 전자세금계산서 자동 |
| 그 외 | 포트원 (Stripe 채널) | 0% (영세율) | 영문 Invoice PDF (커스텀 렌더) |

Stripe 계정은 **PlanQ 자체 Stripe**. 워크스페이스 Stripe 와 별개.

---

## 6. 관리자 대시보드

`/admin/platform-billing` — platform_admin 전용

### 6.1 섹션
1. **이번 달 수익 현황** — 총 MRR · 신규 · 해지 · 다운그레이드
2. **결제 실패 큐** — 재시도 대기 / grace 중 / Free 전환 임박
3. **구독 현황 테이블** — 워크스페이스별 플랜·MRR·next_billing
4. **평균 ARPU (인당 매출)** · **Churn rate** · **LTV 추정**

### 6.2 관리 액션 (platform_admin 만)
- 수동 환불 (`platform_billings.refund`)
- 특정 워크스페이스 플랜 강제 변경 (기존 `/api/admin/businesses/:id/plan` 연동)
- 빌링키 삭제 / 재등록 요청 발송
- 세금계산서 재발행

---

## 7. API 엔드포인트

```
빌링키 (워크스페이스 owner)
  GET    /api/platform-billing/:businessId/key             현재 등록 카드 (마스킹)
  POST   /api/platform-billing/:businessId/key/register    포트원 SDK 콜백 처리
  DELETE /api/platform-billing/:businessId/key             카드 삭제 (구독 해지 플로우와 별개)

결제 내역
  GET    /api/platform-billing/:businessId/history         월별 결제 내역
  GET    /api/platform-billing/:businessId/upcoming        다음 청구 미리보기 (prorate 계산 포함)
  POST   /api/platform-billing/:businessId/retry           수동 재시도 (결제 실패 시 owner 가 카드 교체 후)

플랜 변경 (기존 plan.js 확장)
  POST   /api/plan/:businessId/change                      body: { plan_code, cycle }  — prorate 자동 계산 후 즉시 과금 차액
  POST   /api/plan/:businessId/schedule-downgrade          body: { plan_code }  — 다음 주기 적용 예약

Webhook (포트원/Stripe)
  POST   /api/platform-billing/webhook/portone             포트원 결제·환불·빌링키 이벤트
  POST   /api/platform-billing/webhook/stripe              Stripe 해외 결제 이벤트

관리자
  GET    /api/admin/platform-billing/overview              KPI 대시보드 데이터
  GET    /api/admin/platform-billing/failures              실패 큐
  POST   /api/admin/platform-billing/:id/refund            환불
  POST   /api/admin/platform-billing/:id/retry             수동 재시도
  POST   /api/admin/platform-billing/:id/reissue-tax       세금계산서 재발행

Cron 수동 트리거 (dev/검증)
  POST   /api/admin/cron/platform-charge
  POST   /api/admin/cron/platform-grace-check
  POST   /api/admin/cron/platform-downgrade
```

---

## 8. UI 설계

### 8.1 설정 > 구독 플랜 > "결제 수단" 섹션

카드 없는 상태:
```
┌──────────────────────────────────────┐
│ 결제 수단                             │
│ 등록된 카드가 없습니다.                │
│                                      │
│ [카드 등록]                           │
└──────────────────────────────────────┘
```

카드 있는 상태:
```
┌──────────────────────────────────────┐
│ 결제 수단                             │
│ 신한카드 **** 1234 (12/27)           │
│ 다음 결제: 2026-05-15 · ₩56,000        │
│                                      │
│ [카드 교체]  [내역 보기]              │
└──────────────────────────────────────┘
```

### 8.2 Seat 추가 확인 모달 (UX 약속 §9.3)

```
┌─────────────────────────────────────────────┐
│ 팀원 추가 확인                               │
├─────────────────────────────────────────────┤
│ 김새멤버 님을 초대합니다.                    │
│                                             │
│ 현재 플랜: Basic (5 seat 포함)               │
│ 현재 사용: 10 / 5 (이미 5명 초과)            │
│ 추가 seat: 1명 × ₩9,000 × 남은 18일 = ₩5,400 │
│                                             │
│ ✓ 즉시 카드로 ₩5,400 결제                   │
│ ✓ 다음 달부터 월 ₩56,000 (기본 ₩29,000 +    │
│   6 seat × ₩9,000)                          │
│                                             │
│ ℹ️ 팁: 12 seat 이상 쓰실 예정이면            │
│    Pro 전환이 월 ₩13,000 더 저렴합니다.      │
│    [Pro 로 업그레이드]                       │
│                                             │
│           [취소]   [초대 + 결제]             │
└─────────────────────────────────────────────┘
```

### 8.3 업그레이드 모달 (prorate 투명 표시)

```
┌─────────────────────────────────────────────┐
│ Pro 로 업그레이드                            │
├─────────────────────────────────────────────┤
│ 이번 주기에 즉시 적용됩니다.                 │
│                                             │
│ 차액 계산                                   │
│  Pro 월 기본:  ₩79,000                      │
│  현재 Basic:   ₩29,000 (사용 중)            │
│  차액:         ₩50,000                      │
│  남은 일수:    18일 / 30일                   │
│  일할 차액:    ₩30,000                      │
│                                             │
│  VAT (10%):    ₩3,000                       │
│  총 결제액:    ₩33,000 (즉시)                │
│                                             │
│  다음 결제일: 2026-05-15 — ₩86,900          │
│              (₩79,000 × 1.1)                │
│                                             │
│            [취소]   [업그레이드 + 결제]      │
└─────────────────────────────────────────────┘
```

---

## 9. Enterprise 특별 처리

- Enterprise 는 **자동 결제 없음**. platform_admin 이 수동으로 연간 계약 등록.
- `contact_inquiries.kind='enterprise'` → 영업 담당 플랫폼 관리자 수동 대응 → 계약 후 `plan='enterprise'` 수동 설정.
- 결제는 **전자세금계산서 후 계좌이체** 기본 (Phase 6 에서도 자동화 미포함).
- 필요 시 Phase 10+ 에서 "Enterprise 포털" (수동→반자동) 분리 프로젝트로.

---

## 10. 세금계산서 발행 (팝빌)

### 10.1 트리거
`platform_billings.status` 가 `'charged'` 로 전환 시 cron 이 팝빌 API 호출.

### 10.2 발행 대상
- 국내 사업자 (`businesses.country='KR'` AND `businesses.tax_id` 존재) — 자동 발행
- 국내 개인 (`tax_id` 없음) — 현금영수증 대신 **결제 영수증 이메일만**
- 해외 — 영문 Invoice PDF (`reports` 방식 동일한 PDF 렌더)

### 10.3 PlanQ 자체 팝빌 계정
- `config/env.js` (Phase 6 환경변수):
  - `PLANQ_POPBILL_LINK_ID`
  - `PLANQ_POPBILL_SECRET_KEY`
  - `PLANQ_ISSUER_TAX_ID` — PlanQ 법인 사업자등록번호
- 워크스페이스 개별 팝빌 키와 **완전 별개**.

---

## 11. 보안 · 컴플라이언스

1. **PCI DSS**: 카드번호·CVC 는 **서버에 저장하지 않음**. 포트원/Stripe 빌링키 토큰만.
2. **webhook 서명 검증**: `X-PortOne-Signature` · `Stripe-Signature` HMAC 필수.
3. **환불 권한**: platform_admin 만 · AuditLog 필수.
4. **개인정보**: 카드 holder name / last4 는 마스킹 후 UI 노출. logs 에는 masked.
5. **GDPR (해외 Stripe)**: 결제 데이터 EU 보관 정책. 유럽 고객이 다수 생기면 별도 리전 검토 (Phase 10+).

---

## 12. 검증 체크리스트

- [ ] 같은 워크스페이스 같은 cycle 에 `platform_billings` 중복 생성 안 됨 (UNIQUE)
- [ ] seat 추가 과금 prorate 정확 (남은 일수 / 전체 일수)
- [ ] 업그레이드 prorate 정확 (차액 × 일할)
- [ ] 결제 3회 실패 → grace 7일 → Free 전환 순서 정확
- [ ] Free 전환 후 데이터 유지 · 읽기 전용 모드 정상
- [ ] 해외 (`country != 'KR'`) 워크스페이스는 Stripe 로 분기
- [ ] 세금계산서 발행 status 흐름 (pending→issued) 정확
- [ ] 빌링키 webhook 서명 검증 (위변조 거부)
- [ ] 카드 교체 시 기존 빌링키 무효화
- [ ] 관리자 환불 시 refunded_amount 업데이트 + 세금계산서 취소 연동

---

## 13. 구현 일정 (Phase 6 — 1.5주, 기존 0.5주에서 확대)

| Day | 작업 |
|---|---|
| 1 | DB 스키마 (`platform_billing_keys`, `platform_billings`, businesses 확장) + 모델 |
| 2 | 포트원 V2 SDK 연결 + 카드 등록 플로우 + 빌링키 저장 |
| 3 | 자동 월 결제 cron + 실패 재시도 + grace 전환 |
| 4 | 업/다운그레이드 prorate + seat 추가 즉시 과금 + UI 모달 3개 |
| 5 | 세금계산서 팝빌 자동 발행 + 영수증 이메일 |
| 6 | Stripe 해외 분기 + webhook 서명 검증 |
| 7 | 관리자 대시보드 `/admin/platform-billing` |
| 8 | E2E 검증 (테스트 카드 · 실패 시나리오 · grace 타임 skip) |

---

## 14. 사전 조건 (Phase 6 들어가기 전 준비)

Irene 외부 준비 필요:
- [ ] PlanQ 법인 포트원 V2 Starter 계정 생성 + store_id/api_secret 발급
- [ ] Stripe 법인 계정 (해외 고객 예정 시)
- [ ] PlanQ 법인 팝빌 계정 + link_id/secret_key
- [ ] 이용약관·개인정보처리방침 **결제 섹션** 추가 (법무 검토)
- [ ] 환불 정책 명문화 (14일 이내 전액 환불 · 부분환불 기준)

---

## 15. 변경 이력

| 날짜 | 버전 | 요약 |
|---|---|---|
| 2026-04-24 | 1.0 | 플랫폼 구독 결제 설계 확정. 옵션 C per-seat + prorate + grace + Stripe 해외 · Phase 6 8일 일정 · 사전 조건 5 |
