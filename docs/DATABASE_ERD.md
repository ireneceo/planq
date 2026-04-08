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
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(100) NOT NULL,
  phone         VARCHAR(20),
  avatar_url    VARCHAR(500),
  platform_role ENUM('platform_admin', 'user') DEFAULT 'user',
  status        ENUM('active', 'suspended', 'deleted') DEFAULT 'active',
  last_login_at DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_email (email),
  INDEX idx_status (status)
);
```
- 플랫폼 전체 사용자 테이블
- 한 User가 여러 Business에 속할 수 있음 (BusinessMember/Client로 연결)
- email 기준 unique (한 이메일 = 한 계정)

### 2.2 Business (사업자)
```sql
CREATE TABLE businesses (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  name                    VARCHAR(200) NOT NULL,
  slug                    VARCHAR(100) NOT NULL UNIQUE,
  logo_url                VARCHAR(500),
  owner_id                INT NOT NULL,
  plan                    ENUM('free', 'basic', 'pro') DEFAULT 'free',
  subscription_status     ENUM('active', 'past_due', 'canceled', 'trialing') DEFAULT 'trialing',
  storage_used_bytes      BIGINT DEFAULT 0,
  storage_limit_bytes     BIGINT DEFAULT 524288000,  -- 500MB (free)
  created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (owner_id) REFERENCES users(id),
  INDEX idx_slug (slug),
  INDEX idx_owner (owner_id)
);
```
- slug: URL에 사용 (planq.kr/app/{slug})
- storage_limit_bytes 기본값: Free=500MB, Basic=2GB, Pro=10GB

### 2.3 BusinessMember (사업자 멤버)
```sql
CREATE TABLE business_members (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  user_id     INT NOT NULL,
  role        ENUM('owner', 'member') DEFAULT 'member',
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

### 2.4 Client (고객)
```sql
CREATE TABLE clients (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  business_id   INT NOT NULL,
  user_id       INT NOT NULL,
  display_name  VARCHAR(100),
  company_name  VARCHAR(200),
  notes         TEXT,
  invited_by    INT,
  invited_at    DATETIME,
  joined_at     DATETIME,
  status        ENUM('invited', 'active', 'archived') DEFAULT 'invited',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (invited_by) REFERENCES users(id),
  UNIQUE KEY uq_business_client (business_id, user_id),
  INDEX idx_business_status (business_id, status)
);
```

### 2.5 Conversation (대화방)
```sql
CREATE TABLE conversations (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  business_id     INT NOT NULL,
  client_id       INT NOT NULL,
  title           VARCHAR(200),
  status          ENUM('active', 'archived') DEFAULT 'active',
  last_message_at DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  INDEX idx_business_status (business_id, status),
  INDEX idx_last_message (business_id, last_message_at DESC)
);
```
- 1 고객 = 기본 1 대화방 (Client 초대 시 자동 생성)

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
  id              INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  sender_id       INT NOT NULL,
  content         TEXT NOT NULL,
  task_id         INT,
  is_edited       BOOLEAN DEFAULT FALSE,
  edited_at       DATETIME,
  is_deleted      BOOLEAN DEFAULT FALSE,
  deleted_at      DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (sender_id) REFERENCES users(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  INDEX idx_conversation_time (conversation_id, created_at DESC)
);
```
- is_deleted=true → UI에서 "삭제된 메시지" 표시 (마스킹)
- is_edited=true → UI에서 "(수정됨)" 표시
- task_id → 이 메시지에서 생성된 할일 (양방향 링크)

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

### 2.13 AuditLog (감사 로그)
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
| User → BusinessMember | 1:N (한 유저 → 여러 사업자 소속 가능) |
| User → Client | 1:N (한 유저 → 여러 사업자의 고객 가능) |
| Business → BusinessMember | 1:N |
| Business → Client | 1:N |
| Business → Conversation | 1:N |
| Client → Conversation | 1:1 (기본, 추가 대화방 가능) |
| Conversation → ConversationParticipant | 1:N |
| Conversation → Message | 1:N |
| Message → MessageAttachment | 1:N |
| Message ↔ Task | 양방향 (Message.task_id ↔ Task.source_message_id) |
| Business → Task | 1:N |
| Business → File | 1:N |
| Business → Invoice | 1:N |
| Invoice → InvoiceItem | 1:N (CASCADE DELETE) |

---

## 4. 인덱스 전략

### 성능 핵심 인덱스
| 테이블 | 인덱스 | 이유 |
|--------|--------|------|
| messages | (conversation_id, created_at DESC) | 대화방 메시지 목록 조회 |
| tasks | (business_id, status) | 할일 필터링 |
| tasks | (assignee_id, status) | 담당자별 할일 |
| tasks | (business_id, due_date) | 마감일 기준 정렬 |
| conversations | (business_id, last_message_at DESC) | 최근 대화 정렬 |
| audit_logs | (business_id, created_at DESC) | 감사 로그 조회 |
| invoices | (business_id, status) | 청구서 필터링 |
