# 05. ERD — 데이터베이스 설계

> **최종 갱신: 2026-07-10 (코드 실측 대조 — `dev-backend/models/` 108개 모델 + dev DB 기준) · 이전: 2026-04-24**
>
> **2026-07-10 changelog:**
> - **§7 신규** — 전체 테이블 카탈로그 108개 실측 박제. 기존 문서(§2·§6)의 23개 외 **신규 85개 테이블**을 카테고리별 추가 (Q Task 확장 11 · Q Bill 9 · Q Mail 8 · Q docs/서명 8 · 프로젝트 확장 8 · 보고서 6 · 파일/스토리지 6 등).
> - **정정: tasks** — status ENUM 실측 8값 (`not_started/waiting/in_progress/reviewing/revision_requested/done_feedback(폐지·미사용)/completed/canceled`). §2.9·§6.2의 옛 ENUM 폐기. `priority` 컬럼 없음(`priority_order`로 대체).
> - **정정: projects** — `client_id` FK 없음. 실측은 `client_company` VARCHAR + `project_clients` 조인 테이블. `messages` 본문 컬럼은 `content` (§6.2의 `body` 표기는 오기).
> - **정정: businesses** — plan ENUM 실측 5값(`free/starter/basic/pro/enterprise`). 스토리지 쿼터 현행: Free 1GB / Basic 50GB / Pro 500GB (운영 기준). `business_members.role`은 dev DB 실측 `ENUM('owner','member','ai','admin')` (2026-07-10 admin append 활성화 — 메뉴 권한은 `business_member_permissions` 별도 테이블).
> - §2·§6은 설계 당시(2026-04) 원문 보존 — 이후 확장 컬럼은 §7.1, 신규 테이블은 §7.2가 실측 기준.

---

## 1. 테이블 관계도

```
┌──────────┐
│   User   │──────────────────────────────────────────────┐
└────┬─────┘                                              │
     │ 1:N                                                │
     ├──────────┐                                         │
     │          ▼                                         │
     │  ┌──────────────┐    ┌──────────────┐              │
     │  │   Business    │◄───│BusinessMember│◄─────────────┤
     │  └──────┬───────┘    └──────────────┘              │
     │         │ 1:N                                      │
     │         ├─────────────────┐                        │
     │         ▼                 ▼                        │
     │  ┌──────────┐     ┌──────────┐                    │
     │  │  Client   │     │ Invoice  │                    │
     │  └────┬─────┘     └────┬─────┘                    │
     │       │ 1:1             │ 1:N                      │
     │       ▼                 ▼                          │
     │  ┌──────────────┐ ┌──────────────┐                │
     │  │ Conversation │ │ InvoiceItem  │                │
     │  └──────┬───────┘ └──────────────┘                │
     │         │ 1:N                                      │
     │         ├────────────────────────┐                  │
     │         ▼                        ▼                  │
     │  ┌──────────┐           ┌────────────────────┐     │
     │  │ Message  │◄─────────│ConversationParticipant│◄──┘
     │  └────┬─────┘           └────────────────────┘
     │       │
     │       ├──────────┐
     │       ▼          ▼
     │  ┌────────┐ ┌──────────────────┐
     │  │  Task  │ │MessageAttachment │
     │  └────────┘ └──────────────────┘
     │
     ├────────────────┐
     ▼                ▼
┌──────────┐   ┌──────────┐
│   File   │   │ AuditLog │
└──────────┘   └──────────┘
```

---

## 2. 테이블 상세 설계

### 2.1 User (사용자)
```sql
CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) UNIQUE,              -- AI 계정(Cue)은 NULL
  password_hash VARCHAR(255),                     -- AI 계정은 NULL
  name          VARCHAR(100) NOT NULL,
  phone         VARCHAR(20),
  avatar_url    VARCHAR(500),
  platform_role ENUM('platform_admin', 'user') DEFAULT 'user',
  status        ENUM('active', 'suspended', 'deleted') DEFAULT 'active',
  is_ai         BOOLEAN DEFAULT FALSE,            -- AI 팀원(Cue) 플래그
  last_login_at DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_email (email),
  INDEX idx_status (status),
  INDEX idx_is_ai (is_ai)
);
```
- 플랫폼 전체 사용자 테이블 (사람 + AI)
- 한 User가 여러 Business에 속할 수 있음 (BusinessMember/Client로 연결)
- `is_ai = true`: Cue 계정. email/password 없음, 로그인 불가
- Cue 는 워크스페이스 생성 시 자동 생성 (워크스페이스당 1개)

### 2.2 Business — "워크스페이스" (내부 명칭: businesses, 사용자 표기: 워크스페이스)
```sql
CREATE TABLE businesses (
  id                      INT AUTO_INCREMENT PRIMARY KEY,

  -- 기본 언어 (가입 시 선택)
  default_language        CHAR(2) NOT NULL DEFAULT 'ko',  -- 'ko' or 'en'

  -- 브랜드 (대외 표시 BI — 일상 UI·마케팅·대화 헤더)
  brand_name              VARCHAR(200) NOT NULL,           -- 기본 언어로 입력
  brand_name_en           VARCHAR(200),                    -- default='ko'일 때만 사용
  brand_tagline           VARCHAR(500),
  brand_tagline_en        VARCHAR(500),
  brand_logo_url          VARCHAR(500),
  brand_color             VARCHAR(20),                     -- #HEX
  slug                    VARCHAR(100) NOT NULL UNIQUE,    -- URL용

  -- 법인 정보 (공식 문서·청구서·계약서용)
  legal_name              VARCHAR(200),                    -- 기본 언어
  legal_name_en           VARCHAR(200),                    -- default='ko' 때만
  legal_entity_type       ENUM('corporation', 'individual', 'llc', 'other'),
  tax_id                  VARCHAR(50),                     -- 사업자등록번호
  representative          VARCHAR(100),                    -- 대표자명
  representative_en       VARCHAR(100),
  address                 VARCHAR(500),
  address_en              VARCHAR(500),
  phone                   VARCHAR(50),
  email                   VARCHAR(200),
  website                 VARCHAR(500),

  -- 타임존·근무시간
  timezone                VARCHAR(50) DEFAULT 'Asia/Seoul',
  work_hours              JSON,                            -- {mon: [9,18], ...}

  -- 구독
  owner_id                INT NOT NULL,                    -- 현재 관리자 user_id
  plan                    ENUM('free', 'basic', 'pro', 'enterprise') DEFAULT 'free',
  subscription_status     ENUM('active', 'past_due', 'canceled', 'trialing') DEFAULT 'trialing',
  plan_expires_at         DATETIME,

  -- Cue 설정
  cue_mode                ENUM('smart', 'auto', 'draft') DEFAULT 'smart',
  cue_user_id             INT,                             -- FK to users.id (is_ai=true)

  -- 스토리지
  storage_used_bytes      BIGINT DEFAULT 0,
  storage_limit_bytes     BIGINT DEFAULT 524288000,        -- 500MB (Free)

  created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (owner_id) REFERENCES users(id),
  FOREIGN KEY (cue_user_id) REFERENCES users(id),
  INDEX idx_slug (slug),
  INDEX idx_owner (owner_id)
);
```

**필드 언어 로직**
- `default_language='ko'`: `brand_name`/`legal_name` 한국어 입력. `*_en` 필드는 선택 (외국 고객·영문 문서 대비)
- `default_language='en'`: `brand_name`/`legal_name` 영어 입력. `*_en` 필드는 UI 에서 숨김
- 영문 문서 생성 시: `_en` 필드 있으면 사용, 없으면 기본 필드 fallback

**한도 기본값 (plan 별)**
- storage_limit_bytes: Free 500MB, Basic 2GB, Pro 10GB, Enterprise 100GB+
- 파일당: Free 10MB, Basic 30MB, Pro 50MB
- Cue 월 액션: Free 500, Basic 5,000, Pro 25,000

> **2026-07-10 실측 정정:** plan ENUM은 `('free','starter','basic','pro','enterprise')` 5값 (+`scheduled_plan` 동일 ENUM). 스토리지 쿼터 현행은 **Free 1GB / Basic 50GB / Pro 500GB** (운영 기준, CLAUDE.md). 이후 컬럼이 약 80개로 확장 — 구독(trial_ends_at·grace_ends_at·addon_* 5종), 결제 키(stripe_*·portone_*·popbill_*), 청구 기본값(default_vat_rate·default_due_days·default_currency·default_billing_owner_id·auto_invoice_*), 은행/SWIFT, 메일(mail_from_name·mail_reply_to) 등. 전체는 `models/Business.js` + §7.1 참조.

