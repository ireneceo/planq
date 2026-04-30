# `/insights` (통계·분석) 페이지 설계서

> 작성: 2026-04-30 · 대상: PlanQ B2B SaaS · 임원급(30년차 PM + 글로벌 컨설턴트 + UI/UX) 통합 설계
> 정합 문서: `docs/FINANCIAL_REPORTS_SPEC.md` (이미 정의된 골격을 충실히 흡수 + 운영가능 수준으로 구체화), `docs/Q_BILL_SIGNATURE_DESIGN.md` (Q Bill 9주 계획)
> 기존 `routes/insights.js` 는 Cue 능동 카드 (인박스 알림) 용도라 **`/api/insights/*` 가 아닌 `/api/stats/*` 네임스페이스를 신설** — 충돌 회피 + 의미 분리

---

## 1. 메뉴 구조 (좌측 nav 신규 항목)

좌측 nav 최하단에 "Insights" (i18n: 통계 · Insights) 추가. URL: `/insights`. 기본 진입 시 `Overview` 탭. owner 만 노출 (member 는 `/insights/me` 본인 탭만 접근).

| 탭 | 한 줄 설명 | 핵심 KPI 3개 (페이지 진입 즉시 헤드라인) |
|---|---|---|
| **Overview** (개요) | 한 화면에서 사업 전체 맥박 — "지금 무엇이 잘되고/막히고 있는가" | 월 매출 (전월 Δ%) / **가동률** Util / **공수 정확도** Accuracy |
| **Revenue** (매출·청구) | Q Bill 데이터 기반 매출·미수·세금 분석 | MTD 청구 / 미수금 (overdue) / 평균 결제 리드타임 |
| **Tasks & Time** (업무·시간) | 업무 처리량 + **예측 vs AI vs 실제** 깊이 분석 ★ | 완료 업무수 / 평균 리드타임 p50 / **Estimation Bias** (편차 평균) |
| **People** (직원·생산성) | 직원별 절대값+상대값 순위, 가동률·Effective Rate · 실현율 | 인당 매출 (상위 1인) / 가동률 분포 / 추정 정확도 1위 |
| **Clients** (고객·포트폴리오) | 고객별 매출·마진 2×2, 이탈 위험, LTV | TOP 3 고객 매출 비중 / 신규 고객 / **At-Risk 고객수** |
| **Projects** (프로젝트 수익성) | 프로젝트 손익(매출−노동비−직접비−고정비할당), 견적 정확도 | 활성 프로젝트 / 마진 음수 N건 / Profit per Hour 평균 |
| **Reports** (보고서) | 시점 고정 PDF — 월간/분기/연간 자동 생성 (FINANCIAL_REPORTS_SPEC §5 흡수) | 최근 보고서 / 다음 자동 생성일 / 외부 공유 링크 수 |

7개. 30년차 컨설턴트 관점 — 더 늘리면 의사결정자가 헤맴. Reports 는 "탐색 ≠ 문서" 분리 원칙.

---

## 2. 각 탭의 화면 구조 (와이어프레임 텍스트)

공통 상단: `PageShell` + 우측 actions = `[기간 셀렉터 ▾ 30일]` `[비교 모드: 전기 대비 ⚙]` `[CSV 내보내기]`. PageShell 아래에 **TabBar** (segmented control, Coral 언더라인).

### 2.1 Overview 탭

```
┌─ 인사이트 박스 (가로 3카드, Teal 좌측 stripe) ─────────────────────┐
│ [↗ 매출 +18%]   [⚠ 지연 누적 12건]   [👤 박개발 가동률 102%]      │
│  전월 4,200만원   p90 8.4일 (목표 5)   초과근무 위험             │
│  → "Bill 미발행분 처리"  → "지연 재할당"  → "업무 1건 이전"      │
└────────────────────────────────────────────────────────────────┘

[KPI 그리드 — 6 카드, 각 카드: 큰 숫자 / 전기 대비 % / 스파크라인]
  매출 / 영업이익 / 가동률 / 실현율 / 활성 프로젝트 / 신규 고객

[메인 차트 영역 — 좌(2/3) Stacked Bar : 12개월 매출/이익 트렌드]
[                  우(1/3) Donut : 매출 source 분포 (Q Bill / 외부)]

[하단 — 2-col 작은 차트]
  좌: 가동률·실현율 라인 (목표선 점선 overlay, 75% line)
  우: 주간 번다운 — 이번 주 예측 vs 실제 (오늘 기준)
```

