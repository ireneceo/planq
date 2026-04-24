# PlanQ 통합 컨텍스트 아키텍처 (Phase 9 — 2026-04-24)

> **이 문서는 Phase 9 의 메인 설계 문서다.** Q Mail 상세, 엔티티 프로필 상세, Task visibility 재설계는 각각의 하위 문서에 위임한다.
> 하위 문서: `docs/ENTITY_PROFILE_SPEC.md` · `docs/Q_MAIL_SPEC.md` · `docs/TASK_VISIBILITY_REDESIGN.md`

## 0. 원칙

1. **하나의 패턴, 모든 엔티티** — 대화방·이메일 스레드·고객·멤버·프로젝트는 **동일한 "360도 뷰"** 로 표현된다. 사용자는 어떤 엔티티에서든 "여긴 지금 어떤 상황이지?" 를 같은 구조로 확인한다.
2. **컨텍스트는 엔티티에 귀속** — 이슈·업무 추출·최근 활동·첨부 자료는 엔티티의 속성이지 메뉴의 속성이 아니다. Q Talk 에만 이슈가 있는 게 아니라, 모든 엔티티가 이슈를 가진다.
3. **AI 는 재사용** — 이슈 요약과 업무 추출 엔진은 엔티티 타입에 상관없이 **같은 서비스 호출**. 소스(메시지/메일 본문/메모)만 다르다.
4. **DB 는 기존 것을 확장** — 새 테이블은 `context_issues` 한 개. `task_candidates` 는 `source_type` 컬럼만 추가해 재사용. 스키마 대수술 금지.
5. **UI-First** — ContextPanel / IssueExtractionList / EntityProfilePage 는 **Mock 먼저** 만들어 Irene 승인 후 백엔드 연결. `CLAUDE.md` UI-First 원칙 준수.

---

## 1. 비전 및 목적

### 1.1 문제 — 컨텍스트 파편화

"이 고객은 지금 무슨 상황이지?" 를 확인하려면 현재 4화면을 돌아야 한다: `/clients` Drawer → `/talk/p/:id/c/:id` → `/tasks?client=` → 이메일(아직 없음). 사용자가 mental model 을 수동 조립해야 한다.

### 1.2 해법 — 360도 통합 뷰

| 엔티티 | 클릭 시 보이는 것 (공통) |
|---|---|
| 고객 | 프로필 + 대화 + 이메일 + 할일 + 청구 + 이슈 + 업무 추출 |
| 멤버 | 프로필 + 담당 고객 + 담당 업무 + 회의 + 이슈 + 업무 추출 |
| 대화방 | 메시지 + 첨부 + 이슈 + 업무 추출 + (연결된 고객/프로젝트) |
| 이메일 스레드 | 메시지 + 첨부 + 이슈 + 업무 추출 + (연결된 고객/프로젝트) |
| 프로젝트 | 개요 + 참여자 + 할일 + 회의 + 이슈 + 업무 추출 |

**모든 엔티티가 동일한 섹션 구성**을 가진다. 사용자는 한 번 패턴을 익히면 어디에 있든 "스크롤 어디쯤 이슈가 있을지" 바로 안다.

### 1.3 경쟁 차별화

| 제품 | 고객 360° | 이메일 통합 | AI 이슈 요약 | AI 업무 추출 | 멀티 소스 |
|---|---|---|---|---|---|
| Front | 부분 (연락처) | O | 부분 | X | 이메일 중심 |
| Slack | X | X | X | Huddle 초벌 | 채팅 중심 |
| Linear | X | X | X | X | 업무 중심 |
| Notion | X | X | X | X | 문서 중심 |
| **PlanQ Phase 9** | **O (모든 엔티티)** | **O** | **O** | **O** | **동일 엔진** |

포지션: "Front + Linear + Slack 을 하나의 context model 로 합친 B2B SaaS".

### 1.4 사용자 가치

- **관리자**: 어떤 엔티티든 이슈/추출 섹션만 보면 팀 상황 파악
- **멤버**: 새 고객 배정 시 프로필 한 화면으로 컨텍스트 복원 (3초)
- **고객**: 본인 기준 360° 뷰 (권한 필터 적용)

---

## 2. 아키텍처 개요

### 2.1 도식

