# 내부 프로젝트 vs 고객 프로젝트 — 통계 반영 분석 & 설계안

> 작성: 2026-07-06 (Opus 분석 게이트). Irene 요청 — "우리 내부에서 시간 쓰는 일 vs 고객 대응 프로젝트를 구분해서 **프로젝트 수익성** 같은 통계에서 나눠 표시해야 하는 것 아닌가. 이 구분이 필요한 영역·수치가 빠진 곳 없는지."

---

## 0. 한 줄 결론

**신호는 데이터 모델에 부분적으로 존재하나(`Project.billing_type='internal'`, `Client.kind`), 통계·수익성·시간·EVM 집계 어디에서도 이 구분을 필터/그룹으로 쓰지 않는다.** 그 결과 **내부 프로젝트(매출 0, 노동비 > 0)가 수익성 통계를 체계적으로 왜곡**한다 — "마진 음수 프로젝트" 긴급 알림, 총이익·시간당이익 하향, 인당 매출배분 희석 등.

---

## 1. 현재 프로젝트 분류 신호 (판별 가능한 것)

| 신호 | 위치 | 성격 | 통계 연결 |
|------|------|------|-----------|
| `Project.billing_type='internal'` | `models/Project.js:33-37` ENUM(`fixed/hourly/subscription/milestone/internal`) | 내부=비청구. **프로젝트 레벨 내부/고객 근접 신호** | ❌ 미연결 |
| `Project.client_company` | `models/Project.js:9` STRING free text | 고객사명(27개 중 14개만 채움) | 표시만 |
| `project_clients` 연결 | `models/ProjectClient.js` | 고객 연결 유무 | ❌ |
| `Client.kind` | `models/Client.js:117` ENUM(`customer/vendor/freelancer/other`) | client(사람/회사) 유형 — 프로젝트 내부/고객 아님 | ❌ 미연결 |
| `Project.project_type` | `models/Project.js:26` ENUM(`fixed/ongoing`) | **청구구조**(고정/구독)이지 내부/고객 아님 | — |

**함정:**
- `billing_type='internal'`을 **설정하는 UI가 없다.** 프론트 `billing_type` 사용처는 `TransactionsTab.tsx:68,148` 두 곳뿐이고 148행은 정기청구 켤 때 `subscription` 강제만. "내부 프로젝트" 토글 부재.
- 세 신호(billing_type / client_company / project_clients)가 서로 독립적이고 정규화·통합돼 있지 않음.
- 유일한 내부/고객 시각 구분은 통계와 무관한 휴리스틱 배지: `pages/QTalk/RightPanel.tsx:533-542` (`client_company` 문자열이 비었거나 "내부"로 끝나면 `내부 프로젝트` 배지). 통계로 넘어가지 않음.

---

## 2. 통계·수익성 집계 실태 (전부 `services/stats.js`)

라우트 `routes/stats.js`가 그대로 노출: `/overview`·`/profit`·`/team`·`/finance`·`/reports`. `routes/insights.js`는 Cue 카드용 33줄로 재무 무관.

### 반영 안 된 구체적 지점

| # | 위치 | 문제 |
|---|------|------|
| 1 | `/profit` `stats.js:470-473` | `where:{business_id}`만 — **전 프로젝트 합산**, 내부/고객 필터 없음 |
| 2 | `stats.js:523,545,554` | 내부 프로젝트: `laborCost=hours×50000 > 0`, `revenue=0` → `profit<0` → **"마진 음수 프로젝트" 카운트 + `urgent '즉시 검토 필요'` 알림** |
| 3 | `stats.js:547-549,582-585` | 내부 노동비·시간이 `total_profit`·`avg_profit_per_hour`·`total_hours` 하향 왜곡 |
| 4 | `/overview` `stats.js:379-381` | `new_clients` = `Client.count` **`kind` 필터 없음** → vendor/freelancer/other도 "신규 고객"에 포함 |
| 5 | `/overview` `stats.js:376` | `active_projects`에 내부 프로젝트 포함 |
| 6 | `/team` `stats.js:641,667,670` | `revenue_share`·`effective_rate` — 내부업무 시간이 분모(totalActualHours)에 들어가 **인당 매출 희석·오배분**(내부업무만 한 멤버도 매출 배분받음) |
| 7 | `/finance` `stats.js:830-839` | 내부 프로젝트 직접비(ProjectExpense) 총원가 포함, 대응 매출 0 → `margin` 하향 |
| 8 | 가동률 `stats.js:399-408` | 내부/고객 시간 미분리 합산 |
| 9 | 프론트 `pages/Insights/tabs/ProfitTab.tsx:115,135` | "고객" 컬럼(client_company)만, **내부/고객 필터·구분 배지 없음** |
| 10 | EVM `pages/QTask/QTaskPage.tsx:1339-1356` | SPI/CPI 프론트 프로젝트별 계산, **내부/고객 롤업/구분 개념 없음**(백엔드 EVM 자체가 0건) |