### 2.2 Revenue 탭 (Q Bill 매출)

```
[인사이트 박스 3건]
  · "이번 달 청구 +28% (vs 전월) — 페이스 정상"
  · "연체 7건 / 합계 1,820만원 — 평균 12일 경과" (urgent)
  · "결제 리드타임 8.2일 → 5.1일 단축 (계약 기간 14일 대비)"

[KPI 6카드]
  발행 청구액 / 수금액 / 미수금 / 연체 / 평균 결제일 / 세금계산서 발행수

[메인 차트]
  좌(2/3): 월별 매출 — 발행 vs 수금 vs 연체 (3색 stacked bar, 12개월)
  우(1/3): 결제 상태 깔때기 (draft → sent → viewed → paid → overdue)

[하단 테이블 — 정렬·필터]
  Top 10 미수 청구서: invoice_no / client / 발행일 / 만기 / 금액 / D+경과 / [독촉 액션]
```

### 2.3 Tasks & Time 탭 ★ Irene 강조 포인트 = 최대 디테일

```
[인사이트 박스 3건]
  · "공수 정확도 평균 71% — 박개발 92%, 김기획 48% (편차 큼)"
  · "AI 추정값 신뢰도 ↑ — 6개월간 MAPE 18%→9% (학습 효과)"
  · "qtalk_extract 출처 task 의 평균 리드타임 +2.3일 (수동 대비 길음)"

[KPI 6카드 — 모두 전기 대비 Δ]
  완료 업무 / 생성 업무 / 평균 리드타임 p50 / 평균 리드타임 p90
  / **Estimation Bias** (Σ(actual−user_estimate)/Σactual ×100, +면 과소추정)
  / **AI Accuracy** (1−MAPE)

[메인 차트 — 1번: 핵심 비교 차트]
  Scatter Plot — X축 user_estimate(시), Y축 actual_hours(시),
                 점 색상 = 담당자, 점 크기 = task 수
                 대각선 y=x (정확선) + ±25% 밴드
   → 한눈에 "누가 과대/과소 추정하는지" 보임
   → 이상치(>2배 이탈) hover 시 task 제목 표시 + 클릭 시 task drawer 오픈

[메인 차트 — 2번: AI 학습 추이]
  Line — 월별 AI MAPE (Mean Abs % Error) + User MAPE 동시 표시
        + 최근 30일 이동평균 굵게
   → "AI 가 사람보다 정확해진 시점" 시각화

[중간 — 3-col 작은 차트]
  ① 상태 깔때기 (not_started → in_progress → reviewing → completed) %
  ② 출처별 분포 (qtalk_extract / internal_request / manual) — 도넛
  ③ 카테고리 파레토 (Top 10 카테고리, 누적 80% 선)

[하단 테이블 — 정렬·필터·드릴다운]
  컬럼: 업무 / 담당 / 카테고리 / user_estimate / ai_estimate / actual
       / 정확도% / Bias / 리드타임 / 상태
  필터: 기간, 담당자, 카테고리, 출처, 정확도 범위 (예: <50%)
  Row 클릭 → TaskDetailDrawer 오픈 (기존 컴포넌트 재사용)
```

### 2.4 People 탭

```
[인사이트 박스 3건]
  · "이번 달 1위: 박개발 (인당 매출 920만, +14%)"
  · "주의: 이디자 가동률 132% — 2주 연속 초과근무" (urgent)
  · "정확도 1위: 김기획 88% (Bias −2%, 일관됨)"

[KPI Strip — 팀 평균 + 본인 강조]
  팀 평균 가동률 / 본인 가동률 / 팀 평균 실현율 / 본인 실현율

[메인 차트]
  ① Bar — 직원별 가동률 (정렬 가능, 100% 선 overlay, ≥90 Coral / 60-90 Teal / <60 Gray)
  ② Heatmap — 행: 직원, 열: 주차, 셀 색강도: 실제 시간/가용 시간
              → 초과근무 지속 패턴 한눈에

[하단 메인 — 직원 순위 테이블 (상대값 + 절대값)]
  컬럼: 직원 / 가동률 / 실현율 / Effective Rate (시간당 매출)
       / 추정 정확도 / 평균 Bias / 완료 업무 / 평균 리드타임
       / 인당 매출 / 순위 변동 ↑↓ (전기 대비)
  정렬: 컬럼 헤더 클릭. 비교: "팀 평균 대비" 토글 — 셀 값을 100% 기준 상대값으로 변환
  Row 클릭 → 직원 상세 drawer (해당 직원 한정 차트 5개)
```

