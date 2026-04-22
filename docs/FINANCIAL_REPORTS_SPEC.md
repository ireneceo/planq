# 통계·분석·보고서 — 통합 설계

> 관련 문서: [Q_BILL_SPEC.md](./Q_BILL_SPEC.md) · [FEATURE_SPECIFICATION.md](./FEATURE_SPECIFICATION.md) · [DATABASE_ERD.md](./DATABASE_ERD.md)
>
> 작성: 2026-04-22 · 상태: 설계 확정 (구현 대기)

## 1. 철학

경영진이 던지는 3가지 질문에 답하는 모듈:
1. **"바쁜데 돈은 왜 안 남지?"** → 프로젝트 수익성·가동률·실현율
2. **"누가 기여하지?"** → 인당 생산성·역할별 ROI
3. **"어디서 새지?"** → 비용 구조·병목·고객 포트폴리오

리포트의 3층 구조 제공: **관찰(수치) → 진단(원인) → 처방(액션)**.

## 2. 네비게이션

```
[📊 통계·분석]
  📈 개요
  ⏱️ 업무·시간
  💼 프로젝트 수익성
  👥 팀 생산성
  🧾 비용·재무
  📄 보고서         ← 월간/분기/연간 자동 생성
```

## 3. 대시보드 상세

### 3.1 📈 개요

**상단 KPI 카드 (전월 대비 % 변화)**
- 월 매출 / 월 영업이익 / 영업이익률
- 총 가동시간 / **가동률(Utilization)** = 업무시간 ÷ 가용시간
- **실현율(Realization)** = 청구 시간 ÷ 업무 시간
- 활성 프로젝트 수 / 신규 고객 / 이탈 고객

**차트**
- 월별 매출·이익 트렌드 12개월 (스택)
- 월별 가동률·실현율 라인 (목표선 overlay)
- 주간 번다운 확장 (이번 주 예측 vs 실제)

### 3.2 ⏱️ 업무·시간

- 업무 처리량 (생성·완료·취소·지연, 주·월·분기)
- 상태별 snapshot
- 리드타임 (생성→완료 p50/p90)
- 담당자별 할당·완료·평균 처리일·연체율
- 카테고리·프로젝트·고객별 업무 분포 (파레토)
- 업무 타입 (internal_request / qtalk_extract / manual) 비율
- 지연 업무 TOP N

### 3.3 💼 프로젝트 수익성

**한 프로젝트의 손익 공식**
```
매출 = Σ invoice_payments.amount (해당 프로젝트)
노동비 = Σ (task.actual_hours × member.hourly_rate)
직접비 = Σ project_expenses.amount
고정비 할당 = 월 고정비 × (프로젝트 투입시간 ÷ 조직 전체 가용시간)
기여이익 = 매출 − (노동비 + 직접비)
순이익 = 기여이익 − 고정비 할당
마진율 = 순이익 ÷ 매출
```

**시각화**
- 프로젝트 수익성 테이블 (매출·원가·마진·마진율)
- Bubble Chart (X: 시간 투입 / Y: 매출 / 크기: 마진)
- Estimated vs Actual 시간 오차율 (견적 개선 지표)
- 위험 프로젝트 경보 (마진 음수, 가용시간 대비 80% 초과)

### 3.4 👥 팀 생산성

- 인당 월 매출
- 가동률 (daily_work_hours / weekly_work_days / participation_rate 기반)
- 실현율 (청구 시간 ÷ 업무 시간)
- **Effective Rate** = 인당 매출 ÷ 업무시간 = 시간당 실효 매출
- 역할별 ROI (기획/디자인/개발)
- 주간×멤버 Heat Map (초과근무 감지)
- Retention (가입→퇴사 LTV)

### 3.5 🧾 비용·재무

**고정비 관리**
```sql
CREATE TABLE overhead_items (
  id INT PK AUTO_INCREMENT,
  business_id INT NOT NULL,
  category ENUM('payroll','rent','saas','legal','benefits','marketing','other'),
  name VARCHAR(200),
  amount DECIMAL(12,2),
  cycle ENUM('monthly','quarterly','yearly') DEFAULT 'monthly',
  starts_at DATE, ends_at DATE,
  created_at DATETIME, updated_at DATETIME,
  INDEX(business_id)
);

CREATE TABLE project_expenses (
  id INT PK AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  category VARCHAR(50),
  description VARCHAR(300),
  amount DECIMAL(12,2),
  incurred_at DATE,
  created_by INT,
  created_at DATETIME, updated_at DATETIME,
  INDEX(project_id)
);
```

**UI**
- 간이 P&L (월별 매출 / 원가 / 공헌이익 / 고정비 / 영업이익)
- 고정비 항목 관리 (카테고리·주기·금액)
- Break-even = 고정비 ÷ 공헌이익률
- Burn rate + runway

## 4. 자동 해석 (하이브리드)

### 4.1 3층 구조
```
관찰: 가동률 45%
진단: 박개발 85%, 이디자 30% — 팀원간 편중
처방: 이디자에 후순위 업무 2건 이전 + 저단가 프로젝트 배치
```

