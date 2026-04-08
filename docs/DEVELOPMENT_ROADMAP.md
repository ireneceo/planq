# 11. 개발 로드맵 + Claude Code 프롬프트 모음

---

## 1. 전체 개발 순서

```
PART 1: 인프라                    PART 2: PlanQ 핵심
──────────────────                ──────────────────
Phase 1: 서버 분리 + 세팅 ✅       Phase 2: 인증 시스템
                                  Phase 3: 사업자 + 고객
                                  Phase 4: Q Bill (청구서)
                                  Phase 5: Q Talk (대화)
                                  Phase 6: Q Task (할일)
                                  Phase 7: Q File (자료함)

PART 3: Q Note (독립 개발 가능)    PART 4: 확장
──────────────────                ──────────────────
Phase 8: Q Note (1-2일 집중)       Phase 9: 알림
                                  Phase 10: 구독 관리
                                  Phase 11: 운영 배포
```

---

## 2. Phase별 상세 + Claude Code 프롬프트

---

### Phase 1: 서버 분리 + PlanQ 초기 세팅 ✅

**완료: 2026-04-08**

- [x] 디렉토리 구조 (`/opt/planq/`)
- [x] MySQL DB + 유저 (planq_dev_db / planq_admin)
- [x] 백엔드 (Express + Sequelize + 13 모델 + 8 라우트)
- [x] 프론트엔드 (Vite + React + TypeScript)
- [x] Nginx + SSL (dev.planq.kr)
- [x] Q Note (FastAPI, port 8000)
- [x] Git (github-planq:ireneceo/planq)
- [x] CLAUDE.md + DEVELOPMENT_PLAN.md
- [x] 개발 인프라 명령어 (/개발시작, /개발완료, /저장, /검증, /배포, /복원)
- [x] 보안 미들웨어 POS 수준 업그레이드

---

### Phase 2: 인증 시스템

**예상 소요: 1-2일**

```
CLAUDE.md를 읽고 PlanQ Phase 2 (인증 시스템)를 구현해줘.

구현할 것:

1. routes/auth.js 완성
   - POST /api/auth/register
     - 입력: email, password, name, businessName, businessSlug
     - 처리: User 생성 → Business 생성 → BusinessMember(owner) 생성
     - 반환: user, business, accessToken, refreshToken
     - 유효성: 이메일 중복, slug 중복, 비밀번호 8자 이상
   - POST /api/auth/login
     - 입력: email, password
     - 처리: bcrypt 비교 → JWT 발급
     - 반환: user, businesses(소속 목록), accessToken, refreshToken
   - POST /api/auth/refresh
     - 입력: refreshToken (HttpOnly Cookie)
     - 반환: 새 accessToken
   - POST /api/auth/logout
     - Refresh Token 무효화

2. middleware/auth.js 완성
   - verifyToken: JWT 검증
   - requireRole(roles): 역할 확인
   - checkBusinessAccess: business_id 소속 검증

3. 프론트엔드
   - src/contexts/AuthContext.tsx: 로그인 상태 관리, 토큰 저장
   - src/pages/Login/LoginPage.tsx: 로그인 폼
   - src/pages/Register/RegisterPage.tsx: 회원가입 폼
   - src/utils/api.ts: Axios interceptor (토큰 자동 갱신)
   - src/components/ProtectedRoute.tsx: 인증 필요 라우트 가드

4. 테스트
   - 회원가입 → 로그인 → 토큰 갱신 → 보호된 API 호출 성공 확인
   - 잘못된 토큰으로 API 호출 → 401 확인

빌드하고 PM2 재시작해줘.
```

**완료 확인:**
- [ ] 회원가입 → 자동 로그인 동작
- [ ] 로그인/로그아웃 동작
- [ ] 토큰 만료 → 자동 갱신 동작
- [ ] 미인증 요청 → 401 반환

---

### Phase 3: 사업자 + 고객 관리

**예상 소요: 2-3일**

```
CLAUDE.md를 읽고 Phase 3 (사업자 + 고객 관리)를 구현해줘.

구현할 것:

1. routes/businesses.js
   - GET /api/businesses/:id — 사업자 정보
   - PUT /api/businesses/:id — 사업자 수정 (Owner만)
   - GET /api/businesses/:id/members — 멤버 목록
   - POST /api/businesses/:id/members/invite — 멤버 초대 (이메일 발송)
   - DELETE /api/businesses/:id/members/:memberId — 멤버 제거

2. routes/clients.js
   - GET /api/businesses/:id/clients — 고객 목록
   - POST /api/businesses/:id/clients/invite — 고객 초대
     - Client(invited) 생성 + Conversation 자동 생성 + 초대 이메일 발송
     - 초대 링크: /invite/:token
   - GET /api/businesses/:id/clients/:clientId — 고객 상세
   - PUT /api/businesses/:id/clients/:clientId — 고객 수정
   - POST /api/auth/invite/:token — 초대 수락 (간편 가입)

3. 프론트엔드
   - /app/clients — 고객 목록 페이지
   - /app/clients → 고객 초대 모달
   - /app/team — 팀 관리 페이지 (Owner만)
   - /invite/:token — 초대 수락 페이지 (간편 가입)
   - MainLayout 사이드바 완성

4. 초대 이메일 템플릿 (Nodemailer)
   - 깔끔한 HTML 이메일
   - 초대 링크 포함

빌드하고 PM2 재시작해줘.
```

