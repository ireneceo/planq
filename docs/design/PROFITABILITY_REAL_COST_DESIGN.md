# 수익성 — 인건비를 실제 원가로 (운영 #211 후속, Irene 승인 2026-08-18)

> 배경: `/insights` 수익성 탭은 **이미 존재한다**. 문제는 화면이 없는 게 아니라 **숫자가 가정값**이라는 것.
> `services/stats.js:577` 이 `hours * 50000` 으로 **전 직원을 시간당 5만원 고정**으로 계산하고 있고,
> 주석은 "hourly_rate 컬럼 추후" 라고 되어 있는데 **그 컬럼은 이미 있다**(`BusinessMember.hourly_rate`,
> `monthly_salary` — 주석에 "청구/수익성 계산용", "내부 원가 계산용" 이라고까지 적혀 있다).
>
> 즉 **돈에 관한 화면에서 가정값이 진짜 숫자처럼 보이고 있었다.** 이 문서는 그걸 사실로 바꾸는 설계다.

## 0. 확인된 사실 (조사 결과)

| 항목 | 상태 |
|---|---|
| `BusinessMember.hourly_rate` / `monthly_salary` | 모델에 **존재**. 주석 "owner 만 조회/편집, 본인 단가 조회는 허용" |
| 그 값을 읽는 API | **없음** |
| 그 값을 쓰는 API | **없음** |
| 입력 화면 | **없음** |
| 소비처 | **없음** (그래서 5만원 하드코딩) |
| 수익성 탭 | `services/stats.js:510 buildProfitTab` · 프론트 `pages/Insights/` ProfitTab · segment(client/internal/all) 지원 |
| 시간 집계 | `stats.js:550` — `status:'completed'` 인 task 만, `assignee_id` 를 **select 하지 않음**(프로젝트 단위 합산) |

> **따라서 "단가 미입력이면 제외"(Irene 선택 2번)만 적용하면 전원이 미입력이라 인건비가 전부 0 이 된다.**
> 단가 입력 경로를 **같이** 만들어야 이 선택이 의미를 갖는다.

## 1. Irene 확정 사항 (2026-08-18)

1. **단가 미입력 멤버는 인건비에서 제외**하고, **"단가 미입력 N명" 경고를 화면에 표시**한다.
   (워크스페이스 기본 단가로 채우는 안은 기각 — *"돈 화면에서 그럴듯한 가짜 숫자가 제일 위험하다"*)
2. **진행 중 업무 시간도 원가에 포함**한다. (*"이미 쓴 시간은 돌아오지 않는다"*)
   ⚠️ 이 변경으로 **기존에 보던 이익·마진 숫자가 일제히 나빠진다.** 의도된 것이며 화면에 근거를 남긴다.
3. **고객사 단위 집계**를 추가한다. (지금은 프로젝트 행뿐이라 "이 고객사가 남는 장사인가" 를 눈으로 합산해야 함)

## 2. 설계

### 2-1. 단가 입력 (신규 API + 화면)

민감정보다. 모델 주석의 계약을 그대로 지킨다 — **owner 만 타인 단가 조회·편집, 본인 단가는 본인도 조회 가능.**

| 메서드·경로 | 권한 | 설명 |
|---|---|---|
| `GET /api/businesses/:id/members/rates` | **owner** (+platform_admin) | 전 멤버 단가 목록 |
| `GET /api/businesses/:id/members/:userId/rate` | owner · **또는 본인** | 단건 |
| `PUT /api/businesses/:id/members/:userId/rate` | **owner** | `{hourly_rate?, monthly_salary?}`. AuditLog 필수 |

- 기존 `GET /:businessId/members` 응답에는 **절대 싣지 않는다.** 그 라우트는 member 도 부르므로
  단가가 통째로 새 나간다. 별도 라우트로 분리하는 이유가 이것.
- 값 검증: 음수 불가, 상한(예: 시간당 10,000,000) 캡. 통화는 워크스페이스 `default_currency` 를 따른다.
- 화면: 워크스페이스 설정 → 팀/멤버 관리 안에 owner 전용 섹션. `AutoSaveField` 표준.

### 2-2. 유효 단가 결정 (단일 원천)

신규 `services/memberCost.js` — **여기 한 곳에서만** 시간당 원가를 정한다.
(가용시간이 3벌로 갈라졌던 전례를 반복하지 않는다.)

```
effectiveHourlyCost(member, capacity):
  1) hourly_rate 가 있으면 → 그 값
  2) monthly_salary 가 있으면 → monthly_salary ÷ (주간 가용시간 × 4.345)
       ★ 주간 가용시간은 memberCapacity 정본을 재사용한다. 여기서 새 공식을 만들지 않는다.
  3) 둘 다 없으면 → null   (= 인건비 계산 제외. 절대 기본값으로 채우지 않는다)
```

반환은 `{ cost: number|null, source: 'hourly'|'salary'|null }` — 화면이 출처를 표시할 수 있게.

