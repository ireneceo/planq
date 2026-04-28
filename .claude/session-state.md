## 현재 작업 상태
**마지막 업데이트:** 2026-04-28
**작업 상태:** 완료 — P-0 4건 + P-0+ Q talk 번역·채팅 설정 + P-1.1 인박스 카운트 + 영어 샘플 시드 + 번역 안정화 다라운드 + nginx HTML no-cache

다음 진입: **P-1.5 Profile + ID 시스템** → P-2 자체 결제 → P-3 Q knowledge → P-4 Q brief → P-5 Phase F 슬롯 → P-6 SMTP → P-7 PortOne V2 → P-8 반응형

---

## ⚡ 빠른 재개 (다음 세션)

```
session-state.md 읽고 P-1.5 (Profile + ID 시스템) 부터 진입해줘.
```

---

## 📋 다음 세션 시작점 — P-1.5 Profile + ID 시스템 (~3d)

### 사용자 요청 (2026-04-28)
> "이름을 바꿀 수 있어야 해. 왜 바꿀 수 없지? 그리고 아이디는 이메일이면 이메일을 못 바꾸잖아. 이메일 변경도 할 수 있어야지. 아이디를 만들자. 원래 아이디 있지 않아?"

### 설계 (30년차 권고)

| 항목 | 현재 | 신규 |
|------|------|------|
| 이름 | profile 에서 변경 X | **즉시 변경 가능** (verification 불필요) |
| 이메일 | 로그인 ID 겸용 → 변경 X | **변경 가능 + verification 코드 필수** (새 이메일에 6자리 발송) |
| 로그인 ID | 없음 (이메일이 ID 역할) | 신규 `users.username VARCHAR(40) UNIQUE` 컬럼 — 영문 소문자/숫자/`_`/`-`, 3~30자 |
| 로그인 흐름 | 이메일 + 비밀번호 | **username 또는 email 양쪽 허용** + 비밀번호 |

### 작업 범위 (~3d)

| 단계 | 내용 | 추정 |
|------|------|:---:|
| A | DB ALTER `users.username` + UNIQUE index + 기존 사용자 자동 마이그레이션 (이메일 prefix → username, 충돌 시 `_2` suffix) | 0.5d |
| B | 백엔드: `POST /auth/login` username 양쪽 허용 / `PUT /users/:id` (name PATCH 즉시) / `POST /users/:id/email-change-request` + `verify` (6자리 OTP) / username 검증 (영문/숫자/`_`/`-`, 3~30자, unique) | 1d |
| C | 프론트: ProfilePage — 인라인 편집 (AutoSaveField for name) + 이메일 변경 모달 (코드 입력 단계) + username 변경 입력 + 가용성 즉시 검증 | 1d |
| D | 회원가입 흐름 (signup 에 username 필드 추가) + 검증 + 회귀 (기존 이메일 로그인 호환) | 0.5d |

### 의존
- SMTP 연결 (P-6 의존) — verification 메일 발송용. 임시: 콘솔 로그 출력 (dev) → 운영 시 P-6 활성화 후 동작

### 검증 시나리오
- 이름 변경 → 즉시 반영
- username 변경 → 가용성 검사 → 즉시 반영 → 다음 로그인 시 username 사용 가능
- 이메일 변경 → 새 이메일에 코드 → 코드 입력 → 변경 → 새 이메일로 다음 알림 받음
- 기존 사용자 (마이그레이션됨): 이메일 prefix 가 username — 둘 다 로그인 가능
- 회원가입 신규: username + email + password 모두 받음, 가용성 즉시 표시

---

## 📋 전체 할일 리스트 (P-1 ~ P-8)

### ✅ P-1.1 좌측 nav 인박스 카운트 — 완료
### 🔜 P-1.5 Profile + ID 시스템 (3d) ← **다음 세션**
### P-2 자체 결제 + 월/연 + 미결제 4단계 강등 (6~7d)
- DB: `Subscription` (cycle, status, current_period_end, next_billing_at) + `Payment` (method, status, marked_by, receipt_url) + Business 결제 정보
- 흐름: 플랜 변경 → Subscription/Payment(pending) → 입금 안내 → admin mark-paid → 활성화 → 영수증 PDF
- cron: 매일 자정 — 임박 (D-7) / grace (D-day, +1~+7d) / 강등 (+8d~ Free) 4단계
- 데이터 보존 X 삭제 (read-only 만)

### P-3 Q knowledge — Cue 가 보는 회사 지식 DB (5~7d)
- 좌측 메뉴 `Q 지식` (영문 `Q knowledge`)
- KbDocument.category ENUM (policy/manual/incident/faq/about/pricing) + scope (workspace/project/client) + project_id/client_id
- kb_service.hybridSearch 우선순위 (client → project → workspace, threshold 0.78)
- Q talk Cue / Q docs aiGenerate / Q note 회의록 자동 채움 모두 통합