---

### Phase 4: Q Bill (청구서)

**예상 소요: 2일**

```
CLAUDE.md를 읽고 Phase 4 (Q Bill 청구서)를 구현해줘.

구현할 것:

1. routes/invoices.js
   - GET /api/businesses/:id/invoices — 청구서 목록 (필터: status)
   - POST /api/businesses/:id/invoices — 청구서 생성
     - invoice_number 자동생성 (INV-YYYY-NNNN)
     - tax_amount = total_amount * 0.1 (부가세 10%)
     - grand_total = total_amount + tax_amount
   - GET /api/invoices/:invoiceId — 청구서 상세
   - PUT /api/invoices/:invoiceId — 청구서 수정 (draft만)
   - POST /api/invoices/:invoiceId/send — 이메일 발송
   - PUT /api/invoices/:invoiceId/paid — 입금 확인
   - PUT /api/invoices/:invoiceId/cancel — 취소

2. services/emailService.js
   - sendInvoiceEmail(invoice, items) 함수
   - HTML 템플릿: 청구 제목, 항목 테이블, 금액, 납부기한

3. templates/invoiceEmail.html
   - 프로페셔널한 청구서 이메일 템플릿
   - 사업자 로고/이름, 항목, 금액, 계좌 정보 영역

4. 프론트엔드
   - /app/bills — 청구서 목록 (전체/미결/완료 탭)
   - /app/bills/new — 청구서 작성 폼 (항목 동적 추가/삭제)
   - /app/bills/:id — 청구서 상세 (발송/입금확인 버튼)

빌드하고 PM2 재시작해줘.
```

---

### Phase 5: Q Talk (대화)

**예상 소요: 3-4일 (핵심 기능)**

```
CLAUDE.md를 읽고 Phase 5 (Q Talk 대화 시스템)를 구현해줘.

구현할 것:

1. Socket.IO 설정 (server.js에서 초기화)
   - JWT 인증
   - 대화방 join/leave

2. routes/conversations.js
   - GET /api/businesses/:id/conversations — 대화 목록
   - GET /api/conversations/:convId/messages — 메시지 목록 (페이징, 최신순)
   - POST /api/conversations/:convId/messages — 메시지 전송 + Socket emit
   - PUT /api/messages/:msgId — 메시지 수정 (is_edited, edited_at)
   - DELETE /api/messages/:msgId — 메시지 삭제 (is_deleted 마스킹)
   - POST /api/messages/:msgId/attachments — 첨부파일 업로드

3. 프론트엔드 (핵심 화면)
   - /app/talks — 3단 레이아웃:
     - 좌: 대화방 목록 (ConversationList)
     - 중: 채팅 영역 (MessageList + MessageInput)
     - 우: Q Task 패널 (해당 고객 할일)
   - MessageItem: 내용, 시간, 수정됨 표시, 삭제됨 표시, 첨부파일
   - MessageInput: 텍스트 입력, 📎 첨부, Enter 전송
   - Socket.IO 연결: 실시간 메시지 수신

4. Socket.IO 이벤트
   - new_message, message_updated, message_deleted
   - typing (입력 중 표시)

빌드하고 PM2 재시작해줘.
```

---

### Phase 6: Q Task (할일)

**예상 소요: 2-3일**

```
CLAUDE.md를 읽고 Phase 6 (Q Task 할일 관리)를 구현해줘.

구현할 것:

1. routes/tasks.js
   - GET /api/businesses/:id/tasks — 할일 목록 (필터: status, assignee, client, due)
   - POST /api/businesses/:id/tasks — 할일 생성
     - sourceMessageId가 있으면 Message.task_id도 업데이트 (양방향)
   - PUT /api/tasks/:taskId — 할일 수정
   - PUT /api/tasks/:taskId/status — 상태 변경
   - 상태 변경 시 Socket.IO로 task_updated emit

2. 프론트엔드
   - /app/tasks — 할일 목록 페이지
     - 탭: 오늘 / 이번주 / 전체
     - 필터: 상태별, 담당자별, 고객별
     - 마감 지연 🔴, 오늘 마감 🟠, 임박 🟡 표시
   - Q Talk 대화 화면에서:
     - 메시지 hover → [+ 할일 만들기] 버튼
     - 클릭 → 모달 (제목 자동입력, 담당자, 마감일, 우선순위)
     - 생성 후 메시지에 🔗 뱃지, 우측 패널에 즉시 반영
   - 할일 → 원문 메시지 이동 (💬 원문보기)

빌드하고 PM2 재시작해줘.
```

---

### Phase 7: Q File (자료함)

**예상 소요: 1-2일**