```
Sidebar │ Main
 Dash   │  ┌─ List ─┬─ Detail ─┬─ ContextPanel ─┐     (3컬럼: Q Talk / Q Mail)
 Talk   │  │ 리스트 │ 본문      │ [후보][이슈]     │
 Mail⭐│  │        │           │ [내 할 일]       │
 Task   │  │        │           │ [메타][링크]    │
 Note   │  └────────┴───────────┴──────────────────┘
 Bill   │
 Docs   │  ┌─ EntityProfilePage (단일 컬럼) ──────────┐  (Clients/Members/Projects)
        │  │ Header: 아바타·이름·메트릭·액션            │
 Set    │  │ Tabs: 개요·대화·이메일·할일·회의·청구·파일 │
  고객   │  │ 개요 탭 = ContextPanel 재사용               │
  멤버   │  └──────────────────────────────────────────┘
```

### 2.2 데이터 흐름

```
엔티티 선택 → Promise.all([
   GET /api/<type>s/:id/profile   (또는 /api/context/:type/:id)
   GET /api/context/:type/:id/issues
   GET /api/context/:type/:id/task-candidates
]) → ContextPanel render ── IssueExtractionList(.Issues/.Candidates) + Meta + Links
```

### 2.3 역할 매트릭스

| 역할 | EntityProfile 접근 | ContextPanel | 이슈 추가 | 업무 추출 승인 |
|---|---|---|---|---|
| Owner | 모든 엔티티 | O | O | O |
| Member | 접근 권한 있는 엔티티 | O | O | O |
| Client | 본인 포함 엔티티만 (고객 프로필은 본인) | 필터됨 | 제한적 (개인 이슈만) | X |
| Cue (AI) | API 호출 주체 | — | 자동 생성 (AI 플래그) | 자동 생성 후보 |

---

## 3. 엔티티 모델

### 3.1 공통 인터페이스

```ts
// dev-frontend/src/types/context.ts (신규)
export type EntityType = 'conversation' | 'email_thread' | 'client' | 'member' | 'project';

export interface EntityRef {
  type: EntityType;
  id: number;
  business_id: number;
  title: string;                      // 대화방 이름 / 고객 이름 / 프로젝트명
  subtitle?: string;                  // 회사명 / 부제
  avatar_url?: string | null;
  updated_at: string;                 // 최근 활동 ISO
  metrics?: EntityMetric[];           // 헤더에 표기할 핵심 숫자
}

export interface EntityMetric {
  key: string;                        // 'open_tasks' | 'unread' | 'overdue'
  label: string;                      // i18n key 는 컴포넌트에서
  value: number | string;
  tone?: 'default' | 'warning' | 'danger' | 'point';
}
```

### 3.2 엔티티별 특성 매트릭스

| 엔티티 | 주 소스 | 이슈 소스 | 업무추출 소스 | 프로필 페이지 | Drawer |
|---|---|---|---|---|---|
| `conversation` | messages | 메시지 최근 50 | 같음 | X (우측 패널만) | O (Q Talk) |
| `email_thread` | email_messages (신규) | 본문 최근 20 | 같음 | X (우측 패널만) | O (Q Mail) |
| `client` | 복합 (대화+메일+할일) | 위 모두 합산 | 위 모두 합산 | **O** `/clients/:id` | O (설정→고객) |
| `member` | 복합 (담당 업무+회의) | 담당 대화 합산 | 담당 업무 합산 | **O** `/members/:id` | O (설정→멤버) |
| `project` | messages + tasks + notes | 프로젝트 범위 | 프로젝트 범위 | **O** `/projects/:id` (확장) | X |

### 3.3 엔티티 해석 규칙

- **client**: `conversations WHERE client_id=:id` + `email_threads WHERE client_id=:id` (M2 생성) + `tasks WHERE client_id=:id`. 이슈 집계 = 연결 스레드 이슈 + 고객 고유 이슈 (scope='client')
- **member** (`users.id` where `business_members.role IN ('owner','member')`): `clients WHERE assigned_member_id=:user_id` + `tasks WHERE assignee_id=:user_id` + `calendar_event_attendees WHERE user_id=:user_id`
- **project**: 이미 `project_issues`/`task_candidates` 가 프로젝트 범위로 저장 → 그대로 재사용. 바뀌는 건 컴포넌트 이름뿐 (`RightPanel` → `ContextPanel`)

---

## 4. 공통 컴포넌트 4종

### 4.1 `ContextPanel`

