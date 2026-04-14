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
  "defaultLanguage": "ko",          // "ko" | "en"
  "brandName": "워프로랩",
  "brandNameEn": "WOR-PRO Lab",     // default='ko' 일 때만 선택
  "slug": "worpro-lab"
}

// Response — 워크스페이스 생성 + Cue 계정 자동 생성
{
  "success": true,
  "data": {
    "user": { "id": 1, "email": "...", "name": "Irene", "is_ai": false },
    "workspace": {
      "id": 1,
      "slug": "worpro-lab",
      "brand_name": "워프로랩",
      "brand_name_en": "WOR-PRO Lab",
      "default_language": "ko",
      "plan": "free",
      "cue": { "user_id": 2, "name": "Cue" }
    },
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```

**내부 처리**
1. `users` 에 사람 user insert
2. `businesses` 에 워크스페이스 insert (brand 필수, legal 선택 — 나중 설정에서)
3. `users` 에 Cue AI 계정 insert (`is_ai=true`, `email=null`)
4. `business_members` 에 관리자(role=owner) + Cue(role=ai) 두 행 insert
5. JWT 발급

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

## 4. 워크스페이스 (Businesses)

내부 URL 은 `/businesses/:id` 유지 (스키마 rename 안 함, 8. 네이밍 정책 참조).
사용자 표기만 "워크스페이스".

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | /businesses/:id | 워크스페이스 정보 | Member 이상 |
| PUT | /businesses/:id/brand | 브랜드 정보 수정 | 관리자 |
| PUT | /businesses/:id/legal | 법인 정보 수정 | 관리자 |
| PUT | /businesses/:id/settings | 타임존·근무시간·언어 등 | 관리자 |
| GET | /businesses/:id/members | 멤버 목록 (Cue 포함) | Member 이상 |
| POST | /businesses/:id/members/invite | 멤버 초대 | 관리자 |
| PUT | /businesses/:id/members/:memberId | 멤버 역할 변경 | 관리자 |
| DELETE | /businesses/:id/members/:memberId | 멤버 제거 (Cue 제거 불가) | 관리자 |
| GET | /businesses/:id/cue | Cue 설정 및 사용량 조회 | Member 이상 |
| PUT | /businesses/:id/cue | Cue 모드 (smart/auto/draft) 변경 | 관리자 |
| POST | /businesses/:id/cue/pause | Cue 전체 일시정지 | 관리자 |
| POST | /businesses/:id/cue/resume | Cue 재개 | 관리자 |

### PUT /businesses/:id/brand
```json
// Request (default_language='ko' 인 경우)
{
  "brandName": "워프로랩",
  "brandNameEn": "WOR-PRO Lab",
  "brandTagline": "AI 언어 연구소",
  "brandTaglineEn": "AI Language Research",
  "brandLogoUrl": "...",
  "brandColor": "#F43F5E"
}
```

### PUT /businesses/:id/legal
```json
// Request
{
  "legalName": "(주)아이린앤컴퍼니",
  "legalNameEn": "Irene & Company Inc.",
  "legalEntityType": "corporation",
  "taxId": "123-45-67890",
  "representative": "이정은",
  "representativeEn": "Irene Lee",
  "address": "서울시 ...",
  "addressEn": "Seoul, ...",
  "phone": "+82-2-...",
  "email": "contact@worpro.kr",
  "website": "https://worpro.kr"
}
```

### GET /businesses/:id/cue
```json
// Response
{
  "success": true,
  "data": {
    "cue_user_id": 2,
    "mode": "smart",
    "paused": false,
    "usage": {
      "year_month": "2026-04",
      "action_count": 1234,
      "limit": 5000,
      "cost_usd": 0.62,
      "by_type": {
        "answer": 900,
        "task_execute": 200,
        "summary": 134
      }
    }
  }
}
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
| GET | /conversations/:convId | 대화방 정보 + 참여자 + 현재 Cue 상태 | 참여자 |
| GET | /conversations/:convId/messages | 메시지 목록 (페이징, 내부메모 필터) | 참여자 |
| POST | /conversations/:convId/messages | 메시지 전송 | 참여자 |
| PUT | /messages/:msgId | 메시지 수정 | 작성자 |
| DELETE | /messages/:msgId | 메시지 삭제 (마스킹) | 작성자 |
| POST | /messages/:msgId/attachments | 첨부파일 업로드 | 참여자 |
| POST | /messages/:msgId/approve | Draft 메시지 승인 → 고객에 발송 | Member 이상 |
| POST | /messages/:msgId/reject | Draft 메시지 거절 (삭제) | Member 이상 |
| GET | /conversations/:convId/participants | 참여자 목록 | 참여자 |
| POST | /conversations/:convId/cue/pause | 이 대화에서 Cue 일시정지 | Member 이상 |
| POST | /conversations/:convId/cue/resume | 이 대화에서 Cue 재개 | Member 이상 |
| POST | /conversations/:convId/cue/trigger | Cue 에 즉시 답변 요청 (수동 호출) | Member 이상 |
| GET | /conversations/:convId/cue/suggestions | 현재 맥락 기반 답변 후보 3개 | Member 이상 |
| GET | /conversations/:convId/summary | 고객 히스토리 요약 (캐시 + 재생성 옵션) | Member 이상 |

### POST /conversations/:convId/messages
```json
// Request (사람)
{
  "content": "시안 2개 금요일까지 보내드리겠습니다.",
  "isInternal": false   // true 면 내부 메모
}

// Response
{
  "success": true,
  "data": {
    "id": 42,
    "conversation_id": 1,
    "sender_id": 1,
    "sender": { "name": "Irene", "is_ai": false, "avatar_url": "..." },
    "kind": "text",
    "content": "시안 2개 금요일까지 보내드리겠습니다.",
    "is_ai": false,
    "is_internal": false,
    "created_at": "2026-04-14T14:30:00Z"
  }
}
```

→ 메시지 저장 후 다음 동작:
1. Socket.IO `new_message` 이벤트 발행
2. 해당 대화에서 `cue_enabled=true` 이고 Cue 월 한도 여유 있으면 Cue 선응답 트리거 (백그라운드)
3. `is_internal=true` 면 Cue 트리거 스킵 (내부 대화는 응답 안 함)

### Cue 메시지 응답 예시
```json
{
  "id": 43,
  "sender_id": 2,
  "sender": { "name": "Cue", "is_ai": true, "avatar_url": "/static/cue.svg" },
  "kind": "text",
  "content": "금요일 오후 2시까지 드리는 일정으로 확인됐습니다. 시안 방향은 기존 버전 유지인지요?",
  "is_ai": true,
  "ai_confidence": 0.91,
  "ai_source": "kb_rag",
  "ai_sources": [
    { "doc_id": 12, "title": "작업 일정 가이드", "section": "시안 납기", "snippet": "..." }
  ],
  "ai_model": "gpt-4o-mini",
  "ai_mode_used": "auto",
  "created_at": "2026-04-14T14:30:02Z"
}
```

### Socket.IO 이벤트
| 이벤트 | 방향 | 설명 |
|--------|------|------|
| join_conversation | C→S | 대화방 입장 |
| leave_conversation | C→S | 대화방 퇴장 |
| new_message | S→C | 새 메시지 |
| message_updated | S→C | 메시지 수정 |
| message_deleted | S→C | 메시지 삭제 |
| typing | C↔S | 입력 중 표시 |
| cue_thinking | S→C | Cue 가 답변 준비 중 ("관련 자료 찾는 중...") |
| cue_draft_ready | S→C | Draft 모드에서 초안 준비 완료 (사이드패널 알림) |
| cue_suppressed | S→C | 사람이 타이핑 중이라 Cue 가 해당 턴 스킵 |
| cue_paused | S→C | 해당 대화에서 Cue 일시정지됨 |
| cue_resumed | S→C | Cue 재개됨 |
| task_created | S→C | 할일 생성 (카드 메시지 삽입) |
| task_updated | S→C | 할일 변경 |

---

## 6.1 대화 자료 (KB) — Cue 소스

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | /businesses/:id/kb/documents | 대화 자료 문서 목록 | Member 이상 |
| POST | /businesses/:id/kb/documents | 문서 업로드 + 인덱싱 큐 | 관리자 |
| GET | /businesses/:id/kb/documents/:docId | 문서 상세 + 청크 통계 | Member 이상 |
| DELETE | /businesses/:id/kb/documents/:docId | 문서 삭제 (청크 CASCADE) | 관리자 |
| POST | /businesses/:id/kb/documents/:docId/reindex | 재인덱싱 | 관리자 |
| GET | /businesses/:id/kb/pinned | Pinned FAQ 목록 | Member 이상 |
| POST | /businesses/:id/kb/pinned | FAQ 등록 (question/answer/short/keywords) | 관리자 |
| PUT | /businesses/:id/kb/pinned/:faqId | FAQ 수정 | 관리자 |
| DELETE | /businesses/:id/kb/pinned/:faqId | FAQ 삭제 | 관리자 |
| POST | /businesses/:id/kb/pinned/upload-csv | CSV 일괄 업로드 | 관리자 |
| GET | /businesses/:id/kb/pinned/template.csv | CSV 템플릿 다운로드 | Member 이상 |
| POST | /businesses/:id/kb/search | 검색 (하이브리드 FTS+임베딩, 테스트용) | 관리자 |

엔진 재사용: Q Note `embedding_service.py` + FTS 하이브리드 매칭을 대화 자료 컨텍스트로 래핑.

---

## 6.2 고객 히스토리 요약

| 메서드 | 경로 | 설명 | 권한 |
|--------|------|------|------|
| GET | /businesses/:id/clients/:clientId/summary | 현재 요약 (캐시) | Member 이상 |
| POST | /businesses/:id/clients/:clientId/summary/refresh | 수동 재생성 | Member 이상 |
| PUT | /businesses/:id/clients/:clientId/summary | 수동 편집 (manual=true 플래그) | Member 이상 |

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