### 2.5 Clients 탭

```
[인사이트 박스]
  · "Top 1 고객 비중 32% — 집중 위험 (목표 <25%)"
  · "신규 고객 4건 (이번 달) / 이탈 위험 2건"
  · "최고 마진 고객: ACME (마진율 41%)"

[메인 차트]
  ① Bubble 2×2 — X: 매출 기여 / Y: 마진율 / 크기: 활성 프로젝트 수
                 4분면 라벨: 골드(우상) · 스타(좌상) · 캐시카우(우하) · 유출(좌하)
  ② 매출 집중도 — Pareto: Top N 고객 누적 매출 % (80% 선)

[하단 테이블]
  고객 / 첫 거래일 / 누적 매출 / 12M 매출 / 마진율 / 활성 프로젝트 /
  마지막 인보이스 / **이탈 위험 점수** (0-100) / 액션 [관계 강화]
```

### 2.6 Projects 탭 (FINANCIAL_REPORTS_SPEC §3.3 충실 반영)

```
[인사이트 박스]
  · "마진 음수 프로젝트 2건 — 즉시 검토"
  · "PROJ-A 견적 시간 대비 +160% 초과 (40h → 64h)"
  · "Profit per Hour 평균 78,000원 (목표 90,000)"

[메인 차트]
  ① Bubble — X: 투입시간 / Y: 매출 / 크기: 마진 / 색: 마진 음수=Coral
  ② Estimated vs Actual 시간 분포 — 프로젝트별 박스플롯

[하단 테이블 — 프로젝트 손익]
  프로젝트 / 클라이언트 / 계약가 / 매출(수금) / 노동비 / 직접비 /
  고정비 할당 / 기여이익 / 순이익 / 마진율 / Profit/Hr / 위험 신호
```

### 2.7 Reports 탭

탐색이 아니라 **시점 고정 문서** (FINANCIAL_REPORTS_SPEC §5). 카드 그리드 — 월간 자동 생성 보고서들. 각 카드: 기간 / 핵심 수치 3개 / [PDF 다운로드] [공유 링크 복사] [주석 추가]. 하단 [지금 보고서 생성] (kind 선택 모달).

---

## 3. 메트릭 정의 (집계 쿼리 수준)

| # | 지표 | 정의 | SQL 의사코드 | 의미 / 임계 |
|---|---|---|---|---|
| 1 | **월 매출 (Revenue)** | 결제 완료 청구액 합계 | `SUM(invoice_payments.amount) WHERE business_id=? AND paid_at BETWEEN ?` | MTD vs 전월 |
| 2 | **MRR** (구독) | 구독 월정액 합계 (active) | `SUM(subscriptions.monthly_fee) WHERE status='active'` | SaaS 안정성 |
| 3 | **수금 리드타임** | 발행→수금 평균 일수 | `AVG(DATEDIFF(paid_at, issued_at))` paid 만 | <14일 정상 |
| 4 | **연체율** | 연체 청구액 / 총 발행액 | `SUM(grand_total WHERE status=overdue) / SUM(grand_total WHERE issued)` | <5% |
| 5 | **가동률 (Utilization)** | 업무시간 ÷ 가용시간 | `SUM(tasks.actual_hours) / SUM(member.daily_work_hours × weekly × participation × days_in_period)` | 60-90% 정상 |
| 6 | **실현율 (Realization)** | 청구된 시간 ÷ 업무 시간 | `SUM(invoice_items WHERE source_type='task_hours') / SUM(actual_hours)` | hourly 청구만 의미 |
| 7 | **Effective Rate** | 매출 ÷ 업무시간 | `revenue / SUM(actual_hours)` | 시간당 실효 매출 |
| 8 | **공수 정확도 (Accuracy)** | `(1 − \|user_estimate − actual\| / actual) × 100`, 음수면 0 | per task `1 − ABS(user_est − actual)/actual` then `AVG` | **75% 이상 정상**, 50% 미만 견적 개선 필요 |
| 9 | **Estimation Bias** | `Σ(actual − user_estimate) / Σactual × 100` | `(SUM(actual)−SUM(user_est)) / SUM(actual) × 100` | **+10% 이상 = 과소추정 경향**, −10% 이하 = 과대추정 |
| 10 | **AI Accuracy (MAPE)** | AI 추정 vs 실제의 평균 절대 % 오차 | task 별 `ABS(ai_value − actual)/actual` 평균 | 낮을수록 좋음. 10% 이하 우수 |
| 11 | **AI vs User 우위** | `User MAPE − AI MAPE` | 둘 다 계산 후 차이 | 양수 = AI 가 더 정확 |
| 12 | **리드타임 p50/p90** | 생성 → 완료 일수 | `PERCENTILE_CONT(0.5/0.9) DATEDIFF(completed_at, created_at)` | 카테고리별 비교 |
| 13 | **인당 매출** | 매출 ÷ 활성 멤버수 (또는 시간 비중 가중) | `revenue × (member_hours / total_hours)` | 가중 분배가 공정 |
| 14 | **Profit per Hour** | 프로젝트 순이익 ÷ 총 투입시간 | `(revenue − labor_cost − direct_cost − overhead_alloc) / SUM(actual_hours)` | 회사 평균보다 낮은 프로젝트 = 적자 후보 |
| 15 | **이탈 위험 점수** | 최근 인보이스 경과일 + 활성 프로젝트수 + 미응답 메시지 | rule-based 0–100 | 70 이상 At-Risk |

