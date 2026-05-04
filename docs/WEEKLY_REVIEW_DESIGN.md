# 주간 보고 (Weekly Review) 설계

> **상태:** 합의 완료, 다음 사이클 구현 예정.
> **작성:** 2026-05-04
> **합의자:** Irene
> **원칙:** 기존 코드·테이블·layout 0 변경. 신규 파일·테이블·라우트만 추가.

---

## 1. 배경 / 문제

PlanQ Q Task 의 "이번 주 내 업무" 탭은 **실시간 상태**를 보여준다. 회의에서 "지난 주 끝난 시점" 을 그대로 공유하기 어려운 결함:

1. 지연 업무는 이번 주 리스트에도 계속 표시됨 → 매번 변동, 회의 자료로 박제 X
2. 지연 업무를 이번 주로 옮기면 마감일 변경 → 지난 주 시간 계산에서 빠짐
3. 가용시간 / 번다운 그래프는 실시간이라 5분 뒤 다른 그래프
4. 결과: "지난 주 5pm 끝난 그 시점" 공유 불가, 시계열 분석 불가

**해결:** 매주 마무리 시점에 그 시점의 상태를 **JSON 데이터로 박제**해 시점 고정 + 누적 + 통계 활용.

---

## 2. 핵심 결정

| 항목 | 결정 |
|------|------|
| 주차 시작 | 워크스페이스 timezone 의 **월요일** (`utils/timezones.ts` `mondayOfDateStr` 그대로) |
| 포함 task 기준 | "이번 주 내 업무" 탭 필터와 동일 (담당자=user + 마감/계획 주차 in [week_start, week_end]) |
| 라벨 | "주간 보고" (탭) / "이번 주 마무리" (버튼) / "한 주 메모" (필드) |
| 저장 형태 | **JSON 데이터** (이미지 X) — 통계 활용 가능 |
| 보존 기간 | 무제한 (row 당 ~5KB, DB 부담 없음) |
| 자동 + 수동 | 둘 다 — 매주 일요일 23:59 자동 + 사용자 클릭 |
| 자동 ON/OFF 토글 위치 | 둘 다 — `/business/settings/notifications` 신규 섹션 + Q Task "주간 보고" 탭 우측 상단 |
| 기존 변경 | **0 — 추가만** |

---

## 3. 메뉴 위치

```
사이드바 (변경 X)
└─ Q Task                                   ← 기존 페이지
   ├─ [탭] 이번 주 내 업무                    ← 기존
   │      ┗ 헤더 우측에 [이번 주 마무리] 버튼   ← 신규 (week 탭일 때만)
   ├─ [탭] 내 전체업무                        ← 기존
   ├─ [탭] 요청하기                           ← 기존
   └─ [탭] 주간 보고                          ← 신규 4번째 탭
          ┗ 누적 결산 카드 리스트 + 자동 토글
```

사이드바 메뉴 추가 X. Q Task 안에서 다 처리.

### 라벨 위치

| 라벨 | 위치 | 신규 |
|------|------|------|
| **주간 보고** | Q Task 의 4번째 탭 이름 | 탭 |
| **이번 주 마무리** | "이번 주 내 업무" 탭의 헤더 우측 버튼 | 버튼 |
| **한 주 메모** | 마무리 모달 안 텍스트 입력 라벨 + 결산 view 메모 필드 | 라벨 |

---

## 4. 사용자 시나리오

### 4.1 금요일 오후 — 수동 마무리

1. Q Task → "이번 주 내 업무" 탭 진입
2. 헤더 우측 **"이번 주 마무리"** 버튼 클릭
3. 모달 열림:

```
┌─────────────────────────────────┐
│ 이번 주 마무리                    │
│ 2026-05-04 (월) ~ 2026-05-10 (일) │
│ ─────────────────────────────── │
│ 완료 8건 / 미완료 3건              │
│ 사용 32h / 계획 40h (80%)         │
│ ─────────────────────────────── │
│ 한 주 메모 (선택):                 │
│ ┌─────────────────────────┐    │
│ │ [텍스트 입력]              │    │
│ └─────────────────────────┘    │
│           [저장]    [취소]        │
└─────────────────────────────────┘
```

4. 저장 → `weekly_reviews` 에 row 추가 (snapshot 박제, finalized_by='manual')

이 시점 이후 그 주 결산은 **immutable**. 지연 task 마감일을 다음 주로 옮겨도 변동 없음.

### 4.2 일요일 23:59 — 자동 박제