```
CLAUDE.md를 읽고 Phase 7 (Q File 자료함)을 구현해줘.

구현할 것:

1. routes/files.js
   - GET /api/businesses/:id/files — 파일 목록 (필터: clientId)
   - POST /api/businesses/:id/files — 파일 업로드 (Multer, UUID 파일명)
   - GET /api/files/:fileId/download — 파일 다운로드
   - DELETE /api/files/:fileId — 파일 삭제

2. 프론트엔드
   - /app/files — 자료함 (고객별 탭/폴더)
   - 파일 업로드 (드래그 앤 드롭 + 파일 선택)
   - 파일 목록 (이름, 크기, 업로더, 날짜)
   - 파일 다운로드/삭제

빌드하고 PM2 재시작해줘.
```

---

### Phase 8: Q Note (음성/회의 정리)

**예상 소요: 1-2일 (독립 개발, 우선 진행 가능)**

```
PlanQ의 Q Note 기능을 구현해줘.
/opt/planq/q-note 디렉토리에 FastAPI 프로젝트를 만들어.
PlanQ 백엔드(/opt/planq/dev-backend)와 직접 코드 연결하지 마.

1. 환경 세팅
   cd /opt/planq/q-note
   python3.11 -m venv venv
   source venv/bin/activate

2. 프로젝트 구조
   q-note/
   ├── main.py              ← FastAPI entry
   ├── .env
   ├── requirements.txt
   ├── routers/
   │   ├── stt.py           ← POST /api/stt/upload (음성→텍스트)
   │   ├── summary.py       ← POST /api/summary (텍스트→요약)
   │   ├── questions.py     ← POST /api/questions (질문 추출)
   │   ├── answers.py       ← POST /api/answers (답변 생성)
   │   └── documents.py     ← POST /api/documents/upload (문서 업로드)
   ├── services/
   │   ├── whisper_service.py  ← OpenAI Whisper API 호출
   │   ├── llm_service.py     ← Claude/OpenAI API 호출
   │   └── document_service.py
   ├── uploads/
   └── CLAUDE.md

3. requirements.txt
   fastapi, uvicorn[standard], python-multipart,
   openai, anthropic, python-dotenv, pydub

4. .env
   PORT=8000
   OPENAI_API_KEY=(설정)
   ANTHROPIC_API_KEY=(설정)

5. 각 라우터 구현
   - /api/stt/upload: 음성 파일 → Whisper API → 텍스트 반환
   - /api/summary: 텍스트 → LLM → 핵심요약 + bullet summary
   - /api/questions: 대화 텍스트 → LLM → 질문 리스트 + 중요 표시
   - /api/answers: 질문 + 문서 → LLM → 답변 (짧은/설명형)
   - /api/documents/upload: PDF/텍스트 업로드 + 저장
   - GET /health → { status: "ok" }

6. PM2 등록
   pm2 start "source venv/bin/activate && uvicorn main:app --host 0.0.0.0 --port 8000" \
   --name planq-qnote --cwd /opt/planq/q-note

7. Nginx 프록시 추가 (/etc/nginx/sites-available/planq-dev)
   location /qnote/ {
       proxy_pass http://localhost:8000/;
   }

8. 확인
   curl localhost:8000/health → ok
   curl dev.planq.kr/qnote/health → ok
```

---

### Phase 9: 알림 시스템

```
CLAUDE.md를 읽고 Phase 9 (알림 시스템)를 구현해줘.

인앱 알림:
- 새 메시지, 할일 배정, 마감 임박, 청구서 발송/입금
- 헤더 벨 아이콘 + 드롭다운

이메일 알림:
- 멤버/고객 초대, 마감 임박(D-1), 청구서

빌드하고 PM2 재시작해줘.
```

---

### Phase 10: 구독 관리

```
CLAUDE.md를 읽고 Phase 10 (구독 관리)를 구현해줘.

요금제: Free(0원)/Basic(₩99,000)/Pro(₩149,000)
제한: 고객 수, 담당자 수, 저장공간, Q Note 횟수
미납 처리: 7일 유예 → 읽기전용 → 접근차단 → 데이터삭제

빌드하고 PM2 재시작해줘.
```

---

### Phase 11: 운영 배포 + Landing

```
운영서버 배포 스크립트 + 랜딩 페이지
```

---

## 3. 체크리스트 (전체)

### Phase 완료 확인
- [x] Phase 1: 인프라 세팅 + health check ✅
- [ ] Phase 2: 회원가입/로그인 동작
- [ ] Phase 3: 고객 초대 → 간편 가입 → 대화방 자동 생성
- [ ] Phase 4: 청구서 작성 → 이메일 발송
- [ ] Phase 5: 실시간 채팅 동작
- [ ] Phase 6: 메시지 → 할일 전환 + 양방향 링크
- [ ] Phase 7: 파일 업로드/다운로드
- [ ] Phase 8: 음성 → 텍스트 → 요약 → 질문 → 답변
- [ ] Phase 9: 인앱/이메일 알림
- [ ] Phase 10: 구독 관리 + 결제
- [ ] Phase 11: 운영 배포 + Landing