**경로**: `dev-frontend/src/components/Context/ContextPanel.tsx` (신규). `dev-frontend/src/pages/QTalk/RightPanel.tsx:35-464` 을 엔티티 불가지론으로 일반화.

```tsx
interface ContextPanelProps {
  entity: EntityRef;
  sections?: ContextSection[];        // default: ['candidates','issues','myTasks','meta','links']
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  scope?: 'drawer' | 'page-tab';
}
```

**내부 구조**: Header (60px, PanelHeader 규격) → Scroll [Candidates · Issues · MyTasks · Meta · Links]

**재사용 5곳**
1. `/talk/p/:projectId/c/:id` 우측 (기존 RightPanel 교체)
2. `/mail/thread/:id` 우측 (Q Mail 신규)
3. `/clients/:id?tab=overview`
4. `/members/:id?tab=overview`
5. `/projects/:id?tab=overview` (기존 확장)

### 4.2 `IssueExtractionList`

**경로**: `dev-frontend/src/components/Context/IssueExtractionList.tsx` (신규). 이슈·후보를 한 쌍으로 렌더.

```tsx
IssueExtractionList.Issues      // 주요 이슈 (Coral border-left)
IssueExtractionList.Candidates  // 업무 후보 (Teal dashed)

interface IssueListProps {
  entityType: EntityType;
  entityId: number;
  readOnly?: boolean;    // client 뷰에서 true
  onAddIssue?: (body: string) => void;
  onUpdateIssue?: (id: number, body: string) => void;
  onDeleteIssue?: (id: number) => void;
}

interface CandidateListProps {
  entityType: EntityType;
  entityId: number;
  onRegister: (id: number) => void;
  onMerge: (id: number, targetTaskId: number) => void;
  onReject: (id: number) => void;
}
```

**스타일 출처 (기존 유지)**
- 이슈 카드: `RightPanel.tsx:763-797` (`border-left: 2px solid #F43F5E`)
- 후보 섹션: `RightPanel.tsx:565-590` (`linear-gradient(135deg, #FFF1F2 0%, #FEF3C7 100%)`)
- 후보 카드 렌더: `RightPanel.tsx:160-203`

**재사용 5곳**: ContextPanel · EntityProfilePage 개요 탭 · Dashboard "이번 주 주요 이슈" 위젯 · Q Talk 우측 · Q Mail 우측

### 4.3 `EntityProfilePage`

**경로**: `dev-frontend/src/pages/Profile/EntityProfilePage.tsx` (신규). `QProjectDetailPage.tsx` 의 탭 구조를 일반화.

```tsx
interface EntityProfilePageProps {
  entityType: 'client' | 'member' | 'project';
  entityId: number;
}
```

**레이아웃**
- 헤더: PageShell 규격 (`components/Layout/PageShell.tsx:25-46` — 60px / 18px 700). 좌측 아바타+이름+메트릭 배지, 우측 액션
- 탭 7종: `개요 / 대화 / 이메일 / 할일 / 회의 / 청구 / 파일`
  - 개요: `ContextPanel scope='page-tab'`
  - 대화: 연결된 conversations 리스트 → 클릭 시 채널 라우팅
  - 이메일: 연결된 email_threads 리스트 → Q Mail 라우팅
  - 할일: tasks 리스트 + TaskDetailDrawer URL 싱크
  - 회의: calendar_events 리스트
  - 청구: invoices 리스트
  - 파일: 기존 `pages/QProject/DocsTab.tsx` 재사용 (scope='entity')
- URL 싱크 `?tab=overview` (기본 탭 유지, 탭엔 재클릭 토글 미적용)

### 4.4 `EntityLink`

**경로**: `dev-frontend/src/components/Context/EntityLink.tsx` (신규). 엔티티 간 한 번 클릭 이동.

```tsx
interface EntityLinkProps {
  type: EntityType;
  id: number;
  title: string;
  avatar_url?: string | null;
  size?: 'sm' | 'md';        // sm inline 12px / md chip 14px
  openInDrawer?: boolean;    // true: DetailDrawer / false: route push
}
```

**경로 매핑**: `conversation → /talk/p/:pid/c/:id` · `email_thread → /mail/thread/:id` · `client → /clients/:id` · `member → /members/:id` · `project → /projects/:id`

**재사용 5곳**: ContextPanel Links 섹션 · 메시지 멘션 (@client/@member) · Dashboard todo actor · EntityProfilePage breadcrumb · Task detail "관련 대화/이메일"

