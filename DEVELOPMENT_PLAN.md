# PlanQ - 개발 진행 현황

> **최종 업데이트:** 2026-04-10
> **데이터베이스:** planq_dev_db (MySQL) + qnote.db (SQLite, FTS5)
> **프로젝트:** B2B SaaS — 업무 전용 고객 채팅 + 실행 구조 통합 OS
> **로드맵 상세:** `docs/DEVELOPMENT_ROADMAP.md`

---

## ✅ 완료: Q Note Phase 8 — B-1, B-2 + B-3 mock UI + 인프라 정비 (2026-04-10)

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **B-1 백엔드** | Q Note FastAPI 구조 (routers/services/middleware/data) | ✅ |
| **B-1 백엔드** | SQLite 6 테이블 + FTS5 (sessions, utterances, documents, document_chunks, summaries, detected_questions) | ✅ |
| **B-1 백엔드** | JWT 인증 미들웨어 (PlanQ 백엔드 SECRET_KEY 공유) | ✅ |
| **B-1 백엔드** | Deepgram WebSocket 프록시 (Nova-3, language=multi) | ✅ |
| **B-1 백엔드** | 세션 CRUD API (POST/GET/PUT/DELETE /api/sessions) | ✅ |
| **B-1 백엔드** | WebSocket /ws/live 엔드포인트 | ✅ |
| **B-1 인프라** | Nginx WebSocket 프록시 헤더 추가 | ✅ |
| **B-2 백엔드** | OpenAI GPT-5-mini 연동 (translate, summary, answer) | ✅ |
| **B-2 백엔드** | LLM 서비스 (translate_and_detect_question, generate_summary, generate_answer) | ✅ |
| **B-2 백엔드** | /api/llm/translate, /api/llm/summary 엔드포인트 | ✅ |
| **B-2 백엔드** | live.py에 background enrichment 통합 (utterance → 번역+질문감지) | ✅ |
| **B-2 검증** | 실제 한→영 / 영→한 번역 + is_question 감지 동작 확인 (19/19 헬스체크) | ✅ |
| **헬스체크** | scripts/health-check.js — 19개 체크 (Infra/Auth/B-1/External/B-2/Frontend Lint) | ✅ |
| **헬스체크** | /검증 + /개발완료 명령어에 0단계 헬스체크 통과 강제 추가 | ✅ |
| **헬스체크** | 토큰 캐시 (rate limit 회피) | ✅ |
| **린트** | Frontend 린트 3종 (POS 컬러 잔재 / raw <select> / react-select 직접 import) | ✅ |
| **컴포넌트** | PlanQSelect (react-select 기반 검색 가능 통합 셀렉트, 사이즈/multi/icon 지원) | ✅ |
| **컴포넌트** | Icons.tsx (Feather-style stroke SVG, MicIcon/MonitorIcon/StopIcon 등 11개) | ✅ |
| **POS 정리** | POS 보라색 잔재 17개 파일 약 30곳 일괄 정리 (#6C5CE7→#14B8A6 등) | ✅ |
| **POS 정리** | theme.ts brand 컬러 PlanQ 딥틸로 교체 + Point 컬러 추가 | ✅ |
| **POS 정리** | legacy SelectComponents.tsx 삭제, ThemedSelect/FormSelect 제거 | ✅ |
| **컬러 시스템** | Point 컬러 Coral/Rose #F43F5E 정의 (CTA + AI 감지 강조용) | ✅ |
| **컬러 시스템** | COLOR_GUIDE.md §2.5 Point 컬러 섹션 신규 추가 | ✅ |
| **DB** | users.language 컬럼 추가 (사용자 모국어, ISO 639-1) | ✅ |
| **DB** | PUT /api/users/:id에 language 업데이트 + 검증 추가 | ✅ |
| **B-3 mock UI** | Q Note 페이지 (사이드바 + 라이브/리뷰 모드 + 트랜스크립트) | ✅ |
| **B-3 mock UI** | StartMeetingModal — 회의 시작 입력 폼 | ✅ |
| **B-3 mock UI** | 회의 시작 모달 — 제목, 회의 안내(brief), 참여자, 메인/답변/번역 언어, 자료(파일/텍스트/URL), 캡처 방식 | ✅ |
| **B-3 mock UI** | 메인 언어 멀티 셀렉트 (pill + "+ 언어 추가") — 빈 상태 시작 | ✅ |
| **B-3 mock UI** | 답변 언어 (메인 언어 중 선택), 번역 언어 (모든 언어, 디폴트 사용자 모국어) | ✅ |
| **B-3 mock UI** | 참여자 입력 (이름 + 역할/메모, 그룹 표현 가능) | ✅ |
| **B-3 mock UI** | 자료 — 파일 업로드 (10MB 검증) + 텍스트 붙여넣기 (10만자) + URL (http/https 검증) | ✅ |
| **B-3 mock UI** | 본인 발화 질문 제외 (isSelf 필드, 좌측 코랄 보더 + "질문" 라벨 + "답변 찾기" 버튼 제외) | ✅ |
| **B-3 mock UI** | 질문 발화 텍스트 굵게 + 코랄 좌측 보더 강조 | ✅ |
| **B-3 mock UI** | 사이드바 접기 토글 (미팅 풀스크린) | ✅ |
| **B-3 mock UI** | AudioCapture 추상화 인터페이스 (마이크/탭, 미래 데스크톱 앱 대응) | ✅ |
| **B-3 mock UI** | LANGUAGES.ts 상수 (23개 언어, ISO 639-1 + Deepgram 지원 정보) | ✅ |
| **워크플로우** | UI-First 개발 원칙 영구 규칙화 (CLAUDE.md + 메모리) | ✅ |

### 미완료 / 다음 단계 (B-3 backend wiring + B-4~B-6)

| 작업 | 상태 |
|------|:----:|
| Deepgram WebSocket에 `diarize=true` 옵션 추가 (화자 분리) | ⏳ |
| sessions 테이블에 brief, participants(JSON), urls 컬럼 추가 | ⏳ |
| speakers 테이블 신규 (session_id, speaker_id, participant_name, is_self) | ⏳ |
| 화자 매칭 API (POST /api/sessions/:id/speakers/:speaker_id/match) | ⏳ |
| LLM 호출 시 brief + participants를 system prompt에 prefix 주입 | ⏳ |
| isSelf 자동 마킹 (사용자가 "나"로 매칭한 speaker_id 발화 모두) | ⏳ |
| 본인 발화는 detected_questions 테이블에 INSERT 안 함 | ⏳ |
| URL fetcher (trafilatura/readability) + SSRF 방어 (내부 IP 차단, HTTPS 강제) | ⏳ |
| 문서 업로드 + 텍스트 추출 + 청크 분할 + FTS5 인덱싱 (B-5 RAG) | ⏳ |
| 회의 음성 캡처 → WebSocket 전송 (PCM16 16kHz mono) | ⏳ |
| 라이브 모드 mock 데이터 → 실 WebSocket 연결로 교체 | ⏳ |
| 리뷰 모드 → 실 세션 데이터로 교체 | ⏳ |
| 사용자 프로필 페이지 (language 필드 변경 UI) | ⏳ |
| 회의 도중 연결 끊김 처리 (재연결 + 버퍼 + 이어쓰기) | ⏳ |
| 4시간 회의 한계 처리 (Deepgram 세션 split) | ⏳ |
| 음성 핑거프린트 등록/매칭 (선택 기능) | ⏳ |
| 법적 동의 1회 모달 (녹음 동의, AI 데이터 처리 안내) | ⏳ |

### 수정/생성된 파일 (이번 세션)

**생성:**
- `dev-frontend/src/components/Common/PlanQSelect.tsx`
- `dev-frontend/src/components/Common/Icons.tsx`
- `dev-frontend/src/constants/languages.ts`
- `dev-frontend/src/services/audio/AudioCaptureSource.ts`
- `dev-frontend/src/services/audio/MicrophoneCapture.ts`
- `dev-frontend/src/services/audio/BrowserTabCapture.ts`
- `dev-frontend/src/services/audio/index.ts`
- `dev-frontend/src/pages/QNote/QNotePage.tsx`
- `dev-frontend/src/pages/QNote/StartMeetingModal.tsx`
- `dev-frontend/src/pages/QNote/mockData.ts`
- `q-note/middleware/auth.py`
- `q-note/services/database.py`
- `q-note/services/deepgram_service.py`
- `q-note/services/llm_service.py`
- `q-note/routers/live.py`
- `q-note/routers/sessions.py`
- `q-note/routers/llm.py`
- `q-note/.env` (개인 키 — git 제외)
- `scripts/health-check.js`

**수정:**
- `q-note/main.py`, `q-note/requirements.txt`
- `dev-backend/models/User.js` (language 컬럼 추가)
- `dev-backend/routes/users.js` (language 업데이트 검증)
- `dev-frontend/src/styles/theme.ts` (PlanQ 컬러 + Point 컬러)
- `dev-frontend/COLOR_GUIDE.md` (Point 컬러 §2.5 추가)
- `dev-frontend/src/App.tsx` (Q Note 라우트 활성화)
- `CLAUDE.md` (UI-First 워크플로우 명시)
- `.claude/commands/검증.md`, `.claude/commands/개발완료.md` (헬스체크 0단계 추가)
- POS 컬러 잔재 17개 파일 (보라색 → 딥틸)

**삭제:**
- `dev-frontend/src/components/UI/SelectComponents.tsx` (가짜 SearchableSelect)

---

## Phase 1: 서버 분리 + PlanQ 초기 세팅 ✅

**완료: 2026-04-08**

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 디렉토리 구조 (`/opt/planq/`) | ✅ |
| 2 | MySQL DB + 유저 (planq_dev_db / planq_admin) | ✅ |
| 3 | 백엔드 (Express + Sequelize + 13 모델 + 8 라우트) | ✅ |
| 4 | 프론트엔드 (Vite + React + TypeScript) | ✅ |
| 5 | Nginx + SSL (dev.planq.kr) | ✅ |
| 6 | Q Note (FastAPI, port 8000) | ✅ |
| 7 | Git (github-planq:ireneceo/planq) | ✅ |
| 8 | CLAUDE.md + DEVELOPMENT_PLAN.md | ✅ |
| 9 | 개발 인프라 명령어 (/개발시작, /개발완료, /저장, /검증, /배포, /복원) | ✅ |
| 10 | 보안 미들웨어 POS 수준 업그레이드 (SSRF, CSP, SQL Injection, Socket.IO 인증) | ✅ |
| 11 | 설계 문서 정리 (docs/ — 아키텍처, ERD, IA, API, 기능정의서, 보안, 로드맵) | ✅ |

---

## ✅ 완료: Phase 2 최소 세트 — 인증 시스템 (2026-04-08)

### 완료된 작업

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | POST /api/auth/register (User+Business+Member 트랜잭션 생성, JWT 발급) | ✅ |
| 2 | POST /api/auth/login (이메일/username 둘 다 지원, Access 15분 + Refresh 7일) | ✅ |
| 3 | POST /api/auth/refresh (HttpOnly Cookie, Refresh Token rotation) | ✅ |
| 4 | POST /api/auth/logout (Refresh Token DB 무효화 + cookie 삭제) | ✅ |
| 5 | POST /api/auth/forgot-password + reset-password | 미구현 (나중에) |
| 6 | AuthContext (메모리 토큰 + 14분 자동갱신) + ProtectedRoute | ✅ |
| 7 | LoginPage + RegisterPage (PlanQ 컬러, pill shape, placeholder only) | ✅ |
| 8 | MainLayout (딥틸 사이드바 + LanguageSelector + PlanQ 브랜딩) | ✅ |

### 추가 구현
- User 모델: username, refresh_token, reset_token 필드 추가
- COLOR_GUIDE.md 전면 재작성 (딥 틸 컬러 시스템, 11개 섹션)
- cookie-parser 추가, CORS credentials 설정

### 수정된 파일
- `dev-backend/models/User.js` — username, refresh_token 등 필드 추가
- `dev-backend/routes/auth.js` — register/login/refresh/logout 전면 재작성
- `dev-backend/server.js` — cookie-parser 추가
- `dev-backend/.env` — JWT_REFRESH_SECRET, JWT_EXPIRES_IN=15m
- `dev-frontend/src/pages/Login/LoginPage.tsx` — 신규
- `dev-frontend/src/pages/Register/RegisterPage.tsx` — 신규
- `dev-frontend/src/contexts/AuthContext.tsx` — 전면 재작성
- `dev-frontend/src/components/ProtectedRoute.tsx` — PlanQ 컬러
- `dev-frontend/src/components/Layout/MainLayout.tsx` — 딥틸 사이드바
- `dev-frontend/src/components/Common/LanguageSelector.tsx` — 다크 사이드바 대응
- `dev-frontend/src/App.tsx` — 실제 라우팅 연결
- `dev-frontend/COLOR_GUIDE.md` — 전면 재작성

---

## ✅ 완료: Q Note 설계 문서화 (2026-04-09)

### 완료된 작업

| 작업 | 설명 | 상태 |
|------|------|:----:|
| Q Note 구조 변경 확정 | 배치(Whisper) → 실시간(Deepgram) 전환, 라이브+리뷰 2모드 | ✅ |
| FEATURE_SPECIFICATION.md | Phase 8 전면 재작성 — F8-1~F8-5, 아키텍처, 비용 예측 | ✅ |
| DEVELOPMENT_ROADMAP.md | Phase 8 프롬프트 재작성 — B-1~B-6 단계, 프로젝트 구조 | ✅ |
| DEVELOPMENT_PLAN.md | Phase 8 작업 목록 B-1~B-6으로 교체 | ✅ |

### 수정된 파일
- `DEVELOPMENT_PLAN.md` — Phase 8 작업 목록 변경
- `docs/FEATURE_SPECIFICATION.md` — Phase 8 전면 재작성
- `docs/DEVELOPMENT_ROADMAP.md` — Phase 8 프롬프트 재작성

---

## Phase 3: 사업자 + 고객 관리

> 사업자 프로필 + 멤버 초대 + 고객 초대 (초대 링크로 간편 가입) + 대화방 자동 생성

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 사업자 정보 조회/수정 API | |
| 2 | 멤버 초대/목록/제거 API + 이메일 발송 | |
| 3 | 고객 초대 API (Client 생성 + Conversation 자동 생성 + 초대 이메일) | |
| 4 | 초대 수락 페이지 (/invite/:token → 간편 가입) | |
| 5 | 고객 목록/상세 페이지 | |
| 6 | 팀 관리 페이지 (Owner만) | |
| 7 | 사업자 설정 페이지 (프로필, 구독, 알림) | |

---

## Phase 4: Q Bill (청구서)

> 청구서 작성 + 이메일 발송 + 입금 확인 + 상태 관리

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 청구서 CRUD API (자동 번호생성, 부가세 자동계산) | |
| 2 | 청구서 이메일 발송 (Nodemailer + HTML 템플릿) | |
| 3 | 입금 확인/취소 API | |
| 4 | 청구서 목록 페이지 (전체/미결/완료 탭) | |
| 5 | 청구서 작성 폼 (항목 동적 추가/삭제) | |
| 6 | 청구서 상세 페이지 (발송/입금확인 버튼) | |

---

## Phase 5: Q Talk (대화)

> Socket.IO 실시간 채팅 + 메시지 수정/삭제 + 파일 첨부 + 할일 연결

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 대화 목록 API + 메시지 목록 (페이징) | |
| 2 | 메시지 전송 + Socket.IO 실시간 | |
| 3 | 메시지 수정 (is_edited) + 삭제 (is_deleted 마스킹) | |
| 4 | 첨부파일 업로드 (MessageAttachment) | |
| 5 | 3단 레이아웃: 대화목록 / 채팅 / Q Task 패널 | |
| 6 | MessageInput (텍스트 + 📎 첨부 + Enter 전송) | |
| 7 | typing 표시, 스크롤 자동 하단 | |
| 8 | 메시지에서 할일 만들기 버튼 (Phase 6과 연결) | |

---

## Phase 6: Q Task (할일)

> 할일 CRUD + 메시지↔할일 양방향 링크 + 필터/정렬 + 마감 지연 표시

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 할일 CRUD API (필터: status, assignee, client, due) | |
| 2 | 메시지 → 할일 생성 (source_message_id 양방향 링크) | |
| 3 | 상태 변경 API + Socket.IO emit | |
| 4 | 할일 목록 페이지 (오늘/이번주/전체 탭, 필터) | |
| 5 | 마감 지연 🔴 / 오늘 마감 🟠 / 임박 🟡 표시 | |
| 6 | Q Talk 우측 패널 (해당 고객 할일) | |
| 7 | 원문 메시지 ↔ 할일 상호 이동 | |

---

## Phase 7: Q File (자료함)

> 고객별 파일 관리 + 업로드/다운로드 + 용량 제한

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 파일 업로드 API (Multer, UUID 파일명, 확장자 검증) | |
| 2 | 파일 목록/다운로드/삭제 API | |
| 3 | 자료함 페이지 (고객별 폴더/탭) | |
| 4 | 드래그 앤 드롭 업로드 UI | |
| 5 | 스토리지 사용량 표시 (요금제별 제한) | |

---

## Phase 8: Q Note (실시간 회의 전사 + AI 분석)

> 실시간 STT (Deepgram Nova-3) + 번역/질문감지 (GPT-5-mini) + 문서 기반 답변 (RAG)
> 상세 설계: `docs/FEATURE_SPECIFICATION.md` Phase 8

| # | 작업 | 상태 |
|---|------|:----:|
| B-1 | FastAPI 구조 + Deepgram WebSocket 프록시 + 실시간 STT | ✅ |
| B-2 | GPT-5-mini 연동 (번역 + 질문 감지) | ✅ |
| B-3 | 프론트엔드 라이브 모드 UI (mock + 실 백엔드 연결) | 🔄 mock UI 완료, 백엔드 연결 대기 |
| B-4 | 세션 저장 + 리뷰 모드 (기록 열람, 요약 생성) | |
| B-5 | 문서 업로드 + 답변 찾기 (RAG, SQLite FTS5) | |
| B-6 | 결과 연동 — Q Task 할일 전환 + Q Talk 공유 (2차) | |

---

## Phase 9: 알림 시스템

> 인앱 알림 + 이메일 알림

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 알림 모델 + API | |
| 2 | 인앱 알림 (헤더 벨 + 드롭다운) | |
| 3 | 이메일 알림 (새 메시지, 할일 배정, 마감 임박, 청구서) | |
| 4 | 알림 설정 (카테고리별 on/off) | |

---

## Phase 10: 구독 관리

> 요금제(Free/Basic/Pro) + 결제 + 미납 처리

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 플랜 페이지 (비교 테이블) | |
| 2 | 결제 연동 | |
| 3 | 구독 관리 (업그레이드/다운그레이드/취소) | |
| 4 | 사용량 기반 제한 (스토리지, 멤버 수, Q Note 횟수) | |
| 5 | 미납 처리 흐름 (유예 → 읽기전용 → 차단 → 삭제) | |

---

## Phase 11: 운영 배포 + Landing

> 배포 스크립트 + 랜딩 페이지 + SEO

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 운영서버 배포 스크립트 | |
| 2 | 랜딩 페이지 (Hero, Features, Pricing, CTA) | |
| 3 | SEO 메타태그 + OG 이미지 | |
| 4 | Platform Admin 대시보드 | |
