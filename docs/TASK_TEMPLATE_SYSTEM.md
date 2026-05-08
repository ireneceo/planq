# 업무 템플릿 시스템 — 설계

> **사이클 N+1 (2026-05-08)** — 재사용 가능한 업무 일정. Preset 10종 + 사용자 저장 + 기존 프로젝트에서 저장 + AI 추천 통합.

---

## 1. DB 스키마

```sql
CREATE TABLE task_templates (
  id INT PRIMARY KEY AUTO_INCREMENT,
  business_id INT NULL,                     -- NULL = 시스템 preset
  name VARCHAR(200) NOT NULL,
  description TEXT,
  category VARCHAR(50),                     -- web_dev / marketing / sales / ops / custom
  is_default BOOLEAN DEFAULT 0,             -- 워크스페이스 기본 (자동 적용)
  is_system BOOLEAN DEFAULT 0,              -- 시스템 preset
  total_duration_days INT,                  -- 자동 계산
  task_count INT,                           -- 자동 계산
  usage_count INT DEFAULT 0,
  created_by INT,
  created_at, updated_at,
  INDEX (business_id, category)
);

CREATE TABLE task_template_items (
  id INT PRIMARY KEY AUTO_INCREMENT,
  template_id INT NOT NULL FK task_templates,
  order_index INT,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  start_offset_days INT NOT NULL,           -- 시작일 +N
  duration_days INT NOT NULL,
  estimated_hours DECIMAL(6,2),
  priority ENUM('urgent','high','normal') DEFAULT 'normal',
  role_hint VARCHAR(100),                   -- 디자이너 / 개발자 — 적용 시 멤버 매핑
  depends_on_indexes JSON,                  -- 다른 항목 index (의존성)
  created_at, updated_at,
  INDEX (template_id, order_index)
);
```

## 2. Preset 10종 (시드 스크립트)

| 카테고리 | 이름 | 항목 수 | 기간 |
|---|---|:-:|:-:|
| web_dev | WordPress 블로그 사이트 | 12 | 21일 |
| web_dev | React/Next.js 앱 | 18 | 30일 |
| web_dev | 쇼핑몰 구축 | 24 | 45일 |
| marketing | 마케팅 캠페인 (기획→실행→분석) | 10 | 28일 |
| marketing | 콘텐츠 시리즈 (블로그 4편) | 8 | 14일 |
| sales | 신규 고객사 온보딩 | 9 | 14일 |
| sales | 견적·계약·제작·납품 | 7 | 10일 |
| ops | 채용 프로세스 | 6 | 21일 |
| ops | 분기 회고 | 4 | 7일 |
| custom | 빈 템플릿 | 0 | 0 |

`scripts/seed-task-templates.js` — `is_system=true, business_id=NULL` 로 시드.

## 3. API

```
GET    /api/task-templates                 (워크스페이스용 + 시스템 preset 통합)
POST   /api/task-templates                 (사용자 저장)
PUT    /api/task-templates/:id             (수정)
DELETE /api/task-templates/:id             (삭제 — system 은 owner 만)
PUT    /api/task-templates/:id/default     (워크스페이스 기본 토글)

POST   /api/projects/:id/save-as-template  (기존 프로젝트 → 템플릿)
POST   /api/task-templates/:id/apply        (템플릿 → 신규 task 생성)
   Body: { project_id?, start_date, assignee_map: { "디자이너": userId, ... } }
```

## 4. 적용 흐름 (apply)

```
1. 시작일 + start_offset_days = task.start_date
2. + duration_days = task.due_date  (주말 제외 옵션)
3. role_hint → assignee_map 매핑 → assignee_id
4. depends_on_indexes → 신규 생성된 task id 로 변환 → task_dependencies row
5. estimated_hours → task_estimations(source='ai') row + tasks.estimated_hours
6. 일괄 INSERT 트랜잭션
```

## 5. 저장 흐름 (save-as-template)

기존 프로젝트의 task 12개 → 템플릿화:

```
1. 가장 빠른 task.start_date 를 base 로 잡음
2. 각 task 의 start_offset_days = (task.start_date - base) / 일
3. duration_days = task.due_date - task.start_date
4. role_hint = assignee.User.job_title 또는 expertise (자동 추출)
5. 의존성 (task_dependencies) → depends_on_indexes JSON
6. task_templates + task_template_items 일괄 INSERT
```

## 6. UI

### 템플릿 선택 모달 (프로젝트 생성 / 업무 탭 [+ 템플릿 적용])

- 카테고리 그룹 (시스템 preset / 워크스페이스 default / 내가 저장)
- 카드 프리뷰: 이름·항목수·기간·매칭 점수
- 시작일 picker (default 오늘)
- 담당자 매핑 — role_hint → 멤버 PlanQSelect

### 템플릿 저장 모달

- 이름·설명·카테고리
- "워크스페이스 기본으로 설정" 토글
- 자동 변환 사항 미리보기 (offset_days, role_hint 추출)

### 템플릿 관리 페이지 (`/business/settings/task-templates`)

- 시스템 preset (read-only) + 워크스페이스 (편집)
- 사용 횟수 통계
- 기본 템플릿 토글

## 7. AI 추천 통합 (★)

자연어 입력 시 LLM 에 사용 가능한 템플릿 목록 주입. 매칭 점수 0.80+ 만 추천.

LLM 프롬프트 일부:
```
Available templates:
  1. "WordPress 사이트 개발" — web_dev, 12 tasks, 21 days
  2. ...

Decide:
  (a) Use existing template (return template_id + score)
  (b) Generate fresh
  (c) Mix (template + adjustments)

Score 0.80+ 만 추천으로 반환.
```

## 8. 작업 항목 (사이클 N+1)

- DB 신설 2 테이블
- 시드 10 템플릿 스크립트
- routes/task_templates.js 신규 (CRUD + apply + save)
- services/templateApply.js (날짜 재계산 + 멤버 매핑 + 의존성)
- 프론트 `pages/Settings/TaskTemplatesPage.tsx`
- 프론트 `components/QTask/TemplateSelectModal.tsx`
- 프론트 `components/QTask/TemplateSaveModal.tsx`
- 프론트 AI 모달과 통합 — 추천 배너 컴포넌트