---

## 5. 통합 API 설계

모든 응답은 `CLAUDE.md` 표준 `{ success, data }` 형식. 권한은 `middleware/auth.js` + `checkBusinessAccess` 공통 적용.

### 5.1 엔드포인트 목록

| # | 메서드 | 경로 | 용도 |
|---|---|---|---|
| 1 | GET | `/api/context/:type/:id/issues` | 이슈 목록 (모든 엔티티 공통) |
| 2 | GET | `/api/context/:type/:id/task-candidates` | 업무 추출 후보 (모든 엔티티 공통) |
| 3 | GET | `/api/clients/:id/profile` | 고객 360도 뷰 |
| 4 | GET | `/api/members/:id/profile` | 멤버 360도 뷰 |
| 5 | GET | `/api/email-threads/:id` | 이메일 스레드 상세 (Q Mail) |
| 6 | GET | `/api/projects/:id/profile` | 프로젝트 360도 뷰 (기존 확장) |

### 5.2 GET `/api/context/:type/:id/issues`

**요청**
```
GET /api/context/client/42/issues?limit=20&include_resolved=false
Authorization: Bearer {token}
```

**응답**
```json
{
  "success": true,
  "data": {
    "entity": { "type": "client", "id": 42, "title": "ACME Corp" },
    "issues": [
      {
        "id": 128,
        "body": "포트원 결제 3회 실패 — 2026-04-22 이후 결제 중단",
        "source_type": "message",
        "source_id": 9821,
        "author": { "id": 3, "name": "Cue", "is_ai": true },
        "created_at": "2026-04-22T09:12:00Z",
        "updated_at": "2026-04-22T09:12:00Z"
      }
    ],
    "total": 1
  }
}
```

**권한 체크**
- `type='client'`: `req.user` 가 해당 `business_id` 소속이거나 본인이 client 인 경우
- `type='member'`: 같은 워크스페이스 멤버만 (민감 영역)
- `type='conversation'`/`email_thread'`: 참여자만
- `type='project'`: 프로젝트 멤버만

### 5.3 GET `/api/context/:type/:id/task-candidates`

**요청/응답** 은 기존 `task_candidates` 응답 스키마 재사용. 엔티티별 필터링만 추가.

```
GET /api/context/client/42/task-candidates
  → tasks_candidates WHERE project_id IN (<client 의 프로젝트>) OR conversation_id IN (<client 의 대화>)
```

### 5.4 GET `/api/clients/:id/profile`

```json
{
  "success": true,
  "data": {
    "entity": {
      "type": "client", "id": 42,
      "title": "ACME Corp", "subtitle": "김대리", "avatar_url": null,
      "metrics": [
        { "key": "open_tasks",  "value": 7, "tone": "default" },
        { "key": "overdue",     "value": 2, "tone": "danger" },
        { "key": "unread_msgs", "value": 4, "tone": "point" }
      ],
      "updated_at": "2026-04-23T14:00:00Z"
    },
    "linked": {
      "conversations": [{ "id": 101, "title": "ACME 일반", "last_message_at": "..." }],
      "email_threads": [{ "id": 12, "subject": "견적 재요청" }],
      "projects":      [{ "id": 7, "name": "ACME 사이트 리뉴얼" }],
      "tasks_summary":    { "open": 7, "overdue": 2, "completed_this_week": 3 },
      "invoices_summary": { "outstanding": 2, "overdue_amount": 1200000 }
    }
  }
}
```

**구현 힌트**: `dev-backend/routes/dashboard.js:38-130` 의 `collectTasks` 패턴을 엔티티 단위로 확장. N+1 회피 위해 `Promise.all([conversations, threads, tasksSummary, invoicesSummary])`.

### 5.5 GET `/api/members/:id/profile`

- `user_id=:id` 가 같은 워크스페이스 멤버인지 검증
- 구조는 `/clients/:id/profile` 과 동형, `linked.assigned_clients` + `linked.upcoming_events` 추가
- 본인이 아닌 경우 `linked.personal_issues` 제외 (visibility='private' 필터)

### 5.6 GET `/api/email-threads/:id`

상세는 `docs/Q_MAIL_SPEC.md` 위임. 공통 계약: `entity` 블록(EntityRef 규격) + `linked.client_id` 포함해 역링크 가능.

### 5.7 GET `/api/projects/:id/profile`

