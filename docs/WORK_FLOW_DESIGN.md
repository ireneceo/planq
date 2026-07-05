# 업무 흐름 (Work Flow) 통합 설계
> 2026-05-18 · 사이클 N+26 신규 시스템 설계
>
> 사용자 핵심 요청:
> 1. 업무 실제시간 일시정지·재개 + 적극 활용 UI
> 2. 근무 시작/종료/일시정지 표시 (좌측 사이드바 상시)
> 3. 로그인 시 "오늘 시작" 모달 — 마감 임박·확인요청 업무로 한 번에 진입
> 4. 유휴 감지 → 일시정지/종료 권유
> 5. 이 기능은 **사용자가 명시 설정한 경우에만** 작동 (default OFF)
> 6. 주간 보고 공유 권한 (워크스페이스 멤버끼리 자동 공유 X)
> 7. 자동 확정 요일·시각 설정
> 8. 통합 설정 페이지 신설 — "업무 관리"
> 9. 워크스페이스 주간보고 페이지 안내 + 설정 진입점

---

## 0. 30년차 관점 — 명명·컨셉 결정

| 사용자 표현 | 채택 명명 | 이유 |
|------|---------|------|
| "근무 시작/종료" | **포커스(Focus)** 세션 | "출퇴근/근태 기록"은 부담. PlanQ 의 Cue 컨셉과 결 맞춤 (가볍게) |
| "업무 시간 추적" | **업무 흐름(Work Flow)** | 메뉴/페이지 명. 기능 본질을 정확히 |
| "팝업으로 적극 누르게" | **첫 진입 1회 모달 + 좌측 사이드바 상시 위젯** | 자주 뜨는 팝업은 빠르게 dismiss → 학습되어 무력화. 위젯은 항상 보이지만 부담 없음 |
| "잠시 멈추기 / 다시 시작" | **일시정지 / 재개** (4-state 머신) | idle / active / paused / stopped |
| "유휴 감지 시 팝업" | **사이드바 위젯 색 변경 + 인라인 prompt** (모달 X) | 자리 비웠다 돌아온 사용자에게 모달은 더 부담 |
| "박제" (개발자 용어) | **"확정"** | "마감"은 task due_date 와 충돌, "정리"는 모호, "발행"은 외부 공개 함의. "확정"이 의미 정확 (변경 못 함 + 스냅샷 보존) |

**브랜드 일관성**: Q시리즈 컨셉 — 워크플로우 ≠ Q 메뉴 추가하지 않음. 기능은 **Q Task 내부 + 사이드바 위젯** 으로 자연스럽게 흡수. 별도 메뉴 X.

---

## 1. 사용자 시나리오 — 일일 흐름

### A. 아침 진입 (포커스 OFF 상태, 사용자가 설정에서 활성화 ON 시킨 후)

```
사용자 PWA/웹 진입 → /inbox 또는 /dashboard 도착
  ↓ (active focus 없음 + daily_start_prompt=ON + 오늘 한 번도 안 뜸)
[모달] "오늘 시작하시겠어요?"
  ├ 마감 임박 (오늘·내일) — 3개까지
  ├ 확인 요청 받은 업무 — 2개까지
  ├ 지연된 업무 — 2개까지
  ├ [업무 카드 클릭] → 그 업무로 포커스 시작 + 모달 닫힘
  ├ "지금 시작 안 함" → 모달 닫힘 (위젯은 idle 상태로 유지)
  └ "오늘 안 보기" 체크박스 → daily_start_prompt 오늘 하루 disable
```

### B. 업무 진행 (포커스 ON, 작업 중)

```
좌측 사이드바 SidebarClock 아래:
┌─────────────────────────────┐
│ ● 포커스 중                 │  ← 녹색 dot, 라벨
│ "Q docs PDF 출력 개선"      │  ← 진행 중 task 제목 (1줄 ellipsis)
│ 1h 24m · 12:34 부터         │  ← 경과 + 시작 시각
│ [⏸ 일시정지] [↗ 보기]       │  ← 작은 버튼 2개
└─────────────────────────────┘

TaskDetailDrawer 헤더 (해당 task 열었을 때):
┌────────────────────────────────────────┐
│ Q docs PDF 출력 개선                   │
│ [▶ 포커스 시작]  ← 비활성 시           │
│ [⏸ 일시정지 (1h 24m)] [⏹ 종료]  ← 진행 시 │
│ [▶ 재개 (1h 24m)] [⏹ 종료]  ← 일시정지 시 │
└────────────────────────────────────────┘
```

### C. 유휴 감지 (default 임계 15분)

```
14:00 마지막 활동 (마우스/키보드/터치)
14:15  ↓ 15분 무활동 → 사이드바 위젯 color amber
       작은 micro-bubble "잠시 자리 비우셨네요"
14:30  ↓ 30분 무활동 → 자동 일시정지 + AuditLog
       (사용자 다시 활동 시 위젯에서 "재개 / 누적해서 진행" 선택)

→ 사용자가 자리 돌아옴 (마우스 움직임 감지):
   ┌─ 위젯 안 prompt ────────────────┐
   │ 15분 자리 비웠어요              │
   │ [그 시간 빼기] [계속 진행]      │
   └────────────────────────────────┘
```

### D. 종료

```
사이드바 위젯 ⏹ 종료 클릭 → confirm modal
  "오늘 업무를 마칠까요? (1h 24m 누적)"
  [네 종료] [취소]

또는 PWA 닫힘 / 로그아웃 시 자동 종료 (focus_session.end_at = NOW)
```

---

## 2. 데이터 모델

### 2.1 신규 테이블 — `focus_sessions`