### 4.2 구현 방식
**룰 기반 (1차 필터)** — 임계값·조건 YAML 정의
```yaml
utilization_low:
  condition: org_utilization < 0.60
  severity: warning
  template: "가동률 {{pct}}% — 목표 대비 {{gap}}%p 미달"

project_margin_negative:
  condition: project.margin_rate < 0
  severity: critical
  template: "{{project_name}} 마진율 {{rate}}% — 계약가 대비 원가 초과"
```

**LLM 기반 (2차 서술)** — Cue 엔진 재사용. 룰이 포착한 수치+컨텍스트를 프롬프트로 넘겨 자연어 권고 생성.

### 4.3 차별 지표 (30년차 컨설턴트 관점)
- **Profit per Hour** = 프로젝트 순이익 ÷ 총 투입시간
- **고객 포트폴리오 2×2** (매출 기여 × 마진율) — 골드·스타·캐시카우·유출
- **견적 보정기** — 과거 Estimated vs Actual 통계로 자동 버퍼 권고
- **직무×프로젝트 단가 상관** — "개발이 시간당 12만원, 디자인 8만원 — 개발 비중 ↑"
- **지연 원인 자동 클러스터** — 연체 업무 공통 요소 추출
- **Runway 알림** — 현금 + 예측 입금 ÷ burn < 3개월 시 경고

## 5. 📄 보고서 서비스

### 5.1 차별점
- **리포트 = 실시간 탐색 (차트·드릴다운)**
- **보고서 = 시점 고정 문서 (월간·분기·연간 배포용)**

### 5.2 자동 생성
- cron 매월 1일: 전월 경영보고서 자동 생성
- 포맷: Executive Summary + 핵심 차트 스냅샷 + 진단·처방 + 액션 아이템
- 템플릿: `투자자용` / `이사회용` / `내부팀용` / `월간 점검`
- 주석 추가 기능 (경영진 내러티브)
- 이력 누적 (전년·전월 대비 자동)

### 5.3 데이터 모델
```sql
CREATE TABLE reports (
  id INT PK AUTO_INCREMENT,
  business_id INT NOT NULL,
  kind ENUM('monthly','quarterly','yearly','adhoc'),
  period_start DATE, period_end DATE,
  title VARCHAR(200),
  summary TEXT,
  data JSON,              -- 스냅샷 수치
  insights JSON,          -- 룰·LLM 산출물
  generated_at DATETIME,
  generated_by INT NULL,  -- cron 이면 NULL
  pdf_url VARCHAR(500),
  share_token VARCHAR(64),-- 외부 공유용
  notes TEXT,             -- 오너 주석
  INDEX(business_id, period_start)
);
```

### 5.4 출력
- PDF 다운로드
- 공유 링크 (인증 불필요, share_token)
- 이메일 자동 발송 (오너·설정된 수신자)
- 이전 월과 비교 섹션 (자동 생성)

## 6. 데이터 소스 매트릭스

| 지표 | 소스 | 비고 |
|---|---|---|
| 매출 | `invoices.total_amount` (status='paid') | Q Bill |
| 노동비 | `tasks.actual_hours × business_members.hourly_rate` | Q Bill DB 확장 후 |
| 고정비 | `overhead_items` | 신규 |
| 직접비 | `project_expenses` | 신규 |
| 가동시간 | `tasks.actual_hours` | 기존 |
| 가용시간 | `business_members.daily_work_hours × weekly_work_days × participation_rate` | 기존 |
| 청구시간 | Invoice items where source_type='task_hours' | Q Bill 연동 |
| 프로젝트 매출 | Invoice.paid WHERE project_id | Q Bill |
| 고객 기여도 | GROUP BY project.client | 계산 |

## 7. API 엔드포인트 (요약)

```
Reports/Stats:
  GET  /api/stats/:businessId/overview?period=month
  GET  /api/stats/:businessId/tasks?period=&assignee=&project=
  GET  /api/stats/:businessId/profitability?period=
  GET  /api/stats/:businessId/team?period=
  GET  /api/stats/:businessId/finance?period=

Reports (시점 문서):
  GET  /api/reports/:businessId?kind=monthly
  POST /api/reports/:businessId/generate (kind=monthly&period=2026-04)
  GET  /api/reports/:businessId/:id
  GET  /api/reports/:businessId/:id/pdf
  GET  /api/public/reports/:share_token (공개 링크)

Overhead/Expenses:
  GET/POST/PUT/DELETE /api/overhead-items/:businessId
  GET/POST/PUT/DELETE /api/project-expenses/:projectId
```

## 8. 권한

- 모든 통계·보고서: **owner 또는 platform_admin** 만 (민감한 재무 정보)
- 일반 member 는 본인 가동률·본인 업무 통계만 조회 가능
- 고객(client) 은 본인이 속한 프로젝트 원가·수익성 조회 **불가**

## 9. UI 참고
- 모든 대시보드 필터: 기간(주/월/분기/연), 프로젝트, 고객, 담당자, 카테고리
- 드릴다운: 집계 → 클릭 → 개별 업무·인보이스까지
- 내보내기: CSV, Excel (xlsx), PDF
- 차트 라이브러리: recharts 또는 chart.js (현재 PlanQ 에 이미 있는 것 재사용)
