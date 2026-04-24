# PlanQ 템플릿 시스템 (Template System Spec)

> **프로젝트·테이블·견적·청구·구독·회의·서명 — 모든 엔티티가 템플릿으로 시작할 수 있다.**
> 상위 지도: `INTEGRATED_ARCHITECTURE.md §3`
>
> 작성: 2026-04-24 · 상태: 설계 확정 (구현 Phase 1·3 분산)

---

## 1. 철학

1. **한 테이블 + kind** — 엔티티 종류마다 별도 테이블을 만들면 동일 메커니즘(공유·버전·검색)이 반복된다. `templates` 하나에 `kind` 로 구분.
2. **system / workspace / user 3 scope** — PlanQ 기본(누구나 복제), 워크스페이스 공용(내부 공유), 개인 초안. Linear·Notion 과 동일 구조.
3. **스냅샷 생성** — 템플릿으로 만든 프로젝트/견적/청구는 **독립 인스턴스**. 이후 템플릿이 수정돼도 영향 없음. (Irene 결정 #7)
4. **content JSON schema 는 kind 별 고정** — 타입스크립트로 명시. 백엔드·프론트 양쪽 공유.
5. **모든 "만들기" 진입점에 템플릿 선택이 첫 화면** — UX 약속 §9.1.

---

## 2. 데이터 모델

### 2.1 `templates` (신규)

```sql
CREATE TABLE templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kind ENUM(
    'project_schedule', 'process_table',
    'quote', 'invoice', 'subscription',
    'meeting_agenda', 'email_signature'
  ) NOT NULL,
  scope ENUM('system', 'workspace', 'user') NOT NULL,
  business_id INT NULL,              -- scope='workspace' 시 필수
  owner_user_id INT NULL,            -- scope='user' 시 필수, 'workspace' 시 생성자
  name VARCHAR(200) NOT NULL,
  description TEXT,
  content JSON NOT NULL,             -- kind 별 schema (§3)
  thumbnail_url VARCHAR(500),
  tags JSON,                         -- ["웹사이트","에이전시"] 등
  usage_count INT DEFAULT 0,         -- 복제된 횟수 (인기 순 정렬)
  is_public BOOLEAN DEFAULT FALSE,   -- Phase 10 마켓플레이스 예약 필드 (기본 false)
  version INT DEFAULT 1,             -- 스냅샷 보존용 (수정 시 +1)
  created_at DATETIME,
  updated_at DATETIME,
  INDEX idx_kind_scope (kind, scope),
  INDEX idx_business (business_id, kind),
  INDEX idx_owner (owner_user_id, kind),
  INDEX idx_usage (kind, usage_count DESC)
);
```

### 2.2 스냅샷 연결 (역추적)

템플릿으로 생성된 엔티티는 자기 FK 에 `template_id` + `template_version` 저장 (선택 컬럼).

```sql
ALTER TABLE projects       ADD COLUMN template_id INT NULL, ADD COLUMN template_version INT NULL;
ALTER TABLE quotes         ADD COLUMN template_id INT NULL, ADD COLUMN template_version INT NULL;
ALTER TABLE invoices       ADD COLUMN template_id INT NULL, ADD COLUMN template_version INT NULL;
-- Task, CalendarEvent, Post 는 "어느 템플릿에서 파생됐는가" 추적 필요 없음 (프로젝트/견적에 딸려옴)
```

**역추적 용도**: "이 프로젝트는 웹사이트 제작 템플릿 v3 로 만들어졌습니다" UI 라벨 + 통계.

### 2.3 권한 (PERMISSION_MATRIX 매핑)

| 작업 | system | workspace | user |
|---|---|---|---|
| 복제해서 사용 | 모든 member | 모든 member | 본인만 |
| 조회 | 모든 member | 모든 member | 본인만 |
| 편집 | **불가** (PlanQ 업데이트만) | **owner / PM** (workspace permissions.financial 또는 schedule 에 따름) | 본인만 |
| 삭제 | 불가 | owner 만 | 본인만 |
| 공개(user→workspace 승격) | N/A | owner 승인 | 본인이 제안 |

**권한 미들웨어**: 기존 `canFinancial` (quote/invoice kind) · `canSchedule` (project_schedule/process_table/subscription kind) 재사용.

---

## 3. kind 별 content JSON Schema

### 3.1 `project_schedule` — 프로젝트 일정 템플릿

```typescript
interface ProjectScheduleTemplate {
  duration_weeks: number;                 // 전체 기간 (주)
  default_project_type: 'fixed' | 'ongoing';
  default_billing_type?: 'fixed' | 'hourly' | 'subscription';
  milestones: Array<{
    week: number;                         // 시작 주차 (1-based)
    duration_weeks: number;
    name: string;
    description?: string;
    color?: string;                       // hex
  }>;
  tasks: Array<{
    title: string;                        // 결과물 기반 명사+동사 (feedback_task_naming 준수)
    description?: string;
    milestone_index?: number;             // milestones 배열 인덱스
    offset_days: number;                  // 프로젝트 시작일 기준 +N일에 start_date
    duration_days: number;                // offset_days + duration_days = due_date
    estimated_hours?: number;
    assignee_role?: string;               // '기획' | '디자인' | '개발' (project_member.role 매칭)
    category?: string;
    priority?: 'low' | 'normal' | 'high';
  }>;
  process_table?: {                       // 선택 — 프로젝트 '테이블' 탭 동시 생성
    template_id: number;                  // kind='process_table' 템플릿 참조
  };
  recurring?: Array<{                     // 선택 — 반복 업무 (구독 프로젝트 경우)
    title: string;
    rrule_str: string;                    // 'FREQ=MONTHLY;BYMONTHDAY=15'
    assignee_role?: string;
    estimated_hours?: number;
  }>;
}
```

**예시 (시스템 기본)**: `"웹사이트 제작 12주"` 샘플
```json
{
  "duration_weeks": 12,
  "default_project_type": "fixed",
  "default_billing_type": "fixed",
  "milestones": [
    { "week": 1, "duration_weeks": 2, "name": "기획·리서치", "color": "#6366F1" },
    { "week": 3, "duration_weeks": 3, "name": "디자인", "color": "#F43F5E" },
    { "week": 6, "duration_weeks": 5, "name": "개발", "color": "#14B8A6" },
    { "week": 11, "duration_weeks": 2, "name": "QA·배포", "color": "#F59E0B" }
  ],
  "tasks": [
    { "title": "킥오프 미팅 진행", "milestone_index": 0, "offset_days": 1, "duration_days": 1, "estimated_hours": 2 },
    { "title": "경쟁사 비교 분석표 작성", "milestone_index": 0, "offset_days": 2, "duration_days": 5, "estimated_hours": 8, "assignee_role": "기획" },
    { "title": "사이트맵 확정", "milestone_index": 0, "offset_days": 7, "duration_days": 3, "estimated_hours": 4, "assignee_role": "기획" },
    { "title": "메인 시안 3안 제작", "milestone_index": 1, "offset_days": 14, "duration_days": 7, "estimated_hours": 20, "assignee_role": "디자인" }
    // ...
  ]
}
```

### 3.2 `process_table` — Q Project 테이블 탭 템플릿

현재 `project_process_columns` + `project_process_parts` 구조.

```typescript
interface ProcessTableTemplate {
  tab_label?: string;                     // '테이블' · '체크리스트' · '파이프라인'
  columns: Array<{
    label: string;
    type: 'text' | 'status' | 'member' | 'date' | 'number' | 'select';
    width?: number;
    options?: string[];                   // type='select' 시
  }>;
  rows: Array<{                           // 기본 행 (사용자가 복제 후 편집)
    cells: Record<string, unknown>;       // column.label → value
  }>;
}
```

**예시**: `"클라이언트 온보딩 체크리스트"`
```json
{
  "tab_label": "온보딩",
  "columns": [
    { "label": "항목", "type": "text", "width": 240 },
    { "label": "상태", "type": "status", "options": ["대기","진행","완료"] },
    { "label": "담당", "type": "member" },
    { "label": "마감", "type": "date" },
    { "label": "비고", "type": "text" }
  ],
  "rows": [
    { "cells": { "항목": "계약서 서명", "상태": "대기" } },
    { "cells": { "항목": "브랜드 가이드 수령" } },
    { "cells": { "항목": "액세스 권한 공유 (Slack/Figma/Git)" } }
  ]
}
```

### 3.3 `quote` / `invoice` — 견적서 / 청구서 템플릿

```typescript
interface QuoteInvoiceTemplate {
  title_format?: string;                  // '{{client_name}} - {{year}}년 {{month}}월'
  default_payment_terms?: string;         // '세금계산서 수령 후 14일 이내'
  default_notes?: string;
  default_vat_rate?: number;              // 0.100
  default_currency?: 'KRW' | 'USD' | 'EUR';
  items: Array<{
    description: string;
    quantity?: number;                    // 기본 1
    unit_price?: number;
    source_type?: 'task_hours' | 'manual' | 'recurring';
  }>;
  pdf_design?: {                          // PDF 렌더링 변수 (Phase 1 상세)
    logo_position?: 'top-left' | 'top-center';
    accent_color?: string;                // hex
    footer_text?: string;
  };
}
```

**예시**: `"월간 호스팅 운영 청구"` (구독형)
```json
{
  "title_format": "{{client_name}} - {{year}}년 {{month}}월 호스팅 운영",
  "default_payment_terms": "세금계산서 수령 후 7일 이내",
  "default_notes": "기본 서버 모니터링·백업·보안 패치 포함. CDN 트래픽 별도 정산.",
  "default_vat_rate": 0.100,
  "items": [
    { "description": "웹서버 운영 (기본)", "quantity": 1, "unit_price": 300000 },
    { "description": "CDN 트래픽 (GB)", "source_type": "manual" }
  ]
}
```

### 3.4 `subscription` — 정기 구독 상품 템플릿

```typescript
interface SubscriptionTemplate {
  billing_type: 'subscription';
  monthly_fee: number;
  billing_day: number;                    // 매월 N일 (1~28)
  invoice_template_id?: number;           // kind='invoice' 템플릿 참조 (자동 청구에 사용)
  recurring_tasks?: Array<{               // 자동 생성 업무
    title: string;
    rrule_str: string;                    // 'FREQ=MONTHLY;BYMONTHDAY=15'
    assignee_role?: string;
    estimated_hours?: number;
  }>;
  scope_description: string;              // '월 10시간 서버 운영 · 주 1회 점검'
  overage_unit_price?: number;            // 추가 사용 시 시간당 단가
}
```

### 3.5 `meeting_agenda` — Q Note 회의 안건 템플릿

```typescript
interface MeetingAgendaTemplate {
  meeting_type: 'weekly' | 'monthly' | 'kickoff' | 'review' | 'retrospective' | 'custom';
  duration_minutes?: number;
  agenda: Array<{
    time_minutes: number;                 // 할당 시간
    topic: string;
    notes?: string;
  }>;
  default_attendee_roles?: string[];      // '기획','디자인','개발' 등
  required_materials?: string[];          // 첨부 권장 자료 (사전 업로드 유도)
}
```

### 3.6 `email_signature` — Q Mail 서명 (Phase 9)

```typescript
interface EmailSignatureTemplate {
  html: string;                           // 서명 HTML (안전한 sanitized subset)
  text_fallback: string;
  variables?: {                           // 사용자별 자동 치환
    name?: boolean;
    title?: boolean;
    business_name?: boolean;
    phone?: boolean;
  };
}
```

---

## 4. 시스템 기본 템플릿 (PlanQ 제공)

### 4.1 `project_schedule` 기본 5종 (Phase 3 출시)
1. **웹사이트 제작 12주** (기획 2 / 디자인 3 / 개발 5 / QA 2)
2. **브랜드 아이덴티티 6주** (리서치 1 / 시안 2 / 가이드 2 / 적용 1)
3. **앱 제작 16주** (기획 3 / 디자인 4 / 개발 7 / QA·배포 2)
4. **영상 제작 4주** (기획 1 / 촬영 1 / 편집 1.5 / 보정·납품 0.5)
5. **마케팅 캠페인 8주** (리서치 1 / 콘텐츠 제작 3 / 집행 3 / 리포트 1)

### 4.2 `process_table` 기본 4종
1. **클라이언트 온보딩 체크리스트**
2. **콘텐츠 제작 파이프라인**
3. **리뷰·승인 프로세스**
4. **출시 전 QA 체크리스트**

### 4.3 `quote`·`invoice` 기본 3종
1. **고정가 프로젝트 견적** (1회성 디자인/개발 외주)
2. **시간 기반 청구** (컨설팅·유지보수)
3. **월정액 구독** (호스팅·지원)

### 4.4 `subscription` 기본 2종
1. **월정액 유지보수** (월 10시간 포함 · 초과 ₩120,000/h)
2. **월간 콘텐츠 운영** (월 4건 콘텐츠 제작·게시)

### 4.5 `meeting_agenda` 기본 3종
1. **주간 정기 미팅** (30분 · 진척·블록·다음 주)
2. **프로젝트 킥오프** (90분 · 목표·범위·일정·역할)
3. **스프린트 회고** (45분 · Keep·Problem·Try)

**운영**: system 템플릿은 `scripts/seed-system-templates.js` 로 설치 (dev/prod 공통). 버전 업데이트는 스크립트 재실행.

---

## 5. API 엔드포인트

```
공통
  GET    /api/templates?kind=&scope=&business_id=  (owner/member 조회)
  GET    /api/templates/:id                         (상세)
  POST   /api/templates                             (생성 — scope 'workspace' 는 owner/PM, 'user' 는 누구나)
  PUT    /api/templates/:id                         (편집 — scope 별 권한)
  DELETE /api/templates/:id                         (scope 별 권한)
  POST   /api/templates/:id/clone                   (복제 — workspace→user, system→workspace)

사용 (스냅샷 생성)
  POST   /api/projects/from-template                body: { template_id, name, start_date, client_id?, members? }
  POST   /api/quotes/from-template                  body: { template_id, client_id, ... }
  POST   /api/invoices/from-template                body: { template_id, client_id, ... }

관리자 (system scope)
  POST   /api/admin/templates (platform_admin)      system 템플릿 등록
  PUT    /api/admin/templates/:id (platform_admin)
  DELETE /api/admin/templates/:id (platform_admin)
```

---

## 6. UI 설계

### 6.1 템플릿 갤러리

**위치**: "새 프로젝트 / 새 견적 / 새 청구서 / 새 구독 상품" 등 **모든 만들기 진입점**의 첫 화면.

```
┌──────────────────────────────────────────────────────────────┐
│  새 프로젝트 만들기                                           │
│  [빈 프로젝트] [시스템 템플릿] [내 워크스페이스] [내 템플릿]  │
├──────────────────────────────────────────────────────────────┤
│  🔍 검색      태그: [웹] [디자인] [개발] [운영] ...            │
│  ┌─────────┬─────────┬─────────┐                              │
│  │         │         │         │                              │
│  │  썸네일  │         │         │                              │
│  │         │         │         │                              │
│  ├─────────┼─────────┼─────────┤                              │
│  │ 웹사이트 │ 브랜딩  │ 앱 제작 │                              │
│  │ 12주    │ 6주     │ 16주    │                              │
│  │ ★142    │ ★98     │ ★64     │                              │
│  └─────────┴─────────┴─────────┘                              │
│                                                              │
│  선택 후: [미리보기] [이 템플릿으로 시작]                     │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 미리보기 패널

```
┌──────────────────────────────┐
│ 웹사이트 제작 12주            │
│ PlanQ 기본 · ★142 회 사용     │
├──────────────────────────────┤
│ 마일스톤 4                    │
│  · 기획·리서치 (2주)           │
│  · 디자인 (3주)               │
│  · 개발 (5주)                 │
│  · QA·배포 (2주)              │
│                              │
│ 포함 업무 24건 (예상 총 185시간)│
│ [업무 미리보기 ▾]              │
│                              │
│ [이 템플릿으로 시작]           │
└──────────────────────────────┘
```

### 6.3 사용 후 "이 템플릿에서 생성됨" 표시

프로젝트/견적/청구 상세 상단에 작은 라벨: `"📋 웹사이트 제작 12주 v3 에서 생성 (2026-04-24)"`. 클릭 시 템플릿 갤러리로 이동해 원본 확인 가능.

### 6.4 "워크스페이스 템플릿 관리" 페이지

- 경로: `/business/settings/templates` (새 Secondary 메뉴 — IconCopy)
- 탭: 프로젝트 일정 / 테이블 / 견적 / 청구 / 구독 / 회의 안건
- 워크스페이스 공용 템플릿 CRUD + "내 것을 워크스페이스에 공개" 버튼

---

## 7. 구현 순서 (Phase 배치)

| Phase | 구현 항목 | 예상 |
|---|---|---|
| 1 (Q Bill) | `quote`/`invoice` 템플릿 + 시스템 기본 3종 + 갤러리 UI | +3일 |
| 3 (프로젝트 Bill) | `project_schedule`/`process_table`/`subscription` 템플릿 + 시스템 기본 + `seed-system-templates.js` | +4일 |
| 3 끝부분 | 워크스페이스 템플릿 관리 페이지 | +1일 |
| 9 (Phase 9) | `meeting_agenda`, `email_signature` 템플릿 | Phase 9 자연 포함 |

---

## 8. 검증 체크리스트

- [ ] 시스템 템플릿은 모든 워크스페이스에서 보임
- [ ] 워크스페이스 템플릿은 해당 biz 멤버만 보임 (타 biz 403)
- [ ] 사용자 개인 템플릿은 본인만 보임
- [ ] 시스템 템플릿 편집 시도 → 403
- [ ] 템플릿으로 생성한 프로젝트 → 원본 템플릿 수정해도 변경 없음 (스냅샷)
- [ ] `projects.template_id` + `template_version` 기록됨
- [ ] 갤러리 "★ 사용 횟수" 정렬 정확
- [ ] 템플릿 복제(clone) 시 scope 이동 (system→workspace, workspace→user) 정확
- [ ] PERMISSION_MATRIX 토글(`financial`/`schedule`) 이 템플릿 편집 권한에도 적용됨

---

## 9. 변경 이력

| 날짜 | 버전 | 요약 |
|---|---|---|
| 2026-04-24 | 1.0 | 통합 템플릿 시스템 설계 확정. 7 kind · 3 scope · JSON schema · 시스템 기본 17종 · 갤러리 UI · Phase 1·3·9 분산 배치 |