---

## 4. 업무 시간 깊이 분석 ★ Irene 강조 포인트

### 4.1 3중 비교 — 어떤 비교가 의미 있는가

PlanQ 데이터 구조상 **3개의 시간 신호**가 존재:
- `user_estimate` = TaskEstimation source='user' 의 가장 최신 (= tasks.estimated_hours 와 동기)
- `ai_estimate` = TaskEstimation source='ai' 의 가장 최신 (LLM 자동 추천)
- `actual_hours` = tasks.actual_hours (담당자가 입력한 실제)

**의미 있는 비교 매트릭스:**

| 비교 | 측정 대상 | 의미 |
|---|---|---|
| user_estimate vs actual | **사람의 견적 능력** | 견적 보정기 / 영업 마진 안전성 / 직원별 경향 |
| ai_estimate vs actual | **AI 학습 정확도** | 모델 수준 측정 / 신규 사용자 콜드스타트 보조 |
| ai_estimate vs user_estimate | **사람과 AI 일치도** | 큰 격차 = 둘 중 하나 잘못. 예측 단계 알람 |
| user_estimate(이력 시계열) vs actual | **개인 학습 곡선** | 입사 후 3개월 학습 / 새 카테고리 적응 |

→ **차트로 모두 표현하지 말 것.** "Tasks & Time 탭 메인 차트 1번 = scatter"는 user vs actual 만 (의사결정에 직접 쓰임). AI 비교는 KPI 카드 + Line(추이) 만.

### 4.2 직원별 패턴 (과대/과소)

**직원 카드/테이블 컬럼 = `평균 Bias`**
- 정의: `(Σactual − Σuser_estimate) / Σactual` (모든 완료 task)
- +20% 이상 → "과소추정 경향" 라벨 (Coral) — 이 직원에게는 견적에 +25% 버퍼 자동 권고
- −20% 이하 → "과대추정 경향" 라벨 (Teal) — 견적 시 사람 수 줄이거나 빠른 마감 가능
- ±10% 이내 → "안정" (Gray)

**액션 시그널 (page 상단 인사이트 박스):**
- "이 직원에게 어떤 종류 업무를 맡길지" — `(직원 × 카테고리)` cross-tab 으로 평균 정확도 계산
- 예: "박개발 — `frontend` 카테고리 정확도 92%, `design` 정확도 41%" → frontend 위주 배정 권고

### 4.3 학습된 AI 정확도 추이

월별 AI MAPE (예: 6개월간 18% → 9%) 라인 차트. "AI 가 사람을 능가한 시점" 음영 표시. 이 신호는 임원에게 "PlanQ AI 가 점점 똑똑해짐 → 신규 직원 합류 시 콜드스타트 자동 보조 가능" 메시지로 작용.

### 4.4 직원 배정 결정 시그널 (실제 UI 컴포넌트 출력)

People 탭 → 직원 row 클릭 시 drawer 안에 "이 직원의 강점 카테고리 Top 3 / 약점 카테고리 Bottom 3" 자동 표시 + 해당 직원 평균 정확도/Bias 수치. 30년차 임원 관점에서 **"채용/배치/단가협상" 의 1차 데이터** 가 됨.

---

## 5. UI/UX 가이드

### 5.1 디자인 토큰 (UI_DESIGN_GUIDE 준수)

