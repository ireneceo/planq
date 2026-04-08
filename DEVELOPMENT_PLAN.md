# PlanQ - 개발 진행 현황

> **최종 업데이트:** 2026-04-09
> **데이터베이스:** planq_dev_db (MySQL)
> **프로젝트:** B2B SaaS — 업무 전용 고객 채팅 + 실행 구조 통합 OS
> **로드맵 상세:** `docs/DEVELOPMENT_ROADMAP.md`

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

## Phase 8: Q Note (음성/회의 정리)

> FastAPI — 음성 STT + AI 요약 + 질문 추출 + 답변 생성

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 음성 업로드 + Whisper STT | |
| 2 | 텍스트 → AI 요약 (LLM) | |
| 3 | 질문 추출 + 중요도 표시 | |
| 4 | 문서 기반 답변 생성 | |
| 5 | Q Note 프론트엔드 (업로드 + 결과 뷰) | |
| 6 | 할일로 전환 + Q Talk 공유 연동 | |

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