현재 `routes/projects.js` 응답에 EntityRef 블록 추가만. breaking change 없음.

### 5.8 에러 응답

```json
{ "success": false, "message": "context.notFound" }   // i18n key
{ "success": false, "message": "context.forbidden" }
```

---

## 6. 디자인 토큰

`COLOR_GUIDE.md` 와 `UI_DESIGN_GUIDE.md` 에 이미 정의된 토큰만 사용. 신규 색 추가 금지.

### 6.1 엔티티 헤더 (EntityProfilePage)

| 요소 | 값 |
|---|---|
| 헤더 높이 | `min-height: 60px` (PageShell 규격) |
| 제목 | `font-size: 18px; font-weight: 700; letter-spacing: -0.2px` |
| 부제 (회사명 등) | `font-size: 13px; color: #64748B` |
| 아바타 | 40x40 (헤더), 64x64 (확장 뷰), `LetterAvatar` 재사용 |

### 6.2 메트릭 배지 (EntityMetric)

| tone | 배경 | 텍스트 | 용도 |
|---|---|---|---|
| `default` | `#F1F5F9` | `#334155` | 일반 숫자 |
| `warning` | `#FEF3C7` | `#92400E` | 임박 (3일 내) |
| `danger` | `#FEE2E2` | `#991B1B` | 지연/미결 |
| `point` | `#FFE4E6` | `#9F1239` | 미읽음·AI 감지 (화면당 1-2개 한도) |

배지 공통: `padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700;`

### 6.3 이슈 카드

- 배경 `#F8FAFC`, 좌측 `border-left: 2px solid #F43F5E` (Coral/Point 500)
- 편집 입력: Primary border `#14B8A6` + shadow `rgba(20, 184, 166, 0.12)`
- 참조: `RightPanel.tsx:763-797`

### 6.4 업무 추출 카드

- 섹션: `linear-gradient(135deg, #FFF1F2 0%, #FEF3C7 100%)` + `border: 1px solid #FECDD3` (`RightPanel.tsx:565-580`)
- 개별 카드: 배경 `#FFFFFF` + **`border: 1px dashed #5EEAD4`** (기존 solid → dashed 로 변경해 이슈와 시각 구분)
- 등록 = Primary teal, 거절 = Ghost (액션 3톤 §1.7 준수)

### 6.5 ContextPanel 탭 active

`background: #F0FDFA; color: #0F766E; border-bottom: 2px solid #14B8A6` — COLOR_GUIDE §1 Primary 스케일.

### 6.6 EntityLink 칩

| size | padding | font | avatar |
|---|---|---|---|
| sm | `1px 6px` | `11px / 600` | 14x14 |
| md | `4px 10px` | `13px / 500` | 20x20 |

호버 `background: #F1F5F9`, 클릭 시 route push 또는 drawer.

---

## 7. AI 이슈 요약 엔진

### 7.1 입력 소스 (엔티티별)

| 엔티티 | 입력 원본 | 최대 길이 |
|---|---|---|
| conversation | 최근 50 messages (is_deleted=false, is_internal 포함) | 8K tokens |
| email_thread | 최근 20 email_messages 본문 + 제목 | 12K tokens |
| client | 연결 conversation/thread 통합 요약 (1차 요약 결과 재요약) | 6K tokens |
| member | 담당 고객별 요약 재집계 | 8K tokens |
| project | 프로젝트 messages + notes + task 코멘트 | 12K tokens |

### 7.2 모델 선택

- **기본**: `gpt-4o-mini` — 입력 $0.15 / 출력 $0.60 per 1M (SYSTEM_ARCHITECTURE §10.7)
- 긴 컨텍스트 (12K+): `gpt-4o-mini` 유지. gpt-4o 는 명시적 옵션에서만
- **Cue usage 기록 필수** — `cue_usage.action_type = 'issue_summary'`, 3 액션

### 7.3 프롬프트 템플릿

```
시스템: 너는 B2B 업무 컨텍스트를 요약하는 어시스턴트다. 아래 메시지/본문에서
 - 쟁점 (이슈)
 - 약속된 다음 액션 (업무 후보)
 - 시급한 데드라인
 3가지만 JSON 으로 추출한다. 추측하지 말고 근거가 있는 것만.

엔티티: {entity.type} "{entity.title}"
{소스 텍스트 블록들 — 각 블록 앞에 타임스탬프·발화자}

출력 스키마 (JSON):
{
  "issues": [{"body": "…", "source_index": 3, "confidence": 0.0~1.0}],
  "candidates": [{"title": "…(결과물 형)", "description": "…", "due_hint": "YYYY-MM-DD|null", "source_index": 7}],
  "deadlines": [{"what": "…", "when": "YYYY-MM-DD"}]
}
```