### "없음"으로 확정
- 프로젝트 레벨 내부/고객 **전용** 구분 필드(`project.kind`류): 없음 (billing_type='internal'이 유일 근접, UI·통계 미연결)
- 통계 엔드포인트의 내부/고객 필터·그룹·파라미터: 없음
- 백엔드 EVM/SPI/CPI 구현: 없음 (프론트 QTaskPage에만)
- 내부/고객 구분을 규정한 설계문서: 없음 (`Q_ORG_DESIGN.md`의 `client.kind`는 client 유형이지 프로젝트 아님)

---

## 3. 설계안 (권장)

### 원칙
- **고객 프로젝트** = 매출을 발생시키는 일 → 완전 P&L (매출·원가·마진).
- **내부 프로젝트** = 우리 자체 투자(제품개발·마케팅·운영·R&D) → **시간·원가만 추적, 매출/마진 계산에서 제외**. "내부 투자 시간"으로 별도 세그먼트 표시.
- 핵심: 내부 프로젝트를 매출/마진 통계에 섞지 않는다. 대신 **"내부 투자"라는 독립 뷰**로 시간·비용을 보여준다(어디에 우리 시간을 쓰는가).

### Layer 1 — 데이터 모델 (Fable 게이트: 운영 마이그레이션)
- `Project.kind ENUM('client','internal') NOT NULL DEFAULT 'client'` 신규 컬럼. (billing_type='internal' 재사용보다 **명시 필드 분리** 권장 — 내부 프로젝트도 billing_type 개념이 필요할 수 있고, 의미 혼선 제거.)
- 백필 규칙(멱등): `kind='internal'` ← `billing_type='internal'` OR (project_clients 0건 AND client_company 비어있음). 애매한 것은 `client` 유지 후 UI로 사용자 확정.

### Layer 2 — UI 설정 & 노출
- 프로젝트 생성/편집: **"내부 프로젝트" 토글** (고객 대응 아님 = 자체 투자). 켜면 청구/거래 시퀀스·수익성에서 자동 제외.
- Insights **Profit/Overview/Team/Finance 탭 상단에 세그먼트 토글**: `전체 | 고객 | 내부`. 기본 `고객`(수익성은 고객만 의미 있음).
- 별도 **"내부 투자" 카드/탭**: 내부 프로젝트별 투입 시간·원가, 팀별 내부 vs 고객 시간 비율.

### Layer 3 — 집계 로직 (`services/stats.js`)
- `/profit`·`/finance`·`/team` 수익성 계산: 기본 `kind='client'`만. 내부는 별도 집계 반환(`internal_investment: {hours, cost, by_project}`).
- `negative_margin` 카운트·urgent 알림: `kind='client'`만 대상 → 내부 프로젝트 오탐 제거.
- `/overview` `new_clients`: `Client.kind='customer'`만.
- 팀 `revenue_share`: 분모에서 내부업무 시간 제외(고객 매출은 고객 시간으로만 배분), 내부 시간은 "내부 투자 시간"으로 별도.

### 규모 & 검증
- **대 (신규 필드 + 운영 마이그레이션 + 5개 집계 함수 + UI 세그먼트)** → Fable 검증 게이트 대상(돈·수익성 무결성 + 운영 DB 마이그레이션).
- 검증: 백필 멱등, 고객/내부 세그먼트별 수익성 실데이터 대조, 내부 프로젝트가 마진 음수 알림에서 사라지는지, 팀 매출배분 재계산.

---

## 4. 결정 필요 (Irene)
1. **구분 필드**: 신규 `Project.kind` (권장) vs 기존 `billing_type='internal'` 재사용.
2. **내부 프로젝트 처리**: 수익성에서 "완전 제외 + 별도 내부투자 뷰"(권장) vs "매출 0으로 같이 표시".
3. **범위**: 전체 3-Layer 한 번에 vs Layer 1+2(구분·필터)만 먼저 → Layer 3(로직) 후속.