- cron 트리거 (매시간 0분)
- ws timezone 일요일 23:59 가 방금 지났고 + auto_enabled=true 이고 + 그 주 row 가 없는 사용자
- → snapshot 빌드 + insert (finalized_by='auto')

### 4.3 월요일 아침 — 지난 주 결산 + 이번 주 계획

1. Q Task → "이번 주 내 업무" 탭 진입
2. 탭 상단에 카드 배너: **"지난 주 결산이 있어요 →"** (있으면만)
3. 클릭 → `WeeklyReviewView` 풀 페이지 (그 시점 박제 그대로 + 회고 메모)
4. 회의에서 화면 공유

### 4.4 누적 결산 보기

1. Q Task → **"주간 보고"** 탭 클릭
2. 카드 리스트 (최근 12주, 무한 스크롤로 더) — 각 카드:
   - 주차 라벨 (`5월 1주차` 또는 `2026-05-04 ~ 2026-05-10`)
   - 자동/수동 배지
   - 완료율 / 사용시간 / 한 주 메모 한 줄 미리보기
3. 카드 클릭 → 풀 view

### 4.5 자동 후 수동 — 충돌 처리

- 자동(일요일) 후 월요일에 수동 클릭 → 확인 다이얼로그:
  ```
  "이번 주 결산이 이미 있어요.
  지금 시점으로 덮어쓸까요?"
  [덮어쓰기]  [취소]
  ```
- 덮어쓰면 같은 row 의 snapshot_data + retro_note + finalized_by 갱신.

---

## 5. 데이터 모델

### 5.1 신규 테이블 ① — `weekly_reviews`

```sql
CREATE TABLE weekly_reviews (
  id INT PRIMARY KEY AUTO_INCREMENT,
  business_id INT NOT NULL,
  user_id INT NOT NULL,
  week_start DATE NOT NULL,    -- ws_tz 기준 월요일
  week_end DATE NOT NULL,      -- 같은 timezone 일요일
  finalized_at DATETIME NOT NULL,
  finalized_by ENUM('manual','auto') NOT NULL DEFAULT 'manual',
  snapshot_data JSON NOT NULL,
  retro_note TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_user_biz_week (user_id, business_id, week_start),
  INDEX idx_biz_user_week (business_id, user_id, week_start),
  INDEX idx_biz_week (business_id, week_start)  -- 향후 팀 결산 보드용
);
```

### 5.2 snapshot_data JSON 구조

```json
{
  "tasks": [
    {
      "id": 12,
      "title": "브로슈어 기획 컨펌",
      "status": "completed",
      "estimated_hours": 4,
      "actual_hours": 5,
      "progress_percent": 100,
      "due_date": "2026-05-08",
      "start_date": "2026-05-04",
      "project_id": 3,
      "project_name": "International Onboarding 2026 Q2"
    }
  ],
  "summary": {
    "total": 11,
    "completed": 8,
    "incomplete": 3,
    "estimated_total": 40,
    "actual_total": 32,
    "utilization_pct": 80,
    "capacity_hours": 40
  },
  "burndown": [
    { "date": "2026-05-04", "estimated_cumulative": 8, "actual_cumulative": 6 },
    { "date": "2026-05-05", "estimated_cumulative": 16, "actual_cumulative": 13 },
    { "date": "2026-05-06", "estimated_cumulative": 24, "actual_cumulative": 21 },
    { "date": "2026-05-07", "estimated_cumulative": 32, "actual_cumulative": 27 },
    { "date": "2026-05-08", "estimated_cumulative": 40, "actual_cumulative": 32 },
    { "date": "2026-05-09", "estimated_cumulative": 40, "actual_cumulative": 32 },
    { "date": "2026-05-10", "estimated_cumulative": 40, "actual_cumulative": 32 }
  ]
}
```

**Immutable.** 박제 후 task 변경 무관.

### 5.3 신규 테이블 ② — `weekly_review_settings`

자동 박제 ON/OFF — 사용자별 + 워크스페이스별.

```sql
CREATE TABLE weekly_review_settings (
  user_id INT NOT NULL,
  business_id INT NOT NULL,
  auto_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, business_id)
);
```

row 없으면 default ON 으로 간주.

### 5.4 기존 테이블 영향

**0 — 어떤 기존 테이블도 변경 X**.

`tasks`, `business_members`, `users`, `projects` 등 손 안 댐.

---

## 6. API 설계

라우트 prefix: `/api/weekly-reviews`