**결과물 기반 업무명 강제** — memory `feedback_task_naming` 준수. 프롬프트에 명시:
> 업무명은 반드시 결과물이 있는 완료 시점이 명확한 형태로. "시장조사" 금지 → "경쟁사 비교분석표 작성" 형태.

### 7.4 출력 스키마 → DB 적재

- `issues[]` → `context_issues` (신규 테이블, §9.1 참조)
- `candidates[]` → `task_candidates` (기존 테이블, `source_type` 컬럼 추가)
- `deadlines[]` → ContextPanel 의 경고 배지 (별도 저장 없이 화면에서만 강조)

### 7.5 갱신 트리거

| 트리거 | 실행 시점 | 범위 |
|---|---|---|
| 새 메시지 N개 도착 | debounce 60초 | 해당 conversation/thread |
| 사용자 "재분석" 버튼 | 즉시 | 해당 엔티티 |
| 일일 배치 | 매일 03:00 KST | active=true 인 고객/프로젝트 |
| 엔티티 최초 열람 | 캐시 만료 시 (TTL 6시간) | 해당 엔티티 |

**비용 가드**
- 동일 엔티티 최소 재분석 간격 5분
- Cue 월 액션 한도 도달 시 새 요약 스킵, 기존 캐시 표시

---

## 8. AI 업무 추출 엔진

### 8.1 기존 자산 재사용

- 테이블 `task_candidates` 이미 존재 (`dev-backend/models/TaskCandidate.js:1-34`)
- 프론트 UI 이미 존재 (`RightPanel.tsx:147-205`)
- **확장 필요**: 엔티티 다양성 반영을 위해 `source_type` 컬럼 추가

### 8.2 테이블 확장

```sql
ALTER TABLE task_candidates ADD COLUMN source_type
  ENUM('conversation', 'email_thread', 'project', 'client', 'member')
  NOT NULL DEFAULT 'conversation' AFTER conversation_id;
ALTER TABLE task_candidates ADD COLUMN source_entity_id INT NULL AFTER source_type;
ALTER TABLE task_candidates ADD INDEX idx_source (source_type, source_entity_id);
```

### 8.3 엔티티별 소스 매핑

| entity_type | source_type | source_entity_id |
|---|---|---|
| conversation | `conversation` | conversation.id |
| email_thread | `email_thread` | email_thread.id |
| client | `client` (집계) | client.id |
| member | `member` (담당 업무 추출) | user.id |
| project | `project` | project.id |

### 8.4 업무명 결과물 기반 원칙 (memory `feedback_task_naming`)

프롬프트에 명시적 제약:
- "업무명은 **결과물 명사 + 동사** 형태" — "경쟁사 비교분석표 **작성**", "포트원 결제 연동 **완료**"
- "완료 조건을 명확히 읽을 수 있어야 함"
- 위반 예시: "시장조사", "논의", "검토" → 모두 금지
- 검증: 서버에서 title 이 금지어(시장조사/논의/검토/확인)만으로 끝나면 drop 후 재요청

### 8.5 승인/거절 UX

기존 UX 유지 (`RightPanel.tsx:189-201`):
- **등록** (Primary) → `task_candidates.status = 'registered'`, `tasks` 새 행 생성
- **내용 추가** (Outline) → 유사 기존 task 와 merge (similar_task_id 존재 시만 표시)
- **거절** (Ghost) → `status = 'rejected'`

**신규 추가**: 엔티티별 중복 제출 가드 (`UI_DESIGN_GUIDE.md` §1.8). submitting state 필수.

---

## 9. Phase M0~M4 상세

> 총 9주. Phase 8 반응형 스프린트는 **M5 로 흡수** — 모든 신규 컴포넌트가 DetailDrawer 프리미티브를 사용하고 반응형 3구간 정책을 지키므로, 별도 스프린트 분리 불필요. 다만 기존 페이지 반응형 검증(CalendarPage 등)은 M5 로 남겨둠.

### M0 — 인프라 (1주)