```sql
CREATE TABLE focus_sessions (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  user_id         INT NOT NULL,
  business_id     INT NOT NULL,            -- 어느 워크스페이스에서 시작했는지
  task_id         INT NULL,                -- NULL = 무지정 일반 포커스, 있으면 특정 업무
  state           ENUM('active','paused','stopped') NOT NULL DEFAULT 'active',
  started_at      DATETIME NOT NULL,
  ended_at        DATETIME NULL,           -- stopped 시 set
  pause_total_sec INT NOT NULL DEFAULT 0,  -- 누적 일시정지 시간 (초)
  paused_at       DATETIME NULL,           -- 현재 paused 면 진입 시각
  last_activity_at DATETIME NULL,          -- 유휴 감지 기준
  auto_paused     BOOLEAN DEFAULT FALSE,   -- 유휴로 자동 paused 인지
  end_reason      VARCHAR(30) NULL,        -- 'manual' / 'auto_idle' / 'logout' / 'browser_close'
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_state (user_id, state),
  INDEX idx_user_task (user_id, task_id),
  INDEX idx_biz_date (business_id, started_at)
);
```

**불변식**:
- 한 user 의 active/paused row 는 동시 최대 1개 (라우트 가드).
- 활성 시 `task_id` 변경 = 이전 session stop + 새 session start (race 없는 atomic 트랜잭션)
- `actual_seconds = (ended_at - started_at) - pause_total_sec` (View 또는 응답 계산 필드)

### 2.2 신규 컬럼 — `users` (개인 설정)

```sql
ALTER TABLE users
  ADD COLUMN focus_enabled        BOOLEAN     DEFAULT FALSE COMMENT 'Focus 기능 ON/OFF (default OFF)',
  ADD COLUMN focus_idle_min       INT         DEFAULT 15    COMMENT '유휴 감지 임계 (분)',
  ADD COLUMN focus_auto_pause_min INT         DEFAULT 30    COMMENT '자동 일시정지 시간 (분)',
  ADD COLUMN focus_daily_prompt   BOOLEAN     DEFAULT TRUE  COMMENT '아침 진입 시 시작 모달 (focus_enabled=true 일 때만 효과)',
  ADD COLUMN focus_prompt_last_dismissed_date DATE NULL     COMMENT '"오늘 안 보기" 체크 시점';
```

### 2.3 신규 컬럼 — `businesses` (워크스페이스 자동확정 설정)

```sql
ALTER TABLE businesses
  ADD COLUMN weekly_finalize_dow  TINYINT  DEFAULT 1  COMMENT '자동 확정 요일 (0=일~6=토). default 1=월요일 00시 = 지난 주 마감',
  ADD COLUMN weekly_finalize_hour TINYINT  DEFAULT 0  COMMENT '자동 확정 시각 (0-23 시). default 0 (자정 직후)',
  ADD COLUMN weekly_finalize_enabled BOOLEAN DEFAULT TRUE COMMENT '자동 확정 ON/OFF (워크스페이스 단위 일괄)';
```

### 2.4 멤버 권한 — `business_member_permissions.menu_key` 확장

```
기존 9종: qtalk · qtask · qnote · qdocs · qbill · qcalendar · qfile · clients · insights
추가:    qmail (이미 N+21 hotfix) · qinfo (이미 N+21 hotfix) · 
        ★ weekly_team (신규) — 워크스페이스 통합 주간보고 read 권한
```

**weekly_team 정책**:
- default `none` (멤버에게 자동 공유 X — 사용자 요구)
- owner / admin = 자동 write
- owner 가 명시적으로 멤버에게 `read` 부여하면 그 사람도 봄
- `BusinessWeeklyReport` GET 라우트 = `requireMenu('weekly_team', 'read')`
- 개인 주간보고 `WeeklyReview` 는 별개 — 본인만 R/W (owner/admin 도 못 봄. 사적 공간)

---

## 3. UI 설계 — 컴포넌트별 와이어

### 3.1 SidebarClock 아래 — `FocusWidget`

위치: `components/Layout/MainLayout.tsx` 의 SidebarClock 바로 다음. focus_enabled=false 일 때 **렌더 자체 X** (가벼움 보장).

```
┌─ 상태 idle ──────────────────┐
│ 💤 업무 흐름                  │
│ 시작할 업무를 골라주세요       │
│ [+ 시작]  ▼ 추천 3개          │
└─────────────────────────────┘

┌─ 상태 active ────────────────┐
│ ● 포커스 중   12:34부터       │  ← Primary teal dot
│ Q docs PDF 출력 개선          │  ← task title 1줄
│ 1h 24m 누적                  │
│ [⏸ 잠시] [⏹ 종료] [↗]        │  ← 36×36 icon btns
└─────────────────────────────┘

┌─ 상태 paused ────────────────┐
│ ⏸ 잠시 멈춤   (8m 째)         │  ← Amber dot
│ Q docs PDF 출력 개선          │
│ 1h 24m 누적                  │
│ [▶ 재개] [⏹ 종료] [↗]         │
└─────────────────────────────┘

┌─ 상태 idle_detected (자동) ──┐
│ ⚠ 자리 비우셨나요?           │  ← Warning amber bg
│ 14:00 부터 15분 무활동        │
│ [그 시간 빼기] [계속 진행]    │
└─────────────────────────────┘
```

**Collapsed 사이드바**: 위젯 자리에 **점 1개** (idle gray / active teal / paused amber) — 클릭하면 펼침 popover

### 3.2 TaskDetailDrawer 헤더 — Focus 버튼

기존 헤더 (제목 + 메타) 옆 또는 아래 한 줄 추가:

```
┌──────────────────────────────────────────┐
│ Q docs PDF 출력 개선             [⋮] [×] │
│ ─────────────────────────────────────── │
│ 담당: Irene · 마감: 5/22 · 진행: 60%    │
│ ─────────────────────────────────────── │
│ [▶ 포커스 시작]                          │  ← idle, primary CTA
│   또는                                   │
│ [⏸ 잠시 (1h 24m)] [⏹ 종료]               │  ← active
│   또는                                   │
│ [▶ 재개 (1h 24m)] [⏹ 종료]                │  ← paused, 같은 task
│   또는                                   │
│ "🔵 [다른 업무] 포커스 중 — 전환 시 자동 종료" │  ← 다른 task active
│   [▶ 이 업무로 전환]                     │
└──────────────────────────────────────────┘
```

**핵심 UX**:
- 다른 업무 포커스 중에 이 drawer 열면 → 그쪽 누적 알림 + 전환 버튼
- 전환 클릭 = 이전 session stop + 새 session start (1 트랜잭션)

### 3.3 "오늘 시작" 모달 — `DailyStartModal`

진입 트리거:
- focus_enabled=true AND focus_daily_prompt=true
- focus_prompt_last_dismissed_date != 오늘
- 활성 focus_session 없음
- 페이지가 /inbox 또는 /dashboard 또는 첫 로그인 직후

```
┌─ Modal (560px, 모바일 full) ──────────────────┐
│ 오늘 시작하기                          [×]    │
│ ─────────────────────────────────────────── │
│ 오늘 마감 / 확인 요청 받은 업무를 모았어요.   │
│ 아래에서 골라 시작하거나, 비워두고 닫아도 OK.│
│                                             │
│ 🔥 오늘 마감 (2)                            │
│ ┌─────────────────────────────────────────┐ │
│ │ [▶] Q Bill 외화 청구 검수    오늘 18:00 │ │  ← row 클릭 = 시작
│ │ [▶] 디자인 시안 컨펌         오늘 21:00 │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ 👀 확인 요청 받음 (1)                       │
│ ┌─────────────────────────────────────────┐ │
│ │ [▶] PlanQ 로고 컨펌                     │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ⏰ 지연된 업무 (2)                          │
│ ┌─────────────────────────────────────────┐ │
│ │ [▶] Q Note 화자 통합     2일 지연       │ │
│ │ [▶] PR 코멘트 처리       4일 지연       │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ─────────────────────────────────────────── │
│ ☐ 오늘 다시 보지 않기   [닫기] [업무 보기]  │
└─────────────────────────────────────────────┘
```

각 업무 행 클릭 = `POST /api/focus/start { task_id: X }` + 모달 닫힘 + (선택) 그 task drawer 자동 오픈.

### 3.4 설정 페이지 — `/business/settings/work-flow` (신규)

기존 워크스페이스 설정 메뉴에 **"업무 관리"** 추가. URL 은 `work-flow`.

```
설정 > 업무 관리
─────────────────────────────────────────
[ 섹션 1 ] 주간 보고 자동 확정 (워크스페이스 공통)
  자동 확정 활성:        [●━━━] ON
  요일·시각:             매주 [월요일 ▼] [00:00 ▼]
                       (지난 주 데이터를 이 시점에 확정)
  마지막 확정:           2026-05-13 00:00 (16건)
  다음 확정:             2026-05-20 00:00 (예정)
  [이번 주 확정하기]        ← owner/admin only

[ 섹션 2 ] 워크스페이스 통합 주간보고 보기 권한
  멤버별로 통합 보고를 볼지 설정. owner/admin 은 자동 전체 권한.
  ┌────────────────┬───────────────────────────┐
  │ 멤버            │ weekly_team               │
  ├────────────────┼───────────────────────────┤
  │ 김미정 (owner)  │ ●전체 (자동)              │
  │ 이루아 (admin)  │ ●전체 (자동)              │
  │ 박지원          │ ○ 안 보기 ●보기 only      │
  │ ...                                          │
  └────────────────┴───────────────────────────┘
```

개인 설정 (`/profile` 의 새 섹션 "내 업무 흐름"):
```
[ 섹션 ] 내 업무 흐름 (Focus)
  포커스 추적 활성:      [○━━━] OFF (default)
  ─ 활성화 시 좌측 사이드바에 진행 상태 위젯이 나타나요 ─

  활성화 시 추가 설정:
  ┌──────────────────────────────────────────┐
  │ 아침 시작 안내 모달:    [●━━━] ON         │
  │ 유휴 감지 임계:        [15분 ▼]           │
  │ 자동 일시정지:         [30분 ▼]           │
  └──────────────────────────────────────────┘
```

### 3.5 워크스페이스 주간보고 페이지 안내 띠

`/tasks/workspace?tab=workspace-weekly` 상단:

```
┌─ Info bar (teal bg) ────────────────────────────┐
│ ℹ 매주 월요일 00:00 자동 확정됩니다.            │
│   다음 확정: 2026-05-20 00:00 · [설정 변경 →]  │
└────────────────────────────────────────────────┘

(owner/admin only)
[이번 주 확정] ← 보조 버튼, 비상용
```

"이번 주 마무리 (워크스페이스)" 라벨은 → **"이번 주 확정"** 로 변경 (자동이 표준임을 명확히).

---

## 4. API 설계

### 4.1 Focus 라우트 (`/api/focus`)

