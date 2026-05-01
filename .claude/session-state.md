## 현재 작업 상태
**마지막 업데이트:** 2026-05-01 (저녁 — 첫 운영 배포 + 권한 매트릭스 + 프로필 분리 + Q Note 용어 사이클)
**작업 상태:** 진행 중 — 사이드바 client 2뎁스 + 알림 라우트 가드 수정 빌드 완료. 다음: 실시간 번역(Q Note Python+Frontend), AI 사용량 페이지, 운영 재배포

---

## ⚡ 빠른 재개

```
session-state.md 읽고 이어서 진행해. dev 빌드 끝났음. 다음은 Irene 가 dev.planq.kr 에서 검증 → /배포.
```

---

## 📦 이번 세션 작업 요약 (2026-05-01)

### 1. ✅ 첫 운영 실배포 (commit 661b893)
- 운영서버 (87.106.78.146 / planq.kr / port 3004) PM2·nginx·SSL 모두 정상
- DB sync 시 발생한 `kb_documents.project_id` INT vs `projects.id` BIGINT FK 불일치 → broken FK 드롭 + INT→BIGINT 변경 + 재sync (65/0)
- POS production-backend (3002) 와 공존 영향 없음
- Q Note (`python3.12-venv` 미설치) 만 미배포 — 운영서버 Claude 측에서 sudo 후 재배포 예정

### 2. ✅ /배포 스킬 정비
- `.claude/commands/배포.md` 운영서버 정보 + deploy-planq.sh 호출 + 한/영 릴리즈노트 + POS 가드

### 3. ✅ Client(고객) 권한 매트릭스 정리
- 라우트 가드 추가:
  - `routes/files.js` POST upload/move/DELETE/bulk-delete client 403
  - `routes/calendar.js` POST/PUT/DELETE client 403 (attendee status PUT 만 OK)
  - `routes/tasks.js` POST: client 자기 자신에게 task 생성 차단, 다른 사람에게 "요청" 만 OK
  - `routes/kb.js` GET 4개 + POST/PUT/DELETE 5개 client 403
- 사이드바 client 노출 메뉴: 인박스, Q Talk, Q Task, Q Project (자기 프로젝트만), Q Calendar, Q Bill, 프로필
- 사이드바 client 숨김: Q Note, Q Knowledge, Q Docs, Q File, Q Mail, 통계, 설정, 멤버
- Q Task 우측 패널: client 시 detail 있을 때만 노출 (대시보드 카드 hidden)
- 메모리: `project_client_permission_matrix.md`

### 4. ✅ Calendar 권한 명확화
- Member/Owner default = 워크스페이스 전체 일정 (이전 잘못 좁힌 것 복구)
- "나" 탭 = 자기 관련만 (frontend 후처리 필터)
- "나" 탭 task 필터 버그 수정 (assignee_id 도 포함, 이전엔 created_by 만)
- Client = 자기 attendee 만 (backend 자동 격리, 변동 없음)

### 5. ✅ GDrive 정책 (옵션 B + 옵션 1)
- 워크스페이스 공용 파일 (project_id 있음) = Drive
- 개인 파일 (project_id 없음 = "내 파일") = PlanQ 자체 (`routes/files.js:168` `useGdrive = ... && projectId` 이미 그렇게 됨)
- StorageSettings 안내: 보관/미보관 항목 리스트 + 단방향 안내
- CloudConnectNotice: client 한테 hidden, 멤버/오너에게만 호박색(연결됨)/청록색(권장) 배너
- 메모리: `project_gdrive_policy.md`

### 6. ✅ Push UX 정정
- NotificationSettings PushSection: "본인 계정 + 이 브라우저 1개만 적용" 명시 안내

### 7. ✅ 계정 vs 워크스페이스 프로필 분리
- DB:
  - `users.email_verified_at`, `secondary_email` + 5 OTP 필드
  - `business_members.name`, `name_localized`, `bio`, `expertise`, `organization`, `job_title`, `expertise_level`, `language_levels`, `answer_style_default`, `answer_length_default` (총 10개, 마이그레이션 완료 2 rows)
  - `clients.display_name_localized`
- 라우트:
  - `GET/PUT /api/businesses/:id/me/profile` (이름·영어이름·Q Note 8 필드 모두)
  - `POST /api/users/:id/email-verify-request` + `-confirm` (primary 인증, 변경 없음)
  - `POST /api/users/:id/secondary-email-change-request` + `-verify`
  - `POST /api/users/:id/secondary-email-verify-request` + `-confirm`
  - `DELETE /api/users/:id/secondary-email`
  - `PUT /api/users/:id` username 이미 있으면 변경 차단 (안전핀)