| 메소드 | 경로 | 권한 | 동작 |
|--------|------|------|------|
| `POST` | `/` | authenticate | 수동 박제 — body: `{business_id, week_start?, retro_note?}`. week_start 미지정 시 ws_tz 현재 주. 기존 row 있으면 confirm 파라미터 (`?overwrite=true`) 필요 |
| `GET` | `/` | authenticate | 누적 결산 — `?business_id=&user_id=&limit=12&before=`. 본인 결산만 (또는 owner 가 멤버 결산 조회) |
| `GET` | `/latest` | authenticate | `?business_id=` — 가장 최근 결산 (월요일 진입 배너용) |
| `GET` | `/:id` | authenticate | 풀 view (snapshot_data 포함). 본인 또는 같은 워크스페이스 owner |
| `PATCH` | `/:id` | authenticate | retro_note 만 수정 (snapshot_data 자체 immutable) |
| `DELETE` | `/:id` | authenticate | 본인 결산 삭제. owner 만 멤버 결산 삭제 가능 |
| `GET` | `/settings` | authenticate | `?business_id=` — 자동 박제 설정 조회 |
| `PUT` | `/settings` | authenticate | body: `{business_id, auto_enabled}` — ON/OFF 토글 |

### 6.1 응답 형식 (PlanQ 표준)

```json
{ "success": true, "data": {...} }
{ "success": false, "message": "...", "code": "..." }
```

### 6.2 에러 케이스

| 케이스 | 응답 |
|--------|------|
| 미인증 | 401 `no_token` |
| 다른 워크스페이스 결산 접근 | 403 `forbidden` |
| 같은 주 row 존재 + overwrite=false | 409 `already_exists` |
| 잘못된 week_start (오늘보다 미래) | 400 `invalid_week` |

---

## 7. snapshot 빌드 로직

`services/weeklyReviewSnapshot.js`

```js
async function buildSnapshot(userId, businessId, weekStart, weekEnd) {
  // 1. tasks — "이번 주 내 업무" 탭 필터와 동일
  const tasks = await Task.findAll({
    where: {
      business_id: businessId,
      [Op.or]: [
        { assignee_id: userId },
        // 내 업무 탭 동일 — 추후 정확한 필터 코드 따라감
      ],
      [Op.or]: [
        { due_date: { [Op.between]: [weekStart, weekEnd] } },
        { planned_week_start: weekStart },
      ],
    },
    include: [{ model: Project, attributes: ['id', 'name'] }],
  });

  // 2. summary
  const completed = tasks.filter(t => t.status === 'completed').length;
  const total = tasks.length;
  const estimated_total = tasks.reduce((s, t) => s + (t.estimated_hours || 0), 0);
  const actual_total = tasks.reduce((s, t) => s + (t.actual_hours || 0), 0);

  // 3. capacity (TaskUserHours 또는 user 기본)
  const capacity_hours = await getUserCapacity(userId, businessId, weekStart);
  const utilization_pct = capacity_hours > 0
    ? Math.round((actual_total / capacity_hours) * 100) : 0;

  // 4. burndown — TaskDailyProgress 누적
  const burndown = await buildBurndownData(userId, businessId, weekStart, weekEnd);

  return {
    tasks: tasks.map(serializeTaskForSnapshot),
    summary: { total, completed, incomplete: total - completed,
               estimated_total, actual_total, utilization_pct, capacity_hours },
    burndown,
  };
}
```

---

## 8. 자동 cron

`cron/weeklyReviewCron.js`

```js
// 매시간 0분 트리거
const cron = require('node-cron');

cron.schedule('0 * * * *', async () => {
  // 1. 모든 활성 business_members 순회
  const members = await BusinessMember.findAll({
    where: { active: true },
    include: [{ model: Business, attributes: ['id', 'workspace_timezone'] }],
  });

  for (const m of members) {
    const ws_tz = m.Business.workspace_timezone || 'Asia/Seoul';
    const nowInTz = DateTime.now().setZone(ws_tz);
    const isJustAfterSundayEnd = nowInTz.weekday === 1 // 월요일
                              && nowInTz.hour === 0
                              && nowInTz.minute < 60;

    if (!isJustAfterSundayEnd) continue;

    // 2. 자동 ON 검사
    const setting = await WeeklyReviewSetting.findOne({
      where: { user_id: m.user_id, business_id: m.business_id },
    });
    if (setting && !setting.auto_enabled) continue;

    // 3. 그 주 row 이미 있는지
    const weekStart = nowInTz.minus({ days: 7 }).startOf('week').toFormat('yyyy-MM-dd');
    const exists = await WeeklyReview.findOne({
      where: { user_id: m.user_id, business_id: m.business_id, week_start: weekStart },
    });
    if (exists) continue;

    // 4. snapshot 빌드 + insert
    const snapshot = await buildSnapshot(m.user_id, m.business_id, weekStart, weekEnd);
    if (snapshot.summary.total === 0) continue; // 빈 주 skip

    await WeeklyReview.create({
      user_id: m.user_id, business_id: m.business_id,
      week_start: weekStart, week_end: weekEnd,
      finalized_at: new Date(),
      finalized_by: 'auto',
      snapshot_data: snapshot,
    });
  }
});
```