| Method | Path | 설명 | Auth |
|--------|------|------|------|
| GET | `/api/focus/current` | 현재 active/paused session 1건 (없으면 null) | 본인 |
| POST | `/api/focus/start` | `{ business_id, task_id? }` — 시작. 기존 active 있으면 stop 후 새로 | 본인 |
| POST | `/api/focus/pause` | `{ session_id, reason: 'manual' \| 'auto_idle' }` | 본인 |
| POST | `/api/focus/resume` | `{ session_id }` | 본인 |
| POST | `/api/focus/stop` | `{ session_id, end_reason: 'manual' \| 'auto_idle' \| 'logout' }` | 본인 |
| POST | `/api/focus/heartbeat` | `{ session_id }` — last_activity_at 갱신 (30s throttle) | 본인 |
| POST | `/api/focus/idle-discard` | `{ session_id, idle_seconds }` — 자리 비웠던 시간 빼기 (pause_total_sec 에 더함) | 본인 |
| GET | `/api/focus/daily-prompt-items` | 오늘 시작 모달용 — 오늘마감 + 확인요청 + 지연된 업무 모음 | 본인 |
| GET | `/api/focus/today-summary` | 오늘 누적 focus 시간 + session 수 | 본인 |

### 4.2 설정 라우트

| Method | Path | 설명 |
|--------|------|------|
| GET/PUT | `/api/users/:id/focus-settings` | 개인 설정 |
| GET/PUT | `/api/businesses/:id/weekly-finalize` | 자동 확정 요일/시각 |
| GET/PUT | `/api/businesses/:id/menu-permissions/weekly_team` | 멤버별 weekly_team 권한 |

### 4.3 weekly cron 변경

기존 매시간 트리거 + "월요일 0시" 하드코딩 → setting 기반:
```js
// businesses.weekly_finalize_dow / hour 기준으로 트리거
const isFinalize = nowInTz.weekday === biz.weekly_finalize_dow && nowInTz.hour === biz.weekly_finalize_hour;
```

`weekly_finalize_enabled=false` 시 skip.

---

## 5. 통합 — 기존 시스템과 연결

### 5.1 Task.actual_hours 누적

현재: `TaskStatusHistory` 의 `in_progress` 라운드 합산 (`taskActualHours.js`)
신규: `focus_session.stop` 시점에 `task_id` 있으면 그 task 의 actual_hours 도 누적:
```js
// stop 라우트 안에서:
const seconds = computeActualSeconds(session);  // (end - start) - pause_total
if (session.task_id) {
  await recomputeActualHoursFromHistory(session.task_id);
  // 또는 직접 +seconds
}
```

**actual_source ENUM 확장**: `auto` / `user` / `focus` 3종? 또는 `focus` 도 `auto` 로 묶음. **'auto' 로 묶음** (단순화).

### 5.2 in_progress 상태와의 관계

- task 의 status='in_progress' 가 되면 자동으로 focus 시작 X (사용자가 명시 시작해야)
- 단, focus 시작 시 task 의 status 가 'not_started' 면 자동으로 'in_progress' 전환 (UX)
- focus 종료 시 task status 자동 변경 X (사용자가 명시)

### 5.3 PWA / Socket 동기화

- 다중 디바이스 (데스크탑 + 모바일) 같은 user 가 동시 사용:
  - 모바일에서 시작 → 데스크탑 위젯도 active 로 즉시 반영 (socket `focus:updated`)
  - 데스크탑에서 종료 → 모바일도 stopped 즉시 반영
- 브라우저 닫힘 감지: `beforeunload` 에서 `navigator.sendBeacon('/api/focus/heartbeat')` (last_activity 기록)
- 12h 이상 heartbeat 끊긴 active session = cron 으로 auto-stop (`end_reason='stale'`)

---

## 6. Phase 분리 (구현 순서)

### Phase 1 — Focus MVP (사이클 N+26 ~ N+27)
- `focus_sessions` 테이블 + `users.focus_*` 컬럼 5개
- `/api/focus/*` 8개 라우트
- `FocusWidget` (좌측 사이드바)
- `TaskDetailDrawer` 헤더 Focus 버튼
- 개인 설정 페이지 ("내 업무 흐름" 섹션 in /profile)
- focus_enabled=false 일 때 코드 자체 비활성 (zero overhead)

### Phase 2 — 일일 안내 + 유휴 (사이클 N+28)
- `DailyStartModal`
- 유휴 감지 hook (`useActivityTracker`)
- idle prompt + 자동 일시정지
- 다중 디바이스 socket sync

### Phase 3 — 주간 보고 권한 + 자동확정 설정 (사이클 N+27 병행)
- `businesses.weekly_finalize_*` 컬럼 3개
- `menu_key='weekly_team'` 신규
- 워크스페이스 설정 "업무 관리" 페이지
- 워크스페이스 주간보고 안내 띠
- "이번 주 마무리" → "이번 주 확정"
- weeklyReviewCron 설정 기반 변경

### Phase 4 — 폴리시 (사이클 N+29+)
- 오늘 누적 시간 dashboard 카드
- 주간 focus 시간 통계 (insights)
- 모바일 PWA push: "1시간째 진행 중 — 잠시 쉬어가세요" 옵션

---

## 6.5 UI/UX 디자인 시스템 — Focus 4-상태 일관 토큰

### 색상 토큰 (COLOR_GUIDE 정합)

| 상태 | dot color | bg | label color | 의미 |
|------|-----------|-----|-------------|------|
| `idle` | `#94A3B8` (Slate 400) | `#F8FAFC` | `#64748B` | 가벼움. 시작 가능 |
| `active` | `#14B8A6` (Primary 500) | `#F0FDFA` | `#0F766E` | 진행 중. CTA primary 톤 |
| `paused` | `#F59E0B` (Warning 500) | `#FFFBEB` | `#B45309` | 일시정지. 사용자 의식적 행동 필요 |
| `idle_detected` | `#F59E0B` (pulse) | `#FEF3C7` (강조) | `#92400E` | 유휴 감지. amber 펄스로 주의 환기 |