### 2-3. 인건비 집계 (stats.js 변경)

**지금**: `hoursByProject[pid] += task.actual_hours` → `laborCost = hours * 50000`

**바꾼 뒤**:
1. task 조회에 **`assignee_id` 를 select 에 추가**하고, `status` 조건을 완료 한정에서 **활성 전체**로 넓힌다
   (`canceled` 제외 — 취소된 업무의 시간은 원가로 보지 않는다).
2. `(project_id, assignee_id) → hours` 로 집계.
3. 프로젝트별 인건비 = `Σ(멤버시간 × effectiveHourlyCost(멤버))`, **단가 null 인 멤버는 합산에서 제외**.
4. 프로젝트 행에 함께 반환:
   - `labor_cost` — 실제 단가로 계산된 값
   - `uncosted_hours` — 단가 미입력 멤버의 시간 합
   - `uncosted_member_count` — 그 멤버 수
   - `labor_cost_complete` — `uncosted_hours === 0` 여부
5. 탭 상단 KPI 에도 워크스페이스 전체 `uncosted_*` 를 올려, **한 화면에서 "이 숫자가 완전한가" 를 알 수 있게** 한다.

### 2-4. 고객사 단위 집계

프로젝트 행은 유지하고, `by_client` 배열을 **추가**한다(기존 소비처 무변경 — 프론트가 점진 채택).
- 그룹 키: `projects.client_company` (행에 이미 있다). 비어 있으면 `'—'` 버킷.
- 필드: `client`, `project_count`, `revenue`, `labor_cost`, `direct_cost`, `profit`, `margin_pct`, `hours`,
  `uncosted_hours`, `uncosted_member_count`.
- 정렬: `profit` 오름차순 기본 — **적자 고객사가 맨 위로** 온다(이 화면을 보는 이유).

### 2-5. 화면 (ProfitTab)

- 기존 프로젝트 표 위에 **고객사 표**를 두고, 탭이 아니라 **섹션 2개**로 나란히(전환 클릭 없이 둘 다 보이게).
- **미입력 경고 배너** — `uncosted_member_count > 0` 일 때 상단에 상시 노출:
  > "단가가 입력되지 않은 멤버 {{n}}명이 있어 {{h}}시간이 인건비에서 빠졌습니다. 실제 이익은 이보다 낮습니다."
  > → owner 면 [단가 입력하기] 버튼(설정으로 이동), member 면 안내만.
- **문구가 거짓이 되지 않게** — 진행 중 업무 시간이 포함되도록 바뀌었으므로, 표 헤더 툴팁에
  "취소된 업무를 제외한 모든 업무의 실제 투입시간" 이라고 명시한다.
- 숫자 옆 완전성 표시: `labor_cost_complete === false` 인 행에 회색 "일부 제외" 뱃지.

## 3. 리스크

| 리스크 | 대응 |
|---|---|
| **기존 숫자가 일제히 변한다** (5만원 고정 → 실단가, 완료만 → 진행중 포함) | Irene 사전 승인 완료. 화면에 근거 문구. 배포 후 첫 조회 시 놀라지 않도록 릴리즈노트에 명시 |
| 단가 유출 | 기존 members 라우트에 절대 싣지 않음. 전용 라우트 + owner 게이트 + AuditLog |
| 인건비 0 으로 보이는 초기 상태 | 경고 배너가 그 이유를 말한다. "0" 을 "이익이 크다" 로 오독하지 않게 |
| `monthly_salary` 환산이 또 하나의 공식이 되는 것 | `memberCapacity` 정본 재사용. `memberCost.js` 밖에서 환산 금지 |
| 통화 혼재(외화 프로젝트) | 기존 `has_foreign_currency` 플래그가 이미 있다. 단가는 워크스페이스 기본 통화 기준임을 명시 |

## 4. 검증 계획 (Fable 3단 게이트 — 돈 영역)

1. **권한 반증** — member 토큰으로 rates 라우트 → 403. 본인 단건 → 200. 타인 단건 → 403.
   기존 `GET /members` 응답에 `hourly_rate` 가 **없는지** 실응답으로 확인.
2. **계산 반증** — 단가 있는 멤버 1명 + 없는 멤버 1명에게 업무를 배정하고,
   `labor_cost` 가 **있는 쪽만** 반영하는지 · `uncosted_hours` 가 없는 쪽 시간과 일치하는지.
3. **진행중 포함 반증** — 진행 중 업무의 `actual_hours` 가 원가에 들어가는지(before/after 값 비교).
4. **고객사 집계 반증** — 같은 고객사의 프로젝트 2개 합이 `by_client` 행과 일치하는지.
5. **회귀** — `segment=internal`/`all` 이 기존과 동일하게 동작하는지. 수익성 외 탭 무영향.
6. 테스트 데이터는 전부 원복 후 **COUNT 로 잔존 0 확인**.
