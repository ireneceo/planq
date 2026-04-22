# Q Bill — 청구·결제·세금계산서 통합 설계

> 관련 문서: [FINANCIAL_REPORTS_SPEC.md](./FINANCIAL_REPORTS_SPEC.md) · [FEATURE_SPECIFICATION.md](./FEATURE_SPECIFICATION.md) · [API_DESIGN.md](./API_DESIGN.md)
>
> 작성: 2026-04-22 · 상태: 설계 확정 (구현 대기)

## 1. 목적

워크스페이스(사업자)가 **자기 고객**에게 제공하는 서비스/상품에 대한 **견적→청구→결제→세금계산서** 전 과정을 한 화면에서 처리.
PlanQ 자체 구독료는 **별도 시스템**(플랫폼 ↔ 워크스페이스) — 본 문서 섹션 9.

## 2. 네비게이션 구조

```
[기능]
  Q Talk · Q Task · Q Note · Q Bill ◀

Q Bill 하위 탭:
  📋 개요 · 📝 견적서 · 🧾 청구서 · 💳 결제내역 · 📄 세금계산서 · ⚙️ 설정

프로젝트 상세 탭:
  대시보드 · 업무 · 테이블 · 고객 · 파일 · 문서 · 💰 Bill ◀ · 상세정보
```

## 3. 대상 고객 자동 분기

`clients.country` + `clients.is_business` 기준:

| 고객 | 결제 채널 | 세금계산서 | 부가세 | Invoice 언어 |
|---|---|---|---|---|
| 국내 사업자 | 포트원 국내 채널(토스) | 팝빌 자동 | 10% 포함 | ko |
| 국내 개인 | 포트원 국내 채널(토스) | 현금영수증 | 10% 포함 | ko |
| 해외 | 포트원 해외 채널(Stripe) | 없음 (영세율) | 0% | en |

## 4. Q Bill 기능 상세

### 4.1 개요 대시보드
- 수금 카드 (이번 달 청구·수금·미수·연체)
- 월별 매출 트렌드 (12개월)
- 미수금 TOP 5
- 발행 예정 구독 청구
- 세금계산서 미발행 목록

### 4.2 견적서(Quotes)
**라이프사이클**: `draft → sent → viewed → accepted / rejected / expired / converted`

**자동 전환**: 고객이 승인하면 동일 내용 Invoice 로 원-클릭 전환 (`converted_invoice_id` 연결 유지).

**품목 자동 채우기**:
- 시간 기반: `tasks.actual_hours × member.hourly_rate` 집계
- 프로젝트 `contract_amount` 자동 삽입
- 구독 `monthly_fee` 자동 삽입
- 수동 품목 추가 병행

**공유**: 공개 링크(share_token) · 이메일 · Q Talk 채팅방 자동 공유.

### 4.3 청구서(Invoices)
- 견적서 전환 또는 독립 발행
- 발행 번호 자동(`INV-2026-0042`)
- 부분결제 누적(`paid_amount`)
- 상태: `draft → sent → viewed → partial → paid / overdue / canceled`

### 4.4 결제내역(Payments)
- 포트원 webhook 자동 기록
- 수동 기록(은행송금)
- 월별·수단별 집계
- 환불 이력

### 4.5 세금계산서(Tax Invoices)
- 미발행 대기 / 발행 완료 / 실패 / 취소
- 팝빌 API 연동 (설정에서 key 등록 시만 자동화)
- 실패 시 재시도 버튼

### 4.6 설정
- 발행자 정보 (사업자등록증·은행계좌·로고)
- 포트원 연결 (store_id, api_secret, 국내/해외 channel)
- 팝빌 연결 (link_id, secret_key)
- 기본 부가세율·지급조건 템플릿·이메일 템플릿

## 5. 프로젝트 Bill 탭

- **계약 정보**: `contract_amount`, `billing_type` (fixed/hourly/subscription/milestone), `monthly_fee`, 마일스톤 스케줄
- **원가 vs 청구 게이지**
  - 누적 투입시간 × 멤버 hourly_rate = 실 원가
  - 청구 합계 vs 계약액 vs 원가
  - 마진 게이지 (빨강/노랑/초록)
- **이 프로젝트 견적서 / 청구서 / 수금 타임라인**
- **"이 프로젝트 청구서 발행" 단축 버튼** — 기간 선택 → 미청구 시간 자동 집계 → 견적/청구 draft 생성

## 6. 데이터 모델