### 2.3 BusinessMember (워크스페이스 멤버)
```sql
CREATE TABLE business_members (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  user_id     INT NOT NULL,
  role        ENUM('owner', 'member', 'ai', 'admin') DEFAULT 'member',  -- 'ai' = Cue, 'admin' = 관리자급 직원(2026-07-10)
  invited_by  INT,
  joined_at   DATETIME,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (invited_by) REFERENCES users(id),
  UNIQUE KEY uq_business_user (business_id, user_id)
);
```
- `role='owner'`: 사용자 표기 "관리자 / Admin"
- `role='member'`: 사용자 표기 "멤버 / Member"
- `role='ai'`: Cue 전용, 워크스페이스당 1개 강제

> **2026-07-10 실측/갱신:** role ENUM은 `('owner','member','ai','admin')` (admin append 활성화 — 승격 라우트·설정 UI·access_scope·health-check ENUM감시 완비, 실 HTTP 7/7. 멤버별 메뉴 권한은 §7.2 `business_member_permissions`가 별도로 담당). 이후 확장: 초대 흐름(`invite_token`·`invite_email`·`invited_at`·`removed_at`·`removed_by`), 워크스페이스별 표시명(`name`·`name_localized`), 근무 설정(`daily_work_hours`·`weekly_work_days`·`participation_rate`·`weekly_holidays`·`hourly_rate`·`monthly_salary`), 조직(`department_id`·`team_id`), Q Note 답변 프로필 8필드(`bio`~`answer_length_default`), `default_role`.

### 2.4 Client (고객)
```sql
CREATE TABLE clients (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  business_id         INT NOT NULL,
  user_id             INT NOT NULL,
  display_name        VARCHAR(100),
  company_name        VARCHAR(200),
  notes               TEXT,
  -- Cue 자동 히스토리 요약
  summary             TEXT,
  summary_updated_at  DATETIME,
  summary_manual      BOOLEAN DEFAULT FALSE,  -- 사람이 수동 편집
  -- 담당 멤버
  assigned_member_id  INT,                    -- 기본 담당자 (사람)
  invited_by          INT,
  invited_at          DATETIME,
  joined_at           DATETIME,
  status              ENUM('invited', 'active', 'archived') DEFAULT 'invited',
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (assigned_member_id) REFERENCES users(id),
  FOREIGN KEY (invited_by) REFERENCES users(id),
  UNIQUE KEY uq_business_client (business_id, user_id),
  INDEX idx_business_status (business_id, status),
  INDEX idx_assigned (assigned_member_id)
);
```

### 2.5 Conversation (대화방)
```sql
CREATE TABLE conversations (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  business_id           INT NOT NULL,
  client_id             INT NOT NULL,
  title                 VARCHAR(200),
  status                ENUM('active', 'archived') DEFAULT 'active',
  -- Cue 제어
  cue_enabled           BOOLEAN DEFAULT TRUE,        -- 이 대화에서 Cue 활동 여부
  cue_suppressed_until  DATETIME,                    -- 사람이 타이핑 중일 때 임시 억제
  -- 동기
  last_message_at       DATETIME,
  last_ai_summary_at    DATETIME,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  INDEX idx_business_status (business_id, status),
  INDEX idx_last_message (business_id, last_message_at DESC)
);
```
- 1 고객 = 기본 1 대화방 (Client 초대 시 자동 생성, persistent thread)
- `cue_enabled=false`: 해당 대화에서 Cue 일시정지 (사람이 명시적으로 멈춤)

### 2.6 ConversationParticipant (대화 참여자)
```sql
CREATE TABLE conversation_participants (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  user_id         INT NOT NULL,
  role            ENUM('owner', 'member', 'client') DEFAULT 'member',
  joined_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY uq_conv_user (conversation_id, user_id)
);
```

### 2.7 Message (메시지)
```sql
CREATE TABLE messages (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id   INT NOT NULL,
  sender_id         INT NOT NULL,            -- 사람 user_id 또는 Cue user_id
  content           TEXT NOT NULL,

  -- 메시지 유형
  kind              ENUM('text', 'system', 'card') DEFAULT 'text',
  -- text: 일반 메시지
  -- system: "담당자에게 전달했어요" 등 자동 상태 메시지
  -- card: task/invoice/event 인라인 카드

  -- Cue 관련
  is_ai             BOOLEAN DEFAULT FALSE,   -- Cue 가 작성한 메시지
  ai_confidence     DECIMAL(4,3),            -- 0~1, Cue 답변의 확신도 (nullable)
  ai_source         ENUM('pinned_faq', 'kb_rag', 'session_reuse', 'general'),
  ai_sources        JSON,                    -- [{doc_id, title, section, snippet}]
  ai_model          VARCHAR(50),             -- 'gpt-4.1-nano', 'gpt-4o-mini'
  ai_mode_used      ENUM('auto', 'draft'),   -- draft 면 아직 사람 승인 전

  -- 내부 메모
  is_internal       BOOLEAN DEFAULT FALSE,   -- true 면 고객에겐 안 보임

  -- 카드 링크
  task_id           INT,
  invoice_id        INT,

  -- 수정/삭제
  is_edited         BOOLEAN DEFAULT FALSE,
  edited_at         DATETIME,
  is_deleted        BOOLEAN DEFAULT FALSE,
  deleted_at        DATETIME,

  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (sender_id) REFERENCES users(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  INDEX idx_conversation_time (conversation_id, created_at DESC),
  INDEX idx_is_ai (is_ai),
  INDEX idx_internal (is_internal)
);
```
- `is_deleted=true` → UI "삭제된 메시지" (마스킹)
- `is_edited=true` → UI "(수정됨)"
- `is_ai=true` + `ai_mode_used='draft'` → Draft 상태, 사람이 승인 전엔 고객에 안 보임
- `is_internal=true` → 워크스페이스 멤버만 보임 (고객 차단)
- `kind='system'` → 자동 상태 메시지 (발신자 표시 없이 다른 스타일로 렌더)
- `kind='card'` → task/invoice/event 카드 (task_id/invoice_id 참조)

### 2.8 MessageAttachment (메시지 첨부파일)
```sql
CREATE TABLE message_attachments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  message_id  INT NOT NULL,
  file_name   VARCHAR(255) NOT NULL,
  file_path   VARCHAR(500) NOT NULL,
  file_size   BIGINT NOT NULL,
  mime_type   VARCHAR(100),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (message_id) REFERENCES messages(id),
  INDEX idx_message (message_id)
);
```

### 2.9 Task (할일)
```sql
CREATE TABLE tasks (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  business_id       INT NOT NULL,
  conversation_id   INT,
  source_message_id INT,
  title             VARCHAR(300) NOT NULL,
  description       TEXT,
  assignee_id       INT,
  client_id         INT,
  status            ENUM('pending', 'in_progress', 'completed', 'canceled') DEFAULT 'pending',
  priority          ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
  due_date          DATE,
  completed_at      DATETIME,
  created_by        INT NOT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (source_message_id) REFERENCES messages(id),
  FOREIGN KEY (assignee_id) REFERENCES users(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_business_status (business_id, status),
  INDEX idx_assignee (assignee_id, status),
  INDEX idx_due_date (business_id, due_date),
  INDEX idx_source_message (source_message_id)
);
```
- source_message_id → 원본 메시지 (양방향: Message.task_id ↔ Task.source_message_id)

> **2026-07-10 실측 정정 (Q Task 워크플로우로 전면 확장):**
> - **status ENUM 실측 8값** — `('not_started','waiting','in_progress','reviewing','revision_requested','done_feedback','completed','canceled')`. `done_feedback`은 2026-04-25 폐지되어 미사용 (ENUM 값만 잔존). 위 SQL의 `pending` 계열과 §6.2의 10값 ENUM은 모두 폐기.
> - **`priority` 컬럼 없음** — `priority_order` INT로 대체.
> - 주요 확장 컬럼: `project_id`, `body`(결과물), `email_thread_id`·`source_email_message_id`·`qnote_session_id`(출처 확장), `cue_kind`·`cue_context_ref`(Cue 팀원 실행), `review_policy`·`review_round`·`requires_client_review`(컨펌), `source`·`request_by_user_id`·`request_ack_at`(요청 흐름), `start_date`, `estimated_hours`·`actual_hours`·`actual_source`·`progress_percent`(시간/진행율), `planned_week_start`·`workstream_id`·`is_milestone`(주간/캔버스), `category`, `from_candidate_id`, `recurrence_rule`·`recurrence_parent_id`·`next_occurrence_at`(반복), `share_token` 4종. 전체는 `models/Task.js`.
> - 부속 테이블(task_reviewers·task_status_history·task_comments 등 11개)은 §7.2 참조.