**작업**
- [ ] `context_issues` 테이블 생성:

  ```sql
  CREATE TABLE context_issues (
    id INT AUTO_INCREMENT PRIMARY KEY,
    business_id INT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    entity_type ENUM('conversation','email_thread','client','member','project') NOT NULL,
    entity_id INT NOT NULL,
    body TEXT NOT NULL,
    author_user_id INT NOT NULL REFERENCES users(id),
    is_ai_generated BOOLEAN DEFAULT FALSE,
    ai_model VARCHAR(50) NULL,
    ai_confidence DECIMAL(4,3) NULL,
    resolved_at DATETIME NULL,
    resolved_by_user_id INT NULL REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_entity (business_id, entity_type, entity_id),
    INDEX idx_unresolved (business_id, resolved_at)
  );
  ```
  기존 `project_issues` (`ProjectIssue.js:1-17`) 는 유지, 이후 뷰로 추상화
- [ ] `task_candidates.source_type` 컬럼 추가 (§8.2)
- [ ] `dev-frontend/src/types/context.ts` — EntityRef / EntityMetric / EntityType
- [ ] i18n: `ko|en/unified.json` + `ko|en/client.json` + `ko|en/member.json`, `i18n.ts` ns 등록
- [ ] 라우트 스텁: `routes/context.js`, `routes/clientsProfile.js`, `routes/membersProfile.js`

**테스트**: `sync-database.js` 성공 / `GET /api/context/client/1/issues` 200 빈 배열 / i18n 무경고 로드

### M1 — EntityProfilePage (2주)

**작업**
- [ ] `EntityProfilePage.tsx` (QProjectDetailPage 탭 구조 일반화)
- [ ] 라우트 `/clients/:id`, `/members/:id`
- [ ] 탭 7개 구현 (개요·대화·이메일[placeholder]·할일·회의·청구·파일)
- [ ] `/api/clients/:id/profile`, `/api/members/:id/profile`
- [ ] `ClientsPage` Drawer → "상세 보기" 버튼 추가
- [ ] EntityLink 컴포넌트
- [ ] Dashboard todo actor 클릭 시 EntityProfilePage 이동

**테스트**: metrics overdue 카운트 정확 / 타 멤버 프로필 personal 이슈 제외 / `?tab=tasks` 직접 진입 / ≤640px 탭 가로 스크롤

### M2 — Q Mail 기반 (2.5주)

상세는 `docs/Q_MAIL_SPEC.md` 위임. 본 Phase 에서 책임:
- [ ] `email_threads`, `email_messages` 테이블 생성
- [ ] Q Mail 3컬럼 페이지 (리스트 / 스레드 / ContextPanel)
- [ ] IMAP/SMTP 스텁
- [ ] `/api/email-threads/:id` (EntityRef 규격)
- [ ] 사이드바 Q Talk 아래 Q Mail 메뉴, i18n `layout.nav.qmail`

### M3 — AI 엔진 (2주)

**작업**
- [ ] `services/ai/issueSummaryService.js` — 엔티티별 소스 로더 + 프롬프트 빌더 + 결과 파서 + `context_issues`/`task_candidates` 적재
- [ ] `services/ai/taskExtractionService.js` — 결과물명 규칙 서버 검증
- [ ] Cue usage 기록 (`action_type`: `issue_summary` / `task_extraction`)
- [ ] 갱신 트리거 (§7.5): debounce·수동·cron
- [ ] TTL 캐시 6시간
- [ ] `POST /api/context/:type/:id/reanalyze`

**테스트**: 샘플 대화 30건 → 이슈 2~5 + 후보 3~7 / 5분 내 재요청 캐시 / 월 한도 hard-cap / 금지어 drop 재시도

### M4 — Cue 답변 + Q Talk 확장 (1.5주)

**작업**
- [ ] `ContextPanel.tsx` 작성 (RightPanel UI 추출)
- [ ] `IssueExtractionList.Issues` / `.Candidates` 분리
- [ ] QTalkPage RightPanel → ContextPanel 교체
- [ ] 대화방에 고객 있으면 ContextPanel 상단에 고객 EntityLink + 이메일/이슈/업무 합산
- [ ] Cue 답변 생성 (KB RAG + 이슈 컨텍스트 조합)
- [ ] Q Mail 동일 패턴 적용
- [ ] 회귀 테스트: Q Talk 우측 패널 동작 100% 유지

