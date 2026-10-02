# 근무일·휴일·휴가 통합 설계 (운영 #424 잔여분)

> 작성: Fable 설계 게이트, 2026-10-02. 상태: **구현 완료(2026-10-02 [Opus]) — Irene 결정 Q1·Q2·Q3 모두 «예»**. 구현 기록은 맨 끝 §9.
> 선행: `docs/ATTENDANCE_LEAVE_DESIGN.md` (#208·#285, 휴가 차감 §7) · `services/memberCapacity.js` (#288 단일 원천).
> 신고 원문(#424, owner, 2026-09): *"휴가 승인 화면이 안 떠 / 근태관리 관리자 화면이 없어 / 휴가·휴일이 Q task 근무일수에 반영되어야 / 워크스페이스 휴일을 국가에 맞게 / 기본 근무일수·휴일·휴가 통합 / 일일 시간 강제 말고 주간 관리."*
> 추가 지시(10-02): *"기존 계산 및 정리 문제되게 바꾸는 거 아니면 맞춰서 수정해."*

---

## 0. 결론 (10줄)

1. 휴일의 정본은 **`workspace_holidays` 표 하나**(국가 공휴일 + 직접 추가, 워크스페이스 단위). 외부 API 없음 — 국가 데이터는 저장소 안 정적 JSON(`config/holidays/KR.json`)에서 **행으로 물질화**하고 owner/admin 이 끄고 켠다.
2. 국가는 `businesses.holiday_country` (ISO-2, **NULL 기본 = 자동 공휴일 안 씀**). 켜기 전까지 어떤 숫자도 변하지 않는다.
3. 공식은 `services/memberCapacity.js` **한 벌에 날짜 축을 더한다**: `근무일(주) = max(0, weekly_work_days − 수동휴일(구) − 공휴일(그 주) − 휴가(그 주))`, `실질 가용 = daily × rate × 근무일`. 공휴일·휴가는 **근무 요일(기본 월~금)에 떨어진 날만** 센다 — 토요일 공휴일은 0.
4. 이중차감 규칙: 같은 날짜는 **공휴일로 한 번만** 센다(휴가가 공휴일에 걸치면 그 날은 휴가에서 0). 수동 `weekly_holidays` 는 더하되(호환) Q task 패널의 입력칸은 읽기 전용 내역으로 바뀐다(결정 Q2).
5. 소비처 6곳이 **같은 함수**를 부른다 — my-week·my-month·주간보고(개인·워크스페이스)·단위보고서·Q task 패널. 패널의 클라이언트 재계산(`QTaskPage.tsx:1374`)을 **서버값으로 교체**한다 — 지금은 휴가 차감이 서버에만 있고 **화면에는 안 보인다**(§1.3).
6. 과거 스냅샷(weekly_reviews·business_weekly_reports·report_units)은 JSON 박제라 **재계산되지 않는다**(§3.3).
7. 설정 화면은 **기존 설정 > 근태 관리 탭** 상단에 「휴일·근무일」 섹션으로 — 새 페이지 없음. "관리자 화면이 없다" 는 owner 에게는 09-23(v1.58.0)에 해결됐고, **admin 역할에게만 메뉴가 안 보이는 구멍**이 남아 있다(§1.4) — 같이 고친다.
8. 운영 적용: `migrate-workspace-holidays.js`(멱등, 컬럼 1 + 표 1, 백필 없음) → 코드 배포. 롤백 = 코드만.
9. 판정 R=1(운영 스키마 + 보고서 수치) · S=1 · F=1 → **구현 후 Fable 게이트 1회(묶어서)**. 각 단계 검증은 실 API 수치 diff 로(§6).
10. Irene 결정 3건(§7): 휴가 차감일을 근무일 기준으로 / 패널 수동 휴일칸 폐지 / 휴일을 예약·캘린더에도 반영할지.

---

## 1. 현 계산 경로 전수 (2026-10-02 실측)

### 1.1 정본 함수 (`services/memberCapacity.js`)

| 함수 | 공식 | 날짜 축 |
|---|---|---|
| `getMemberCapacity` → `weekly` | `daily × (days − weekly_holidays) × rate` | 없음(명목) |
| `getMemberCapacityForWeek` → `weekly_effective` | `weekly − daily×rate×L(주)` | 주 |
| `periodHours` | `weekly × 일수/7` | 기간 |
| `periodHoursWithLeave` | `periodHours − daily×rate×L(기간)` | 기간 |
| `getLeaveDaysInRange` | approved 휴가 `days_charged` 를 **달력일 겹침 비율**로 일할 | — |

`weekly_holidays`(business_members.INTEGER)는 이름이 "이번 주 휴일" 이지만 **멤버에 영구 저장**되는 상수다(운영 #50 "페이지 이탈 후에도 유지"). 주가 바뀌어도 리셋되지 않는다. 운영 실측: 22명 중 21명 0 · **1명 1**. dev: 67명 중 1명 2.

### 1.2 소비처 (전수)

| # | 소비처 | 지금 부르는 것 | 휴가 | 수동휴일 | 비고 |
|---|---|---|---|---|---|
| ① | `routes/tasks.js:140` GET my-week | `getMemberCapacityForWeek` | ● | ● | 응답 `capacity{daily,days,rate,holidays,weekly,leave_days,leave_deduction,weekly_effective}` |
| ② | `routes/tasks.js:248-254` GET my-month | `getMemberCapacity` + 주별 `ForWeek` | ● | ● | `weeks[].capacity_effective` — **프론트 소비처 0** |
| ③ | `routes/tasks.js:1119` participation-suggestion | `getMemberCapacity` 명목 | ✕(의도) | ● | 분모 = 명목. 무변경 |
| ④ | `weeklyReviewSnapshot.js:604-613` fetchMemberUtilization(워크스페이스 주간보고) | `weeklyHours` + **인라인 휴가 차감** | ● | ● | ★ 서비스 밖 **사본**(#288 계열 잔존) — 이번에 서비스로 흡수 |
| ⑤ | `weeklyReviewSnapshot.js:78→722` getUserCapacity(개인 주간보고) | `getMemberCapacityForWeek` | ● | ● | |
| ⑥ | `reportUnitSnapshot.js:244` 단위 보고서 capacity_hours | `periodHoursWithLeave` | ● | ● | 생성 시점 박제 |
| ⑦ | `memberCost.js:57` 월급→시급 환산 | `weeklyHours` 명목 | ✕ | ● | **무변경** — 원가 환산은 명목 기준이어야 한다 |
| ⑧ | `stats.js:492,956` Insights 가동률 | **인라인 `dh×wd×pr`** (휴일·휴가 무시) | ✕ | ✕ | 별개 사본 2벌. 이번 범위 밖 — "간이 추정" 주석대로 두되 §8 후속에 기록 |
| ⑨ | `QTaskPage.tsx:1374` 패널 `effectiveCapacity` | **클라이언트 재계산** `daily×(days−holidayDays)×rate` | **✕** | ● | ★ 서버 `weekly_effective` 를 **읽는 곳이 0** → 휴가 차감이 화면에 안 나온다 |
| ⑩ | `QTaskPage.tsx:1630` 주간 판정 `totalBiz`/`elapsedBiz` | `days − holidayDays` / **월~금 하드코딩** | ✕ | ● | 공휴일 날짜를 모른다 |
| ⑪ | `leaveTransition.js:computeDaysCharged` | full_day = **달력 일수** | — | — | 주말·공휴일 포함 차감(설계 §7.1 한계로 명시돼 있음) |
| ⑫ | `booking.js:workHoursOf` 예약 슬롯 | `businesses.work_hours` (요일별, 전부 NULL → 기본 월~금 9–18) | — | — | **요일 집합의 유일한 기존 소비처** — 이 집합을 재사용한다 |

### 1.3 "휴가를 쓰면 Q task 근무일수에 반영" — 실제 상태

서버는 ①②④⑤⑥ 모두 차감한다. 그러나 **Q task 화면(⑨⑩)은 서버의 `weekly_effective` 를 한 번도 읽지 않고** 자기 공식으로 다시 계산한다(`grep weekly_effective dev-frontend/src` → 0건). 운영의 유일한 승인 휴가(biz 1 · user 3 · 2026-09-30 수 · 1일)는 API 로는 40→32h 인데 패널은 40h 를 그린다. **백엔드만 되고 화면이 안 붙은 상태**(memory `feedback_backend_done_ui_missing`). 이것이 신고의 두 번째 문장이다.

### 1.4 "관리자 화면이 없다" — 지금도 사실인가

- 화면은 있다: `/business/settings/attendance` → `WorkspaceSettingsPage` 의 `AttendanceAdminSettings`(승인함·팀 현황·통계). 09-23 v1.58.0 에서 알림 딥링크 `?leave=` 와 옛 `/attendance?tab=team` 리다이렉트까지 붙었다(`canary-leave-deeplink`).
- **남은 구멍 1**: 사이드바 항목이 `hasBiz('owner')` (`MainLayout.tsx:1706`)인데 승인 권한은 서버 `isManager = owner ∥ admin` (`routes/leave.js:26`). **admin 역할은 승인할 수 있는데 메뉴가 없다.** `hasBiz` 의 타입 자체가 `'owner'|'member'|'client'` 라 `'admin'` 을 표현 못 한다. 운영엔 admin 역할 0명이라 아직 신고가 없을 뿐이다. → 이번에 `hasBiz` 에 `'admin'` 추가 + 근태 관리·활동 기록 항목에 적용.
- 신고자는 owner 이므로 당시 증상은 딥링크(해결됨)였다.

### 1.5 워크스페이스 국가 필드

없다. `businesses` 에 `country` 류 컬럼 0 — `timezone`(운영 8 Asia/Seoul · 1 Asia/Kuala_Lumpur), `default_language`, `work_hours`(JSON, 운영·dev 전부 NULL) 뿐. `Client.country`(ISO-2, 청구용)만 존재.

---

## 2. 데이터 모델

### 2.1 `businesses.holiday_country VARCHAR(2) NULL` (컬럼 1 추가)

- NULL = 국가 공휴일 자동 없음(기본). 값은 **데이터셋이 있는 국가만** 허용(`config/holidays/index.js` 의 키: 1차 `KR`). 그 외 값 400.
- timezone 으로 **추측하지 않는다**(Asia/Seoul 이라고 한국 공휴일을 넣으면 "켜지 않은 워크스페이스의 숫자가 바뀐다"). owner 가 켠다.
- `country` 가 아니라 `holiday_country` 인 이유: 법인 국가·청구 국가와 뜻이 다르고, NULL 의 의미("안 씀")가 이름에 담긴다.

### 2.2 `workspace_holidays` (표 1 신규)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INT PK AI | |
| business_id | INT NOT NULL FK | 멀티테넌트 축 |
| date | DATEONLY NOT NULL | 워크스페이스 달력일 |
| name | VARCHAR(100) NOT NULL | ko (예: 추석) |
| name_en | VARCHAR(100) NULL | |
| source | ENUM('national','custom') NOT NULL | 데이터셋에서 온 행 / 직접 추가 |
| is_off | BOOLEAN NOT NULL DEFAULT 1 | **0 = 이 날은 근무**(국가 공휴일을 끈 것). 국가 행은 삭제하지 않고 끈다 — 재동기화가 되살리지 않게(툼스톤) |
| created_by | INT NULL FK users | custom·토글 주체 |

UNIQUE(`business_id`,`date`) · INDEX(`business_id`,`date`). `underscored`, timestamps.

**왜 물질화(행)인가 — 실시간 조회(데이터셋 − 예외) 대신**: ①계산 경로의 읽기 술어가 `WHERE business_id=? AND is_off=1 AND date BETWEEN` **하나**가 된다 ②owner 가 보는 목록 = 계산이 쓰는 목록(같은 행) ③데이터셋을 나중에 고쳐도(임시공휴일 추가) 이미 지나간 주의 행이 조용히 바뀌지 않는다.

### 2.3 국가 데이터셋 — 정적 JSON, 외부 API 없음

`dev-backend/config/holidays/KR.json`:
```json
{ "2026": [ { "date": "2026-01-01", "name": "신정", "name_en": "New Year's Day", "kind": "fixed" },
            { "date": "2026-02-17", "name": "설날", "name_en": "Seollal", "kind": "lunar" }, … ],
  "2027": [ … ] }
```
- `kind`: fixed(양력 고정) · lunar(음력, 해마다 다름) · substitute(대체공휴일) · temporary(임시공휴일). 출처는 **공공데이터포털 특일정보(관보)** 를 사람이 옮겨 커밋한다 — 커밋 전 그 해 관보와 날짜 전수 대조(§6 P1).
- 다른 국가는 데이터셋이 생길 때 키를 더한다(MY 는 주(州)별이라 1차 제외 — 운영 1곳은 `custom` 으로 직접 관리). **`holiday_country` 허용값 = 데이터셋 키**다(코드와 데이터가 한 곳).
- 물질화 `services/workspaceHolidays.js ensureNationalRows(businessId, year)` — 데이터셋 날짜 중 **그 워크스페이스에 없는 날짜만** INSERT(`source='national'`). 있는 행(꺼진 행 포함)은 건드리지 않는다. 멱등.
- 호출 시점 ①`holiday_country` 저장 시(올해·내년) ②설정 섹션 GET(`?year=`) 시 그 해 ③`services/holidayYearCron.js` 매일 00:10, 11월 이후면 내년(기존 cron 파일 패턴). **가용시간 계산 경로는 읽기만** 한다 — 읽다가 쓰지 않는다.
- 국가를 바꾸면: 오늘 이후 `national` 행 전부 삭제 후 새 국가로 물질화. 과거 행은 남긴다(그 주의 보고서가 그 행으로 계산됐다). NULL 로 바꾸면: 오늘 이후 `national` 행 삭제, `custom` 은 유지.

### 2.4 근무 요일 집합 — 새 컬럼 없음

`booking.workHoursOf(biz)` 가 이미 요일별 null/시간을 가진다(기본 `[일 null, 월~금 9–18, 토 null]`). `services/workspaceHolidays.js workWeekdaysOf(biz)` = `hours[dow] !== null` 인 요일 집합. **휴일·휴가는 이 집합에 속한 날짜만 센다.** 운영·dev 모두 `work_hours` NULL → 월~금. 멤버별 요일 매핑(주 4일 근무자가 어느 요일을 쉬는지)은 **비범위** — Irene: "일일 시간을 강제하지 않고 주간 관리". 수치는 `max(0, days − …)` 클램프로 보호한다.

---

## 3. 공식 (단일 원천 · 불변 조건)

### 3.1 `services/memberCapacity.js` — 함수 시그니처는 그대로, 날짜 축만 더한다

```
H(biz, from, to) = #{ d ∈ workspace_holidays(biz) : is_off=1 ∧ from≤d≤to ∧ dow(d) ∈ workWeekdays }
L(u, biz, from, to) = Σ approved leave:
    full_day  → #{ d ∈ [start,end]∩[from,to] : dow(d) ∈ workWeekdays ∧ d ∉ H-dates }   ← 달력 일할 → 근무일 계수
    half_day / hours → days_charged (그 날짜가 공휴일·비근무 요일이면 0)
workDays(주) = max(0, days − weekly_holidays(구·수동) − min(H, days) − L)
weekly_effective = round1( daily × rate × workDays )                 ← 곱을 한 번만 반올림
periodHoursEffective(from,to) = max(0, round1( periodHours(weekly) − daily×rate×(H+L) ))   ← 단위보고서(월간)
```
- `weekly`(명목)·`weeklyHours`·`periodHours` **무변경** (⑦ 원가, ③ 참여율 추천, my-month `capacity` 가 쓴다).
- `getMemberCapacityForWeek` 응답에 **키 추가만**: `holiday_days`, `holiday_list:[{date,name,name_en}]`, `work_days`(=workDays), `holiday_deduction`. 기존 `holidays`(수동값)·`leave_days`·`leave_deduction`·`weekly_effective` 는 그대로.
- `periodHoursWithLeave` → `periodHoursEffective(userId, businessId, cap, from, to)` 로 이름을 바꾸고 유일한 호출부 ⑥을 옮긴다(이름이 동작보다 좁아지면 다음 사람이 속는다).
- ④ 인라인 사본은 `getMemberCapacityForWeek` 호출로 교체 → `capacity_hours = weekly_effective`, `capacity_hours_nominal = weekly`, `leave_days`, **+`holiday_days`**(additive, schema_version 불변).

### 3.2 이중차감 방지 — 세 축이 **같은 날짜를 두 번 세지 않는다**

| 쌍 | 규칙 |
|---|---|
| 공휴일 × 휴가 | 날짜 단위로 공휴일이 먼저. 휴가가 공휴일에 걸친 날은 L 에서 0. (반차·시간 휴가가 공휴일이면 0) |
| 공휴일 × 비근무 요일 | 토·일(또는 `work_hours` null 요일) 공휴일은 H 에 안 들어간다 |
| 수동 `weekly_holidays` × 공휴일 | 더한다(호환). 단 **Q task 패널의 입력칸을 없애** 새로 생기지 않게 한다(§4.2, 결정 Q2). 기존 값(운영 1명=1)은 ✕ 로 지울 때까지 유지 |
| 휴가 × 휴가 | 기존 `overlapping_leave` 400 유지 |

### 3.3 기존 결과 불변 조건 (게이트 판정 기준)

1. **휴일 행 0 · 승인 휴가 0** 인 (멤버, 주) → `H=0, L=0` → `workDays = days − weekly_holidays` → **지금 `weekly` 와 동일**. 운영·dev 의 전 멤버가 여기 해당한다(운영 승인 휴가 1건 제외).
2. **승인 휴가만 있는 주** → 단일일 종일 휴가(운영 1건, 수요일)는 L=1 그대로. 변하는 건 **주말을 가로지르는 종일 휴가**뿐(예: 월~일 7일 charged → 종전 7 차감, 신규 5) — 종전이 틀렸던 것이고 운영·dev 에 해당 행 0. 분수 휴가(시간 단위)는 반올림 지점이 한 번으로 바뀌어 **±0.1h** 가능 — 해당 행 0.
3. **과거 스냅샷은 재계산되지 않는다** — `weekly_reviews.snapshot_data`·`business_weekly_reports.snapshot_data`·`report_units` 는 POST(확정)·cron 때 JSON 박제, GET 은 읽기만(`routes/weekly_reviews.js:90`·`:347` 모두 생성 경로). 운영 weekly_reviews 53 · business_weekly_reports 88 행 불변.
4. `memberCost`(원가)·participation-suggestion·my-month `capacity`(명목)는 코드 경로 자체가 안 바뀐다.
5. 판정은 §6 P0 기준선 스크립트의 **diff 0** 으로 기계가 한다.

---

## 4. 화면

### 4.1 설정 > 근태 관리 탭 — 「휴일·근무일」 섹션 (owner/admin)

위치: `AttendanceAdminSettings.tsx` 최상단(승인함 위). 새 페이지·새 탭 없음. 사이드바 `근태 관리` 항목은 `hasBiz('owner','admin')`.

```
┌ 휴일·근무일 ──────────────────────────────────────────────────────┐
│ 국가 공휴일  [ 대한민국 ▾ ]   (사용 안 함 / 대한민국)      ✓        │  ← AutoSaveField select
│   공휴일은 근무 요일(월~금)에 해당하는 날만 가용시간에서 빠집니다. 개인 휴가는 근태 > 휴가에서. │
│ ◀ 2026 ▶                                        [+ 휴일 추가]      │
│ 날짜        요일  이름            출처    휴무                        │
│ 2026-10-09  금    한글날          공휴일   [●  ]  ✓                   │  ← 토글 AutoSaveField type=toggle
│ 2026-10-05  월    개천절 대체휴일  공휴일   [●  ]                      │
│ 2026-10-03  토    개천절          공휴일   [●  ]  (비근무 요일 — 반영 없음)│
│ 2026-10-30  금    창립기념일      직접     [●  ]  ✕                   │  ← custom 만 ✕(삭제)
│ (지난 날짜는 접힘 — "지난 휴일 보기")                                │
└──────────────────────────────────────────────────────────────────┘
[+ 휴일 추가] → 인라인 행: 날짜(SingleDateField) · 이름 · [추가]   (액션형 — autosave-exempt)
```
- `data-testid`: `holiday-country`, `holiday-add-open`, `holiday-add-submit`, `holiday-row-<date>`, `holiday-toggle-<date>`, `holiday-delete-<date>`.
- 비근무 요일에 떨어진 행은 회색 + "반영 없음" 보조문구(숫자가 왜 안 줄었는지 화면이 말한다).

### 4.2 Q task 우측 「주간 가용시간」 패널 — 입력칸 → 서버 내역

```
주간 가용시간
1일 업무시간 [8]  업무일수 [5]  실작업률 [100]%          ← 그대로(멤버 설정 PATCH work-hours)
이번 주 근무일  4일   = 5 − 공휴일 1 − 휴가 0                ← 읽기 전용(서버 capacity.work_days)
  · 10-09 금 한글날                                       ← holiday_list
  · 수동 휴일 +1  ✕                                        ← weekly_holidays>0 일 때만. ✕ = 0 저장
  · 휴가 신청 → (멤버)  /  휴일 관리 → (owner/admin)         ← 링크, 새 탭
8h × 4일 × 100% = 주 32h
```
- `effectiveCapacity` = `capacity.weekly_effective`(서버) — 클라이언트 공식 삭제. 주간 판정 `totalBiz = capacity.work_days`, `elapsedBiz` 는 `holiday_list` 날짜를 건너뛴다.
- `capacity-holidays` 입력칸 제거(결정 Q2). 1436-1438 의 로컬 재계산도 서버 재조회(`silentLoad my-week`)로 바꾼다.
- 블록을 `components/QTask/CapacityPanel.tsx` 로 **분리**한다 — QTaskPage 는 god-file 래칫 기준(3606) 을 이미 넘어 있다(3611).
- 실시간: `holiday:updated {business_id}` 수신 → my-week silentLoad(이미 business room join 중). 설정 저장·휴가 승인(`leave:updated`) 도 같은 리로드.

### 4.3 보고서 표면 (additive)
- 워크스페이스 주간보고 멤버 표: `capacity_hours` 옆 툴팁 "명목 40h − 공휴일 8h − 휴가 0h". 개인 주간보고·단위보고서 `capacity_hours` 는 값만 바뀐다(이미 그리고 있다).

### 4.4 i18n (ko / en)

`settings.json` → `holidays.*` (설정 섹션) · `qtask.json` → `capacity.*` 추가 · `attendance.json` 무변경.

| 키 | ko | en |
|---|---|---|
| settings:holidays.title | 휴일·근무일 | Holidays & workdays |
| settings:holidays.country | 국가 공휴일 | National holidays |
| settings:holidays.countryNone | 사용 안 함 | Off |
| settings:holidays.countryKR | 대한민국 | South Korea |
| settings:holidays.desc | 공휴일은 근무 요일(월~금)에 해당하는 날만 가용시간에서 빠집니다. 개인 휴가는 근태 > 휴가에서 신청합니다. | Only holidays that fall on a workday (Mon–Fri) reduce capacity. Personal time off is requested under Attendance > Leave. |
| settings:holidays.add | 휴일 추가 | Add holiday |
| settings:holidays.col.date / dow / name / source / off | 날짜 / 요일 / 이름 / 출처 / 휴무 | Date / Day / Name / Source / Off |
| settings:holidays.source.national / custom | 공휴일 / 직접 | National / Custom |
| settings:holidays.notWorkday | 비근무 요일 — 반영 없음 | Not a workday — no effect |
| settings:holidays.showPast | 지난 휴일 보기 | Show past holidays |
| settings:holidays.duplicate | 이미 있는 날짜입니다 | That date already exists |
| settings:holidays.readOnly | 워크스페이스 관리자만 변경할 수 있습니다. | Only workspace admins can change this. |
| qtask:capacity.workDays | 이번 주 근무일 | Workdays this week |
| qtask:capacity.workDaysFormula | {{days}}일 = {{base}} − 공휴일 {{holiday}} − 휴가 {{leave}} | {{days}} = {{base}} − {{holiday}} holiday − {{leave}} leave |
| qtask:capacity.manualHoliday | 수동 휴일 +{{n}} | Manual holiday +{{n}} |
| qtask:capacity.manualHolidayClear | 수동 휴일 지우기 | Clear manual holiday |
| qtask:capacity.requestLeave | 휴가 신청 | Request leave |
| qtask:capacity.manageHolidays | 휴일 관리 | Manage holidays |
| qtask:capacity.formula (수정) | {{daily}}h × {{days}}일 × {{rate}}% = 주 {{total}}h | {{daily}}h × {{days}}d × {{rate}}% = {{total}}h/wk |
| weeklyReview 멤버 툴팁 | 명목 {{nominal}}h − 공휴일 {{holiday}}h − 휴가 {{leave}}h | Nominal {{nominal}}h − holidays {{holiday}}h − leave {{leave}}h |

가드: `--category=i18n` · `parity` · `autosave`(섹션 select/토글은 AutoSaveField) · `godfile`(패널 분리로 감소).

---

## 5. API · 권한 · 실시간

| 메서드·경로 | 권한 | 동작 |
|---|---|---|
| PUT `/api/businesses/:id/settings` `{holiday_country}` (기존 라우트에 필드 추가) | **owner/admin** (`isAdmin(req) ∥ businessRole==='admin'` — report-settings 와 같은 식) | 허용값 = 데이터셋 키 ∥ null. 저장 후 `ensureNationalRows(올해·내년)`, 국가 변경 시 §2.3 교체. AuditLog `business.settings_update`(기존) |
| GET `/api/businesses/:id/holidays?year=` | 멤버 이상(읽기) | 그 해 행 전부(꺼진 행 포함) + `work_weekdays`. owner/admin 호출이면 그 해 `ensureNationalRows` 선행 |
| POST `/api/businesses/:id/holidays` `{date,name,name_en}` | owner/admin | `custom` 추가. 같은 날짜 409 `holiday_exists`. AuditLog `holiday.create` |
| PATCH `/api/businesses/:id/holidays/:hid` `{is_off,name,name_en}` | owner/admin | national 은 `is_off` 만. AuditLog `holiday.update` |
| DELETE `/api/businesses/:id/holidays/:hid` | owner/admin | **custom 만**(national 은 400 `use_toggle`). AuditLog `holiday.delete` |

- 모든 WHERE 에 `business_id`. 타 워크스페이스 행 id 로 PATCH/DELETE → 404.
- 쓰기 4종 모두 `io.to('business:{id}').emit('holiday:updated', {business_id})` — 신호만(CLAUDE.md §16 b).
- `/api/tasks/my-week` 응답 `capacity` 에 키 추가(§3.1). 라우트 파일은 `routes/business_holidays.js` 신규, `/api/businesses` 접두어 **앞에** 마운트(꼬리 경로 `/:id/holidays…` 만 둔다 — `client_links.js` 선례, `--category=duproute`).

---

## 6. 운영 마이그레이션 · 롤백 · 판정 · 구현 순서

### 6.1 마이그레이션 `dev-backend/scripts/migrate-workspace-holidays.js` (멱등)
1. `businesses.holiday_country VARCHAR(2) NULL` — `SHOW COLUMNS` 로 없을 때만 ADD. **백필 없음**(NULL = 안 씀이 불변 조건의 근거다).
2. `CREATE TABLE IF NOT EXISTS workspace_holidays (…)` + UNIQUE/INDEX.
3. 재실행 시 변경 0 출력. **코드 배포 전**(deploy 슬롯) — 컬럼 없이 새 코드가 뜨면 my-week 가 500. ENUM 변경 없음.

### 6.2 롤백
코드만 되돌린다. 컬럼·표는 남아도 무해(읽는 코드가 없다). 완전 제거는 `ALTER TABLE businesses DROP COLUMN holiday_country; DROP TABLE workspace_holidays;`. 휴가 데이터 무관.

### 6.3 R/S/F
- **R=1** — 운영 스키마 추가 + 보고서·가용시간 수치에 닿는다(되돌릴 수는 있지만 CLAUDE.md 분류상 R). (결정 Q1 채택 시 휴가 잔여 차감 규칙도 바뀐다 → 더욱 R.)
- S=1 — 세 축(공휴일·휴가·수동)의 절단면과 이중차감 규칙은 이 문서가 정했다.
- F=1 — 불변 조건·차감 규칙 전부 실 API diff 와 양성/음성 대조군으로 갈린다.
- → **구현 후 Fable 게이트 1회, P1~P3 묶어서.** 단계별 자체 검증은 아래 수치로.

### 6.4 구현 순서와 단계 검증 (실 API)

**P0 기준선(코드 변경 전)** — `dev-backend/test-capacity-baseline.js`(끝나면 삭제): dev 전 워크스페이스 × 활성 멤버 × 최근 6주 에 대해 `getMemberCapacityForWeek().weekly_effective`, `buildSnapshot().summary.capacity_hours`, `fetchMemberUtilization()[].capacity_hours`, `periodHoursWithLeave(월)` 를 JSON 으로 저장(scratchpad). 운영도 SSH 읽기로 같은 표(멤버 22 × 6주) 저장.

**P1 백엔드 공식·표·마이그레이션** (memberCapacity · workspaceHolidays · ④⑥ 전환 · 데이터셋 KR 2026·2027 · 마이그레이션 · cron)
- 마이그레이션 2회 실행 → 2회째 변경 0.
- KR.json 날짜 전수를 관보 목록과 대조(스크립트로 날짜·요일 출력 → 사람이 확인) — 한 날짜라도 틀리면 **전 워크스페이스 숫자가 틀린다.**
- P0 재실행 → **전 항목 diff 0** (휴일 행 0 이므로).
- 양성 대조군(dev 멤버 1명, 이번 주): 평일 공휴일 1행 INSERT → `weekly_effective` 가 정확히 `daily×rate` 만큼 감소하고 **네 표면(my-week·개인 주간보고·워크스페이스 주간보고·단위보고서 주간)이 같은 수**; `is_off=0` → 원복; 토요일 행 → 변화 0; 같은 날짜에 승인 종일 휴가 → `holiday_days=1, leave_days=0`(이중차감 0); 금~월 종일 휴가 → L=2. 끝나면 행·휴가 원복(memory `feedback_test_data_restore`).
- `node scripts/health-check.js` · `guard-invariants` 전체 · `--suite leavesave,leavelink` 회귀.

**P2 설정 API·화면 + admin 메뉴** (business_holidays.js · settings 필드 · AttendanceAdminSettings 섹션 · hasBiz admin)
- login(owner) → PUT `holiday_country=KR` → GET `?year=2026` 행수 = 데이터셋 2026 건수 → 토글 OFF → GET `is_off=false` → custom POST → 중복 POST 409 → DELETE custom 200 / DELETE national 400 → member 로 POST 403 → 타 워크스페이스 id PATCH 404 → `audit_logs` 5행 → `holiday_country=null` → 오늘 이후 national 삭제·custom 잔존.
- 소켓: 탭 A 토글 → 탭 B Q task 패널 ≤1초 갱신.
- 실브라우저(3폭): admin 역할 계정에 「근태 관리」 보임(양성) / member 안 보임(음성).

**P3 Q task 패널** (CapacityPanel 분리 · 서버값 · 내역)
- `--suite holidaycap`(신설, 3폭): 패널 숫자 == `/api/tasks/my-week.capacity.weekly_effective`; 공휴일 행 추가 후 「이번 주 근무일 4일」·내역 줄 보임; 수동 휴일 칩은 `weekly_holidays>0` 계정에만; ✕ 후 PATCH 1건·0 저장; 주간 판정 칩이 공휴일 날짜를 건너뛰는지(elapsedBiz). 양성 대조군: 클라이언트 공식을 되살리면 FAIL.
- `npm run build` EXIT 0 · `error TS` 0 · godfile QTaskPage 감소.

**P4 (결정 후)** — Q1 채택 시 `computeDaysCharged` 근무일 계수(앞으로의 승인분만; `days_charged` 박제라 과거 불변) · Q3 채택 시 예약 슬롯 공휴일 제외(`computeSlots` 에 `H` 날짜 skip 1줄) · 캘린더 읽기 전용 표시.

---

## 7. Irene 결정 필요 (최대 3)

1. **휴가 차감일(잔여)도 근무일 기준으로?** 지금 종일 휴가는 달력 일수(금~월 신청 = 4일 차감). 공휴일·요일 집합이 생기므로 **앞으로 승인되는 건부터** 주말·공휴일을 빼고 센다(과거 승인은 박제라 불변). 권고: **예**. (아니오면 가용시간 차감만 근무일 기준이고 잔여는 종전 — 두 숫자가 다른 이유를 화면이 설명해야 한다.)
2. **Q task 패널의 「이번 주 휴일」 수동 입력칸 폐지?** 읽기 전용 내역(공휴일·휴가)으로 바꾸고 기존 수동값은 ✕ 로 지울 때까지 유지(운영 1명). 권고: **예** — 남겨 두면 공휴일과 같은 날을 두 번 넣는 문이 남는다.
3. **휴일을 상담 예약 슬롯·Q calendar 에도 반영?** 공휴일에 고객 예약이 잡히는 것을 막고(`computeSlots` skip) 캘린더에 회색 띠로 표시. 가용시간과 무관한 추가 범위. 권고: 예약 슬롯은 **예**(1줄), 캘린더 표시는 후속.

---

## 8. 후속(이번 범위 밖, 기록)
- `services/stats.js:492,956` Insights 가동률 분모 2벌 — 휴일·휴가·수동휴일 전부 무시하는 사본. 별건으로 `periodHoursEffective` 로 흡수.
- 멤버별 근무 요일 매핑(주 4일 근무자) — `work_hours` 는 워크스페이스 단위. 요구가 오면 `business_members.work_weekdays` 로.
- MY 등 데이터셋 — 요청 시 `config/holidays/<CC>.json` 추가만으로 켜진다.


---

## 9. 구현 기록 (2026-10-02 [Opus])

Irene 결정: Q1 예 · Q2 예 · Q3 예(예약 슬롯. 캘린더 표시는 후속).

| 항목 | 위치 |
|---|---|
| 데이터셋 KR 2026·2027 (노동절·제헌절 2026 개정 반영, 2026-06-03 지방선거 포함) | `dev-backend/config/holidays/KR.json` |
| 근무 달력 단일 원천 | `services/workspaceHolidays.js` (`getWorkCalendar`·`countWorkdays`·`ensureNationalRows`·`applyCountryChange`·cron) |
| 가용시간 공식(공휴일·휴가·이중차감) | `services/memberCapacity.js` `getDeductionsInRange` · `getMemberCapacityForWeek`(+`holiday_days`·`holiday_list`·`work_days`·`work_weekdays`) · `periodHoursEffective` |
| ④ 워크스페이스 주간보고 인라인 사본 제거 | `weeklyReviewSnapshot.fetchMemberUtilization` → `getMemberCapacityForWeek` |
| Q1 휴가 차감일 = 근무일 | `leaveTransition.computeDaysCharged` · 근무일 0 인 신청 400 `no_workdays_in_range` · 신청 화면 미리보기는 `GET /api/leave/preview`(같은 함수) |
| Q3 예약 슬롯 휴일 제외 | `booking.computeSlots` |
| 설정 API | `routes/business_holidays.js` — **국가는 `PUT /:id/holiday-country`** 로 분리(§5 의 `PUT /settings` 는 owner 전용이라 owner/admin 술어와 섞지 않았다) |
| 설정 화면 | `pages/Settings/HolidaySettingsSection.tsx` (근태 관리 탭 상단) |
| Q task 패널 | `components/QTask/CapacityWorkdays.tsx` — 수동 휴일칸 제거, 서버 `work_days` 로 곱하기만. 패널 전체 분리는 하지 않았다(범위 축소) |
| admin 역할 | 사이드바 `hasBiz`(admin ⊇ member) · 라우트 `hasRole`(admin → business_member) · `visibleNavMenus` · **데스크탑 설정 보조 패널에 근태 관리·활동 기록 추가**(owner 도 폰 아코디언에서만 갈 수 있었다) |
| 마이그레이션 | `dev-backend/scripts/migrate-workspace-holidays.js` (멱등, 배포 슬롯 등록 필요) |

자체 검증: P0 기준선 871값 diff 0 · 휴일 API 26/26 · 휴가·이중차감·예약 13/13 · 미리보기 6/6 · `--suite holidaycap`(3폭).
2027 노동절 대체공휴일(5/3)은 출처가 갈려 넣지 않았다 — 관보 확정 뒤 데이터셋에 추가.
