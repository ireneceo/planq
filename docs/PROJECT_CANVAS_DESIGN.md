# 프로젝트 캔버스 (Project Canvas) — 설계 문서

> D3 #65. 프로젝트 상세를 "업무 목록"에서 **전략·실행·산출물이 한 화면에 흐르는 캔버스**로 격상.
> 최고 수준 경영 컨설팅이 engagement 를 구조화하는 논리(Why→How→Execute)를 그대로 녹임.
> D1 조직(부서)·D2 외부파트너(격리) 위에 얹힘. 기존 인프라 최대 재사용.

---

## 1단계 — 기능 정의 (승인됨)

| 항목 | 내용 |
|------|------|
| 기능명 | 프로젝트 캔버스 (Project Canvas) |
| 목적 | 프로젝트 진입 즉시 목표·이번주 할 일·연계 구조·결과물 파악. 전략 실행도로 격상 |
| 핵심 사용자 | 워크스페이스 멤버(owner/admin/member). 외부 파트너/client 는 캔버스 비노출(전략=내부) |
| 화면 배치 | 기존 `dashboard` 탭을 **"캔버스"로 격상·재구성**(새 탭 추가 X). 프로젝트 랜딩 탭 |
| 성공 기준 | 전략필드 AutoSave / 워크스트림 업무 귀속 / 타임라인 통합 / 금주·차주 정확 / 연계도 정확 / client 격리 / 빌드·E2E·헬스 통과 |

### 컨설팅 콘텐츠 구조 (3 레이어, 위→아래 논리 흐름)

**🔵 Layer 1 프레이밍 (Why)** — SCQA + OKR
1. 추진 배경 (Context)
2. 핵심 과제 (Key Question)
3. 목표 (Objective)
4. 성공 지표 (Success Metrics — 정량 KR, 구조화)

**🟢 Layer 2 전략 (How)** — 피라미드 원칙 + MECE
5. 핵심 메시지 (Governing Thought, 한 문장)
6. 추진 방식 (Approach)
7. 핵심 추진과제 (Workstreams — MECE 3~5개, 업무의 상위 골격)

**🟠 Layer 3 실행·추적 (Execute)** — 기존 인프라 재사용
8. 로드맵·마일스톤 (project_stages + tasks + GanttTrack)
9. 금주/차주 포커스 (Task.planned_week_start)
10. 산출물 (Post/Document/File)
11. 이해관계자 (members+부서 / clients+kind)
12. 리스크 & 대응 (ProjectIssue)

---

## 3단계 — DB 구조

### A. `projects` 컬럼 6개 추가 (sync-database 자동 — 컬럼 추가만, ENUM 변경 없음)

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `strategy_context` | TEXT null | 추진 배경 (Situation) |
| `strategy_key_question` | TEXT null | 핵심 과제 (Key Question) |
| `strategy_goal` | TEXT null | 목표 (Objective) |
| `strategy_governing_thought` | TEXT null | 핵심 메시지 (Governing Thought) |
| `strategy_approach` | TEXT null | 추진 방식 (Approach) |
| `success_metrics` | JSON null | `[{ id, label, target, current, unit }]` 성공 지표 |

> 기존 `description` 은 "한 줄 소개"로 유지(캔버스 헤더). 전략 5필드는 별도.

### B. 신규 테이블 `project_workstreams`

```js
ProjectWorkstream.init({
  id:          { BIGINT, PK, autoIncrement },
  business_id: { INTEGER, allowNull:false },   // 멀티테넌트 WHERE 격리 (denormalized)
  project_id:  { BIGINT,  allowNull:false, references: projects(id), onDelete:'CASCADE' },
  title:       { STRING(200), allowNull:false },
  description: { TEXT, null },
  order_index: { INTEGER, default:0 },
  color:       { STRING(20), null },           // 캔버스 그룹 색 (없으면 팔레트 자동)
  status:      { ENUM('active','done','dropped'), default:'active' },
  created_by:  { INTEGER, null },
}, { tableName:'project_workstreams', timestamps:true, underscored:true,
     indexes:[ {fields:['project_id','order_index']}, {fields:['business_id']} ] });
```

### C. `tasks.workstream_id` 컬럼 추가

```js
workstream_id: { type: BIGINT, allowNull:true,
  references:{ model:'project_workstreams', key:'id' }, onDelete:'SET NULL' }
// index: workstream_id
```

### D. Association (models/index.js)