### 모션 디자인

| 요소 | 모션 | 지속 | easing |
|------|------|------|--------|
| dot active | breath pulse (scale 1.0 → 1.15 → 1.0) | 1.6s loop | ease-in-out |
| dot paused | 정적 (없음) | — | — |
| dot idle_detected | 강조 pulse + opacity (scale 1.0 → 1.25, opacity 1 → 0.6 → 1) | 1.2s loop | ease-in-out |
| 상태 전환 | bg + color crossfade | 0.18s | ease-out |
| 위젯 hover | elevate (box-shadow 0 → 0 2px 8px rgba(0,0,0,0.06)) | 0.15s | ease |
| 버튼 press | scale 1.0 → 0.96 | 0.08s | ease-in |
| 모달 enter | scale 0.96 → 1.0 + opacity 0 → 1 | 0.2s | cubic-bezier(0.2, 0.8, 0.2, 1) |
| 카운터 (1h 24m) | 1초마다 무애니메이션 텍스트 갱신 (jitter 방지: tabular-nums) | — | — |

### 터치 타겟 + 사이즈

| 컴포넌트 | desktop | mobile |
|----------|---------|--------|
| FocusWidget (펼침) | width 220, padding 12 | width 100%, padding 16 |
| FocusWidget (사이드바 collapsed) | dot 12px circle (centered) | 사이드바 안 노출 (모바일은 햄버거 시트로) |
| 메인 버튼 (시작·일시정지·종료) | 32×32 svg + 라벨 | 40×40 svg + 라벨 |
| 보조 아이콘 버튼 (↗ 보기) | 28×28 | 36×36 |
| DailyStartModal 행 | min-height 48 | min-height 56 |
| TaskDetailDrawer 헤더 버튼 | height 36 (md) | height 44 (lg) |

### 타이포그래피

| 요소 | font | weight | size | letter-spacing |
|------|------|--------|------|----------------|
| 위젯 상태 라벨 | system | 700 | 13 | 0.2px |
| task title (위젯) | system | 600 | 13 | -0.1px (1줄 ellipsis) |
| 누적 시간 ("1h 24m") | system + **font-variant-numeric: tabular-nums** | 600 | 12 | 0 |
| 시작 시각 ("12:34부터") | system + tabular-nums | 500 | 11 | 0 |
| 모달 제목 | system | 700 | 18 | -0.2px |
| 모달 섹션 헤더 | system | 700 | 13 | 0 |
| 모달 행 task title | system | 600 | 14 | -0.1px |
| 모달 행 메타 (마감/지연) | system | 500 | 12 | 0 |

### 마이크로 인터랙션 (트렌디 디테일)

1. **위젯 active dot 펄스** — "진행 중" 직관 신호. 사용자 화면 시야 끝(주변시)에서도 인지.
2. **버튼 라벨 hover 색 전환** — 텍스트 색만 0.15s crossfade. bg 전환 X (덜 산만).
3. **시간 카운터 매초 갱신** — 단 텍스트 컨테이너 width 고정 (`min-width: 6ch` tabular-nums), 자릿수 변할 때 reflow 없음.
4. **상태 전환 시 dot scale bump** — paused → active 클릭 시 dot 가 1.0 → 1.3 → 1.0 (0.3s) "선택됨" 피드백.
5. **첫 활성화 후 5초** — 위젯 옆에 미세 toast "포커스 시작됨" (페이드 자동, alert 아님, focusing 라벨이 곧 명백한 안내라 toast 는 첫 1회만).
6. **DailyStartModal 행 hover** — bg `#F8FAFC` → `#F0FDFA` (primary 50). 행 클릭 시 그 행만 0.3s primary 100 flash 후 모달 닫힘.
7. **TaskDetailDrawer 의 active focus 표시** — task 자체가 활성 session 의 task 면 drawer 헤더 상단 좌측에 4px wide teal stripe (시각 우선순위 마커).

### 접근성 (a11y) 정밀화

| 요소 | 조치 |
|------|------|
| FocusWidget | `role="region"` + `aria-label={t('focus.widget')}` |
| 상태 dot | `aria-hidden="true"` (장식). 상태 텍스트 라벨이 sr 에 전달 |
| 카운터 | `aria-live="polite"` + `aria-atomic="false"` (매초 갱신 spam 방지 — 30초마다만 sr 알림) |
| 일시정지/재개 토글 | `<button role="switch" aria-checked={isActive}>` |
| 시작/종료 confirm | useEscapeStack + useFocusTrap (DetailDrawer 표준 hook 재사용) |
| 키보드 단축키 | `⌘.` (mac) / `Ctrl+.` (win) = 토글. cheat sheet 등록 |
| 색맹 대응 | 상태는 색 + 아이콘 형태 둘 다 (▶/⏸/⏹). 색만 의존 X |
| 명도 대비 | 모든 label·bg 조합 AA 4.5:1 통과 (Slate/Teal/Amber 토큰은 이미 검증됨) |

### 다크모드 대응 (미래 — Phase 4 이후)

- COLOR_GUIDE 에 다크모드 토큰 정의되면 자동 매핑.
- 위젯 색 분기: light = Slate 400 / dark = Slate 600 (dot only). bg 는 background-100/900 토큰 사용.
- 현재 구현에서는 light 만, 다크모드 변수 활성 시 자동 적용되도록 `currentColor` + `color-mix()` 사용.

---