**부담 평가:** 100 멤버 가정 시 매시간 100 건 검사. 일요일/월요일 경계만 실제 insert. cron 자체 비용 거의 0.

---

## 9. 프론트 컴포넌트

```
dev-frontend/src/
├ pages/QTask/
│   ├ QTaskPage.tsx                 ← 추가만 (TabBar + 헤더 버튼 + 4번째 탭 본문)
│   ├ WeeklyReviewTab.tsx           ← 신규
│   └ WeeklyReviewView.tsx          ← 신규
├ components/QTask/
│   ├ WeeklyReviewModal.tsx         ← 신규
│   └ WeeklyReviewAutoSection.tsx   ← 신규 (settings 페이지 + 탭 우측 토글 공용)
└ services/
    └ weeklyReview.ts               ← 신규 API client
```

### 9.1 QTaskPage.tsx 추가 지점

```tsx
// 기존 TabBar 안에 4번째 추가만
<TabBtn $active={tab==='weekly-review'} onClick={()=>setTab('weekly-review')}>
  {t('tab.weeklyReview', '주간 보고')}
  {/* count badge 옵션 — 누적 N */}
</TabBtn>

// 기존 헤더 우측에 버튼 추가만 (week 탭일 때만)
{scope==='mine' && tab==='week' && (
  <FinalizeBtn type="button" onClick={() => setReviewModalOpen(true)}>
    {t('weeklyReview.finalize', '이번 주 마무리')}
  </FinalizeBtn>
)}

// 모달
{reviewModalOpen && (
  <WeeklyReviewModal
    businessId={bizId}
    userId={myId}
    onClose={() => setReviewModalOpen(false)}
    onSaved={() => { setReviewModalOpen(false); /* tab 갱신 */ }}
  />
)}

// 4번째 탭 활성 시 본문
{tab==='weekly-review' && (
  <WeeklyReviewTab businessId={bizId} userId={myId} />
)}
```

### 9.2 NotificationSettings.tsx 추가 (1줄)

```tsx
<PwaInstallSection />
<PushSection businessId={businessId} />
<WeeklyReviewAutoSection businessId={businessId} />   ← 신규 한 줄
<Section>...알림 매트릭스...</Section>                 ← 기존 그대로
```

---

## 10. i18n (qtask 신규 키)

```json
"tab": {
  "week": "이번 주 내 업무",
  "all": "내 전체업무",
  "requested": "요청하기",
  "weeklyReview": "주간 보고"           ← 신규
},
"weeklyReview": {                       ← 신규 블록 전체
  "finalize": "이번 주 마무리",
  "modal": {
    "title": "이번 주 마무리",
    "period": "{{start}} ~ {{end}}",
    "summary": "완료 {{c}}건 / 미완료 {{i}}건",
    "hours": "사용 {{a}}h / 계획 {{e}}h ({{p}}%)",
    "noteLabel": "한 주 메모",
    "notePlaceholder": "이번 주 어땠나요? (선택)",
    "save": "저장",
    "cancel": "취소",
    "alreadyExists": "이번 주 결산이 이미 있어요. 지금 시점으로 덮어쓸까요?",
    "overwrite": "덮어쓰기"
  },
  "tab": {
    "empty": "아직 저장된 결산이 없습니다",
    "emptyHint": "금요일·일요일에 \"이번 주 마무리\" 또는 자동 박제로 누적해보세요.",
    "autoBadge": "자동",
    "manualBadge": "수동",
    "weekLabel": "{{n}}월 {{w}}주차"
  },
  "view": {
    "back": "결산 목록",
    "tasksTitle": "그 주 업무",
    "summaryTitle": "요약",
    "burndownTitle": "주간 진척",
    "noteTitle": "한 주 메모",
    "addNote": "메모 추가"
  },
  "auto": {
    "title": "주간 보고 자동 박제",
    "desc": "매주 일요일 23:59 자동으로 그 주 결산을 저장합니다. 통계 누적과 회의 자료로 사용됩니다.",
    "enabled": "켜짐",
    "disabled": "꺼짐"
  },
  "lastWeekBanner": {
    "title": "지난 주 결산이 있어요",
    "desc": "회의 또는 회고에 활용하세요.",
    "viewBtn": "보러 가기"
  }
}
```

