# 07. API 설계

---

## 1. 공통 규칙

### Base URL
```
개발: https://dev.planq.kr/api
운영: https://planq.kr/api (나중에)
```

### 응답 형식
```json
// 성공
{ "success": true, "data": { ... } }

// 성공 (목록)
{ "success": true, "data": [...], "pagination": { "page": 1, "limit": 20, "total": 58 } }

// 실패
{ "success": false, "message": "에러 메시지" }
```

### 인증 헤더
```
Authorization: Bearer {accessToken}
```

### 공통 쿼리 파라미터 (목록 API)
| 파라미터 | 설명 | 기본값 |
|---------|------|--------|
| page | 페이지 번호 | 1 |
| limit | 페이지당 수 | 20 |
| sort | 정렬 필드 | created_at |
| order | 정렬 방향 | DESC |

---

## 2. 인증 (Auth)

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| POST | /auth/register | 회원가입 (사업자 등록) | 불필요 |
| POST | /auth/login | 로그인 | 불필요 |
| POST | /auth/refresh | 토큰 갱신 | Refresh Token |
| POST | /auth/logout | 로그아웃 | 필요 |
| POST | /auth/forgot-password | 비밀번호 재설정 요청 | 불필요 |
| POST | /auth/reset-password | 비밀번호 재설정 실행 | 불필요 (토큰) |

### POST /auth/register
```json
// Request
{
  "email": "irene@planq.kr",
  "password": "...",
  "name": "Irene",
  "businessName": "워프로",
  "businessSlug": "warpro"
}

// Response
{
  "success": true,
  "data": {
    "user": { "id": 1, "email": "...", "name": "..." },
    "business": { "id": 1, "name": "워프로", "slug": "warpro" },
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```

### POST /auth/login
```json
// Request
{ "email": "...", "password": "..." }

// Response
{
  "success": true,
  "data": {
    "user": { "id": 1, "email": "...", "name": "...", "platform_role": "user" },
    "businesses": [
      { "id": 1, "name": "워프로", "slug": "warpro", "role": "owner" }
    ],
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```

---

## 3. 사용자 (Users)

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | /users/me | 내 정보 | 로그인 |
| PUT | /users/me | 내 정보 수정 | 로그인 |
| PUT | /users/me/password | 비밀번호 변경 | 로그인 |
| PUT | /users/me/avatar | 프로필 이미지 변경 | 로그인 |

---

## 4. 사업자 (Businesses)

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | /businesses/:id | 사업자 정보 | Member 이상 |
| PUT | /businesses/:id | 사업자 정보 수정 | Owner |
| GET | /businesses/:id/members | 멤버 목록 | Member 이상 |
| POST | /businesses/:id/members/invite | 멤버 초대 | Owner |
| PUT | /businesses/:id/members/:memberId | 멤버 역할 변경 | Owner |
| DELETE | /businesses/:id/members/:memberId | 멤버 제거 | Owner |

### POST /businesses/:id/members/invite
```json
// Request
{ "email": "member@example.com", "role": "member" }

// Response — 초대 이메일 발송됨
{ "success": true, "data": { "invited": true, "email": "member@example.com" } }
```

---

## 5. 고객 (Clients)

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | /businesses/:id/clients | 고객 목록 | Member 이상 |
| POST | /businesses/:id/clients/invite | 고객 초대 | Member 이상 |
| GET | /businesses/:id/clients/:clientId | 고객 상세 | Member 이상 |
| PUT | /businesses/:id/clients/:clientId | 고객 정보 수정 | Member 이상 |
| PUT | /businesses/:id/clients/:clientId/archive | 고객 보관 처리 | Owner |
| POST | /auth/invite/:token | 초대 수락 (간편 가입) | 불필요 |

### POST /businesses/:id/clients/invite
```json
// Request
{
  "email": "client@company.com",
  "displayName": "김고객",
  "companyName": "A사"
}

// Response — 초대 이메일 + 대화방 자동 생성
{
  "success": true,
  "data": {
    "client": { "id": 1, "status": "invited" },
    "conversation": { "id": 1, "title": "A사 — 김고객" },
    "inviteLink": "https://planq.kr/invite/abc123..."
  }
}
```

---

## 6. 대화 (Conversations) — Q Talk

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | /businesses/:id/conversations | 대화 목록 | Member 이상 |
| GET | /conversations/:convId | 대화방 정보 | 참여자 |
| GET | /conversations/:convId/messages | 메시지 목록 (페이징) | 참여자 |
| POST | /conversations/:convId/messages | 메시지 전송 | 참여자 |
| PUT | /messages/:msgId | 메시지 수정 | 작성자 |
| DELETE | /messages/:msgId | 메시지 삭제 (마스킹) | 작성자 |
| POST | /messages/:msgId/attachments | 첨부파일 업로드 | 참여자 |
| GET | /conversations/:convId/participants | 참여자 목록 | 참여자 |
| POST | /conversations/:convId/participants | 참여자 추가 | Owner/Member |

### POST /conversations/:convId/messages
```json
// Request
{ "content": "시안 2개 금요일까지 보내드리겠습니다." }

// Response
{
  "success": true,
  "data": {
    "id": 42,
    "conversation_id": 1,
    "sender_id": 1,
    "content": "시안 2개 금요일까지 보내드리겠습니다.",
    "created_at": "2025-04-08T14:30:00Z"
  }
}
```
→ 동시에 Socket.IO로 실시간 전달