- **PageShell** 단일 컬럼 / 헤더 60px 잠금 / 본문 #f8fafc / 카드 #fff
- **카드 정규형** — `border: 1px solid #E2E8F0; border-radius: 12px; padding: 20px;`
- 색상: Teal `#14B8A6` = 긍정/목표 / Coral `#F43F5E` = 경고·urgent / Gray `#64748B` = 보조 / 차트 카테고리 컬러는 `theme/chartPalette.ts` 신규 (10색 팔레트, color-blind safe)
- **이모지 절대 금지** — 인사이트 박스 좌측 strip 색으로 severity 표현 (Teal/Coral/Amber)
- 차트: `recharts` (이미 설치) — LineChart, BarChart, ScatterChart, PieChart, Treemap

### 5.2 인터랙션

- **기간 셀렉터 (PageShell actions 우측)**: `Last 7d / 30d / 90d / This Month / Last Month / This Quarter / Custom`. 기본 30일. URL 싱크 (`?range=30d` or `?from=...&to=...`)
- **비교 모드 토글**: 전기 대비 ON 시 KPI 카드에 ▲▼ % 노출 + 차트에 점선 ghost 시리즈
- **직원 필터 / 프로젝트 필터 / 카테고리 필터** — 다중 선택 칩. `PlanQSelect` (multi mode) 강제
- **드릴다운**: 차트 점/막대 클릭 → 하단 테이블 자동 필터 적용 + 스크롤
- **테이블 행 클릭** → 기존 `TaskDetailDrawer` / `ClientDrawer` / `ProjectDrawer` 재사용 (URL 싱크 `?task=`, `?client=`)

### 5.3 빈 상태 / 로딩 / 에러

- **빈 상태 (콜드스타트)**: 데이터 부족 시 "데이터 30일 이상 누적되면 인사이트가 더 정확해져요" + 진행 게이지 (`현재 N건 / 30건`).
- **로딩**: skeleton (카드 6개, 차트 영역 1개 — 회색 박스 shimmer). 절대 spinner 단독 X
- **에러**: 인사이트 박스 자리에 빨간 배너 "통계 집계 중 오류 — 잠시 후 다시 시도" + 재시도 버튼

### 5.4 모바일 반응형 정책

- ≥1025px: 표준 desktop 레이아웃
- 641-1024px: KPI 카드 그리드 6→2col, 메인 차트 가로 스크롤, 테이블 sticky header
- ≤640px: KPI 1col stack, 차트는 "차트 보기" 버튼 (펼침), 테이블은 카드 리스트
- 데스크톱 우선 — 통계는 의사결정용

### 5.5 자동저장 / 알림

- 통계 페이지 자체는 입력 폼 없음 → AutoSaveField 무관
- 차트 view 설정 (선호 기간/필터) 은 localStorage 기억 (`insights:lastRange`, `insights:lastFilters`)

---

## 6. 우선순위 + 단계 (MVP → Phase 후속)

### MVP — 1.5주 (현재 데이터로 즉시 가능한 탭)

| 우선 | 탭 | 이유 | 의존성 |
|---|---|---|---|
| 1 | **Tasks & Time** | Irene 강조 포인트 + 데이터 100% 존재 | 없음 |
| 2 | **People** | Tasks 데이터로 즉시 산출. 직원 평가/배치 의사결정 즉시 가치 | 없음 |
| 3 | **Overview** (라이트) | KPI 6개만, 위 두 탭의 핵심을 요약 | 1·2 |

### Phase 2 — 1개월 (Q Bill 데이터 정리 후)

| 4 | **Revenue** | 청구·수금 분석 | invoice_payments 누적 |
| 5 | **Clients** | client × invoice 조인 | Revenue 탭 |
| 6 | **Reports** (월간 자동 생성) | cron + PDF + 공유링크 | Overview/Tasks 안정 |

### Phase 3 — 2개월 후 (Q Bill 9주 완료 후)

| 7 | **Projects (수익성)** | overhead_items / project_expenses 신규 + hourly_rate 설정 UI | DB 확장 |
| 8 | **자동 해석 (룰 + LLM)** | 인사이트 박스 풍부화 | Projects |
| 9 | **고객 LTV / 이탈 예측** | 6개월+ 데이터 누적 후 의미 | 6+ 개월 |

---

## 7. 30년차 임원의 통찰

### 7.1 사업자 의사결정 기여