- ProfilePage 재설계:
  - "계정 정보" Card: 아이디 readonly + 이메일 verified 뱃지 + 인증 버튼 + 보조 이메일 + 기본 언어
  - "{워크스페이스명} 프로필" Card: 이름·영어이름 (BusinessMember 단위)
  - "{워크스페이스명} — Q note 답변 생성용" Card: 조직·직책·전문분야·소개 + 5단계 전문지식 카드
  - 알림 매트릭스 카드 제거 (별도 메뉴로 이동)
- expertise_level 5단계: 입문자/학습자/실무자/숙련자/전문가 + 각 단계 결과 예시 한 줄
- EmailChangeModal `kind` 확장: `primary`/`secondary`/`verify-primary`/`verify-secondary` (verify-only 모드면 모달 열리자마자 자동 OTP 발송)
- 메모리: `project_account_workspace_profile_split.md`

### 8. ✅ 사이드바 client 2뎁스 (방금)
- "설정" NavItem + AccordionWrap (내 프로필 + 알림) — owner/member 패턴과 일관
- App.tsx 에 `/business/settings/notifications` 별도 라우트 추가 (requiredRole owner/member/**client** 모두) — `:tab` 보다 먼저 매칭

### 9. ✅ Q Note 용어 통일 + UX 보강
- i18n ko/en: 회의 → 음성메모, 회의 제목 → 제목, 회의 안내 → 안내 메모, 회의 언어 → 사용 언어, 회의 진행 → 녹음 시작, 회의 종료 → 음성메모 종료
- StartMeetingModal:
  - **목적 칩**: 회의/상담/강의/인터뷰/메모/기타 (재클릭 토글, 신규 state)
  - **캡처 방식 안내**: 호박색 박스 — "마이크 모드는 본인/상대 구분 X. 웹 화상회의는 자동 구분"
  - **프로필 미완성 배너**: bio/expertise/organization/job_title 중 하나라도 비면 "프로필 완성하기 →" /profile 링크

### 10. ✅ 검증 (/검증 9단계)
- 0단계 헬스체크 27/27 통과
- 1단계 TS 타입 0건
- 3단계 신규 라우트 익명 401 + 잘못된 토큰 403
- 4단계 빌드 산출물에 신규 i18n 키 모두 포함
- 6단계 17 항목 모두 구현 완료

---

## 🔖 다음 할 일 (우선순위)

### A. 즉시 (다음 청크)
- **Q Note 실시간 번역 + 텍스트 표시 완성도** — Irene 의 핵심 피드백
  - Interim transcript 즉시 화면 표시 (회색 → final 검정)
  - 글자수 단위 segmenting (긴 발화 자동 끊기)
  - 번역 끊김 fix (max_tokens chunked + retry)
  - **범위**: `q-note/main.py` Python (Deepgram) + Frontend `LiveBoard` 양쪽

### B. 운영 재배포 (Q Note 포함)
- 운영서버에서 `sudo apt install python3.12-venv` 실행
- dev 에서 `./scripts/deploy-planq.sh --auto` (Q Note 포함 완전체)

### C. AI 사용량 페이지 (별도 사이클)
- 메뉴별 AI 사용량 (Q Note, Q Talk, Q Task, Cue, KB)
- 가장 많이 사용하는 영역 표시
- 플랫폼 개발자 뷰 (사용 영역 + 사용량)
- 통계/리포트 페이지 통합

### D. 운영 진입 후 폴리싱
- User 테이블 인덱스 64 한계 — 누적 unique constraint 정리
- KbDocument FK type — dev DB 도 정비
- Q Task `+ 업무 추가` 버튼 client 시 hidden
- Python q-note 서비스 client 차단
- platform_settings 사이클 (반나절) — `.env` 의 PLANQ_BILLING_BANK_*, EMAIL_LOGO_URL, SMTP_FROM 을 DB+관리자 UI 로

---

## 📂 주요 문서
- 권한 매트릭스: `memory/project_client_permission_matrix.md`
- GDrive 정책: `memory/project_gdrive_policy.md`
- 프로필 분리: `memory/project_account_workspace_profile_split.md`
- 운영 배포: `scripts/deploy-planq.sh` (commit 1f3b791)
- 첫 배포 commit: 661b893 (운영 nginx + SSL 완료, planq.kr 라이브)

---

## 🔑 환경 (변동)
- dev backend port 3003, 운영 backend port 3004
- 모든 라우트 변경 후 PM2 reload 적용 완료 (planq-dev-backend)
- 마지막 빌드 hash: 빌드 진행 중 (b66tccu6h ~ bhh46kpfc 가 최신)

---

## ⚠️ 미해결 (이번 청크)
- Q Note 음성메모 시작 전 미완성 라벨 잔여 (line 5 page.help.body, line 25 page.empty.line2 등) — 다음 폴리싱
- Q Note Page (qnote-realtime) 의 "회의" 라벨 잔여
- 위 9.에서 startModal + page 핵심만 처리, 그 외 detail 라벨 일부 남음