### 2.10 File (공유자료)
```sql
CREATE TABLE files (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  client_id   INT,
  uploader_id INT NOT NULL,
  file_name   VARCHAR(255) NOT NULL,
  file_path   VARCHAR(500) NOT NULL,
  file_size   BIGINT NOT NULL,
  mime_type   VARCHAR(100),
  description VARCHAR(500),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (uploader_id) REFERENCES users(id),
  INDEX idx_business_client (business_id, client_id)
);
```

### 2.11 Invoice (청구서)
```sql
CREATE TABLE invoices (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  business_id               INT NOT NULL,
  client_id                 INT,
  invoice_number            VARCHAR(20) NOT NULL UNIQUE,
  title                     VARCHAR(200) NOT NULL,
  total_amount              DECIMAL(12,0) DEFAULT 0,
  tax_amount                DECIMAL(12,0) DEFAULT 0,
  grand_total               DECIMAL(12,0) DEFAULT 0,
  status                    ENUM('draft', 'sent', 'paid', 'overdue', 'canceled') DEFAULT 'draft',
  issued_at                 DATE,
  due_date                  DATE,
  paid_at                   DATETIME,
  recipient_email           VARCHAR(255),
  recipient_business_name   VARCHAR(200),
  recipient_business_number VARCHAR(20),
  notes                     TEXT,
  sent_at                   DATETIME,
  created_by                INT NOT NULL,
  created_at                DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_business_status (business_id, status),
  INDEX idx_invoice_number (invoice_number)
);
```
- invoice_number 형식: INV-2025-0001 (연도-순번, 자동생성)
- 금액은 원(KRW) 단위, 소수점 없음

### 2.12 InvoiceItem (청구서 항목)
```sql
CREATE TABLE invoice_items (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id  INT NOT NULL,
  description VARCHAR(500) NOT NULL,
  quantity    DECIMAL(10,2) DEFAULT 1,
  unit_price  DECIMAL(12,0) NOT NULL,
  amount      DECIMAL(12,0) NOT NULL,
  sort_order  INT DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  INDEX idx_invoice (invoice_id)
);
```

### 2.13 KB Document (대화 자료 문서)
```sql
CREATE TABLE kb_documents (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  business_id     INT NOT NULL,
  title           VARCHAR(300) NOT NULL,
  source_type     ENUM('manual', 'faq', 'policy', 'pricing', 'other'),
  file_name       VARCHAR(255),
  file_path       VARCHAR(500),
  file_size       BIGINT,
  mime_type       VARCHAR(100),
  version         INT DEFAULT 1,
  status          ENUM('pending', 'indexing', 'ready', 'failed') DEFAULT 'pending',
  uploaded_by     INT NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (uploaded_by) REFERENCES users(id),
  INDEX idx_business_status (business_id, status)
);
```
- Q File 과 분리된 **대화 자료** 전용 (Cue 가 고객 질문 답변 시 검색하는 소스)
- `version`: 문서 갱신 시 이전 버전 자동 보존 (감사용)

### 2.14 KB Chunk (문서 청크 + 임베딩)
```sql
CREATE TABLE kb_chunks (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  kb_document_id   INT NOT NULL,
  business_id      INT NOT NULL,              -- 조회 성능용 denormalize
  chunk_index      INT NOT NULL,
  content          TEXT NOT NULL,
  section_title    VARCHAR(500),
  token_count      INT,
  embedding        BLOB,                      -- 1536 float32 = 6144 bytes
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (kb_document_id) REFERENCES kb_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  INDEX idx_document (kb_document_id),
  INDEX idx_business (business_id)
);

-- FTS5 가상 테이블 (SQLite 패턴 참조, MySQL 에서는 FULLTEXT 사용)
CREATE FULLTEXT INDEX ft_kb_chunks ON kb_chunks(content, section_title);
```
- 텍스트 검색(FULLTEXT) + 시맨틱 검색(embedding cosine) 하이브리드
- 엔진은 Q Note 의 `embedding_service.py` 재사용

### 2.15 KB Pinned FAQ (고정 Q&A)
```sql
CREATE TABLE kb_pinned_faqs (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  business_id     INT NOT NULL,
  question        TEXT NOT NULL,
  answer          TEXT NOT NULL,
  short_answer    VARCHAR(500),               -- 간결 답변 (선택)
  keywords        JSON,                       -- ["환불", "반품"]
  embedding       BLOB,
  category        VARCHAR(100),
  created_by      INT NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_business (business_id)
);
```
- 관리자가 직접 등록한 Q&A (Cue 답변의 최우선 소스)
- Q Note 의 `qa_pairs` priority tier 구조 차용

### 2.16 Cue Usage (사용량 추적)
```sql
CREATE TABLE cue_usage (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  business_id     INT NOT NULL,
  year_month      CHAR(7) NOT NULL,           -- '2026-04'
  action_type     VARCHAR(50) NOT NULL,       -- 'answer', 'task_execute', 'summary'
  action_count    INT DEFAULT 0,
  token_input     BIGINT DEFAULT 0,
  token_output    BIGINT DEFAULT 0,
  cost_usd        DECIMAL(10,6) DEFAULT 0,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (business_id) REFERENCES businesses(id),
  UNIQUE KEY uq_business_month_action (business_id, year_month, action_type),
  INDEX idx_business_month (business_id, year_month)
);
```
- Cue 모든 액션 집계 (월 한도 검사 + 대시보드)
- UPSERT 패턴: 새 액션 발생 시 해당 행 counter 증가

### 2.17 AuditLog (감사 로그)
```sql
CREATE TABLE audit_logs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT,
  business_id INT,
  action      VARCHAR(50) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id   INT,
  old_value   JSON,
  new_value   JSON,
  ip_address  VARCHAR(45),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  INDEX idx_business_time (business_id, created_at DESC),
  INDEX idx_user_time (user_id, created_at DESC),
  INDEX idx_target (target_type, target_id)
);
```
- updated_at 없음 (로그는 수정 불가)
- action 예: 'message.create', 'task.update', 'task.delete', 'invoice.send', 'member.invite'

---

## 3. 관계 요약

| 관계 | 설명 |
|------|------|
| User → BusinessMember | 1:N (한 유저 → 여러 워크스페이스 소속 가능) |
| User → Client | 1:N (한 유저 → 여러 워크스페이스의 고객 가능) |
| User(is_ai) → BusinessMember(role=ai) | 1:1 per 워크스페이스 (Cue 계정) |
| Business → BusinessMember | 1:N (관리자 + 멤버 + Cue 1) |
| Business → Client | 1:N |
| Business → Conversation | 1:N |
| Business → KB Document | 1:N |
| Business → KB Pinned FAQ | 1:N |
| Business → Cue Usage | 1:N (월별·액션별 집계) |
| Client → Conversation | 1:1 (기본, persistent thread) |
| Client → Summary | 1:1 (clients.summary 컬럼, Cue 자동 갱신) |
| Conversation → ConversationParticipant | 1:N |
| Conversation → Message | 1:N |
| Message → MessageAttachment | 1:N |
| Message(is_ai=true) → KB Document/Chunk | N:N (ai_sources JSON) |
| Message ↔ Task | 양방향 (Message.task_id ↔ Task.source_message_id) |
| Message ↔ Invoice | 양방향 (kind='card' 인라인 카드) |
| KB Document → KB Chunk | 1:N (CASCADE DELETE) |
| Business → Task / File / Invoice | 1:N |
| Invoice → InvoiceItem | 1:N (CASCADE DELETE) |

---

## 4. 인덱스 전략

### 성능 핵심 인덱스
| 테이블 | 인덱스 | 이유 |
|--------|--------|------|
| users | (is_ai) | Cue 계정 빠른 조회 |
| businesses | (slug) | URL 매핑 |
| business_members | (business_id, user_id) UNIQUE | 중복 방지 |
| messages | (conversation_id, created_at DESC) | 대화방 메시지 목록 조회 |
| messages | (is_ai) | Cue 메시지 필터 |
| messages | (is_internal) | 내부 메모 필터 |
| conversations | (business_id, last_message_at DESC) | 최근 대화 정렬 |
| clients | (business_id, assigned_member_id) | 담당자별 고객 |
| kb_chunks | (business_id), FULLTEXT(content) | 대화 자료 검색 |
| kb_pinned_faqs | (business_id) | 우선 FAQ 탐색 |
| cue_usage | (business_id, year_month) | 한도 검사 |
| tasks | (business_id, status) | 할일 필터링 |
| tasks | (assignee_id, status) | 담당자별 할일 (Cue 포함) |
| tasks | (business_id, due_date) | 마감일 기준 정렬 |
| invoices | (business_id, status) | 청구서 필터링 |
| audit_logs | (business_id, created_at DESC) | 감사 로그 조회 |