## 7. 접근성·보안·운영

| 항목 | 결정 |
|------|------|
| focus_sessions 격리 | user_id 본인만. owner/admin 도 못 봄 (개인 시간) |
| AuditLog | start/stop/pause/resume 기록 (`action='focus.*'`) |
| Rate limit | `/focus/start` 분당 10회/user, `/heartbeat` 분당 60회/user |
| 키보드 단축키 | ⌘. (mac) / Ctrl+. (win) = 포커스 토글 (start ↔ pause) |
| ARIA | 위젯 `role="status"` + `aria-live="polite"`. 모달 표준 (focus trap 적용) |
| i18n | ko/en 양쪽. 네임스페이스 `focus` 신규 |
| AuditLog | start/stop/pause/resume 기록 |

---

## 8. 명명·라벨 결정표 (혼란 방지)

| 코드/DB | UI 라벨 (ko) | UI 라벨 (en) |
|---------|-------------|-------------|
| `focus_session` | 포커스 세션 | Focus session |
| `state='active'` | 포커스 중 | Focusing |
| `state='paused'` | 잠시 멈춤 | Paused |
| `state='stopped'` | 종료 | Stopped |
| 메뉴 (개인) | 내 업무 흐름 | My Work Flow |
| 메뉴 (워크스페이스) | 업무 관리 | Work Management |
| 모달 제목 | 오늘 시작하기 | Start your day |
| 자동확정 | 자동 확정 | Auto-finalize |
| weekly_team menu | 통합 주간보고 보기 | View team weekly report |

---

## 9. 다음 단계

1. **사용자 승인** — 이 설계서 검토 + 명명/Phase 분리 확정
2. **Phase 1 구현** (사이클 N+26):
   - DB migration (`focus_sessions` + `users.focus_*` 5컬럼)
   - 백엔드 라우트 8개
   - 프론트 `FocusWidget` + `TaskDetailDrawer` 버튼 + 개인 설정 UI
3. **Phase 1 검증** — 시작/일시정지/재개/종료 + 다중 디바이스 sync + task actual_hours 누적
4. **Phase 2/3 분리 진행** — 검증 후

---

> **30년차 코멘트**:
> - 사용자가 "팝업 적극" 이라고 했지만, 실 사용 데이터에서 모달은 학습되어 dismiss 됨. **사이드바 위젯이 진짜 적극성**이다 — 항상 보이지만 부담은 0.
> - "근무 시작/종료" 표현은 의도적으로 피했다. PlanQ는 자율적 협업 도구 — "출퇴근 도장" 컨셉은 PlanQ의 자산 (Cue) 과 충돌. **포커스(Focus)** 로 통일하면 자유롭게 켰다 껐다 하며 사용 가능.
> - 주간보고 자동 확정가 표준이고 수동 확정는 비상용 — 라벨도 그 위계를 반영해야 한다.
> - default OFF — 회사관리 도구로 오해받지 않도록. 사용자가 명시 ON 했을 때만 위젯 노출.

---

## 5. "이번 주 나의 업무" 리스트 포함 규칙 (canonical) — 2026-06-16 확정

> Q Task `?tab=week` (scope=mine) 리스트 + 우측 주간 진척 그래프가 **이 규칙 단일 출처**로 결정된다.
> 프론트 `QTaskPage.tsx` week 필터 + 백엔드 `routes/tasks.js GET /my-week` 가 동일 규칙을 따른다.
> (회귀 배경: 프론트가 "미완료 전부 표시"로 확장되며 옛 not_started backlog 수십 건이 이번 주로 쏟아져
>  리스트 flood + 그래프 baseline 왜곡. 워프로랩 실사례 61건 중 옛 not_started 36건.)

기준: **담당자 = 나** (또는 pending reviewer). 그 위에서 상태별로:

| 상태 | 이번 주 표시 조건 | 근거 |
|------|------------------|------|
| **completed / canceled** | `completed_at` 이 이번 주 범위 안일 때만 | "완료시점이 이번 주"가 기준. 마감이 과거여도 이번 주에 끝냈으면 이번 주 성과. completed_at 없으면 제외(시점 불명) |
| **not_started (미진행)** | 이번 주 계획(`planned_week_start`=이번주 월) **또는** 이번 주 마감 **또는 지연(`due_date` 가 이번 주 前 = 마감 지난 미착수)**. 마감 없는 것만 제외 | 지연(밀린 내 일)은 이번 주 책임선에 포함(Irene 2026-07-05). 마감 없는 backlog 만 flood 차단으로 제외 |
| **in_progress / reviewing / revision_requested / waiting** | **날짜 무관 항상 표시** | 한 번 착수한 내 업무는 마감·날짜가 없어도 끝까지 이번 주 책임선. 요청받아 진행 중인 마감 없는 업무도 포함 |

추가 규칙:
- **pending reviewer**: 내가 컨펌 대기(state=pending) 인 `reviewing`/`revision_requested` 업무는 담당자가 아니어도 표시.
- **완료 가리기 토글(hideCompletedInWeek)** OFF(기본): 내가 관여(담당/요청/작성/리뷰)한 **이번 주 완료**도 표시. ON 이면 완료 숨김.
- **정렬**: 완료/취소는 항상 맨 아래.
- **그래프 점선 종점(weekTotalEst)** = 위 규칙으로 추려진 이번 주 리스트의 예측시간 총합 → 옛 backlog 가 빠져 현실적 baseline.