### 6.1 기존 테이블 확장
```sql
-- 발행자 (워크스페이스)
ALTER TABLE businesses
  ADD COLUMN biz_registration_img VARCHAR(500),
  ADD COLUMN bank_name VARCHAR(100),
  ADD COLUMN bank_account_name VARCHAR(100),
  ADD COLUMN bank_account_number VARCHAR(50),
  ADD COLUMN tax_invoice_email VARCHAR(200),
  ADD COLUMN portone_store_id VARCHAR(100),
  ADD COLUMN portone_api_secret VARCHAR(500),
  ADD COLUMN portone_channel_domestic VARCHAR(100),
  ADD COLUMN portone_channel_overseas VARCHAR(100),
  ADD COLUMN portone_webhook_secret VARCHAR(500),
  ADD COLUMN popbill_link_id VARCHAR(100),
  ADD COLUMN popbill_secret_key VARCHAR(500),
  ADD COLUMN default_vat_rate DECIMAL(4,3) DEFAULT 0.10;

-- 수신자 (고객)
ALTER TABLE clients
  ADD COLUMN country VARCHAR(2) DEFAULT 'KR',
  ADD COLUMN is_business TINYINT(1) DEFAULT 0,
  ADD COLUMN biz_name VARCHAR(200),
  ADD COLUMN biz_ceo VARCHAR(100),
  ADD COLUMN biz_tax_id VARCHAR(20),
  ADD COLUMN biz_type VARCHAR(100),
  ADD COLUMN biz_item VARCHAR(100),
  ADD COLUMN biz_address VARCHAR(500),
  ADD COLUMN biz_address_en VARCHAR(500),
  ADD COLUMN tax_invoice_email VARCHAR(200),
  ADD COLUMN billing_contact_name VARCHAR(100),
  ADD COLUMN billing_contact_email VARCHAR(200);

-- 프로젝트 계약
ALTER TABLE projects
  ADD COLUMN contract_amount DECIMAL(14,2),
  ADD COLUMN billing_type ENUM('fixed','hourly','subscription','milestone','internal') DEFAULT 'fixed',
  ADD COLUMN monthly_fee DECIMAL(12,2);

-- 멤버 단가
ALTER TABLE business_members
  ADD COLUMN hourly_rate DECIMAL(10,2),
  ADD COLUMN monthly_salary DECIMAL(12,2);

-- 인보이스
ALTER TABLE invoices
  ADD COLUMN invoice_number VARCHAR(50),
  ADD COLUMN project_id BIGINT,
  ADD COLUMN quote_id BIGINT,
  ADD COLUMN currency VARCHAR(3) DEFAULT 'KRW',
  ADD COLUMN subtotal DECIMAL(14,2),
  ADD COLUMN vat_rate DECIMAL(4,3) DEFAULT 0.10,
  ADD COLUMN vat_amount DECIMAL(14,2),
  ADD COLUMN total_amount DECIMAL(14,2),
  ADD COLUMN paid_amount DECIMAL(14,2) DEFAULT 0,
  ADD COLUMN due_date DATE,
  ADD COLUMN paid_at DATETIME,
  ADD COLUMN payment_terms TEXT,
  ADD COLUMN notes TEXT,
  ADD COLUMN share_token VARCHAR(64) UNIQUE,
  ADD COLUMN viewed_at DATETIME,
  ADD COLUMN tax_invoice_status ENUM('none','pending','issued','failed','canceled') DEFAULT 'none',
  ADD COLUMN tax_invoice_external_id VARCHAR(100),
  ADD COLUMN tax_invoice_url VARCHAR(500),
  ADD COLUMN tax_invoice_issued_at DATETIME;
```

### 6.2 신규 테이블

```sql
-- 견적서
CREATE TABLE quotes (
  id BIGINT PK AUTO_INCREMENT,
  business_id INT NOT NULL,
  client_id INT,
  project_id BIGINT NULL,
  quote_number VARCHAR(50) NOT NULL,
  title VARCHAR(300),
  status ENUM('draft','sent','viewed','accepted','rejected','expired','converted') DEFAULT 'draft',
  issued_at DATE, valid_until DATE,
  subtotal DECIMAL(14,2), vat_rate DECIMAL(4,3),
  vat_amount DECIMAL(14,2), total_amount DECIMAL(14,2),
  currency VARCHAR(3) DEFAULT 'KRW',
  payment_terms TEXT, notes TEXT,
  signature_url VARCHAR(500),
  share_token VARCHAR(64) UNIQUE,
  viewed_at DATETIME, accepted_at DATETIME,
  converted_invoice_id BIGINT NULL,
  created_by INT NOT NULL,
  created_at DATETIME, updated_at DATETIME,
  INDEX(business_id, status), INDEX(client_id), INDEX(project_id)
);

CREATE TABLE quote_items (
  id BIGINT PK AUTO_INCREMENT,
  quote_id BIGINT NOT NULL,
  description VARCHAR(500) NOT NULL,
  quantity DECIMAL(10,2) DEFAULT 1,
  unit_price DECIMAL(14,2) NOT NULL,
  subtotal DECIMAL(14,2) NOT NULL,
  source_type ENUM('task_hours','manual','recurring') DEFAULT 'manual',
  source_ref_id BIGINT NULL,
  order_index INT DEFAULT 0,
  INDEX(quote_id)
);

-- 결제 기록 (invoice : payment = 1 : N)
CREATE TABLE invoice_payments (
  id BIGINT PK AUTO_INCREMENT,
  invoice_id BIGINT NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  method ENUM('portone','bank_transfer','cash','other'),
  paid_at DATETIME NOT NULL,
  pg_provider VARCHAR(20),        -- 'portone'
  pg_channel VARCHAR(50),         -- 'toss' | 'stripe' | 'kakao' 등
  pg_transaction_id VARCHAR(200),
  pg_raw_response JSON,
  fee_amount DECIMAL(14,2) DEFAULT 0,
  net_amount DECIMAL(14,2),
  currency VARCHAR(3),
  memo VARCHAR(500),
  refunded_amount DECIMAL(14,2) DEFAULT 0,
  refunded_at DATETIME,
  recorded_by INT,
  created_at DATETIME,
  INDEX(invoice_id), INDEX(pg_transaction_id)
);

-- 이벤트 타임라인
CREATE TABLE bill_events (
  id BIGINT PK AUTO_INCREMENT,
  entity_type ENUM('quote','invoice') NOT NULL,
  entity_id BIGINT NOT NULL,
  event_type ENUM('created','sent','viewed','accepted','rejected','converted',
                   'paid_partial','paid_full','overdue','canceled','refunded',
                   'tax_issued','tax_failed','commented'),
  actor_user_id INT,
  detail JSON,
  created_at DATETIME,
  INDEX(entity_type, entity_id)
);
```