영문 동일 구조로 작성.

---

## 11. 통계 활용 (Phase 3 — 후속 사이클)

snapshot_data 가 JSON 이라 누적 분석 가능. **Insights 페이지 신규 탭 "주간 추세"** 가능:

| 분석 | 데이터 출처 |
|------|-----------|
| **완료율 추세** | 매주 `summary.completed / total` |
| **시간 정확도** | 매주 `estimated_total vs actual_total` (예측 정확도 추세) |
| **캐파 사용률 추세** | 매주 `utilization_pct` (overload / under-capacity 패턴) |
| **반복 지연 task** | 매주 incomplete tasks 의 title 패턴 |
| **번다운 일관성** | 매주 burndown — 월요일 폭주? 주말 몰림? |

**최소 4주 이상 누적되면 의미 있는 인사이트 가능.**

---

## 12. 작업 분할

### Phase 1 (이번 사이클)

1. DB 마이그레이션 (`weekly_reviews`, `weekly_review_settings` 신규)
2. 백엔드 모델 + 서비스 + 라우트 + cron
3. 프론트:
   - WeeklyReviewModal (수동 마무리)
   - WeeklyReviewTab (4번째 탭 본문)
   - WeeklyReviewView (풀 view)
   - WeeklyReviewAutoSection (settings + 탭 토글 공용)
   - QTaskPage 추가만 (TabBar + 헤더 버튼)
4. i18n ko/en 신규 키
5. 월요일 진입 시 "지난 주 결산이 있어요" 배너 (week 탭 상단)
6. dev 검증 → 운영 배포

규모: 큰 1 사이클 (10+ 신규 파일).

### Phase 2 (후속)

- 통계 활용 — Insights 페이지에 "주간 추세" 탭 신규
- 팀 결산 보드 (Irene 의 추가 아이디어 후 합의)
- 회의 모드 (풀스크린, 화면 공유 친화)

---

## 13. 검증 포인트 (Phase 1 배포 전)

1. **수동 마무리** — 클릭 → 모달 → 저장 → 4번째 탭 카드 추가 확인
2. **자동 cron** — 시각 시뮬레이션으로 트리거 검증 (Node 스크립트로 timezone 강제)
3. **중복 방지** — 자동 후 수동 클릭 시 `409 already_exists` + 덮어쓰기 옵션
4. **Snapshot immutable** — 결산 후 task 수정해도 snapshot_data 의 값 변동 없음 (DB 직접 확인)
5. **자동 ON/OFF 토글** — settings + 탭 우측 둘 다 동기화
6. **권한** — 다른 사용자 결산 접근 시 403
7. **빈 주 skip** — total=0 이면 자동 박제 skip
8. **i18n** — ko/en 양쪽 키 일치, 한국어 하드코딩 0건

---

## 14. 위험·오픈 이슈

| 항목 | 노트 |
|------|------|
| 워크스페이스 timezone 다양 | cron 매시간 도면서 ws_tz 별 검사 — 100+ 워크스페이스 시 부담 검토 |
| TaskDailyProgress 의존 | burndown 빌드 — 기존 daily_progress 데이터 정확도에 따라감 |
| 사용자 개인정보 | snapshot_data 안 task title — 같은 워크스페이스 owner 가 본인 외 결산 조회 시 노출. 정책: owner 도 자기만 / 또는 명시적 공유 필요 |
| Phase 2 팀 보드 | 1차에는 개인만. 팀 보드는 사용자 추가 아이디어 후 |
| Insights 통합 | Phase 3 — 4주 이상 누적 후 |

---

## 15. Phase 1 시작 체크리스트

- [ ] DB 마이그레이션 SQL (sync-database.js 안 모델 정의 + 자동 sync 또는 ALTER)
- [ ] WeeklyReview / WeeklyReviewSetting 모델
- [ ] routes/weekly_reviews.js + 응답 표준
- [ ] services/weeklyReviewSnapshot.js
- [ ] cron/weeklyReviewCron.js + server.js 등록
- [ ] WeeklyReviewModal / Tab / View / AutoSection 4 컴포넌트
- [ ] QTaskPage 추가 지점 2곳 (TabBar + 헤더 버튼)
- [ ] NotificationSettings 신규 섹션 1줄 추가
- [ ] i18n weeklyReview 블록 ko/en
- [ ] 월요일 배너 (week 탭 상단)
- [ ] 검증 9단계 → 배포 명령 대기

---

**원칙 재확인:** 기존 코드·layout·테이블 0 변경. 추가만으로 모두 구현 가능.
