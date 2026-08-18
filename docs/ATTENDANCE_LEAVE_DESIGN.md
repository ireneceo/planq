# 출퇴근·휴가 관리 설계 (운영 피드백 #208 · #285)

> 작성: Fable 설계 게이트, 2026-08-18.
> 상태: **설계 확정 대기** — Irene 승인 후 Opus 구현 착수.
> 선행 사실: `docs/` 전수 확인 결과 이 기능의 설계·구현은 존재하지 않았다 (#285 답 — 밀린 게 아니라 시작된 적 없음).
> 백엔드·프론트에 attendance/leave 관련 코드 0건 확인 (routes/models/services grep 0건, 2026-08-18).

---

## 1. 범위와 비범위

**Irene 확정 1차 범위 (2026-08-18):**
1. 출퇴근 기록 — 시작/중지(휴게)/재개/종료, 유연근무제 기준 (고정 출근시각 강제 없음)
2. 휴가 — 관리자 연간 부여(유급) → 멤버 신청(유급/무급, 종일/반차/시간) → 승인/반려 → 잔여 관리
3. Q Task 주간 가용시간 연동 — 승인된 휴가가 그 주 가용시간을 자동 차감

**비범위 (제외 확정):**
- 급여 계산·연동 (BusinessMember.monthly_salary 는 존재하지만 근태와 연결하지 않는다)
- 법정 신고(근로기준법 연차 자동산정·수당·4대보험 등) — PlanQ 는 근태 **기록** 도구이지 노무 시스템이 아니다. 연차 일수는 관리자가 직접 부여한다(자동 산정 없음)
- 법정공휴일 캘린더 자동 반영 — 기존 `weekly_holidays` 수동 입력 유지 (§7.2)
- 지오펜싱/IP 제한 출퇴근 — 유연근무 철학과 충돌, 요구에도 없음

---

## 2. 기존 시스템과의 관계 (핵심 절단면)

### 2.1 FocusSession 과의 관계 — **별개 엔티티, 단방향 연동** (결정)

| | FocusSession (기존) | Attendance (신규) |
|---|---|---|
| 목적 | 업무별 몰입시간 → `task.actual_hours` | 근무일 기록 (근무/휴게/퇴근) |
| 공개 범위 | **본인만. owner/admin 도 못 봄** (`routes/focus.js:5`, PERMISSION_MATRIX §5.8 계열) | 본인 + owner/admin (관리 목적) |
| 단위 | 세션(업무 전환마다) | 하루(work_date) |
| 방치 처리 | heartbeat + 캡 (`FocusSession.computeActualSeconds`, models/FocusSession.js:20-43) | 명시 도장 + 미퇴근 자동마감 cron (§4.3) |

**세 가지 선택지 판정:**
- ~~포커스 합계로 출퇴근 대체~~ ❌ — 프라이버시 모델이 정반대다. Focus 는 "owner 도 못 보는" 개인 도구로 박제되어 있는데(WORK_FLOW_DESIGN.md:21 은 "출퇴근 도장" 컨셉을 의도적으로 회피하고 Focus 로 명명했다), 그 합계를 관리자 근태로 노출하면 기존 계약 파기다. 또 Focus 는 켜는 사람만 켠다(`focus_enabled` opt-in) — 근태의 전수성이 성립 안 함.
- ~~출퇴근이 포커스를 포함(부모-자식 FK)~~ ❌ — 출근 안 찍고 Focus 쓰는 기존 사용자가 즉시 깨진다. FK 결합은 개인 도구를 근태에 종속시킨다.
- **별개 테이블 + 행동 연동** ✅ — 데이터는 독립, UX 만 연결:
  - **(연동 A)** Focus `POST /start` 시 오늘 근태가 '미출근'이면 자동 출근 처리. 개인 설정 `auto_clock_in_on_focus` (기본 ON). 구현 위치: `routes/focus.js` POST /start 커밋 후 `attendanceTransition.clockIn(..., { source: 'auto_focus' })` 호출 (실패해도 focus 는 성공 — catch 후 무시).
  - **(연동 B)** 퇴근(clock-out) 시 본인의 active/paused Focus 세션 자동 stop (`end_reason: 'clock_out'` — FocusSession.end_reason 은 STRING(30) 이라 ENUM 변경 불필요, models/FocusSession.js:74-77).
  - **(연동 C)** 휴게 시작 시 active Focus 자동 pause (`auto_paused=true`). 휴게 종료 시 자동 resume 은 **하지 않는다** (업무 재개는 명시 행동 — Focus 기존 철학 유지).
  - 역방향(출근이 Focus 를 시작)은 없다. 출근 ≠ 업무 착수.
- 참여율 제안(U5, `routes/tasks.js:787-830` participation-suggestion)은 그대로 Focus 기반 유지 — 근태 시간으로 바꾸지 않는다(근태는 명목, Focus 가 실작업).

### 2.2 memberCapacity — **재사용 + 확장. 4번째 사본 금지** (결정)

정본: `services/memberCapacity.js` (2026-08-17 #288 통합본). 공식 1벌:
`weekly = daily_work_hours × (weekly_work_days − weekly_holidays) × participation_rate` (memberCapacity.js:33-36)

소비처 3곳 확인:
- `routes/tasks.js:133,246,798` (my-week / my-month / participation-suggestion)
- `services/weeklyReviewSnapshot.js:603,715` (워크스페이스 멤버 통계 + 개인 capacity)
- `services/reportUnitSnapshot.js:246-248` (기간 환산 `periodHours`)

휴가 차감은 **이 파일 안에** 새 함수로 추가하고(§7), 소비처가 옵션 인자를 넘겨 opt-in 한다. 별도 계산식 신설 절대 금지 (memory: feedback_same_value_multiple_formulas).

### 2.3 "근무타입 ↔ Q Task 기본세팅 동기화" (#208) — **같은 컬럼이 정본이므로 동기화 문제 자체를 제거**

근무일수/주·1일 기준시간은 이미 `business_members.daily_work_hours / weekly_work_days / participation_rate / weekly_holidays` (models/BusinessMember.js:73-89) 에 있고, 편집 라우트도 있다 (`PATCH /api/businesses/:id/members/:memberId/work-hours`, routes/businesses.js:1104-1125, 본인 또는 owner).
→ 근태 설정 화면은 **이 컬럼·이 라우트를 그대로 사용**한다. 새 컬럼·새 라우트 없음. "동기화" 는 저장소가 하나이므로 자동 성립.

### 2.4 상태 전이 단일 착지점 — `services/attendanceTransition.js` + `services/leaveTransition.js` 신설

`services/taskTransition.js` 패턴 준용 (가드·이력·notify·broadcast 를 한 곳에서). 라우트든 cron 이든 자동연동(§2.1)이든 전부 이 두 파일을 지난다. 인라인 전이 금지.

### 2.5 메뉴 권한 — **새 menu_key 를 추가하지 않는다** (결정)

`middleware/menu_permission.js` 의 11+1 메뉴는 "메뉴 숨김/읽기전용" 용도다. 출퇴근은 본인 필수 기능이라 level=none 이 성립하지 않고, 타인 기록 열람은 role(owner/admin) 축이다. 즉 근태의 권한 모델은 PERMISSION_MATRIX **§5.1(본인 데이터) + §5.5(조직 관리 owner/admin)** 로 이미 표현된다. `requireMenu` 불사용, `getUserScope`(middleware/access_scope.js:25) 로 role 판정.

---

## 3. 데이터 모델

신규 4 테이블. 전부 `business_id` 멀티테넌트 격리 + `underscored: true` + timestamps.

### 3.1 `attendance_days` — 하루 롤업 (조회 정본)

qnote_usage(롤업) + qnote_usage_events(원장) 선례 준용.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INT PK AI | |
| business_id | INT NOT NULL FK businesses | |
| user_id | INT NOT NULL FK users | |
| work_date | DATEONLY NOT NULL | 워크스페이스 tz 기준 날짜 (`Business.timezone`, 기본 Asia/Seoul) |
| state | ENUM('working','on_break','done') NOT NULL | 미출근 = row 없음. done 후 재출근 → 'working' 복귀 (스팬은 events 가 보존) |
| clock_in_at | DATETIME NOT NULL | 그날 **첫** 출근 시각 |
| clock_out_at | DATETIME NULL | 그날 **마지막** 퇴근 시각 (재출근 시 NULL 로 복귀) |
| break_started_at | DATETIME NULL | 현재 on_break 면 진입 시각 |
| work_total_sec | INT NOT NULL DEFAULT 0 | 근무 스팬 합 (events 재계산 결과, done/휴게 진입 시 갱신) |
| break_total_sec | INT NOT NULL DEFAULT 0 | 휴게 합 |
| auto_closed | BOOLEAN DEFAULT false | 미퇴근 자동마감 (§4.3) — UI 에 "자동 마감됨" 뱃지 + 관리자 정정 유도 |
| admin_fixed | BOOLEAN DEFAULT false | 관리자 정정 이력 있음 |
| note | VARCHAR(500) NULL | 본인 메모 (예: "외근") |

인덱스: UNIQUE(`business_id`,`user_id`,`work_date`) / (`business_id`,`work_date`) / (`user_id`,`work_date`).

### 3.2 `attendance_events` — append-only 원장 (감사·재계산 원천)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INT PK AI | |
| business_id / user_id | INT NOT NULL FK | |
| attendance_day_id | INT NOT NULL FK attendance_days | |
| kind | ENUM('clock_in','break_start','break_end','clock_out') NOT NULL | |
| at | DATETIME NOT NULL | 발생 시각. admin_fix 는 과거 시각 입력 가능 |
| source | ENUM('user','auto_focus','auto_close','admin_fix') NOT NULL DEFAULT 'user' | §2.1 연동 A = auto_focus |
| actor_user_id | INT NOT NULL FK users | 본인 또는 정정한 관리자 |
| fix_reason | VARCHAR(300) NULL | admin_fix 필수 |

인덱스: (`attendance_day_id`,`at`) / (`business_id`,`at`).
`work_total_sec` = kind 시퀀스에서 working 스팬 합산 — 재계산 함수는 `attendanceTransition.js` 안 1벌 (`recomputeDay(dayId)`), 정정 시에도 이걸로만 갱신.

### 3.3 `leave_grants` — 관리자 연간 부여 (유급 잔여의 원천)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INT PK AI | |
| business_id / user_id | INT NOT NULL FK | |
| year | INT NOT NULL | 부여 연도 (워크스페이스 tz 기준) |
| days | DECIMAL(4,1) NOT NULL | 부여 일수 (0.5 단위 허용). 정정은 row 추가(음수 허용)로 — 원장식, 기존 row 수정 금지 |
| note | VARCHAR(300) NULL | 사유 (예: "2026 연차", "리프레시 +2") |
| granted_by | INT NOT NULL FK users | |

인덱스: (`business_id`,`user_id`,`year`).
**잔여는 파생값 — 컬럼으로 저장하지 않는다** (receiptsDue 파생 원칙 동일): `잔여 = Σgrants(year).days − Σapproved requests(paid, 그 해).days_charged`.

### 3.4 `leave_requests` — 신청·승인

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INT PK AI | |
| business_id / user_id | INT NOT NULL FK | |
| leave_type | ENUM('paid','unpaid') NOT NULL | 유급=잔여 차감, 무급=차감 없음(승인만) |
| unit | ENUM('full_day','half_day','hours') NOT NULL | #208 "1일 기준 + 시간 기준" |
| start_date / end_date | DATEONLY NOT NULL | full_day 는 기간 가능, half_day/hours 는 start=end 강제 |
| half_kind | ENUM('am','pm') NULL | half_day 만 |
| hours | DECIMAL(4,1) NULL | hours 단위만 |
| days_charged | DECIMAL(5,1) NOT NULL | **승인 시점에 확정 박제** (§7.1 환산식). 이후 근무설정이 바뀌어도 불변 |
| reason | VARCHAR(500) NULL | |
| status | ENUM('pending','approved','rejected','canceled') NOT NULL DEFAULT 'pending' | |
| decided_by | INT NULL FK users / decided_at DATETIME NULL / decide_note VARCHAR(300) NULL | 승인·반려 기록 |
| canceled_by | INT NULL / canceled_at DATETIME NULL | |

인덱스: (`business_id`,`user_id`,`status`) / (`business_id`,`start_date`,`end_date`) — 가용시간 계산이 주간 겹침 조회를 친다.

### 3.5 기존 테이블 변경

- `users` +1: `auto_clock_in_on_focus BOOLEAN DEFAULT true` (§2.1 연동 A 개인 설정. focus_* 5컬럼 옆).
- `notification_prefs.event_kind` ENUM 에 **`'leave'` append** (models/NotificationPref.js:30-44 — 'system' 뒤에 추가).
- BusinessMember·FocusSession **무변경**.

### 3.6 마이그레이션 절차

1. dev: `node sync-database.js` — 신규 4 테이블 CREATE 는 안전. `users` 컬럼 추가 OK.
2. `notification_prefs.event_kind` ENUM append — sync-database 의 ENUM 재-ALTER 반복 함정(BusinessMember.role 주석 선례, models/BusinessMember.js:52-53) 회피 위해 **모델 ENUM 순서는 기존 끝에 append 로만**. 운영 배포 시 수동 ALTER 준비:
   `ALTER TABLE notification_prefs MODIFY event_kind ENUM(...기존 전체 순서 유지..., 'leave') NOT NULL;`
3. 백필 없음 (전 테이블 신규 — 과거 데이터가 애초에 없다). idempotent 확인: sync 재실행 시 ALTER 0건.
4. 운영 sync-alter 64키 한도(memory: feedback_sync_alter_too_many_keys) — 신규 테이블이라 무관하지만 배포 시 health-check 필수.

---

## 4. 상태 전이

### 4.1 출퇴근 (attendance_days.state) — 착지점 `services/attendanceTransition.js`

```
(row 없음: 미출근)
  ─ clockIn ──────→ working        허용: 본인 / auto_focus / admin_fix
working
  ─ breakStart ───→ on_break       허용: 본인 / admin_fix
  ─ clockOut ─────→ done           허용: 본인 / auto_close(cron) / admin_fix (연동 B: focus stop)
on_break
  ─ breakEnd ─────→ working        허용: 본인 / admin_fix
  ─ clockOut ─────→ done           휴게 중 퇴근 허용 (break 자동 종료 후 마감)
done
  ─ clockIn ──────→ working        재출근 (유연근무 — 저녁 재근무). clock_out_at NULL 복귀
```

가드: 같은 (user, biz, work_date) 트랜잭션 + `LOCK.UPDATE` (focus.js:127-147 패턴). 이중 clock-in 은 400 `already_working`. 모든 전이는 ①event insert ②day 재계산 ③AuditLog ④broadcast(§9) ⑤(clockOut 시) focus stop 을 한 함수 안에서.

**타 워크스페이스 동시 출근**: 출퇴근은 워크스페이스 단위(BusinessMember 계약 단위)다. cross-workspace 상호배제는 두지 않는다 — 겸직 멤버는 각자 기록.

### 4.2 휴가 (leave_requests.status) — 착지점 `services/leaveTransition.js`

```
pending ─ approve → approved      owner/admin (본인 신청 자가승인 금지 — owner 는 예외 허용: 워크스페이스에 다른 관리자가 없을 수 있다)
pending ─ reject  → rejected      owner/admin
pending ─ cancel  → canceled      본인
approved ─ cancel → canceled      시작일 전: 본인 / 시작일 후: owner/admin 만 (기록 정정 성격)
```

- approve 시 `days_charged` 확정(§7.1) + 유급이면 잔여 검사(`잔여 < days_charged` → 400 `insufficient_leave_balance`). 잔여 검사·차감 판정은 leaveTransition 한 곳.
- approved 취소 시 잔여 자동 복원(파생값이라 별도 쓰기 없음 — status 만 바뀌면 Σ에서 빠진다).
- 기간 겹침: 같은 user 의 approved/pending 과 날짜 겹치면 400 `overlapping_leave`.

### 4.3 미퇴근 자동마감 cron

`services/attendanceAutoClose.js` — 매시 정각 실행(기존 cron 서비스 파일 패턴: services/calendarReminderCron.js 등). 워크스페이스 tz 기준 **전날** 의 state IN ('working','on_break') row 를:
- clock_out = max(마지막 attendance_event.at, 본인 그날 마지막 FocusSession.last_activity_at) — [주의] focus 시각은 마감 시각 추정에만 쓰고 노출하지 않는다(프라이버시 침해 아님: 본인 row 마감용).
- `auto_closed=true` 마크, event source='auto_close'. 관리자/본인이 admin_fix/메모로 정정.

---

## 5. API

신규 라우트 파일 2: `routes/attendance.js` (`app.use('/api/attendance', ...)`), `routes/leave.js` (`/api/leave`). server.js 마운트는 `/api/focus`(server.js:390) 옆.
공통: `authenticateToken` + business_id 는 `getUserScope` 로 멤버십 검증 (client·ai role 전부 403). 응답은 `successResponse/errorResponse`, 목록은 `parsePagination + paginatedResponse` (default 200 / max 500).

### 5.1 출퇴근

| 메서드·경로 | 권한 | 설명 |
|---|---|---|
| GET `/api/attendance/today?business_id=` | 본인 | 오늘 day row(없으면 null) + state + 진행 중 work_total_sec 실시간 계산 |
| POST `/api/attendance/clock-in` `{business_id}` | 본인 | → attendanceTransition. rate-limit 분당 10 (focus startStopLimiter 패턴, keyGenerator user 버킷) |
| POST `/api/attendance/break-start` / `break-end` / `clock-out` `{business_id}` | 본인 | 동일 |
| GET `/api/attendance/my?business_id=&from=&to=` | 본인 | 내 일별 기록 목록 (pagination) |
| GET `/api/attendance/team?business_id=&date=` 또는 `&week=` | **owner/admin** | 전 멤버 일별 기록 + 합계 (§6 프라이버시) |
| GET `/api/attendance/presence?business_id=` | 멤버 전원 | 전 멤버 **상태 뱃지만** {user_id, state, on_leave_today} — 시각·수치 없음 |
| PATCH `/api/attendance/days/:id` `{events: [...], fix_reason}` | **owner/admin** | 정정 — event(source='admin_fix') append + 재계산. fix_reason 필수 |
| GET `/api/attendance/stats?business_id=&month=` | owner/admin 전체 / member 본인만 | §8 통계 |
| GET/PUT `/api/attendance/settings` | 본인 | `auto_clock_in_on_focus` (focus /settings 패턴) |

### 5.2 휴가

| 메서드·경로 | 권한 | 설명 |
|---|---|---|
| GET `/api/leave/grants?business_id=&user_id=&year=` | owner/admin 전체 / member 본인 | 부여 이력 |
| POST `/api/leave/grants` `{business_id,user_id,year,days,note}` | **owner/admin** | days 음수 허용(정정). AuditLog |
| GET `/api/leave/balance?business_id=&year=[&user_id=]` | 본인 / owner·admin 은 user_id 지정 가능 | `{granted, used, pending, remaining}` — 전부 파생 계산 |
| POST `/api/leave/requests` | 본인 | 신청. 유급이면 잔여−pending 사전 검사(안내용 — 확정 검사는 approve 시) |
| GET `/api/leave/requests?business_id=&status=&scope=mine\|all&year=` | scope=all 은 owner/admin | pagination. all 은 승인함 |
| POST `/api/leave/requests/:id/approve` / `reject` `{decide_note}` | **owner/admin** | → leaveTransition |
| POST `/api/leave/requests/:id/cancel` | §4.2 규칙 | |

notify (`routes/notifications.js` notify/notifyMany, event_kind='leave', CLAUDE.md 운영안정성 13번 — 전이 라우트 notify 강제):
- 신청 → 해당 biz 의 owner/admin 전원 notifyMany
- 승인/반려/관리자취소 → 신청자 notify
- 검증: node test 스크립트로 신청 POST 후 push_logs row ≥ 1 확인.

---

## 6. 열람 범위 (개인정보)

| 데이터 | 본인 | member(동료) | owner/admin | client |
|---|:---:|:---:|:---:|:---:|
| 내 출퇴근 시각·시간·휴게 | ● | - | ● | - |
| 동료 presence 뱃지 (근무중/휴게/퇴근/휴가중) | ● | ● | ● | - |
| 휴가 신청·잔여 (수치) | 본인 것 | - | ● | - |
| FocusSession | 본인 것 | - | **-** (기존 계약 유지) | - |

- presence 뱃지는 열린 문화(§1) + 협업 필요("휴가중인 줄 모르고 컨펌 요청") 절충 — **시각·누계는 절대 미포함**. 응답 serializer 를 분리해 team 용과 presence 용이 다른 필드 셋을 갖게 한다 (민감정보 §6 패턴).
- 모든 라우트 WHERE 에 `business_id` — 겸직 사용자의 타 워크스페이스 기록 격리.
- AuditLog: clock 전이·grants·approve/reject/cancel·admin_fix 전건 기록 (old/new JSON).

---

## 7. 가용시간 연동 (정확한 공식)

### 7.1 휴가 → 차감일 환산 (승인 시점 박제)

`days_charged` 계산 (leaveTransition.approve 안, 그 시점의 BusinessMember 설정 사용):
- full_day: 기간 내 **날짜 수를 그대로** (주말 제외 판단은 하지 않는다 — 근무일 개념이 weekly_work_days "일수" 뿐이고 요일 매핑이 없다. 신청 UI 가 "근무일만 선택" 안내. [한계 명시] 요일제 근무 캘린더는 비범위)
- half_day: 0.5
- hours: `hours ÷ daily_work_hours` (소수 1자리 반올림, 예: 2h ÷ 8h = 0.3)

### 7.2 memberCapacity 확장 — `services/memberCapacity.js` 에 추가 (사본 금지)

```js
// 신규 — 기존 함수 시그니처 불변 (소비처 무변경 시 기존값 그대로 = 회귀 0)
async function getLeaveDaysInRange(userId, businessId, startYmd, endYmd) {
  // approved leave_requests 중 [start,end] 와 겹치는 날짜별 차감일 합.
  // full_day: 겹치는 날짜 수 × 1 / half_day: 0.5 / hours: days_charged (단일일이므로 그대로)
  // 기간에 걸친 full_day 는 일할: days_charged × (겹친일수/전체일수)
}
async function getMemberCapacityForWeek(userId, businessId, weekStartYmd) {
  const cap = await getMemberCapacity(userId, businessId);       // 기존 정본
  const leaveDays = await getLeaveDaysInRange(userId, businessId, weekStartYmd, addDays(weekStartYmd, 6));
  const deduction = Math.round(cap.daily * cap.rate * leaveDays * 10) / 10;
  const weekly_effective = Math.max(0, Math.round((cap.weekly - deduction) * 10) / 10);
  return { ...cap, leave_days: leaveDays, leave_deduction: deduction, weekly_effective };
}
```

수학적 동치: `weekly − daily×rate×L = daily×(days−holidays−L)×rate` — 즉 "휴가일은 휴일과 같은 방식으로 근무일에서 빠진다". 기간(월간)은 `periodHours(weekly, start, end) − daily×rate×getLeaveDaysInRange(start,end)` clamp 0 — 같은 파일의 `periodHoursWithLeave(userId, businessId, start, end)` 헬퍼로 1벌.

**`weekly_holidays` 와의 이중차감 방지**: weekly_holidays 는 "공휴일 등 워크스페이스 공통 휴일" 용도로 유지, 개인 휴가는 leave 로. QTaskPage 가용시간 패널의 휴일 입력 옆에 안내 문구("개인 휴가는 휴가 신청으로 — 자동 반영됩니다") + 그 주에 내 approved 휴가가 있으면 뱃지 표시. 강제 차단은 하지 않는다(공휴일과 휴가가 같은 주에 공존 가능).

### 7.3 소비처 변경 (3곳 동시 — 화면과 보고서가 같이 움직인다)

| 소비처 | 변경 | 값 변화 |
|---|---|---|
| `routes/tasks.js:133` my-week | `getMemberCapacityForWeek(userId, businessId, monday)` 로 교체, 응답 `capacity` 에 `weekly_effective/leave_days` 추가 (기존 키 유지 — frontend 호환) | 휴가 있는 주만 |
| `routes/tasks.js:246` my-month | 주별 루프에서 week 단위 effective 사용 | 〃 |
| `weeklyReviewSnapshot.js:603` (워크스페이스 멤버 통계) · `:715` (개인) | 대상 주 monday 전달 → effective 사용 | 〃 |
| `reportUnitSnapshot.js:246` | `periodHoursWithLeave` 로 교체 (박제 원칙 유지 — 생성 시점 값 고정) | 〃 |
| `routes/tasks.js:798` participation-suggestion | **무변경** — 명목시간(rate 제외) 분모는 휴가 차감하면 참여율이 왜곡 상승. 4주 창이라 영향 미미, 의도적 제외 명시 |

**회귀 판정**: 휴가 데이터가 없는 멤버는 `getLeaveDaysInRange = 0` → `weekly_effective === weekly` → **전 소비처 기존 값과 diff 0**. Fable 구현 게이트에서 교차 표면(화면 my-week vs 주간보고 vs 월간보고) diff 0 + 휴가 1건 승인 후 세 표면이 **동일하게** 줄어드는지 실호출 검증 필수.

### 7.4 진척 그래프(#288 계열)와의 정합

가용선·가용 페이스(WORK_FLOW_DESIGN §6)는 my-week 의 capacity 를 그대로 그리므로 `weekly_effective` 를 쓰면 자동 정합. 프론트 QTaskPage 가 capacity 로 재계산하는 곳이 있는지 grep 후(memberCapacity.js:5-6 주석의 옛 병리) **표시값은 서버 계산 1벌**만 쓰게 정리.

---

## 8. 통계 (#285 "필요한 정보 취합")

### 8.1 집계 항목 (`GET /api/attendance/stats?business_id=&month=`)

멤버별 (owner/admin 은 전원, member 는 본인):
- `work_days` (출근일수) · `work_hours` (Σwork_total_sec) · `break_hours`
- `avg_clock_in` / `avg_clock_out` (유연근무 패턴 파악 — 지각 판정 아님)
- `overtime_hours` = Σ max(0, 일 근무시간 − daily_work_hours) — 초과 참고치 (법정 아님, 라벨에 명시)
- `leave_used_paid / leave_used_unpaid / leave_remaining` (그 해 기준)
- `auto_closed_count` (미퇴근 마감 건수 — 데이터 품질 신호)
- 부서별 롤업: BusinessMember.department_id 그룹 합계

### 8.2 노출 위치

1. **`/attendance` 페이지 안 탭** (§9) — 1차 정본. 개인 "내 통계" + 관리 "팀 통계".
2. **Insights 신규 `AttendanceTab`** (owner/admin 전용, `dev-frontend/src/pages/Insights/tabs/` 7탭 옆) — 팀 통계 재사용 뷰. Phase 3.
3. **워크스페이스 주간보고** (`weeklyReviewSnapshot` 멤버 통계에 `leave_days` 필드 동봉 — "이 주 캐파가 왜 줄었나" 설명) — Phase 3. snapshot JSON schema_version 증가 없이 additive 키만.

---

## 9. UI / 화면

i18n: 신규 네임스페이스 **`attendance`** (ko/en 동시 작성, `i18n.ts` ns 등록). 아래 문구는 ko 안이며 en 동시 작성 필수.

### 9.1 사이드바 — 출퇴근 미니 위젯 (FocusWidget 위, SidebarClock 아래)

```
[미출근]   ( ▶ 근무 시작 )                      ← Primary 톤 버튼 1개
[근무중]   ● 근무중 3:42  ( ⏸ 휴게 ) ( ■ 퇴근 )   ← 경과는 clock_in 기준 실시간
[휴게중]   ⏸ 휴게 0:12   ( ▶ 재개 ) ( ■ 퇴근 )
[퇴근]     ✓ 오늘 7.5h    ( ▶ 재개 근무 )
```
- Focus 4-상태 토큰(WORK_FLOW_DESIGN §6.5) 색상 재사용, 별도 bespoke 금지 (memory: feedback_copy_existing_design_not_bespoke).
- `data-testid`: `attn-clock-in` / `attn-break` / `attn-resume` / `attn-clock-out` (검사 하니스 17번).
- 중복 제출 가드 `submitting` + disabled.

### 9.2 모바일 (실사용 핵심)

- 모바일(≤640px)에서는 사이드바가 접히므로 **Dashboard/Todo 첫 화면 최상단에 출퇴근 카드** 고정 — 위젯과 동일 상태·동일 핸들러 공유(컴포넌트 1벌, 배치만 2곳). 버튼 터치 타겟 **48×48 이상**, 카드 전체 폭.
- PWA 실행 직후 2탭 이내 출근 완료가 목표: 앱 열기 → 카드의 "근무 시작" 1탭.
- 연동 A(auto_clock_in_on_focus) 덕에 Focus 로 하루를 시작하는 사용자는 출근 도장을 아예 안 눌러도 된다 — 자연스러운 연결(#285)의 실체.

### 9.3 `/attendance` 페이지 (PageShell 단일 컬럼, 사이드바 메뉴 "근태" 추가)

```
PageShell title="근태" actions=[월 선택 ◀ 2026-08 ▶]
  탭: [내 기록] [휴가] [팀 관리*]        *owner/admin 만 노출
  ── 내 기록 ──
  주간 요약칩: 이번 주 32.5h · 휴게 4.2h · 휴가 1일
  일별 테이블: 날짜 | 출근 | 퇴근 | 휴게 | 근무시간 | 상태(자동마감 뱃지)
  ── 휴가 ──
  잔여 카드: 2026 유급 15일 부여 · 사용 4 · 대기 1 · 잔여 10
  [+ 휴가 신청] → DetailDrawer (유형 paid/unpaid · 단위 종일/반차/시간 · 날짜 SingleDateField · 사유)
  내 신청 리스트 (status 뱃지, pending 은 취소 버튼) — URL 싱크 ?leave=:id
  ── 팀 관리 (owner/admin) ──
  승인함: pending 신청 카드 [승인][반려]           ← Primary/Danger 톤
  연간 부여: 멤버 테이블 (부여일수 인라인 +부여 버튼 → 모달)
  팀 현황: 오늘 presence + 일별 기록 (member 행 클릭 → 상세 drawer)
  팀 통계: §8.1 표 + 부서별 롤업
```
- 신청 drawer 는 `DetailDrawer` 프리미티브 + 3훅(useBodyScrollLock/useFocusTrap/useEscapeStack). 신청/부여 폼은 제출 액션형이라 저장 버튼 사용(AutoSaveField 예외 — 청구서 작성과 같은 분류). `auto_clock_in_on_focus` 토글·work-hours 설정은 AutoSaveField.
- 근무 기준(1일 시간·주 근무일수) 편집 UI: 이 페이지 팀 관리 탭에서 기존 `PATCH work-hours` 라우트 호출 — QTaskPage 가용시간 패널과 같은 값이 보이는지가 "Q Task 동기화" 의 수용 기준.

### 9.4 연결 표면

- Q Task 가용시간 패널: `weekly_effective` 표시 + "휴가 −4h" 내역 행.
- TaskDetailDrawer/멤버 선택 등에서 presence 뱃지(휴가중) 노출은 Phase 3 검토 (1차 비포함 — 절단면 최소화).

---

## 10. 실시간 반영 (CLAUDE.md 운영안정성 16번 — 5요소)

- **(a)** `/attendance` 페이지·위젯 mount 시 기존 socket + `join:business` 재사용 (TodoPage 패턴).
- **(b)** broadcast — attendanceTransition: `io.to('business:{id}').emit('attendance:updated', {user_id, work_date, state})` (수치 미포함 — presence 용 최소 payload. 수치는 각자 재조회). leaveTransition: `leave:updated` {request_id, user_id, status}.
- **(c)** listener: presence·팀 현황은 즉시 state merge, 목록·통계는 250ms debounce silentLoad(server fresh 교체).
- **(d)** `useVisibilityRefresh(silentLoad)` — 위젯·페이지 양쪽.
- **(e)** 같은 탭 안전망: 위젯에서 clock 액션 시 `window.dispatchEvent(new CustomEvent('attendance:refresh'))` → 모바일 카드/페이지 동기 (두 표면이 동시에 mount 될 수 있다).
- 검증: 2탭(A 출근 → B 관리자 팀현황 ≤1초 반영) + 모바일 background 5분 시나리오.

---

## 11. 리스크 · 절단면 · 구현 순서

### 깨질 수 있는 지점
1. **capacity 소비처 부분 적용** — 3곳 중 1곳만 weekStart 를 넘기면 #288(화면 30h vs 보고서 40h)이 그대로 재발한다. **한 커밋에서 3곳 동시 전환 + 교차 표면 diff 검증**이 게이트 조건.
2. **weekly_holidays 이중차감** — 사용자가 휴가 승인 후 휴일도 +1 하면 이중 차감. 1차는 UI 안내로 완화(§7.2), 신고 오면 그때 자동보정 검토.
3. **auto_focus 자동 출근의 tz 경계** — work_date 는 반드시 `Business.timezone` 기준(`dateStrInTz` 재사용, routes/tasks.js:35 getWorkspaceTz). 자정 넘어 focus 시작 시 어제 row 에 붙는 버그 주의.
4. **재출근(done→working)** — clock_out_at 을 NULL 로 되돌리므로 "퇴근시각" 소비처는 항상 events 의 마지막 clock_out 을 봐야 한다. 롤업 재계산 함수 1벌 원칙으로 차단.
5. **notify 누락** (운영안정성 13번 실사례 계열) — leave 전이 4종 모두 leaveTransition 안에서 notify. 라우트 인라인 금지.
6. **ENUM append 운영 ALTER** — §3.6. 배포 게이트에서 수동 ALTER 포함 여부 확인.

### 구현 순서 (각 단계가 그 자체로 완결 — MVP 아님 원칙: 단계마다 실 API 검증 + Fable 게이트)
- **Phase 1 — 출퇴근 코어**: 테이블 2 + attendanceTransition + 라우트(clock 4종·today·my·presence·team·정정) + cron 자동마감 + 사이드바 위젯 + 모바일 카드 + 실시간 + i18n. → 이 시점부터 근태 기록으로 실사용 가능.
- **Phase 2 — 휴가**: 테이블 2 + leaveTransition + 라우트 전체 + `/attendance` 페이지(3탭) + notify('leave' ENUM) + Focus 연동 A/B/C.
- **Phase 3 — 가용시간·통계**: memberCapacity 확장 + 소비처 3곳 동시 전환 + stats 라우트 + Insights AttendanceTab + 주간보고 leave_days 동봉.
- 각 Phase 종료 시 검증: login → 전이 CUD → 재조회 값 일치, 권한별 403(member 가 team/approve 호출), 2탭 실시간, `node scripts/health-check.js` + `npm run build` + guard-invariants(i18n/parity).

### Irene 결정 필요 (구현 전 확답)
- **Q1. 부서장 승인 라인** — 현 설계는 owner/admin 만 승인. `Department.lead_user_id` 는 "권한 축 아님" 으로 박제되어 있어(models/Department.js:2-3) 부서장 승인을 넣으려면 그 원칙을 깨야 한다. 1차 owner/admin 으로 가는 안에 동의하는지.
- **Q2. presence 뱃지 공개 범위** — 동료에게 "근무중/휴가중" 상태만 보이는 §6 안 확인.
- **Q3. 사이드바 메뉴명** — "근태" vs "출퇴근" (en: Attendance). 문서는 "근태" 가정.