---

## 5. 마이그레이션 노트 (Phase 0)

기존 스키마에서 추가로 필요한 DDL:

```sql
-- users
ALTER TABLE users
  ADD COLUMN is_ai BOOLEAN DEFAULT FALSE,
  ADD INDEX idx_is_ai (is_ai),
  MODIFY email VARCHAR(255) NULL,
  MODIFY password_hash VARCHAR(255) NULL;

-- businesses
ALTER TABLE businesses
  ADD COLUMN default_language CHAR(2) NOT NULL DEFAULT 'ko',
  ADD COLUMN brand_name VARCHAR(200) NOT NULL,
  ADD COLUMN brand_name_en VARCHAR(200),
  ADD COLUMN brand_tagline VARCHAR(500),
  ADD COLUMN brand_tagline_en VARCHAR(500),
  ADD COLUMN brand_logo_url VARCHAR(500),
  ADD COLUMN brand_color VARCHAR(20),
  ADD COLUMN legal_name VARCHAR(200),
  ADD COLUMN legal_name_en VARCHAR(200),
  ADD COLUMN legal_entity_type ENUM('corporation','individual','llc','other'),
  ADD COLUMN tax_id VARCHAR(50),
  ADD COLUMN representative VARCHAR(100),
  ADD COLUMN representative_en VARCHAR(100),
  ADD COLUMN address VARCHAR(500),
  ADD COLUMN address_en VARCHAR(500),
  ADD COLUMN phone VARCHAR(50),
  ADD COLUMN email VARCHAR(200),
  ADD COLUMN website VARCHAR(500),
  ADD COLUMN timezone VARCHAR(50) DEFAULT 'Asia/Seoul',
  ADD COLUMN work_hours JSON,
  ADD COLUMN plan_expires_at DATETIME,
  ADD COLUMN cue_mode ENUM('smart','auto','draft') DEFAULT 'smart',
  ADD COLUMN cue_user_id INT,
  ADD FOREIGN KEY (cue_user_id) REFERENCES users(id);

-- 기존 businesses.name 데이터를 brand_name 에 복사:
UPDATE businesses SET brand_name = name WHERE brand_name IS NULL;

-- 그 후 name 컬럼 drop:
ALTER TABLE businesses DROP COLUMN name;

-- business_members: role ENUM 확장 (admin append — 2026-07-10 활성화)
ALTER TABLE business_members
  MODIFY COLUMN role ENUM('owner','member','ai','admin') NULL DEFAULT 'member';

-- conversations
ALTER TABLE conversations
  ADD COLUMN cue_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN cue_suppressed_until DATETIME,
  ADD COLUMN last_ai_summary_at DATETIME;

-- messages
ALTER TABLE messages
  ADD COLUMN kind ENUM('text','system','card') DEFAULT 'text',
  ADD COLUMN is_ai BOOLEAN DEFAULT FALSE,
  ADD COLUMN ai_confidence DECIMAL(4,3),
  ADD COLUMN ai_source ENUM('pinned_faq','kb_rag','session_reuse','general'),
  ADD COLUMN ai_sources JSON,
  ADD COLUMN ai_model VARCHAR(50),
  ADD COLUMN ai_mode_used ENUM('auto','draft'),
  ADD COLUMN is_internal BOOLEAN DEFAULT FALSE,
  ADD COLUMN invoice_id INT,
  ADD INDEX idx_is_ai (is_ai),
  ADD INDEX idx_internal (is_internal),
  ADD FOREIGN KEY (invoice_id) REFERENCES invoices(id);

-- clients
ALTER TABLE clients
  ADD COLUMN summary TEXT,
  ADD COLUMN summary_updated_at DATETIME,
  ADD COLUMN summary_manual BOOLEAN DEFAULT FALSE,
  ADD COLUMN assigned_member_id INT,
  ADD FOREIGN KEY (assigned_member_id) REFERENCES users(id);

-- 신규 테이블들 (kb_documents, kb_chunks, kb_pinned_faqs, cue_usage)
-- 위 섹션 2.13~2.16 참조
```

**Phase 0 단계 순서**
1. `users.is_ai` 등 가장 의존성 없는 컬럼부터 추가
2. `businesses` 확장 + 기존 데이터 마이그레이션 (`name` → `brand_name`)
3. `business_members.role` ENUM 확장
4. 각 워크스페이스에 Cue 계정 생성 (`users` insert + `business_members` insert)
5. 나머지 확장 + 신규 테이블 생성
6. 정합성 검증 스크립트 실행

---

## 6. Phase 5 마이그레이션 (Q Talk 프로젝트 중심 재설계, 2026-04-15)

### 6.1 신규 테이블 6 개

#### 6.1.1 `projects` — 프로젝트 (1급 개체)

```sql
CREATE TABLE projects (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  business_id BIGINT NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  client_id BIGINT DEFAULT NULL,          -- clients.id, 프로젝트:고객사 = 1:1
  status ENUM('active','paused','closed') DEFAULT 'active',
  start_date DATE,
  end_date DATE,
  default_assignee_user_id BIGINT,        -- 자동 추출 담당자 매핑 실패 시 fallback
  owner_user_id BIGINT NOT NULL,          -- 프로젝트 생성자
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_business_status (business_id, status),
  INDEX idx_client (client_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id),
  FOREIGN KEY (default_assignee_user_id) REFERENCES users(id) ON DELETE SET NULL
);
```

> **2026-07-10 실측 정정:** `client_id` 컬럼 없음 — 고객사 표시는 `client_company` VARCHAR(200), 고객 연결은 `project_clients` 조인으로만. 이후 확장: `color`, `project_type`·`kind`·`process_tab_label`, `gdrive_folder_id`, 청구(`contract_amount`·`billing_type`·`monthly_fee`·`auto_invoice_*`·`invoice_billing_day`·`last_auto_invoice_at`), `paused_at`, 전략 캔버스(`strategy_*` 5종·`success_metrics`·`timeline_key_only`). `project_members`에는 `is_pm` 추가. 전체는 `models/Project.js`.

#### 6.1.2 `project_members` — 멤버 + 역할 매핑

```sql
CREATE TABLE project_members (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  role VARCHAR(50),                       -- '기획','디자인','개발','영업','운영','기타' 또는 자유 입력
  role_order INT DEFAULT 0,               -- 같은 역할 내 우선순위 (자동 배정용, 0 = 최우선)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_project_user (project_id, user_id),
  INDEX idx_project_role (project_id, role, role_order),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### 6.1.3 `project_clients` — 고객 참여자

```sql
CREATE TABLE project_clients (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  client_id BIGINT NOT NULL,              -- clients.id (고객사)
  contact_user_id BIGINT,                 -- users.id (로그인 가능한 고객 연락자)
  invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  invited_by BIGINT,                      -- 초대한 멤버 user_id
  UNIQUE KEY uniq_project_client_contact (project_id, client_id, contact_user_id),
  INDEX idx_project (project_id),
  INDEX idx_contact (contact_user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_user_id) REFERENCES users(id) ON DELETE SET NULL
);
```

#### 6.1.4 `project_notes` — 프로젝트 메모 (개인/내부)

```sql
-- 2026-04-24: project_id nullable + conversation_id 추가 (독립 대화 메모 지원).
-- 쓰기 규칙: 프로젝트 메모면 project_id 세팅 + conversation_id 옵션(어느 채팅에서
-- 왔는지 추적), 독립 대화 메모면 project_id=NULL + conversation_id 필수.
CREATE TABLE project_notes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NULL,              -- NULL = 독립 대화 스코프
  conversation_id BIGINT NULL,         -- 메모가 작성된 대화 (프로젝트·독립 공통)
  author_user_id BIGINT NOT NULL,
  visibility ENUM('personal','internal') NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_recent (project_id, created_at DESC),
  INDEX idx_conv_recent (conversation_id, created_at DESC),
  INDEX idx_author (author_user_id, visibility),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
  FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

> **2026-07-10 실측 정정:** visibility ENUM은 `('personal','internal','shared')` 3값 (shared = 내부 + 관련 고객). N+67 4단계 visibility 통합으로 `vlevel ENUM('L1','L2','L3','L4')` + `target_member_ids` JSON 추가 (personal→L1 / internal→L3 / shared→L4 양방향 동기). `email_thread_id`(메일 스레드 노트) 추가. `project_issues`에도 `email_thread_id` 추가.