**HubSpot/Linear/Stripe 대시보드는 "현황 보고"** 다. PlanQ Insights 는 **"3층 답변 (관찰→진단→처방)"**:
- 관찰 "가동률 45%" → 진단 "박개발 85%, 이디자 30% 편중" → 처방 **"이디자에 후순위 업무 2건 이전 [실행]"**
- 의사결정자가 페이지를 "본 후 무엇을 할지" 명확
- 차별점: 대부분의 분석 도구는 BI 따로, 실행 따로. PlanQ 는 **분석 = 실행 = 동일 페이지**

### 7.2 글로벌 SaaS 와의 차별점

| 항목 | HubSpot/Linear/Stripe | PlanQ Insights |
|---|---|---|
| 깊이 | 매출·CRM·결제 단일 도메인 | 매출 + 업무시간 + 직원 + 고객 + AI 추정 통합 |
| AI | "Ask AI" 챗봇 | **AI 가 사용자보다 정확해진 시점** 명시적 시각화 |
| 실행 | 분석 페이지에서 분석만 | 인사이트 카드 → 1클릭 액션 |
| 콜드스타트 | "아직 데이터 없음" | 진행 게이지 + 학습 메시지 |
| 한국 사업자 | (영어권 우선) | 세금계산서·팝빌·KRW 1차 시민 |

### 7.3 콜드스타트 — 신규 사용자 (데이터 0~30일)

- **0~7일**: 인사이트 박스 자리에 "PlanQ 사용 가이드" 카드 (업무 5건 등록 / 청구서 1건 발행 / 직원 1명 초대)
- **8~30일**: 부분 활성화. KPI 카드는 표시하되 "표본 부족" 회색 라벨
- **AI 추정만 사용** — TaskEstimation source='ai' 가 1개라도 있으면 그 값으로 콜드스타트
- **기준값 (Benchmark)**: 같은 업종 평균 — Phase 3+ 에서 추가

### 7.4 한국 / 외국 사업자 차이

| 항목 | 한국 | 외국 |
|---|---|---|
| 통화 | KRW (천원·만원·억) 압축 표기 | USD/EUR/JPY/CNY — `Intl.NumberFormat` 표준 |
| 세금계산서 | Revenue 탭에 발행수·미발행 KPI | 비활성 (자동 숨김) |
| 회계 사이클 | 부가세 분기 신고 (1·4·7·10월) | 회계연도 |
| 가동시간 임계 | 90% 이상 야근 경보 | 80% 이상 경보 (EU) |
| 청구 결제 리드타임 | 한국 14-30일 | EU 30-60일, US 15-30일 |

→ `Insights.thresholds = getThresholdsByCountry(business.country)` — 워크스페이스 country 기반 임계 자동 조정.

---

## 8. API 설계

```
GET /api/stats/:businessId/overview?from=&to=&compare=prev
GET /api/stats/:businessId/revenue?from=&to=
GET /api/stats/:businessId/tasks?from=&to=&assignee_id=&category=&source=
GET /api/stats/:businessId/people?from=&to=
GET /api/stats/:businessId/clients?from=&to=
GET /api/stats/:businessId/projects?from=&to=
GET /api/stats/:businessId/insights-cards?tab=tasks&from=&to=

POST /api/reports/:businessId/generate (kind=monthly, period=2026-04)
```

권한: `authenticateToken + checkBusinessAccess + role in (owner, platform_admin)`. member 는 `/api/stats/:businessId/me` (본인 한정 가동률·정확도) 만 허용.

응답 형식: `{ success, data: { kpis: [...], charts: { ... }, insights: [...], filters_applied: {...} } }` (CLAUDE.md 표준).

---

## Critical Files (구현 시작점)

- `/opt/planq/dev-backend/routes/insights.js` (현 Cue 카드 — 별도 파일 유지)
- `/opt/planq/dev-backend/services/insights.js` (Cue 카드 로직)
- `/opt/planq/dev-backend/routes/stats.js` (신규 — Insights 분석 페이지용)
- `/opt/planq/dev-backend/services/stats.js` (신규 — 룰 엔진)
- `/opt/planq/dev-backend/models/TaskEstimation.js` (AI vs User 정확도 핵심)
- `/opt/planq/dev-backend/models/TaskUserHours.js` (가동률 정확도)
- `/opt/planq/docs/FINANCIAL_REPORTS_SPEC.md` (이미 정의된 골격)
- `/opt/planq/dev-frontend/UI_DESIGN_GUIDE.md` (PageShell / 카드 / 색상 / 자동저장 / 반응형 표준)
