# 11. 개발 로드맵 + Claude Code 프롬프트 모음

---

## 1. 전체 개발 순서

```
PART 0: 기초 정비                   PART 1: 인프라
──────────────────                 ──────────────────
Phase 0: 네이밍·Workspace·Cue 기반  Phase 1: 서버 분리 ✅
         (Q Talk 직전 선행 필수)

PART 2: PlanQ 핵심 메뉴             PART 3: Q Note (독립)
──────────────────                 ──────────────────
Phase 2: 인증 시스템                 Phase 8: Q Note ✅
Phase 3: 워크스페이스 + 고객
Phase 4: Q Bill (청구서)            PART 4: 확장
Phase 5: Q Talk (Cue + 사람)        ──────────────────
Phase 6: Q Task (할일)              Phase 9: 알림
Phase 7: Q File (자료함)            Phase 10: 구독 관리
                                   Phase 11: 운영 배포
```

---

## 2. Phase별 상세 + Claude Code 프롬프트

---

### Phase 0: 기초 정비 (Q Talk 선행 필수)

**예상 소요: 2-3일**
**상세: `docs/FEATURE_SPECIFICATION.md` Phase 0 참조**

#### 작업 단계

| 단계 | 작업 | 내용 |
|------|------|------|
| 0-1 | 네이밍 i18n 교체 | `사업자→워크스페이스`, `Owner→관리자` (locales/*.json 일괄) |
| 0-2 | businesses 테이블 확장 | brand/legal 컬럼 추가, 기존 `name` → `brand_name` 마이그레이션 |
| 0-3 | users.is_ai 추가 + Cue 계정 자동 생성 | register 트랜잭션 확장, 기존 워크스페이스에 Cue 주입 스크립트 |
| 0-4 | business_members.role ENUM 확장 | `+ 'ai'` 값 추가 |
| 0-5 | 워크스페이스 설정 페이지 신규 | `/app/settings/brand` · `/legal` · `/language` · `/members` · `/cue` |
| 0-6 | 가시성 미들웨어 신규 | `checkVisibility()` — 각 메뉴 Phase 에서 활용 |
| 0-7 | 설계 문서 완성 | 본 단계 완료 시점에 5개 문서 모두 업데이트됨 |

#### 완료 확인
- [ ] 로그인 후 UI 모든 화면에서 "사업자" 문자열 없음 (한국어 검증)
- [ ] 회원가입 → 워크스페이스 생성 + Cue 멤버 1개 자동 생성
- [ ] `/app/settings/brand` 에서 brand_name·logo·color 자동저장 동작
- [ ] `/app/settings/legal` 에서 legal_name·tax_id 자동저장 동작
- [ ] `/app/settings/members` 상단에 Cue 카드 고정 표시
- [ ] Cue 관련 API (`/businesses/:id/cue`) 스텁 응답

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

### Phase 5: Q Talk (Cue + 사람 공동 응대)

**예상 소요: 6-8일 (핵심 기능, Cue 통합 포함)**
**상세 기획: `docs/FEATURE_SPECIFICATION.md` Phase 5 (F5-0 ~ F5-16)**

#### 구현 단계

| 단계 | 작업 | 기간 |
|------|------|------|
| 5-1 | Socket.IO 초기화 + 대화 기본 CRUD | 1일 |
| 5-2 | Messages 테이블 확장 필드 적용 (`is_ai`, `kind`, `is_internal` 등) | 0.5일 |
| 5-3 | 대화 자료 (KB) 관리 페이지 + 업로드 + 인덱싱 파이프라인 (Q Note 엔진 래핑) | 2일 |
| 5-4 | Pinned FAQ CRUD + CSV 템플릿·업로드 | 1일 |
| 5-5 | `cue_orchestrator.py` — Tier 매칭 + 답변 생성 + 비용 집계 | 2일 |
| 5-6 | Auto/Draft/Smart 모드 분기 + 민감 키워드 강제 Draft | 0.5일 |
| 5-7 | Cue 메시지 실시간 발송 (WS `cue_thinking` → `new_message`) | 0.5일 |
| 5-8 | Cue 사이드패널 (고객 프로필·요약·답변 후보·내부 메모) | 1.5일 |
| 5-9 | Draft 승인/거절 워크플로우 | 0.5일 |
| 5-10 | 고객 히스토리 자동 요약 배치 | 0.5일 |
| 5-11 | Cue 일시정지·재개 (전역·대화별·턴단위 스킵) | 0.5일 |
| 5-12 | 인라인 카드 (task/invoice/event 생성 메시지) | 1일 |
| 5-13 | 검증 + 버그 수정 | 1일 |

#### Claude Code 실행 프롬프트

```
CLAUDE.md + docs/FEATURE_SPECIFICATION.md Phase 5 + docs/DATABASE_ERD.md 를
읽고 Phase 5 (Q Talk Cue 팀원 시스템)를 구현해줘.

Phase 0 선행 작업이 모두 완료된 상태여야 함.

구현 우선순위 (단계별 커밋):
  5-1: Socket.IO + routes/conversations.js 기본 CRUD (기존 보완)
  5-2: DB 마이그레이션 (messages 확장 필드, conversations Cue 필드)
  5-3: 대화 자료 (KB) 관리 — /app/talks/kb, routes/kb.js
       · Q Note embedding_service.py 를 q-note/services 에서
         backend/services/kb_service.js (또는 FastAPI 확장)로 연결
  5-4: Pinned FAQ CRUD + CSV 업로드 (Q Note priority-qa 로직 재사용)
  5-5: cue_orchestrator.py — 4-tier 매칭 + Auto/Draft/Smart + 비용 집계
  5-6: 고객 메시지 수신 시 Cue 자동 트리거 (post-insert hook)
  5-7: 프론트엔드 Q Talk 3단 레이아웃 (좌: 대화목록, 중: 채팅, 우: Cue 사이드패널)
  5-8: Cue 사이드패널 — 고객 요약, 진행 업무 카드, Draft 답변 후보, 내부 메모
  5-9: Draft 승인/거절 UI + API
  5-10: 고객 히스토리 자동 요약 (20턴 트리거 + 일 배치)
  5-11: Cue 일시정지·재개 (전역·대화별·턴단위)
  5-12: 인라인 카드 (task/invoice/event 카드 메시지)

각 단계마다 검증 후 커밋.
최종 검증: 9단계 검증 프로세스 전부 통과.
```

#### 완료 확인
- [ ] 고객 초대 → 가입 → 첫 대화 1분 내
- [ ] 대화 자료 업로드 → 인덱싱 → Cue 답변 소스로 사용
- [ ] Pinned FAQ 등록 → 유사 질문 paraphrase 매칭
- [ ] Cue Smart 모드: confidence 높은 질문은 Auto 발송, 낮은 건 Draft
- [ ] Draft 메시지 사이드패널 표시 + 승인/거절 동작
- [ ] Cue 메시지에 출처 문서·섹션 인라인 표시
- [ ] 고객별 자동 요약 생성 + 수동 갱신
- [ ] Cue 일시정지 (전역·대화별·턴단위) 동작
- [ ] 메시지에서 할일·청구서·일정 생성 → 인라인 카드 표시
- [ ] `cue_usage` 한도 도달 시 "휴식 중" UI + 액션 거부
- [ ] 9단계 검증 프로세스 전체 통과

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

### Phase 8: Q Note (실시간 회의 전사 + AI 분석)

**예상 소요: 3-4일 (독립 개발, 우선 진행)**
**상세 기능 정의: `docs/FEATURE_SPECIFICATION.md` Phase 8 참조**

#### 작업 단계

| 단계 | 작업 | 내용 |
|------|------|------|
| B-1 | FastAPI 구조 + Deepgram WebSocket 프록시 | 프로젝트 구조, DB(SQLite), 인증, Deepgram 연동 |
| B-2 | GPT-4o-mini 연동 (번역 + 질문 감지) | final result → 번역+질문판별 한 번에 처리 |
| B-3 | 프론트엔드 라이브 모드 | 녹음 시작/종료, 실시간 전사+번역 표시, 질문 하이라이트 |
| B-4 | 세션 저장 + 리뷰 모드 | 세션 목록, 기록 열람, 요약 생성 |
| B-5 | 문서 업로드 + 답변 찾기 (RAG) | 문서 업로드, FTS5 검색, LLM 답변 생성 |
| B-6 | 결과 연동 (Q Task, Q Talk) | 요약→할일, 결과→대화방 공유 (2차) |

#### 프로젝트 구조

```
q-note/
├── main.py                  ← FastAPI entry + WebSocket
├── .env                     ← DEEPGRAM_API_KEY, OPENAI_API_KEY, JWT_SECRET
├── requirements.txt
├── routers/
│   ├── live.py              ← WebSocket /ws/live (실시간 STT 프록시)
│   ├── sessions.py          ← GET/POST /api/sessions (세션 CRUD)
│   ├── summary.py           ← POST /api/summary (요약 생성)
│   ├── questions.py         ← GET /api/sessions/:id/questions (질문 목록)
│   ├── answers.py           ← POST /api/answers (답변 찾기)
│   └── documents.py         ← POST /api/documents/upload (문서 업로드)
├── services/
│   ├── deepgram_service.py  ← Deepgram WebSocket 연결 관리
│   ├── llm_service.py       ← GPT-4o-mini (번역/질문감지/요약/답변)
│   └── document_service.py  ← 문서 텍스트 추출 + FTS5 인덱싱
├── middleware/
│   └── auth.py              ← JWT 검증 (PlanQ 백엔드 SECRET_KEY 공유)
├── data/
│   └── qnote.db             ← SQLite (세션, 발화, 문서, 질문)
└── uploads/                 ← 문서 파일 저장
    └── {business_id}/
```

#### 필요 API 키
- **Deepgram**: 실시간 STT ($0.0077/분)
- **OpenAI**: GPT-4o-mini 번역/요약/답변 ($0.15/1M tokens)

#### Nginx WebSocket 프록시 (추가 필요)

```nginx
location /qnote/ {
    proxy_pass http://localhost:8000/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
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