**가시성 쿼리 예시**:
```sql
-- 멤버 조회 (internal + 본인의 personal)
SELECT * FROM project_notes
WHERE project_id = :pid
  AND (visibility = 'internal' OR (visibility = 'personal' AND author_user_id = :me))
ORDER BY created_at DESC;

-- 고객 조회 (본인의 personal 만)
SELECT * FROM project_notes
WHERE project_id = :pid
  AND visibility = 'personal' AND author_user_id = :me
ORDER BY created_at DESC;
```

#### 6.1.5 `project_issues` — 주요 이슈 (완전 수동 CRUD)

```sql
-- 2026-04-24: project_id nullable + conversation_id 추가 (독립 대화 이슈 지원).
CREATE TABLE project_issues (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NULL,              -- NULL = 독립 대화 스코프
  conversation_id BIGINT NULL,         -- 이슈가 제기된 대화
  body TEXT NOT NULL,
  author_user_id BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_recent (project_id, created_at DESC),
  INDEX idx_conv_recent (conversation_id, created_at DESC),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
  FOREIGN KEY (author_user_id) REFERENCES users(id)
);
```

**중요**: LLM 자동 생성 없음 — 전적으로 사용자 CRUD (AI 최소 사용 원칙).

#### 6.1.6 `task_candidates` — 업무 추출 후보 (영구 저장 히스토리)

```sql
-- 2026-04-24: project_id nullable (독립 대화에서도 extract 가능).
--            conversation_id 는 항상 필수 (어느 대화에서 왔는지가 근본 스코프).
CREATE TABLE task_candidates (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NULL,              -- NULL = 독립 대화 후보
  conversation_id BIGINT NOT NULL,
  extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  extracted_by_user_id BIGINT DEFAULT NULL,   -- 누가 트리거 (NULL = 자동)
  source_message_ids JSON NOT NULL,           -- [123, 124, 127]
  title VARCHAR(300) NOT NULL,
  description TEXT,
  guessed_role VARCHAR(50),                   -- LLM 제안 역할
  guessed_assignee_user_id BIGINT,            -- 결정론적 매핑 결과
  guessed_due_date DATE,
  similar_task_id BIGINT DEFAULT NULL,        -- 유사 기존 업무
  recurrence_hint VARCHAR(20),                -- 'weekly' | 'monthly' 등
  status ENUM('pending','registered','merged','rejected') DEFAULT 'pending',
  registered_task_id BIGINT DEFAULT NULL,     -- status=registered/merged 시 연결
  resolved_at TIMESTAMP NULL,
  resolved_by_user_id BIGINT DEFAULT NULL,
  INDEX idx_project_status (project_id, status, extracted_at DESC),
  INDEX idx_conv (conversation_id),
  INDEX idx_registered (registered_task_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (guessed_assignee_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (similar_task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (registered_task_id) REFERENCES tasks(id) ON DELETE SET NULL
);
```

**영구 저장 이유**: 거절/등록/병합 히스토리는 AI 재호출 없이 조회·재사용 가능해야 함.

> **2026-07-10 실측 정정:** `conversation_id`는 이제 nullable — 추출 출처가 채팅 외로 확장되어 `email_thread_id`(Q Mail)·`qnote_session_id`(Q Note)·`source_email_message_ids` 추가. `business_id` 컬럼 직접 보유(격리 축), `hidden_at`(카드 숨김) 추가. status ENUM은 `('pending','registered','merged','rejected')` 그대로.

### 6.2 기존 테이블 확장

```sql
-- conversations: 프로젝트 소속 + 채널 타입 + 자동 추출 커서
ALTER TABLE conversations
  ADD COLUMN project_id BIGINT DEFAULT NULL AFTER business_id,
  ADD COLUMN channel_type ENUM('customer','internal','group') DEFAULT 'internal' AFTER project_id,
  ADD COLUMN auto_extract_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN last_extracted_message_id BIGINT DEFAULT NULL,
  ADD COLUMN last_extracted_at TIMESTAMP NULL,
  ADD COLUMN extraction_in_progress_at TIMESTAMP NULL,   -- 동시 추출 방지 (TTL 2분)
  ADD INDEX idx_project (project_id),
  ADD FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;

-- messages: 답글 + FULLTEXT + Cue draft 잠금
ALTER TABLE messages
  ADD COLUMN reply_to_message_id BIGINT DEFAULT NULL,
  ADD COLUMN cue_draft_processing_by BIGINT DEFAULT NULL,
  ADD COLUMN cue_draft_processing_at TIMESTAMP NULL,
  ADD INDEX idx_reply (reply_to_message_id),
  ADD FULLTEXT INDEX ft_body (body) WITH PARSER ngram,  -- 한국어 검색
  ADD FOREIGN KEY (reply_to_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  ADD FOREIGN KEY (cue_draft_processing_by) REFERENCES users(id) ON DELETE SET NULL;

-- tasks: 프로젝트 + 후보 연결 + 반복 + 상태 확장
ALTER TABLE tasks
  ADD COLUMN project_id BIGINT DEFAULT NULL AFTER business_id,
  ADD COLUMN from_candidate_id BIGINT DEFAULT NULL,
  ADD COLUMN recurrence VARCHAR(20) DEFAULT NULL,
  MODIFY COLUMN status ENUM(
    'task_requested','task_re_requested',
    'waiting','not_started','in_progress',
    'review_requested','re_review_requested',
    'customer_confirm','completed','canceled'
  ) DEFAULT 'task_requested',
  ADD INDEX idx_project_status (project_id, status),
  ADD FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  ADD FOREIGN KEY (from_candidate_id) REFERENCES task_candidates(id) ON DELETE SET NULL;

-- files: 프로젝트 소속
ALTER TABLE files
  ADD COLUMN project_id BIGINT DEFAULT NULL,
  ADD INDEX idx_project (project_id),
  ADD FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;

-- invoices: 프로젝트 소속
ALTER TABLE invoices
  ADD COLUMN project_id BIGINT DEFAULT NULL,
  ADD INDEX idx_project (project_id),
  ADD FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
```

> **2026-07-10 실측 정정 (위 §6.2 블록의 stale 부분):**
> - `tasks`의 status ENUM 10값(`task_requested` 계열)은 폐기 — 실측은 §2.9 정정 노트의 8값. `recurrence` VARCHAR도 `recurrence_rule`(RRULE)로 대체.
> - `messages`의 본문 컬럼은 `body`가 아니라 **`content`** — FULLTEXT ngram 인덱스 대상도 `content`.
> - `conversations`에는 이후 `display_name`, `translation_enabled`·`translation_languages`, `archived_at`·`archived_by_user_id` 추가.
> - `messages`에는 이후 `pinned_at`·`pinned_by_user_id`, `cue_rating` 3종, `ai_draft_approved` 3종, `meta`, `translations`·`detected_language` 추가.

### 6.3 마이그레이션 순서

1. `projects` 생성 (의존성 없음)
2. `project_members`, `project_clients` 생성
3. `project_notes`, `project_issues` 생성
4. `task_candidates` 생성 (tasks FK 있으므로 tasks 확장 이후)
5. `conversations` 확장 (project_id 포함)
6. `messages` 확장 (FULLTEXT ngram 인덱스)
7. `tasks` 확장 (status ENUM 확장 + project_id)
8. `task_candidates` FK 최종 연결
9. `files`, `invoices` 확장
10. 정합성 검증:
    - `conversations.project_id IS NOT NULL` 체크 (Phase 5 이후 생성된 것은 반드시 있어야 함)
    - `project_members` 에 프로젝트 오너는 반드시 포함
    - `project_clients.contact_user_id` 가 있으면 해당 user 의 clients 레코드 일치

### 6.4 인덱스 확장

| 테이블 | 추가 인덱스 | 용도 |
|---|---|---|
| `projects` | (business_id, status) | 워크스페이스별 활성 프로젝트 |
| `project_members` | (project_id, role, role_order) | 역할 기반 담당자 매핑 |
| `project_notes` | (project_id, created_at DESC) | 최신순 메모 |
| `project_notes` | (author_user_id, visibility) | 고객의 개인 메모 조회 |
| `project_issues` | (project_id, created_at DESC) | 주요 이슈 최신순 |
| `task_candidates` | (project_id, status, extracted_at DESC) | 후보 리스트 |
| `messages` | FULLTEXT ngram on `body` | 한국어 채팅 검색 |
| `conversations` | (project_id) | 프로젝트별 채널 조회 |
| `tasks` | (project_id, status) | 프로젝트별 업무 조회 |

---

## 7. 2026-07-10 코드 실측 — 전체 테이블 카탈로그 (108 모델)