## 7. API 엔드포인트 (요약)

```
Quotes:
  GET    /api/quotes?business_id=&status=&project_id=&client_id=
  POST   /api/quotes
  GET    /api/quotes/:id
  PUT    /api/quotes/:id
  DELETE /api/quotes/:id
  POST   /api/quotes/:id/send
  POST   /api/quotes/:id/accept              (공개 — share_token)
  POST   /api/quotes/:id/convert-to-invoice

Invoices:
  GET    /api/invoices?business_id=&status=&project_id=&client_id=
  POST   /api/invoices
  GET    /api/invoices/:id
  PUT    /api/invoices/:id
  POST   /api/invoices/:id/send
  POST   /api/invoices/:id/payments          (수동 수금 기록)
  POST   /api/invoices/:id/issue-tax         (세금계산서 수동 트리거)

Public (share_token 기반, 인증 없음):
  GET    /api/public/quotes/:token
  POST   /api/public/quotes/:token/accept
  GET    /api/public/invoices/:token
  GET    /api/public/invoices/:token/pay     (포트원 결제 준비)

Webhooks:
  POST   /api/bill/webhook/portone           (결제·빌링키·환불)
  POST   /api/bill/webhook/popbill           (세금계산서 발행 상태)

Settings:
  PUT    /api/bill/settings/:businessId      (포트원·팝빌 키·발행자 정보)
```

## 8. 결제 플로우 (순서도)

```
[고객이 공개 링크 열람]
  ↓
[포트원 V2 SDK 로드, country 기반 채널 자동 선택]
  ↓ 국내 → 토스 채널 / 해외 → Stripe 채널
[결제창 → 고객 승인]
  ↓
[포트원 서버 → /api/bill/webhook/portone]
  ↓
[서버: 포트원 결제 검증 API 호출 → 금액·통화 일치 확인]
  ↓
[invoice_payments 생성 + invoices.paid_amount 누적 + 상태 전환]
  ↓
[국내 사업자 + tax_invoice_status='none' → 팝빌 발행 큐]
  ↓
[팝빌 API → tax_invoice_status='pending' → webhook → 'issued']
  ↓
[bill_events 기록 + 고객·오너 알림]
```

## 9. PlanQ 자체 구독 청구 (플랫폼 층위)

별도 시스템 — `docs/FEATURE_SPECIFICATION.md` 의 "플랜/구독" 섹션과 연계.

- 워크스페이스 가입 → 플랜 선택 → 포트원 빌링키 발급 → DB 저장
- cron 매월 1일: 모든 구독 워크스페이스에 대해 빌링키로 자동 결제
- 성공: 플랜 갱신 + 플랫폼(PlanQ) 발행 세금계산서 자동 전송
- 실패: 3회 재시도 → 최종 다운그레이드 (`plan.js` 엔진)

## 10. UI 참고
- 견적서·청구서 PDF 템플릿: A4, 좌상 워크스페이스 로고 + 우상 문서번호, 고객 정보 블록, 품목 테이블, 합계, 서명
- 설정 페이지: PG·팝빌 키 마스킹 입력 (`****-****-last4`)
- 공개 링크 페이지: 인증 없이 결제까지. 반응형 필수 (모바일 결제 빈번)

## 11. 테스트 전략
- **포트원 테스트 키** + 테스트 카드로 전체 플로우 재현
- **Stripe test mode** 해외 결제
- **팝빌 테스트 계정** 세금계산서 시뮬레이션
- Unit: 금액 계산·부가세·환율
- E2E: 견적→청구→결제→세금계산서 전 경로 자동화 테스트