### P-4 Q brief — 자료정리/요약 신규 (5~6d)
- 별도 좌측 메뉴
- multi 입력 (텍스트 + 파일 N개) → LLM 요약 → 시점/파일 view 토글 → 후속 문서 (Q docs) 양방향 링크

### P-5 Phase F — Q docs 슬롯 시스템 (5d)
- DocumentTemplate.schema_json 활용 (이미 있음)
- F1 컨텍스트 빌더 + 슬롯 치환 (1d)
- F2 슬롯 폼 자동 생성 (2d)
- F3 영문 locale 슬롯 + 템플릿 (1d)
- F4 슬롯 단위 revision 비교 (1d)

### P-6 SMTP 운영 연결 (1d)
- `.env` SMTP_HOST/USER/PASSWORD/FROM
- 도메인 SPF/DKIM/DMARC DNS
- 실 발송 검증

### P-7 PortOne V2 + 팝빌 (5~6d)
- **가맹점 가입은 이 단계 직전 시작** (Irene)
- Business.billing_key + 카드 등록 모달 + 빌링키 결제 + 정기결제 cron + webhook 환불 + 팝빌 세금계산서

### P-8 반응형 일괄 스프린트 (5d)
- 햄버거 2뎁스 + 마스터-디테일

**총 추정: 35~38 영업일 (~7~8주)**

---

## 🧪 다음 세션 진입 전 클릭 검증 (선택)

### 1. 채팅 번역 + 설정
- 채팅방 헤더 톱니 → 설정 모달 → 번역 ON, ko/en
- 메시지 발송 → 즉시 표시 → 1~3초 후 회색 박스 번역 추가
- 줄바꿈/번호/이모지 양 언어 보존
- 토글 OFF → 신규 메시지 번역 X

### 2. 새 채팅 흐름
- "새 대화 시작" → 디폴트 프로젝트 미연결 (좌측에서 프로젝트 선택했어도)
- 모달에 번역 + 자동추출 토글 + 언어 선택 입력

### 3. 인박스 카운트
- 좌측 nav `확인 필요` 옆 빨간 pill (개수)
- 0건이면 숨김

### 4. 영어 샘플 환경
- https://dev.planq.kr/projects/p/70 (International Onboarding 2026 Q2)
- tasks 탭 — 영어 업무 20건
- transactions 탭 — 영어 stage (Issue Quote → Sign Contract → Invoice & Payment → Issue Tax Invoice)
- 캘린더 8건 (영어)

### 5. 회귀 — Q file 대량 다운로드 / Q docs AI 작성 / 채팅방 카드 (이전 라운드)

---

## 완료된 작업 (이번 세션, 2026-04-28)

### P-0 운영 안정화 4건 (이전 라운드)
- 채팅방 카드 렌더 (path-param 진입 fix)
- 업무 추출 차단 (이미 등록된 task 의 source 재추출 방지)
- AI 문서 client/project 컨텍스트 (롤백 후 선택)
- 파일 공유 + multi-source ZIP

### P-0+ Q talk 번역 + 채팅 설정 (이번 라운드)
- DB: Conversation/Message 번역 컬럼
- translation_service.js (gpt-4o-mini, 5종, retry, sanitize, max_tokens 적정화)
- 비동기 번역 + Socket.IO push + 폴링 fallback
- ChatPanel — TranslatedText 옅은 회색 박스, white-space pre-wrap, 스크롤 정책
- ChatSettingsModal 신규 — 번역/자동추출/참여자 통합
- NewChatModal — 디폴트 미연결 + 설정 입력 추가
- 독립 채팅 그룹 분리 fix
- Cue 응답 번역 hook
- nginx HTML no-cache (캐시 함정 해결)

### P-1.1 좌측 nav 카운트 배지
- useInboxCount hook
- MainLayout InboxBadge (pill / dot)

### 영어 샘플 시드
- 프로젝트 70 (International Onboarding 2026 Q2)
- 캘린더 8 / 업무 20 / 노트 3 / stage 4 영어 라벨

### 인프라 fix
- nginx HTML cache-control: no-cache
- standalone 대화 PATCH 허용
- memberOptions null user 방어
- PostsPage projectId 미전달

---

## 신규 메모 (이번 세션)

- `feedback_translation_async.md` — 동기 LLM 호출 금지, 비동기 + Socket.IO + 폴링 fallback 패턴
- `feedback_nginx_html_no_cache.md` — SPA HTML 은 no-cache 강제 (immutable assets 함정)

---

## 환경 / 인증

- 백엔드: pm2 planq-dev-backend (port 3003)
- DB: planq_dev_db / planq_admin
- 도메인: dev.planq.kr (HTML no-cache 적용됨)
- 마지막 빌드: `index-ikmafdzy.js`
- 신규 패키지: 없음 (이전 라운드 archiver, puppeteer 유지)

---

## 복구 가이드 (새 Claude 세션)

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘. P-1.5 (Profile + ID 시스템) 부터 진입.
```