> **진실 공급원:** `dev-backend/models/` 의 108개 모델 파일 (index.js 제외) + dev DB 실측. 컬럼명은 전부 모델 `init` 에서 추출한 실측값.
> §2·§6 이 다루는 기존 23개 테이블 외에 **신규 85개** 를 아래 카테고리별로 박제. 각 테이블의 전체 컬럼·ENUM 값·인덱스는 해당 모델 파일이 최종 진실이며, association 은 `models/index.js` 에 집중돼 있다.

### 7.1 기존 문서화 테이블(23)의 주요 확장 — 실측

(businesses / business_members / tasks / projects / project_notes / project_issues / task_candidates / conversations / messages 는 §2·§6 의 인라인 정정 노트 참조)

| 테이블 | 2026-04 이후 주요 확장 컬럼 |
|---|---|
| `users` | 이메일 변경/인증 OTP(`pending_email`·`email_change_otp_*`·`email_verified_at`), 보조 이메일 OTP 7종(`secondary_email_*`), `password_reset_*`, `email_verify_*`, 약관(`terms_*`·`privacy_*`), `username`(변경 불가), `name_localized`, `language`, Focus 설정 5종(`focus_*`), `timezone`·`reference_timezones`, `active_business_id`, Q Note 답변 프로필(`bio`·`expertise`·`organization`·`job_title`·`language_levels`·`expertise_level`·`answer_style_default`·`answer_length_default`) |
| `clients` | 초대(`invite_token`·`invite_email`·`accepted_at`·`reinvite_count`), `display_name_localized`, `country`·`is_business`·`kind`, 사업자 정보(`biz_name`·`biz_ceo`·`biz_tax_id`·`biz_type`·`biz_item`·`biz_address`·`biz_address_en`), `tax_invoice_email`, `billing_contact_*` 3종, `email_aliases`(Q Mail 매칭) |
| `files` | `project_id`·`folder_id`, 외부 스토리지(`storage_provider`·`external_id`·`external_url`·`gdrive_mirror_*` 3종), SHA-256 dedup(`content_hash`·`ref_count`), 공유(`share_token`·`shared_at`·`share_password_hash`·`share_expires_at`·`share_created_at`), 가시성(`visibility`·`security_level`·`vlevel`·`target_member_ids`), `deleted_at`(소프트 삭제) |
| `invoices` | `installment_mode`·`payment_method`, 증빙(`receipt_type`·`receipt_profile`·`receipt_requested_at`·`cash_receipt_*` 4종·`tax_invoice_*` 5종), `bank_snapshot`, `owner_user_id`(담당 표시용 — 권한 부여 안 함), 출처(`project_id`·`quote_id`·`source_post_id`), 외화(`currency`·`subtotal`·`vat_rate`·`paid_amount`·`payment_terms`), 공개 링크(`share_token`·`share_expires_at`·`viewed_at`), 입금 알림(`notify_paid_at`·`notify_payer_name`), Stripe(`stripe_session_id`·`stripe_payment_intent`), `meta` |
| `invoice_items` | `detail`(항목 상세 설명) |
| `message_attachments` | `storage_provider`·`external_id`·`external_url`, `file_id`(File 테이블 연결) |
| `project_clients` | `contact_name`·`contact_email`(미가입 연락자), `invite_token`·`invite_token_used_at` |
| `kb_documents` | 출처(`source_file_id`·`source_post_id`·`body`), 인덱싱(`chunk_count`·`error_message`), 분류(`category`·`categories`·`scope`·`project_id`·`client_id`·`tags`), 첨부(`attached_file_ids`·`attached_post_ids`), 커스텀 필드(`custom_columns`·`custom_values`), 고객 공개(`read_policy`·`client_ids`), 번역(`source_language`·`auto_translate`·`translation_visibility`·`translations`·`parent_doc_id`), 가시성(`vlevel`·`target_member_ids`·`security_level`), 공유 토큰 4종 |
| `kb_chunks` | `source_type`('kb'/'wiki' — Q위키 본문 임베딩 재사용) + `source_id`. `kb_document_id`·`business_id` 는 nullable (wiki chunk 는 플랫폼 공통이라 NULL) |

`kb_pinned_faqs` / `cue_usage` / `audit_logs` / `conversation_participants`(+`pinned_at`·`last_read_at`) 는 원 설계와 거의 동일.

### 7.2 신규 테이블 카탈로그 (85)

#### 조직 — Q조직 (2)

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `departments` (Department) | 워크스페이스 평면 부서 (표시·집계 단위, 권한 축 아님) | business_id, name, name_en, color, lead_user_id(부서장), sort_order |
| `teams` (Team) | 부서 하위 선택적 팀 | business_id, department_id, name, name_en, sort_order |

#### 인증/세션 (2)

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `refresh_tokens` (RefreshToken) | 다중 디바이스 세션 (rotation + reuse 탐지, chain 격리) | user_id, token_hash, client_kind ENUM('pwa','web','ios','android'), expires_at, revoked_at, revoked_reason, replaced_by_id(사슬), last_used_at |
| `oauth_connections` (OauthConnection) | 사용자 외부 OAuth 로그인 연결 (Google/Microsoft, UNIQUE user+provider) | user_id, provider, subject, email, display_name, connected_at, last_used_at |

#### Q Task 확장 (11)

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `task_comments` (TaskComment) | 업무 댓글 (visibility personal/internal/shared 공통 ENUM) | task_id, user_id, content, visibility, vlevel, target_member_ids, kind |
| `task_reviewers` (TaskReviewer) | 업무 컨펌자 — 각자의 컨펌 상태 추적 (`recalcStatusFromReviewers` 원천) | task_id, user_id, is_client, state, reverted_once, action_at, added_by_user_id |
| `task_status_history` (TaskStatusHistory) | status 전이 이력 (시간 자동 누적·워크플로우 감사) | task_id, event_type, from_status, to_status, actor_user_id, actor_role, target_user_id, round, note |
| `task_daily_progress` (TaskDailyProgress) | 일별 진행 스냅샷 (번업 그래프 원천) | task_id, snapshot_date, progress_percent, actual_hours, estimated_hours, status |
| `task_user_hours` (TaskUserHours) | 역할별(담당/요청/컨펌) 개인 예측·실제 시간 | task_id, user_id, role, estimated_hours, actual_hours |
| `task_estimations` (TaskEstimation) | 예측시간 이력 (AI 추천 vs 사용자 확정 — 정확도 분석) | task_id, business_id(워크스페이스 few-shot), value, source, model, created_by_user_id |
| `task_attachments` (TaskAttachment) | 업무/댓글 첨부 (context='description_attach' = 의뢰자 영역) | business_id, task_id, comment_id, context, original_name, file_path, storage_provider, external_id/url |
| `task_links` (TaskLink) | 관련 업무 양방향 링크 (a<b 강제, UNIQUE(task_a,task_b)) | task_a_id, task_b_id, link_type('related'), created_by |
| `task_templates` (TaskTemplate) | 업무 템플릿 (유사 검색용 embedding 보유) | business_id, name, category, is_default, is_system, total_duration_days, task_count, usage_count, embedding |
| `task_template_items` (TaskTemplateItem) | 템플릿 항목 (상대 일정·의존) | template_id, order_index, title, start_offset_days, duration_days, estimated_hours, role_hint, depends_on_indexes |
| `focus_sessions` (FocusSession) | 개인 시간 추적 포커스 세션 (본인만 — owner/admin 도 접근 불가) | user_id, business_id, task_id, state, started_at, ended_at, pause_total_sec, last_activity_at, auto_paused, end_reason |

#### 프로젝트 확장 (8)

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `project_stages` (ProjectStage) | 거래 시퀀스 (견적→계약→청구→세금계산서) — `projectStageEngine` 멱등 자동 진행 | project_id, order_index, kind('quote'/'proposal'/'contract'/'invoice'/'tax_invoice'/'custom'), status, linked_entity_type/id, metadata, is_template_seeded |
| `project_status_options` (ProjectStatusOption) | 프로젝트별 커스텀 상태 옵션 (프로세스 표에서 사용) | project_id, status_key, label, color, order_index |
| `project_status_history` (ProjectStatusHistory) | 프로젝트 상태 전이 이력 (AuditLog 와 별개 전용 history) | project_id, business_id, from_status, to_status, changed_by, note |
| `project_workstreams` (ProjectWorkstream) | 캔버스 핵심 추진과제 (Workstream) — task.workstream_id 의 상위 골격 | business_id, project_id, title, order_index, color, status, created_by |
| `project_links` (ProjectLink) | 관련 프로젝트 양방향 연결 (a<b 강제) | business_id, project_a_id, project_b_id, relation_label, created_by |
| `project_process_columns` (ProjectProcessColumn) | 프로젝트 프로세스 표 커스텀 컬럼 정의 | project_id, col_key, label, col_type, order_index |
| `project_process_parts` (ProjectProcessPart) | 프로세스 표 행 (3단 계층) | business_id, project_id, depth1~3, description, status_key, link, notes, extra(JSON), order_index |
| `project_expenses` (ProjectExpense) | 프로젝트 직접비 (수익성 계산 차감) | project_id, category, description, amount, incurred_at, created_by |