```js
Project.hasMany(ProjectWorkstream, { foreignKey:'project_id' });
ProjectWorkstream.belongsTo(Project, { foreignKey:'project_id' });
ProjectWorkstream.belongsTo(User, { as:'creator', foreignKey:'created_by' });
ProjectWorkstream.hasMany(Task, { foreignKey:'workstream_id', as:'tasks' });
Task.belongsTo(ProjectWorkstream, { foreignKey:'workstream_id', as:'workstream' });
```

### 마이그레이션
- `sync-database.js` 가 컬럼 6개 + tasks.workstream_id 자동 추가, `project_workstreams` 신규 테이블 자동 생성. ENUM 은 신규 테이블에만 → 기존 테이블 ENUM ALTER 없음(안전).
- 운영 배포 시 동일. 백필 불필요(전부 nullable, 신규).

---

## 2단계 — API (전부 `routes/projects.js`, 멤버 전용. client 차단)

접근: 기존 `loadProjectOrForbidden(projectId, userId)` → `{project, role, error}`. 캔버스는 `role==='client'` 차단(403 `member_only`). 쓰기는 member/owner/admin.

### 캔버스 집계 (1콜)
**`GET /api/projects/:id/canvas`**
```jsonc
{ success:true, data:{
  project: { id, name, status, start_date, end_date, color, description, owner_user_id },
  strategy: { context, key_question, goal, governing_thought, approach },
  success_metrics: [{ id, label, target, current, unit }],
  workstreams: [{ id, title, description, order_index, color, status,
                  rollup: { total, completed, in_progress, overdue, progress_pct } }],
  week_focus: { week_start, next_week_start,
                this_week: [taskBrief], next_week: [taskBrief] },   // planned_week_start 기준
  deliverables: [{ kind:'post'|'document'|'file', id, title, category, status, created_at, link }], // published/완료 우선, cap 30
  stakeholders: { members:[{ user_id, name, dept, team, role }], clients:[{ id, name, kind }] },
  risks: [{ id, title, severity, status }]   // ProjectIssue 상위 N
} }
```
- 타임라인(stages)은 기존 `GET /:id/transactions` 재사용(중복 안 함) — 캔버스 페이지가 같이 호출.

### 전략 필드 (AutoSave 필드별)
**`PATCH /api/projects/:id/strategy`** — body 부분집합 `{context?, key_question?, goal?, governing_thought?, approach?}` → 갱신분 반환. member write. broadcast `project:updated`.

### 성공 지표 (구조화 리스트 — 전체 교체)
**`PUT /api/projects/:id/success-metrics`** — body `{ metrics:[{label, target, current, unit}] }` (1~10개, 서버가 id 부여, label 필수 검증). member write. broadcast.

### 워크스트림 CRUD + 정렬
- **`GET  /api/projects/:id/workstreams`** — 목록 + rollup (canvas 와 동일 직렬화 공유)
- **`POST /api/projects/:id/workstreams`** — `{title, description?, color?}` → 201. order_index=max+1. member write. broadcast `workstream:new`
- **`PATCH /api/projects/:id/workstreams/:wsId`** — `{title?, description?, color?, status?}`. broadcast `workstream:updated`
- **`DELETE /api/projects/:id/workstreams/:wsId`** — 삭제(tasks.workstream_id→NULL). broadcast `workstream:deleted`
- **`POST /api/projects/:id/workstreams/reorder`** — `{ordered_ids:[...]}` 일괄 order_index. broadcast

### 업무 ↔ 워크스트림 귀속 (기존 task PUT 확장)
- `PUT /api/tasks/by-business/:biz/:id` 에 **`workstream_id`** 수용. 검증: 같은 project 의 workstream 여야(아니면 400 `invalid_workstream`). FIELD_RULES: 담당자/작성자/owner/admin. task 직렬화에 `workstream_id` 포함.
- 업무연계도/타임라인은 task.workstream_id + 기존 `task_links`(GET `/api/tasks/:id/links`) 조합으로 렌더.

### 에러 케이스
- 403 `member_only`(client), 404 `project_not_found`, 400 `invalid_workstream`/`metric_label_required`, 멀티테넌트 cross 403/404.

### 실시간 (CLAUDE.md §16)
- 모든 mutation → `io.to('business:${bizId}').emit('<event>', payload)` + `broadcastInboxRefresh` 패턴. 캔버스 페이지가 `project:updated`/`workstream:*` listen → silentLoad(250ms debounce) + `useVisibilityRefresh`.

---

## 4단계 — UI