> **30년차 코멘트**: "이번 주"의 의미는 **"이번 주에 내가 손대야 / 손댄 일"** 이다.
> not_started 는 아직 안 시작한 일이라 *이번 주로 계획·마감된 것만* 이번 주 일이고,
> 한 번 시작한(in_progress~) 일은 끝낼 책임이 이번 주에 계속 살아있으니 날짜와 무관하게 남는다.
> 완료는 *언제 끝냈나(completed_at)* 가 그 일이 어느 주의 성과인지를 결정한다.

---

## 6. 주간 진척 그래프 + 가용시간 통계 재설계 (2026-06-25 확정 — 30년차 통계/UX 관점)

> §5 가 "어떤 업무가 이번 주 리스트에 들어오나"를 정한다면, §6 은 그 리스트로 **그래프·가용시간을 어떻게 통계적으로 정확하게 계산·표시하나**를 정하는 단일 출처다.
> 발단: 운영 #94(주간 진척 그래프 실제선이 187h 비현실값 고정) 디버깅 중 그래프 전반의 통계 신뢰성을 점검.
> **이미 처리:** 포커스 방치세션 캡(#94, `403509d`) · 실작업률(%) 입력 UI(`583f6bb`). 아래는 그 위의 정식 재설계.

### 6.0 핵심 전제 (Irene 확정) — 단일 엔티티 + 주별 렌즈

PlanQ 업무 모델은 **"부하(workload)·책임 뷰"**다 (계획 슬라이스 모델 아님):
- 한 번 착수한 업무는 날짜 무관 끝낼 때까지 이번 주 리스트에 남는다(§5).
- **업무는 절대 복사·분할하지 않는다.** 하나의 엔티티로 영구 유지.
- "주(week)"는 그 업무 타임라인 위의 **렌즈(뷰)**일 뿐이다. 주별 통계는 timestamp(focus·상태이력) 구간 귀속 + 스냅샷 델타로 **도출**한다.

**왜 복사하지 않나 (설계 진화 기록):** amortize(주별 쪼개기) → 복사+이월 → **단일 엔티티**로 3회 수렴.
- amortize 는 carried-over/지연 업무의 실부하를 축소 → §5 "착수 업무는 온전히 이번 주 책임" 전제와 충돌. 탈락.
- 복사+이월 은 주별 데이터는 깨끗하나 **이전 작업시간·댓글·대화·메모·첨부가 옛 엔티티에 묶여 연속성 단절**(Irene 호소: "전에 작업했는지도 모름"). 체인 합산은 가능하나 이중계산·누락 버그 표면 큼. 탈락.
- **단일 엔티티 + 렌즈:** 연속성 100% 보존(같은 업무라 댓글·대화·메모 전부 그 자리) + 주별 깨끗한 통계(스냅샷 델타) + 복잡도 최저. 복사의 유일 장점(주별 깔끔 그래프)도 델타로 동일하게 획득. **채택.**
- 이는 PlanQ 기존 원칙 **Single Source, Multiple Views**(개인 보관함 패턴)와 동일.

### 6.1 통계 모델 — EVM(획득가치) 기반

현재 그래프는 사실상 EVM 인데 라벨·해석이 없어 못 읽음. 정식화:

| 선 | 정의 | EVM 대응 |
|----|------|---------|
| **가용 페이스(대각선 점선)** | 0 → **가용시간(effectiveCapacity)**, 영업일 균등 페이스. 종점이 가로 가용선과 만남. **시각 가이드 전용** (2026-07-05 Irene 확정, Fable 검토) | — (용량선) |
| **PV (판정 전용, 비표시)** | Σ예측 × 경과영업일/총영업일 — 판정칩 SPI 계산에만 사용, 선으로 그리지 않음 | PV |
| **진척(한 일)** | Σ(예측시간 × 진행률) 누적 | EV (획득가치) |
| **투입(쓴 시간)** | Σ(실제시간) 누적 (focus 캡 적용) | AC (실제비용) |

> **y축 = max(가용, 그려진 누적 최댓값)** — Σ예측으로 y축을 선제 확대하지 않는다(왕창 표시 금지). 실데이터(진척·투입)가 가용을 넘으면 그때만 확장(초과 솟구침 유지). 목표 대각선은 "할 일(Σ예측)"이 아니라 "가용시간 소진 페이스"이며, 판정칩 SPI는 계획(Σ예측) 기준을 유지한다(시각 가이드 ≠ 판정 기준 분리). 옛 "0→Σ잔여" 정의는 코드에 구현된 적 없어 삭제.

- **잔여(remaining) = Σ 예측시간 × (1 − 진행률)** — 활용률·목표선의 기준. 전체 예측이 아니라 잔여.
  - 거의 끝난 carried-over 업무가 가용을 거짓으로 잡아먹는 왜곡 제거. 진행률만 올리면 자동 보정(재추정 불필요 — §6.0 전제 충족).
- **carry-in 진행분:** 이번 주 그래프는 **이번 주 델타**(스냅샷 progress 델타)로 그려 월요일 0에서 시작(순수 이번 주 생산성). 누적 뷰가 아님.
- **단조 강제 완화(U4):** 진행률 하락·시간 하향수정을 `Math.max` 로 숨기지 않음. 되돌림 발생일에 `↓되돌림` 마커.

### 6.2 가용시간 — 잔여 기반 + 부하 구성

```
가용 = 하루 × (영업일 − 휴일) × 실작업률(participation_rate)   ← 583f6bb 로 입력 가능
잔여(이번 주 부하) = Σ 예측 × (1 − 진행률)
활용률 = 잔여 ÷ 가용
부하 구성 = 이월분(이번 주 시작 이전부터 활성) + 이번 주 신규분
```

- **이월(carried) = derived** — 데이터 복제 0. "업무가 이번 주 시작 이전부터 활성이었나"(상태이력·focus timestamp·created_at)로 **계산해 배지·구성 표시**.
- **참여율 자동 제안(U5):** 최근 4주 실측(focus 실작업시간 ÷ 명목 근무시간) → participation_rate 제안. 수동 입력 기본, 제안은 은은한 [적용] 칩.

### 6.3 UI/UX 설계 (30년차 — "한눈 인지" 6원칙)

1. 판정 먼저, 근거 나중(glance→look→hover) 2. 전문용어 0(EVM/SPI/CPI 비노출, 일상어 번역) 3. 의미색 일관 4. 연속성 가시화 5. 정직(되돌림 표시) 6. 점진적 노출

**① 가용시간 패널 (잔여 + 부하구성 + U5)**
```
이번 주 가용시간
  남은 일 18h / 가용 25.5h
  ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░ 71%
  여유 7.5h
── 이월 8h · 이번 주 신규 10h ──          ← 부하 구성(인지 핵심)
  하루6 영업일5 휴일0 실작업85%
  6h × 5일 × 85% = 주 25.5h
  ┄ 최근 4주 실측 82% · [적용]            ← U5 제안
(초과 시) ▓▓…██ 122% 🔴  초과 5.5h ⚠ / 이월 20h · 신규 11h
```
**② 주간 진척 그래프 (EVM → 일상어 판정 칩)**
```
주간 업무 진척
  🟢 순조롭게 진행 중                      ← 판정 칩(결론 먼저)
  [목표 점선 / 진척 teal / 투입 slate, 오늘까지만, 미래 잘림]
  ● 진척(한 일)  ● 투입(쓴 시간) ┈ 목표
```
판정 칩 매트릭스(탭 시 한 줄 설명):

| 내부 EVM | 화면 문구 | 색 | 설명 |
|---|---|---|---|
| 진척≈목표 & 투입≈진척 | 순조롭게 진행 중 | 🟢 | 계획대로 가고 있어요 |
| 진척 > 목표 페이스 | 예정보다 앞서 있어요 | 🟢 | 이번 주 목표보다 빨라요 |
| 투입 > 진척 (CPI<1) | 시간 대비 진척이 더뎌요 | 🟡 | N h 썼는데 M h어치 진행 — 예상보다 오래 걸리는 중 |
| 진척 < 목표 페이스 (SPI<1) | 목표보다 뒤처져 있어요 | 🟡→🔴 | 이번 주 가야 할 선보다 아래예요 |

**③ 리스트 — 이월 인지**
```
1 경쟁사 비교분석표 작성  〔이월〕         ← 은은한 pill(slate-100/600)
  지난주부터 · 이미 4h 투입 · 진행중       ← 이력 가시화("전에 했는지" 호소 해소)
  ▓▓▓▓▓▓░░░░ 60%  예측8h 실제4h
2 랜딩 카피 초안                          ← 신규는 배지 없음(노이즈↓)
```
〔이월〕 hover → "지난주에 시작한 업무예요. 열면 이력·대화·메모 전부 볼 수 있어요."

**④ 상세 드로어 — 연속성 표면화**
```
〔이월〕 지난주부터 진행 · 누적 4h 투입
[이번 주 작업] [전체 누적] ← 토글   (이번 주 1.5h · 전체 4h)
… 댓글·대화·메모·첨부 전부 그대로 …       ← 단일 엔티티라 다 살아있음
```

**색 시맨틱:** 좋음/앞섬 Teal `#14B8A6` · 투입 Slate `#64748B` · 주의 Amber `#F59E0B` · 초과/뒤처짐 Red `#EF4444` · 이월배지 `#F1F5F9`/`#475569` · 목표 점선 `#CBD5E1`. 카피 ko/en 필수, 공통 컴포넌트 재사용.

### 6.4 구현 범위 (DB 신규 테이블 0)

- **DB:** 신규 테이블 없음. 잔여·이월·주별 델타·참여율 제안 전부 기존 `tasks`·`task_daily_progress`·`focus_sessions`·`task_status_history` 에서 **도출**. (필요 시 성능용 파생 캐시 컬럼 정도만 검토)
- **API:** `routes/tasks.js` 확장 — daily-progress 응답에 `est_remaining`·주별 델타·`is_carried` 추가 + getMemberCapacity 에 부하 구성(이월/신규) + 참여율 제안 endpoint(또는 capacity 응답에 동봉).
- **Frontend:** `QTaskPage` `computedBurndown`(델타·단조완화)·`weekTotalEst`→잔여·활용률·판정칩·이월배지·드로어 연속성 배너/토글.
- **보고서 정합:** `weeklyReviewSnapshot.js` 동일 공식 재사용 → 한 곳 고치면 보고서도 정합.

### 6.5 무결성 룰 (회귀 차단)

1. **이월 ≠ 완료** — 이월은 derived 표시일 뿐, 완료 건수·완료율·throughput 통계에 **절대 포함 금지**. (복사 모델 폐기로 carried_over status 자체가 불필요해졌으나, 향후 명시 이월 도입 시에도 이 룰 고정.)
2. **이중계산 금지** — 단일 엔티티라 구조적으로 차단되나, 주별 귀속 합이 전체 누적을 초과하지 않음을 검증.
3. **focus 캡 의존** — 잔여·투입선 정확도는 #94 focus 캡(`computeActualSeconds`)에 의존. 캡 회귀 시 그래프도 오염.
4. **별개 미해결:** focus 없는 업무가 in_progress 로 수주 방치 시 status_history live 누적 inflation(1152h 류) — 본 설계와 다른 fallback 경로. 작업시간 정의(영업시간/구간 캡) product 결정 필요.