#### Q Calendar (2)

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `calendar_events` (CalendarEvent) | 일정 (RRULE 반복 + Google Meet/GCal 연동 + 공유 토큰) | business_id, project_id, title, start_at, end_at, all_day, category, rrule, meeting_url, meeting_provider, gcal_event_id, reminder_minutes, recurrence_parent_id/recurrence_id/exception_dates, visibility·vlevel·target_member_ids·target_client_ids, share_token 4종 |
| `calendar_event_attendees` (CalendarEventAttendee) | 일정 참석자 (멤버 또는 고객) | event_id, user_id, client_id, response, responded_at |

#### 파일/스토리지/외부 연동 (6)

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `file_folders` (FileFolder) | Q File 폴더 트리 | business_id, project_id, parent_id, name, sort_order, created_by |
| `business_storage_usage` (BusinessStorageUsage) | 워크스페이스 스토리지 집계 (PK=business_id) | business_id(PK), bytes_used, file_count, storage_provider |
| `ops_capacity_log` (OpsCapacityLog) | 운영 용량 주간 스냅샷 (Stage 0~4 전환 감지) | snapshot_at, businesses_count, total_bytes_used, total_files, planq_share, gdrive_share, stage_reached |
| `business_cloud_tokens` (BusinessCloudToken) | 워크스페이스 GDrive OAuth 토큰 + 폴더/watch 채널 | business_id, provider, access_token, refresh_token, root_folder_id, qnote/conversations/workspace_folder_id, watch_channel_id·watch_resource_id·watch_expires_at·watch_page_token, last_error |
| `workspace_storage_configs` (WorkspaceStorageConfig) | 워크스페이스 독립 S3 호환 저장 설정 (자격 AES-256-GCM 암호화) | business_id, provider, endpoint, region, bucket, path_prefix, public_base_url, access_key_enc, secret_key_enc, is_active, verified_at |
| `external_connections` (ExternalConnection) | 외부 연동 통합 (owner_scope='workspace'/'user' 단일 모델 — OAuth + IMAP/SMTP) | owner_scope, business_id, user_id, provider, auth_type, access/refresh_token_encrypted, password_encrypted, account_email, imap_* 5종, smtp_* 3종, is_active, is_default, last_sync_at/error, fail_count |

#### Q docs — 포스트/문서/서명 (8)

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `posts` (Post) | Q docs 포스트 (TipTap JSON 본문, Brief/연결 포스트) | business_id, project_id, conversation_id, title, content_json, content_text, category, author_id, status, visibility·vlevel·security_level, is_pinned, share_token, brief_meta, parent_post_id, kind, q_record_id, linked_post_ids |
| `post_attachments` (PostAttachment) | 포스트 ↔ File 연결 | post_id, file_id, sort_order |
| `post_categories` (PostCategory) | 포스트 카테고리 마스터 | business_id, project_id, name, sort_order |
| `document_templates` (DocumentTemplate) | 문서 템플릿 (폼/AI 생성 모드) | business_id, kind, name, mode, schema_json, body_template, variables_json, ai_prompt_template, visibility·vlevel, locale, is_system, usage_count |
| `documents` (Document) | 생성 문서 (PDF·공유·서명) | business_id, template_id, kind, title, status, form_data, body_json/body_html, pdf_url, 연결 FK(client_id·project_id·conversation_id·session_id·task_id·quote_id·invoice_id), share_token, signed_at, signature_data, ai_generated, security_level |
| `document_revisions` (DocumentRevision) | 문서 리비전 스냅샷 | document_id, revision_number, body_snapshot, changed_fields, changed_by, change_note |
| `document_shares` (DocumentShare) | 문서 공유 발송 이력 | document_id, share_method, recipient_email, share_token, expires_at, viewed_at/count, signed_at, shared_by |
| `signature_requests` (SignatureRequest) | 서명 요청 (polymorphic entity_type='post'/'document', OTP 인증) | entity_type, entity_id, business_id, signer_email, token, otp_code_hash·otp_expires_at·otp_attempts·otp_locked_until, signature_image_b64, signed_at·signed_ip·signed_ua·signed_consent, rejected_at, status, expires_at, reminder_count |

#### Q record — 동적 테이블 (3)

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `q_records` (QRecord) | 동적 테이블 메타 (Notion DB 패턴, columns JSON 정의) | business_id, project_id(NULL=워크스페이스 전역), name, category, columns(JSON), read_policy, vlevel·target_member_ids, position |
| `q_record_rows` (QRecordRow) | 행 데이터 — values JSON `{col_id: value}` (secret 은 라우터 마스킹) | q_record_id, values, position, created_by, updated_by |
| `q_record_audits` (QRecordAudit) | read/reveal/edit/delete 전용 감사 (secret reveal 별도 기록) | q_record_id, q_record_row_id, user_id, action, field, meta |

#### Q Bill (9)

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `quotes` (Quote) | 견적서 (draft→sent→viewed→accepted/…/converted) | business_id, client_id, project_id, quote_number, status, valid_until, subtotal·vat_rate·vat_amount·total_amount·currency, signature_url, share_token, accepted_at, converted_invoice_id |
| `quote_items` (QuoteItem) | 견적 항목 (출처 참조 가능) | quote_id, description, quantity, unit_price, subtotal, source_type, source_ref_id, order_index |
| `invoice_installments` (InvoiceInstallment) | 분할 청구 회차 — 회차별 결제·세금계산서·현금영수증 마킹 | invoice_id, installment_no, label, percent, amount, due_date, status, paid_at, tax_invoice_no/at/marked_by/file_id, cash_receipt_no/at/file_id/marked_by, milestone_ref, notify_paid_*, stripe_session_id·stripe_payment_intent |
| `invoice_payments` (InvoicePayment) | 결제 기록 (Invoice 1:N — 부분/분할결제) | invoice_id, amount, method, paid_at, pg_provider·pg_channel·pg_transaction_id·pg_raw_response, fee_amount, net_amount, refunded_amount/at, recorded_by |
| `invoice_status_history` (InvoiceStatusHistory) | 청구서 상태 전이 이력 | invoice_id, business_id, from_status, to_status, changed_by, note |
| `receipt_corrections` (ReceiptCorrection) | 수정세금계산서·증빙 취소 이력 (원 발행 보존, 정정을 참조 이벤트로) | business_id, invoice_id, installment_id, kind('tax'/'cash'), reason(부가세법 §70 6사유), original_no, corrected_no, written_at, amount_delta, marked_by |
| `client_subscriptions` (ClientSubscription) | 고객 정기청구 (구독형 — cron 이 회차 invoice 자동 생성) | business_id, client_id, plan_name, amount·currency·vat_rate, interval, auto_mode, due_days, status, next_billing_at, last_invoiced_at, end_mode·max_occurrences·occurrences_count·end_date |
| `bill_events` (BillEvent) | Q Bill 이벤트 타임라인 (quote/invoice polymorphic — 열람·승인·결제·발행 전부) | entity_type, entity_id, event_type, actor_user_id, detail |
| `overhead_items` (OverheadItem) | 고정비 (손익·Break-even 산출) | business_id, category, name, amount, cycle, starts_at, ends_at |

#### SaaS 구독/결제 — 플랫폼 (3) ※ Q Bill(워크스페이스의 고객 청구)과 절대 혼동 금지

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `subscriptions` (Subscription) | 워크스페이스의 PlanQ 구독 (비즈니스당 활성 1개) | business_id, plan_code, cycle, status, price·currency, current_period_start/end, next_billing_at, past_due_at, grace_started_at/ends_at, demoted_at, canceled_at |
| `payments` (Payment) | PlanQ 구독/애드온 결제 (계좌이체 mark-paid + Stripe/PortOne) | business_id, subscription_id, kind('plan'/'addon'), addon_code·addon_quantity, method, status, amount, period_start/end, marked_by/at, portone_* 4종, stripe_* 3종, paid_at, refunded_at, tax_invoice_* 5종 |
| `business_plan_history` (BusinessPlanHistory) | 플랜 변경 이력 | business_id, from_plan, to_plan, reason, changed_by, effective_at |