### 위치
`QProjectDetailPage` 의 `dashboard` 탭 → **"캔버스"**(label 변경, i18n `qproject:tabs.canvas`). 기존 dashboard 카드(진행률·이슈·노트)는 캔버스 Layer 로 흡수. 신규 컴포넌트 `pages/QProject/canvas/`.

### 레이아웃 (위→아래, 컨설팅 논리)
```
┌ 캔버스 헤더 ── 프로젝트명 · status · 기간 · owner/부서 · "한 줄 소개"(description AutoSave)
│
├ 🔵 Layer 1 프레이밍
│   ├ [추진 배경] [핵심 과제]  ← 2열 AutoSaveField (textarea)
│   ├ [목표]                   ← AutoSaveField
│   └ [성공 지표] ─ metric chip 리스트(label · target ← current · unit) + 인라인 편집 + 추가
│
├ 🟢 Layer 2 전략
│   ├ [핵심 메시지] ─ 강조 배너(큰 글씨, governing thought) AutoSave
│   ├ [추진 방식]   ─ AutoSaveField
│   └ [핵심 추진과제] ─ 워크스트림 카드 그리드
│        WorkstreamCard: 색 바 · title · rollup 진행바(완료/진행/지연) · 업무수 · 편집/삭제
│        + 워크스트림 추가 · 드래그 정렬
│
├ 🟠 Layer 3 실행
│   ├ [종합 타임라인] ─ 기존 GanttTrack/stages 재사용, 워크스트림 색 그룹
│   ├ [금주 / 차주 포커스] ─ 2열 task chip(담당자·마감·진행%)
│   ├ [산출물] ─ published Post/Doc/File 그리드(아이콘·제목·종류·날짜·열기)
│   ├ [이해관계자] ─ 멤버(부서 badge D1) + 외부파트너(PartnerKindBadge D2)
│   └ [리스크] ─ ProjectIssue 상위 N (severity 색)
│
└ [업무연계도] ─ 워크스트림 레인별 task 노드 + task_links 커넥터(경량 SVG, v1)
```

### 컴포넌트
- 신규: `ProjectCanvas.tsx`(컨테이너) · `StrategyFrame.tsx`(L1) · `SuccessMetricsEditor.tsx` · `WorkstreamBoard.tsx`+`WorkstreamCard.tsx` · `WeekFocus.tsx` · `DeliverablesGrid.tsx` · `StakeholderList.tsx` · `TaskLinkGraph.tsx`
- 재사용: `AutoSaveField`(전략 텍스트), `PartnerKindBadge`(D2), 부서 badge(D1), `GanttTrack`, `PlanQSelect`, `ActionButton`, 카드 패턴, `useVisibilityRefresh`
- 서비스: `services/projectCanvas.ts`(getCanvas/patchStrategy/putMetrics/CRUD workstreams)

### UX 규칙 (CLAUDE.md 준수)
- 전략 텍스트 = AutoSaveField(저장 버튼 X, ✓ 뱃지). 토스트 금지.
- 빈 상태: 각 섹션 "아직 없음 + 작성 CTA"(전략 미작성 시 안내). 워크스트림 0개 → 추가 CTA.
- 로딩: skeleton. 색: COLOR_GUIDE 토큰. 반응형: ≤768 1열. i18n ko/en 신규 키(`qproject` 확장 or `qcanvas` 신규 ns).
- client 진입 시: 캔버스 탭 자체 숨김(멤버 전용) — 기존 탭 가드와 일관.

### 업무연계도 v1 범위
- 워크스트림을 레인으로, task 를 노드(색=워크스트림)로 배치 + `task_links` 를 커넥터 라인(CSS/SVG)으로. 인터랙티브 드래그·자동 레이아웃은 v2. v1 은 "읽기 명확성" 우선.

---

## 비범위 (재확인)
다단계 트리 / 부서 예산 / #64 통합보고서(별도) / 신규 간트 엔진(GanttTrack 재사용) / AI 전략 자동생성 / 외부 공유 캔버스 / 연계도 인터랙티브 편집(v2).

---

## 신규/변경 파일 요약
- **모델**: `models/ProjectWorkstream.js`(신규) · `models/Project.js`(6컬럼) · `models/Task.js`(workstream_id) · `models/index.js`(association)
- **백엔드**: `routes/projects.js`(canvas/strategy/metrics/workstreams 라우트 + serialize 헬퍼) · `routes/tasks.js`(PUT workstream_id 수용+검증, 직렬화)
- **프론트**: `pages/QProject/canvas/*`(신규 8) · `QProjectDetailPage.tsx`(dashboard→canvas) · `services/projectCanvas.ts` · i18n ko/en
