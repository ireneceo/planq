# 05. ERD — 데이터베이스 설계

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

### 2.3 BusinessMember (워크스페이스 멤버)
```sql
CREATE TABLE business_members (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  user_id     INT NOT NULL,
  role        ENUM('owner', 'member', 'ai') DEFAULT 'member',  -- 'ai' = Cue
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

-- business_members: role ENUM 확장
ALTER TABLE business_members
  MODIFY role ENUM('owner','member','ai') DEFAULT 'member';

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