#### Q Mail (8)

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `email_accounts` (EmailAccount) | 워크스페이스 IMAP/SMTP 계정 (자격 AES-256-GCM) | business_id, email, auth_type, oauth_*_encrypted, imap_host/port/username/password_encrypted/folder/last_uid, smtp_* 4종, owner_user_id, is_default, last_sync_at/error |
| `email_threads` (EmailThread) | 메일 스레드 (client/project 허브 — 맥락지능) | business_id, account_id, subject, client_id, project_id, status, reply_needed(+reason/at), spam_score, triage, ai_summary, labels, message_count·unread_count, last_message_*, participants, vlevel, share_token |
| `email_messages` (EmailMessage) | 메일 메시지 (수신/발신) | thread_id, business_id, direction, message_id·in_reply_to·references_chain, imap_uid, from/to/cc/bcc, subject, body_html/text, sent_by_user_id, delivery_status, ai_intent·ai_summary, faq_embedding |
| `email_attachments` (EmailAttachment) | 메일 첨부 (File 테이블 연결) | message_id, file_id, filename, mime_type, size_bytes, content_id, is_inline |
| `email_thread_participants` (EmailThreadParticipant) | 스레드별 배정/팔로우/읽음/열람중/작성중 presence | thread_id, user_id, is_assigned, is_following, last_read_message_id/at, is_viewing, is_drafting |
| `email_drafts` (EmailDraft) | 답장 임시저장 (AutoSave — 발송 시 message 전환 후 삭제) | thread_id, user_id, in_reply_to_message_id, account_id, to/cc/bcc, subject, body_html, attachment_file_ids |
| `email_faq_suggestions` (EmailFaqSuggestion) | 반복 Q&A 클러스터링 제안 → accept 시 KbDocument(faq) 등록 | business_id, question, answer, source_thread_ids, occurrence_count, status, kb_document_id |
| `email_logs` (EmailLog) | 시스템 이메일 발송 로그 (외부 발송 = LogTable 원칙) | to_email, subject, status, error_message, template, related_entity_type/id, business_id, retry_count |

#### 알림/푸시 (4)

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `notifications` (Notification) | 인앱 알림 feed (정보 통지 — "확인 필요" Action Queue 와 별개) | user_id, business_id, event_kind, title, body, link, cta_label, actor_user_id, entity_type/id, read_at, email_escalated_at |
| `notification_prefs` (NotificationPref) | user × business × event_kind × channel 토글 (row 없으면 기본 ON, business_id NULL=플랫폼) | user_id, business_id, event_kind, channel, enabled |
| `push_subscriptions` (PushSubscription) | Web push/디바이스 구독 (같은 user×host 좀비 자동 만료) | user_id, business_id, kind, endpoint, p256dh, auth, device_token, device_name, last_used_at, expired_at |
| `push_logs` (PushLog) | push 발송 로그 (실패율 모니터링) | user_id, subscription_id, endpoint_host, category, status, status_code, error_message, payload_title |

#### 보고서/주간 리뷰 (6)

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `reports` (Report) | 월간/분기/연간 경영 보고서 스냅샷 (cron 매월 1일) | business_id, kind, period_start/end, status, title, summary, data(JSON), insights, generated_at/by, pdf_url, share_token |
| `report_units` (ReportUnit) | 책임 단위 보고서 (멤버/프로젝트/부서 — 자동 초안→확정→롤업) | business_id, scope, scope_ref_id, period_type, period_start, status, auto_snapshot, edited_overrides, narrative, confirmed_by/at, finalized_by |
| `report_shares` (ReportShare) | 통합보고서 외부 공유 링크 (token→기간 매핑, 롤업 재계산) | business_id, token, period_type, period_start, dim, created_by, last_viewed_at |
| `weekly_reviews` (WeeklyReview) | 개인 주간 리뷰 스냅샷 | business_id, user_id, week_start/end, finalized_at/by, snapshot_data(JSON), retro_note |
| `weekly_review_settings` (WeeklyReviewSetting) | 개인 주간 리뷰 자동화 설정 | user_id, business_id, auto_enabled |
| `business_weekly_reports` (BusinessWeeklyReport) | 워크스페이스 통합 주간보고서 (UNIQUE biz+week_start, cron+수동 박제) | business_id, week_start/end, finalized_at, finalized_by_user_id, snapshot_data(JSON v1), executive_summary, retro_note |

#### KB/Cue 확장 (3)

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `kb_categories` (KbCategory) | Q info 카테고리 마스터 (문서의 category 문자열과 별개) | business_id, name, sort_order |
| `kb_share_bundles` (KbShareBundle) | KB 다건/카테고리 공유 번들 (단건은 KbDocument.share_token) | business_id, token, kind('selection'/'category'), doc_ids(JSON), category, title, viewed_count, expires_at |
| `cue_knowledge` (CueKnowledge) | Cue 워크스페이스 지식 카드 (자동 채굴 pending → 승인 후 active 만 컨텍스트 주입) | business_id, kind, title, body, source, status, meta, decided_by/at |

#### Q Note STT 과금 (2)

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `qnote_usage` (QnoteUsage) | 월 rollup — `seconds_used` 가 단일원천 (`minutes_used`=표시용) | business_id, year_month, seconds_used, minutes_used, session_count, cost_usd |
| `qnote_usage_events` (QnoteUsageEvent) | 멱등 원장 — UNIQUE(stream_id, segment_seq), 재연결 quota 우회 차단 | stream_id, segment_seq, session_id(q-note SQLite 소재 — FK 없음), business_id, user_id, seconds, is_stereo |

#### Q위키/도움말 (3)

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `help_categories` (HelpCategory) | 도움말 카테고리 (플랫폼 공통 — business_id 없음) | slug, title_ko/en, summary_ko/en, icon, sort_order |
| `help_articles` (HelpArticle) | 도움말 아티클 (ko/en JSON 블록 본문, 랜딩 블로그 겸용) | slug, category_id, title_ko/en, body_ko/en, visibility('public'/'authenticated'), linked_route, is_published, view_count, blog_published_at, blog_category, origin·origin_meta |
| `help_question_logs` (HelpQuestionLog) | Q helper 질문 전량 로그 (미답변 클러스터링 → 위키 초안 되먹임) | user_id, business_id, mode, question, lang, answered, top_article_id, feedback, processed_article_id |

#### 플랫폼 운영 (4)

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `platform_settings` (PlatformSetting) | 플랫폼 전역 설정 (단일 row — 회사 정보·계좌·약관 버전·점검모드·공지·SEO·결제 키) | brand, legal_entity, bank_*, stripe_*/portone_*, terms_version·privacy_version, maintenance_mode/message, announcement_* 3종, seo_*, app_ios/android_url |
| `contact_inquiries` (ContactInquiry) | 플랫폼 문의 (Enterprise·랜딩·일반 통합) | kind, source, business_id, from_name/email/company/phone, message, from_user_timezone, status, replied_at/by, reply_note |
| `feedback_items` (FeedbackItem) | 사용자 → 운영팀 피드백 위젯 (parent_id 스레드) | user_id, business_id, parent_id, category, priority, title, body, attachments, page_url, status, admin_response, responded_by/at |
| `export_jobs` (ExportJob) | 데이터 내보내기/이전 비동기 작업 (cron 워커 드레인, 재시도 3회) | user_id, business_id, kind, mode, target_business_id, include_qnote, status, attempts, result, download_path·download_token, expires_at |

#### 권한 (1)

| 테이블 (모델) | 용도 | 핵심 컬럼 |
|---|---|---|
| `business_member_permissions` (BusinessMemberPermission) | 멤버 메뉴 권한 Layer 3 (UNIQUE biz+user+menu_key — row 없음 = write 전권) | business_id, user_id, menu_key(`middleware/menu_permission.js` VALID_MENUS 12종 — 11 메뉴 + weekly_team), level('none'/'read'/'write' — insights·weekly_team 은 read 코어스), updated_by |

### 7.3 실측 요약

- 모델 총 108개 = §2·§6 기존 문서화 23개 + §7.2 신규 85개. 카테고리 합계: 조직 2 + 인증 2 + Q Task 11 + 프로젝트 8 + 캘린더 2 + 파일/스토리지 6 + Q docs 8 + Q record 3 + Q Bill 9 + SaaS 3 + Q Mail 8 + 알림/푸시 4 + 보고서 6 + KB/Cue 3 + Q Note 과금 2 + 위키 3 + 플랫폼 운영 4 + 권한 1 = 85.
- Q Note 자체 세션 데이터(sessions·transcripts 등)는 이 DB 가 아닌 `q-note/` FastAPI 의 SQLite 소재 — 여기 카탈로그 대상 아님 (`qnote_usage*` 만 MySQL).
- ENUM 정확 값·인덱스·association 이 필요하면: 각 모델 파일 → `models/index.js` (association 집중) 순서로 확인.