**테스트**: 채팅방 선택 시 우측에 고객 이슈+이메일 2건 / ⌘/ 단축키 / Client 뷰 candidates 숨김 / ≤1200px FloatingPanelToggle

---

## 10. 검증 시나리오

### 10.1 360도 일관성

| 시나리오 | 기대 |
|---|---|
| 고객 프로필 개요 탭 이슈 수 | 연결된 conversation + email_thread 이슈 합산 |
| 같은 고객의 대화방 → ContextPanel 이슈 | 해당 대화만 (부분집합) |
| 고객 프로필 할일 탭 총 수 | 멤버 프로필 "담당 고객 업무" 와 일치 |
| 멤버 프로필 → 담당 고객 5명 EntityLink 이동 | 5회 네비게이션 정상 |

### 10.2 재사용 검증

- [ ] `grep -rn "from.*Context/ContextPanel" dev-frontend/src` → 5곳 hit
- [ ] `IssueExtractionList` CSS 단일 정의 (중복 복제 없음)
- [ ] `EntityLink` 가 DashboardTodo / ContextPanel / MessageMention / Breadcrumb / TaskDetail 전부에서 사용

### 10.3 권한별 노출

| 역할 | 상황 | 기대 |
|---|---|---|
| Client | 본인 프로필 | metrics O, 내부 이슈 X |
| Client | 타인 프로필 | 403 |
| Member | 타 멤버 프로필 | personal 이슈 제외 |
| Member | 본인 프로필 | personal 포함 |
| Owner | 모든 엔티티 | 전체 |

### 10.4 성능 (N+1 회피)

- [ ] `/api/clients/:id/profile` p95 < 400ms (고객 10, 각 100 메시지)
- [ ] SQL 쿼리 ≤ 6회 (Promise.all 병렬)
- [ ] ContextPanel — 이슈·후보 2회 API 호출 이내
- [ ] 일일 크론 100 고객 < 10분, Cue usage 정확

### 10.5 AI 품질 스모크

- [ ] 업무명 결과물형 샘플 20개 ≥ 90%
- [ ] 동일 원본 재분석 시 90% 유사 이슈 merge
- [ ] 환각 가드: 소스 없는 고유명사·금액 등장 시 confidence < 0.5 강등, "검증 필요" 뱃지

### 10.6 검증 보고 템플릿 (M별 필수)

CLAUDE.md 검증 단계 준수: 빌드 성공 / 실제 API 호출 로그 / 페이지 렌더링 / 체크리스트 ✅❌ / Cue usage 증가분 실측.

---

## 11. 관련 문서 (cross-reference)

| 문서 | 이 문서에서 위임한 부분 |
|---|---|
| `docs/ENTITY_PROFILE_SPEC.md` | 고객/멤버 프로필 페이지의 탭별 상세 UI, 필드 편집 룰, AutoSaveField 적용 |
| `docs/Q_MAIL_SPEC.md` | IMAP/SMTP 설정, 이메일 DB 스키마, 스레드 그룹화 알고리즘, 서명/템플릿, Phase M2 세부 체크리스트 |
| `docs/TASK_VISIBILITY_REDESIGN.md` | `tasks.visibility` 컬럼 도입, 개인/워크스페이스/공유 3모드, Q Task 필터 UI 변경, 마이그레이션 플랜 |
| `docs/SYSTEM_ARCHITECTURE.md` §10 | Cue 액션 단가·한도. 본 문서 §7.2, §8, §9 의 비용 산정 근거 |
| `docs/DATABASE_ERD.md` | 기존 28개 테이블. Phase 9 추가: `context_issues`, `email_threads`, `email_messages` (3개) |
| `docs/API_DESIGN.md` | 공통 응답 규약. Phase 9 API 6종이 여기 규약 준수 |
| `dev-frontend/UI_DESIGN_GUIDE.md` | 액션 3톤, 중복 제출 가드, URL 싱크, 드로어 접근성 — 모든 신규 컴포넌트 준수 |
| `dev-frontend/COLOR_GUIDE.md` | §6 디자인 토큰의 색상 출처 |

---

## 12. 변경 이력

| 날짜 | 버전 | 요약 |
|---|---|---|
| 2026-04-24 | 1.0 | Phase 9 메인 설계 문서 최초 작성. 360도 통합 컨텍스트 아키텍처 확정. 9주 M0~M4 로드맵 포함. |