### Socket.IO 이벤트
| 이벤트 | 방향 | 설명 |
|--------|------|------|
| join_conversation | Client→Server | 대화방 입장 |
| leave_conversation | Client→Server | 대화방 퇴장 |
| new_message | Server→Client | 새 메시지 |
| message_updated | Server→Client | 메시지 수정 |
| message_deleted | Server→Client | 메시지 삭제 |
| task_created | Server→Client | 할일 생성 |
| task_updated | Server→Client | 할일 변경 |
| typing | Client↔Server | 입력 중 표시 |

---

## 7. 할일 (Tasks) — Q Task

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | /businesses/:id/tasks | 할일 목록 | Member 이상 |
| POST | /businesses/:id/tasks | 할일 생성 | Member 이상 |
| GET | /tasks/:taskId | 할일 상세 | 참여자 |
| PUT | /tasks/:taskId | 할일 수정 | Member 이상 |
| PUT | /tasks/:taskId/status | 상태 변경 | Member 이상 |
| DELETE | /tasks/:taskId | 할일 삭제 | Owner |

### POST /businesses/:id/tasks (메시지에서 생성 시)
```json
// Request
{
  "title": "시안 2개 추가",
  "sourceMessageId": 42,
  "conversationId": 1,
  "clientId": 1,
  "assigneeId": 3,
  "dueDate": "2025-04-11",
  "priority": "high"
}

// Response — Message.task_id도 자동 업데이트
{
  "success": true,
  "data": {
    "id": 10,
    "title": "시안 2개 추가",
    "source_message_id": 42,
    "status": "pending",
    "due_date": "2025-04-11"
  }
}
```

### GET /businesses/:id/tasks 쿼리 파라미터
| 파라미터 | 설명 | 예시 |
|---------|------|------|
| status | 상태 필터 | pending,in_progress |
| assigneeId | 담당자 | 3 |
| clientId | 고객별 | 1 |
| dueDateFrom | 마감일 시작 | 2025-04-08 |
| dueDateTo | 마감일 끝 | 2025-04-14 |
| overdue | 지연 여부 | true |

---

## 8. 파일 (Files) — Q File

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | /businesses/:id/files | 파일 목록 | Member 이상 |
| POST | /businesses/:id/files | 파일 업로드 | Member 이상 |
| GET | /files/:fileId/download | 파일 다운로드 | 참여자 |
| DELETE | /files/:fileId | 파일 삭제 | 업로더/Owner |

---

## 9. 청구서 (Invoices) — Q Bill

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | /businesses/:id/invoices | 청구서 목록 | Member 이상 |
| POST | /businesses/:id/invoices | 청구서 생성 | Member 이상 |
| GET | /invoices/:invoiceId | 청구서 상세 | 관련자 |
| PUT | /invoices/:invoiceId | 청구서 수정 | 작성자/Owner |
| POST | /invoices/:invoiceId/send | 이메일 발송 | Member 이상 |
| PUT | /invoices/:invoiceId/paid | 입금 확인 | Member 이상 |
| PUT | /invoices/:invoiceId/cancel | 청구서 취소 | Owner |

### POST /businesses/:id/invoices
```json
// Request
{
  "clientId": 1,
  "title": "4월 디자인 작업비",
  "dueDate": "2025-04-30",
  "recipientEmail": "billing@company.com",
  "recipientBusinessName": "A사",
  "recipientBusinessNumber": "123-45-67890",
  "items": [
    { "description": "로고 디자인", "quantity": 1, "unitPrice": 500000 },
    { "description": "명함 디자인", "quantity": 2, "unitPrice": 150000 }
  ],
  "notes": "입금 확인 후 작업 착수합니다."
}

// Response — invoice_number 자동생성, tax_amount/grand_total 자동계산
{
  "success": true,
  "data": {
    "id": 3,
    "invoice_number": "INV-2025-0003",
    "total_amount": 800000,
    "tax_amount": 80000,
    "grand_total": 880000,
    "status": "draft"
  }
}
```

---

## 10. Q Note

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| POST | /qnote/upload | 음성/문서 업로드 | 로그인 |
| POST | /qnote/transcribe | 음성→텍스트 | 로그인 |
| POST | /qnote/summarize | 텍스트→요약 | 로그인 |
| POST | /qnote/questions | 질문 추출 | 로그인 |
| POST | /qnote/answer | 답변 생성 | 로그인 |
| GET | /qnote/notes | 노트 목록 | 로그인 |
| GET | /qnote/notes/:noteId | 노트 상세 | 로그인 |

※ Q Note API는 FastAPI(port 8000)로 처리, Nginx에서 /qnote → localhost:8000 프록시

---

## 11. Platform Admin

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | /admin/dashboard | 전체 통계 | platform_admin |
| GET | /admin/businesses | 사업자 목록 | platform_admin |
| GET | /admin/businesses/:id | 사업자 상세 | platform_admin |
| PUT | /admin/businesses/:id/status | 사업자 상태 변경 | platform_admin |
| GET | /admin/users | 전체 사용자 | platform_admin |
| GET | /admin/audit | 감사 로그 | platform_admin |

---

## 12. Health Check

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | /health | Backend 상태 확인 |
| GET | /qnote/health | Q Note 상태 확인 |

```json
{ "status": "ok", "timestamp": "2025-04-08T14:30:00Z" }
```
