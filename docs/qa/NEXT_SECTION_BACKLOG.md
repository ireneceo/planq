# PlanQ 다음 섹션 백로그 (2026-07-15 확정)

> Irene 지시 반영 — 남은 개발 전수 정리. **추천 착수 순서대로** 진행. 각 항목은 완성도·품질 최우선(대충 금지).
> 근거·트리아지: [`docs/qa/FEEDBACK_TRIAGE_2026-07-15.md`](FEEDBACK_TRIAGE_2026-07-15.md) · 멀티탭: [`docs/MULTITAB_DESIGN.md`](../MULTITAB_DESIGN.md)

---

## 착수 순서 (Irene 승인 = Opus 추천 순서)

### ① 🔴 기능 작동 전수검사 + 모바일 흰 화면 (즉효·최우선)
**"기능 안 되는 건 중요. 다른 곳도 작동 안 하는 것 없는지 전수검사."(Irene)**
- **전 페이지 기능 무반응 전수검사** — catch 가 삼킨 조용한 실패 스윕:
  - `apiFetch` 는 throw 안 함 → `res.ok`/`j.success` 미검사로 저장·AI·발송이 조용히 죽는 패턴 전수 grep([[feedback_apifetch_no_throw_silent_save]], [[feedback_completed_but_dead_features]])
  - 버튼 클릭→아무 반응 없음(핸들러 누락·early return), AI 요약/추출 무반응(#179 계열), 저장 후 미반영
  - 검증: 각 기능 실제 클릭 e2e(Playwright MCP) + 콘솔/네트워크 에러 0 (`/검증 --e2e`)
- **🔴 모바일 Q Mail 전체 흰 화면** (#173/174/159/178) — 단일 근본원인: `MailPage` 메인 컬럼 `PanelLayout.tsx:102` `≤1024px{display:none}` + `data-panel-main` 부재. QNote 패턴(`QNotePage.tsx:2198`)으로 `$hideTablet` 제거 + `data-panel-main` 추가. 규모 소~중.
- ✅ 이미 배포 해결: #181 FAB·#171/172 드로어 닫기 z-index

### ② 모바일 반응형 — 모든 페이지 완성도 (한 사이클)
**"완성도 있게 모든 페이지 해야 해."(Irene)** — 공통 `--vvh`/`breakpoints` 수렴, 페이지별 점검 리스트로 100% 커버.
- 프로젝트 탭 세로 줄바꿈·좌우 흔들림(#176/177/160) — `QProjectDetailPage.styles.ts` TabBar `overflow-x:auto` + Tab `white-space:nowrap;flex:0 0 auto`
- KPI 카드 모바일 1열→2열(#169) — 공용 KpiGrid `repeat(2,minmax(0,1fr))`
- 통계 하위메뉴 제목·모바일 필터 깨짐(#170)
- /tasks 기간 팝오버 달력 잘림(#175) — `CalendarPicker` mediaPhone 1달
- **새 일정 키보드 위 흰 여백(#161)** — 바텀시트+푸터 sticky+`body[data-keyboard-up]` 계약. ※ 이게 "일정 드로어 위 가림(C)" 로 추정 — 실동작 확인
- 드로어/모달 모바일 풀스크린·safe-area 재점검
- 원칙: [[feedback_responsive_strategy]] Phase 일괄이 아닌, 이번은 **전 페이지 완성** 목표

### 🔴 ③′ Q Mail 즉시 수신 — IMAP IDLE (Irene: "보통 바로 들어와야 하는 거 아니야?" — 최상위)
**정답 = 폴링이 아니라 IMAP IDLE(push).** 폴링(2·5분)은 근본이 아니다. Gmail 등 정상 메일앱은 IDLE 로 서버가 새 메일을 즉시 push.
**진단(2026-07-15)**: 인프라 자체는 정상 — IMAP cron fetch → `global.__planqIo` `mail:new` broadcast → MailPage `onSocket('mail:new')` 자동 갱신. 문제 메일(#584 WORPRO)은 22:10 fetch 되어 DB 존재. '안 들어옴'의 정체 = ① 폴링 지연 ② 폴더(확인권장) 분류.
- **임시**: fetch 주기 5분→**2분 완료**(이번 커밋). 폴백으로 유지.
- **🔴 본 기능 — IMAP IDLE 설계**:
  - 라이브러리 `imap-simple`(node-imap) 이 IDLE 지원 — `conn.imap.on('mail', ...)` 가 새 메일 도착 시 fire.
  - `services/emailImapIdle.js` 신설 — 활성 계정(password + google_oauth)별 **persistent 연결 유지**, INBOX open 후 idle. `mail` 이벤트 → 해당 계정 `syncOne()` 즉시 실행 → 기존 fetch·triage·`mail:new` broadcast 재사용(멱등).
  - **재연결**: `error`/`close` 시 backoff 재연결. 토큰 만료(oauth) 갱신. 연결 수 상한.
  - **폴백**: 2분 폴링 cron 유지(IDLE drop·놓친 것 커버). IDLE + 폴링 이중.
  - 검증: 실제 메일 발송→도착 초 단위 반영 확인(초 단위 e2e).
- **triage 튜닝**: #584 는 `status='uncertain'`(확인권장)·`reply_needed=0` 이라 기본 '답변 필요' 뷰에 없었음. 정상 발신자 메일의 확인권장 과다분류 재점검 + '전체' 폴더 접근성.

### ③ Q Mail 로직·AI + 말로 추가 품질
**"기능 안 되는 건 중요"(3) + "말로 추가 품질 제대로"(4)**
- AI 답장 영어메일에 한글 생성(#153) — 최근 수신본문 언어감지를 default(ko)보다 우선
- 메일 요약/추출 무반응(#179) — 프론트 실패분기 추가(현재 `if(j.success)` else 없음 → 조용히 죽음) + 런타임 last_error/OPENAI 실측
- 미리보기 영어조각·주소 노출(#164)
- **말로 추가 품질**(#155) — 오픈 시 자동 `start()`, `MediaRecorder.isTypeSupported` 로 webm↔mp4(iOS) 분기, 인식률·의도분류·프리뷰 정확도 검수. (운영 DEEPGRAM 키는 반영됨)
- ✅ 이미 배포 해결: #180 뱃지·#154 일괄버튼·메일 첨부 다운로드

### ④ 기획 판단 반영
- **주간 진척 그래프**(#166) — "성과에 도움되는 제대로 된 안내". 주중 '목표 미달' 오안내 수정(주초 유예/임계완화), 번업 그래프 유지([[feedback_weekly_progress_graph_burnup]]). 문구는 성과 코칭 관점.
- **개요 = 보기전용** = 프로젝트 개요 맞음(#167 확정) — 오늘 그 방향 재설계 완료. **DEVELOPMENT_PLAN #148/#167 충돌 기록 정리(개요=읽기·상세=편집으로 확정 박제).**
- **캘린더 양방향 동기화 미작동 안내**(#126) — Google OAuth 승인 전이라 현재 **단방향(내보내기만/읽기만)** 상태. 고객이 이해하도록 **캘린더 상단에 상태 배너**("현재 Google 캘린더 단방향 — 양방향은 승인 후" 등) 노출. OAuth 승인은 Irene 액션.
- **일정(캘린더) 피드백 전수 적용 확인**(#163 등) — 모바일 필터/오늘시작/월전환 접근성 + 디자인·기능 제기 항목 전수 대조 후 미적용분 처리.

### ⑤ 자동/수동 인지 디자인 (전역 원칙)
**"자동으로 가져오는데 수정하고 싶을 수 있잖아. 수정 가능/자동입력+수정/완전수동 을 디자인·문구로 즉시 알게."(Irene)**
- **원칙 신설**: 모든 자동 생성/가져온 콘텐츠는 3상태를 명시 —
  1. **자동입력 + 수정가능**: 작은 `자동` 배지 + 편집 아이콘 + "AI가 채웠어요 · 수정할 수 있어요" 톤
  2. **완전 수동**: 배지 없음
  3. **읽기전용(자동, 수정불가)**: `자동` 배지 + "여기선 읽기전용, ○○에서 수정" 링크
- **선행**: 프로젝트 개요 '자동' 표시는 캔버스 데이터에 **소스 플래그(`source: 'ai'|'manual'`) 컬럼 필요** → 백엔드 마이그레이션 선행. 지표·추진과제·리스크 등 AI 생성분에 플래그.
- 적용처: 프로젝트 개요·모든 보고서(주간/월간)·Cue 결과물·자동추출 업무후보 등
- **미세 기능요청 전부** 반영 (트리아지 C/신규 잔여)

### ⑥ 노션형 상단 탭 (멀티탭) — 별도 트랙, 완성도 최우선
**"꼭 해야 해. 업무 효율. 대충 금지 — 쉽고 디자인 안 망치는 탁월한 방식."(Irene)**
- 설계: [`docs/MULTITAB_DESIGN.md`](../MULTITAB_DESIGN.md). P0-A(공유 소켓) 완료.
- 남은: **P0-B**(useTabActive + document34/hook16 마이그레이션) → **SPIKE**(Fable 게이트: chrome 포함 형제 MemoryRouter 무크래시) → **P1**(TabStore·탭별 history·TabHost/Strip/Pane + chrome react-router 탈피 리팩터)
- 규모 대·다중 사이클·데스크탑 전용. **디자인**: 탭 스트립이 기존 사이드바/헤더와 충돌 없이, 브라우저 탭처럼 직관적. 착수 전 UI 와이어 확정.

---

## 설정/인프라 — Irene 액션 (⑦)

### Stripe Webhook Secret (카드결제 활성화)
Stripe 대시보드 → Developers → Webhooks → 엔드포인트 `https://planq.kr/api/stripe/webhook` 추가(이벤트 `checkout.session.completed`, `payment_intent.succeeded`) → Signing secret 복사 → **플랫폼관리자 → 결제 설정(AdminBillingSettingsPage)** 의 Stripe webhook secret 칸에 입력. (백엔드 라우트·필드 준비됨)

### 운영 SMTP DKIM — 설명 (다음에 조치)
- **DKIM(DomainKeys Identified Mail)** = 보내는 메일에 도메인(planq.kr) 개인키로 **암호 서명**을 붙여, 받는 서버(Gmail·Outlook)가 "진짜 planq.kr 이 보냈다"를 검증하게 하는 이메일 인증. SPF·DMARC 와 3종 세트.
- **스팸격리 위험** = DKIM(+SPF/DMARC)이 없으면 받는 메일서버가 발신자를 검증 못 해 **PlanQ 발송 메일(초대·알림·청구서·비밀번호 재설정)을 스팸함으로 격리하거나 반송**. → 사용자가 초대/알림을 못 받는 치명 문제.
- **조치 방법**: 메일 발송 도메인(planq.kr)의 DNS 에 **DKIM 공개키 TXT 레코드** + **SPF**(발송 서버 허용) + **DMARC** 정책 레코드 추가. 값은 사용하는 발송 인프라(자체 SMTP/SES/SendGrid 등)가 발급. 설정 후 mail-tester 등으로 스팸점수 확인.
- 현황: 미설정 → 발송 메일 스팸격리 가능성. dev 는 발송 정지([[feedback_email_send_gate]]). 운영 발송 전 필수.

### Google OAuth 검증
데모비디오 촬영·제출(진행 중) → 승인되면 캘린더 양방향(#126)·Gmail 원클릭 활성.

---

## 참고 설계 문서 (착수 전 필독/보완)
| 트랙 | 문서 | 보완 필요 |
|------|------|-----------|
| 멀티탭 | `docs/MULTITAB_DESIGN.md` | 탭 스트립 UI 와이어(디자인 확정) |
| 피드백 | `docs/qa/FEEDBACK_TRIAGE_2026-07-15.md` | 오늘 해결분 close 마킹 |
| 개요 구조 | (신규 필요) | 개요=읽기·상세=편집 확정 + 자동/수동 3상태 원칙 |
| 반응형 | `dev-frontend/src/theme/breakpoints.ts` + [[feedback_responsive_strategy]] | 전 페이지 완성 체크리스트 |
| 자동/수동 인지 | (신규 필요) | ⑤ 원칙 문서화 + `source` 플래그 스키마 |
