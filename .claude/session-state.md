# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-08-03 11:15 UTC (Opus 5, 1M)
**작업 상태:** #244·#245 구현 완료 → **Fable 구현 검증 게이트 진행 중** (판정 대기). 미배포.

### 진행 중
- **Fable 구현 검증 게이트** — #244 + #245. 반증 강제(D2 되돌리면 실패 재현 / `overflow-x:hidden` 지우면 카나리 FAIL).
  - ⚠️ 판정 나오기 전까지 **소스 편집 금지** — `git status` 지문이 바뀌면 검증 무효.
  - autosave 가 `5d91e82` 로 구현을 이미 커밋함. **비교 기준선 = `48f5f8b`**.

---

## 이번 세션에 한 일

### #244 PWA 세션 증발 (구현 완료, 검증 대기)

**Irene 원문:** "planQ 앱모드로 사용하고 있을때, 사용자가 로그아웃 하지 않았는데, 로그인화면으로 돌아가면서 로그아웃됨"
(user_id=3, Mac Chrome standalone 440×720, 08-03 01:22)

**Fable 이 로그 라인 회계로 확정한 것 — Opus 초기 진단을 뒤집음:**
- 오늘분 error 로그는 392바이트·정확히 3줄. Mac 2줄의 유일하게 정합한 배정 = ①01:21:03 타이머 refresh ②`goLogin()` 후 로그인화면 부팅 refresh.
- **요청은 서버에 닿았고, 쿠키 없이 닿았다.** → "네트워크 실패 → 로그아웃"(D1)은 **이번 건의 근인이 아니다**.
- 429·서버측 삭제·백엔드 재시작 전부 반증 (logout 호출 시 `revoked_reason='logout'` 이 남는데 27441 은 NULL / 백엔드 마지막 재시작 08-02 18:09).
- **만성**: 이 Mac 에서 30일간 재로그인 22회. 07-21 엔 28분 사이 4회. 재발일마다 마지막 토큰이 **미회전 고아**로 방치(26519·25247·27441 동일 서명).
- **미확정(서버 데이터로 식별 불가)**: 쿠키를 무엇이 지웠는가. 유력 가설 = Mac Chrome **"모든 창을 닫을 때 쿠키 및 사이트 데이터 삭제"** 설정 또는 쿠키 권한 확장. → **Irene 확인 대기**.

**타임라인 (운영 `refresh_tokens`, user 3):**
| 시각 | 사건 |
|---|---|
| 01:06:58 | 로그인 (27440 — 선행 row 없음 = login 라우트 생성) |
| 01:07:03 | 정상 refresh (27440→27441) |
| — | **14분 18초 침묵** (= scheduleRefresh 1주기) |
| 01:21:21 | **또 로그인** (27445) |
| 01:22:16 | 피드백 작성 |
27441 은 만료 2027년인데 한 번도 회전되지 않고 방치 — 서버 토큰은 멀쩡했다.

**구현 (Fable 조건 반영):**
- **D1** `tryRefresh` → `{ok}|{ok:false, reason}`. **401 일 때만 종결**, network/server/**429** 는 `refreshWithRetry` 백오프(5s→15s→60s, cap 5분, `online` 이벤트 즉시 앞당김).
  - 옛 코드는 `status>=500` 만 재시도라 **429 포함 모든 non-401 4xx 가 즉시 영구 로그아웃**이었다.
  - **발행측 게이트 필수** — `apiFetch` 의 `planq:session-expired` 도 terminal 일 때만. 소비자만 고치면 우회된다.
- **D2** grace(15분) 창 **쿠키 자가치유** — stale 쿠키로 오면 새 토큰 발급 + 쿠키 재설정.
  - 서버는 raw 토큰을 해시로만 보관 → 후속 토큰 재전송 불가 → 새 발급이 유일한 치유법.
  - **캡 1회** (`refresh_tokens.grace_successor_id` 신규 컬럼, FK/인덱스 없음 — 64키 한도 회피). 2회차부터 종전 동작.
  - 누적 `stale_reuse` 267건이 이 구조의 물증.
- **D3** 동반 쿠키 `has_session`(non-HttpOnly, path=/, refresh_token 과 동일 수명) → **"게스트 부팅"과 "refresh_token 표적 소실" 구분** / 401 기계판독 `code` / 로그 ISO 타임스탬프 / `POST /api/auth/session-diag` 비콘(무인증, IP당 60초 1건).
- **누락 동시 수정**: `middleware/security.js` apiLimiter `p.id` → `p.userId` (payload 는 `{userId,email}` — **항상 IP 폴백이라 user 버킷이 침묵 사망 중이었다**) / refresh 가 `remember` 무관 `maxAge` 를 붙여 **세션쿠키→영구쿠키 승격**되던 것을 JWT `persist` claim 승계로 차단.
- **비채택**: access token 으로 쿠키 재발급(re-mint) — 탈취 토큰이 365일 세션으로 승격되는 보안 확대.

**Opus 자체 실HTTP 24/24 PASS** (Fable 이 독립 재현 중). 로그 실물 확인:
`[auth] refresh grace_reissue user=15 stale_row=12562 new_row=12564` / `grace_cap ... already_reissued_row=12564` / `session_end ... cookies(refresh=false hint=false)`

### #245 Q Talk 모바일 가로 흔들림 (구현 완료, 검증 대기)

**Fable 실측 — Opus 의 `* { max-width: 100vw }` 가설은 기각.**
- 진짜 메커니즘: `overflow-y: auto` **만** 선언하면 **반대축 계산값이 visible→auto 로 강제**된다. `MessageList` computed `overflow-x:"auto"` 실측. 트랙패드 가로휠 `deltaX:120` → `scrollLeft` 120 실측.
- **소스에 `overflow-x` 라는 글자가 없어 grep 으로 영원히 못 잡는다** — computed style 을 읽어야만 드러남.
- `index.css` 는 **무접촉** (앱 셸이 position:fixed/overflow:hidden 이라 문제 자체가 성립 안 하고, N+29/31/63 회귀 이력상 광역 변경은 리스크만).
- 잠복 버그 발견: `TranslatedText`(pre-wrap 만) · `CardNote`(가드 0) 줄바꿈 부재 → 장토큰 10~62px 오버플로.

**구현**: `MessageList`(ChatPanel) · `ChatList`(LeftPanel) · `Scroll`(RightPanel) 에 `overflow-x:hidden; overscroll-behavior-x:none` + 두 블록에 `word-break/overflow-wrap` + **신규 카나리 `scripts/e2e/canary-qtalk-hlock.js`** (`run.js` 에 `hlock` 등록).

**미확정 잔여**: 흔들릴 때 화면 가장자리에 **뒤로가기 화살표(←)** 가 보였는지 → 보였으면 브라우저 히스토리 스와이프 계열 확정. **Irene 확인 대기** (수정은 어느 쪽이든 봉쇄).

---

## 설계 승인 완료 — 구현 대기

### 신규 ① 정기청구 세금계산서 "발행 대상 아님" (Fable CONDITIONAL PASS)

**결함이 2개다:**
- (a) **쓰기측** — `services/recurring_invoice.js` payload 에 `receipt_type` 부재 → 모델 기본값 `'none'`. `services/clientSubscriptionBilling.js:197` **동일 결손 확정**.
- (b) **표시측** — `InvoiceDetailDrawer.tsx:713` 이 단일원천 술어를 안 쓰고 `tax_invoice_status` 직독. **이게 "발행 대상 아님" 표기의 직접 원인.**

**중요**: `receiptsDue.js:50-58` 에 레거시 fallback 이 있어 `receipt_type='none'` 이어도 한국 사업자면 `'tax'` 판정 → **증빙 큐는 이 건을 놓치지 않는다**(paid 게이트라 지금 안 보이는 게 정상).

**피해 규모(운영 실측)**: 정기 엔진 생성 & `receipt_type='none'` = **1건**(INV-2026-0004). `paid` 인데 증빙 미발행 = **0건**. **세무 실피해 0.**

**INV-2026-0004 는 오늘 10:54 Irene 이 직접 draft→sent 발송함**(= ② 경로). 편집 모달 `taxOn` 초기값이 기존 `receipt_type` 만 보고 고객 사업자정보를 안 봐서 `'none'` 유지 → **①과 ②는 같은 흐름에서 맞물린 결함**.

**승인 조건:**
1. 술어는 `receiptsDue.js` 공유 헬퍼로 단일화 — `KRW && is_business && (country==='KR'||!country)`. **`biz_tax_id` 게이트 금지**(사업자번호는 결제 후 고객이 공개 페이지에서 입력하는 정식 흐름 존재 — 발행 의향과 데이터 완비는 별개 축).
2. `tax_invoice_status='pending'` 동시 세팅 (수동 경로와 같은 컨벤션. 큐 편입은 paid 게이트라 조기 독촉·오염 없음).
3. **`receipt_profile` 은 엔진이 찍지 마라** — 그 컬럼의 의미는 "고객이 직접 입력·확인한 정보". 찍으면 의미 오염 + stale 스냅샷.
4. 개인 고객(`is_business=0`)은 `'none'` 유지 (현금영수증은 cr_identifier 필요 — 엔진 신설은 스코프 확장).
5. 드로어는 백엔드 파생 `receipt_kind` 소비 (프론트 술어 중복 금지).
6. 백필은 멱등 조건 UPDATE + 재실행 변경 0 실측. 운영 적용은 /배포 절차로만.

**Irene 결정 대기 1건 (이번 절단면 제외 권장)**: 수동 모달도 KR 사업자 고객 선택 시 `taxOn` 기본 ON 으로 할지.

### 신규 ② 청구서 상세에 발송 버튼 없음 (Fable CONDITIONAL PASS)

- **단순 누락 확정.** 결정적 근거: 정기 draft_review 알림이 **"검토 후 발송해주세요"** 문구로 그 드로어를 여는데 **드로어에 발송 버튼이 없다** — 자기 흐름과 모순. git 이력에도 제거 흔적 없음.
- **권한 불일치 없음** — `requireMenu` 다음 줄에 `assertInvoiceMutationOwner`(routes/invoices.js:1224). 노출 조건은 기존 `isOwner && status==='draft'`.
- **부수 발견**: `POST /send` 가 **`broadcastInvoice` 미호출** (CLAUDE.md §16 위반 — 발송해도 다른 탭 목록 갱신 안 됨). 발송 버튼 추가 시 broadcast 1줄 동반 필수.
- 조건: ConfirmDialog(비가역·고객 메일 발송) · `submitting` 가드 · 수신처 부재 시 disabled+힌트 · i18n ko/en.
- ①과 **같은 사이클**로 묶되 커밋은 분리.

### #214 알림 발송처 재정리 (Fable CONDITIONAL PASS)

- **"확인권장 - PlanQ" 는 이메일이 아니다** — `email_logs` 0건. mailNotify 가 '확인 권장'에 `skipChannels:['email']`. **push/인앱 title 이 표적**. (운영 실물: notifications id=697, push_logs payload_title, 2디바이스 sent)
- 발생 지점 `services/mailNotify.js:108` — `확인 권장 — ${sender}`, sender=메일 발신자명. **제목에 "메일" 단서가 없는 문법 자체**가 문제.
- Opus 집계 13건 MISS → **실제 7건**(notifications.js 4건은 구현부, invoices.js:331·overdue_handler.js:95 는 오탐). 그중 **실수정 2건**(invoices.js:1322, shareExpiryNotify.js:62), 4건은 `[PlanQ]` 가 정답, 1건 무영향.
- **41곳 고치지 말고 착지점 1곳**: `notify()` 가 `businessId` 로 workspaceName 자체 조회(캐시 5분) + `[PlanQ]` 정답 4곳은 `platformBrand:true` 명시 + **kind 라벨 중앙 부여**(`메일 · 확인 권장 — PlanQ`). push·인앱만, 이메일 subject 제외.
- push·인앱·이메일 title 이 **`notify()` 단일 원천** 확정 — 한 곳 고치면 3채널 동시 해결.
- 백엔드 알림 i18n 은 인프라 부재 → **별도 사이클 백로그**(kindLabel 은 `{ko:…}` 구조로 확장 절단면만 남길 것).

---

## 다음 할 일

1. **Fable 판정 확인** → PASS 면 마커 기록, FAIL 이면 지적 수정 후 재검증
2. 신규 ①② 한 사이클 구현 (검증 시나리오 관통: 정기 draft 생성 → 드로어 발송 → receipt_kind 표시 → mark-paid → 증빙 큐 편입)
3. #214 구현
4. 잔여 운영 피드백 (총 26건 — 아래 "운영 피드백" 참조)

### Irene 확인 대기
- Mac Chrome **"모든 창을 닫을 때 쿠키 및 사이트 데이터 삭제"** 설정/확장 (#244 삭제 주체 확정)
- #245 흔들릴 때 화면 가장자리 **뒤로가기 화살표(←)** 유무
- #217 답변 (증빙 발행 알림메일 문안·체크박스 기본값·수신자 없을 때)
- 수동 모달 `taxOn` 기본 ON 여부 (신규 ① 후속)

### Irene 조치 (코드로 불가)
- 워프로랩 Google Calendar 재연동 (운영 토큰 스코프가 `userinfo.email openid` 뿐 → #242 Meet 동작 안 함)
- iOS 앱: **Apple Developer 등록·결제 완료(2026-08-03)** → Mac 의 Xcode 에서 빌드·서명·TestFlight 업로드
- Google OAuth 검증 제출 (앱 심사 전 필요)

### 데스크탑 앱 방침 (2026-08-03 결정)
- **PWA 가 정석.** Q Note 웹회의 탭 오디오 캡처(`getDisplayMedia`)가 데스크탑 Chrome/Edge 전용이라 PWA 로 두면 그대로 동작 — Electron 은 이 경로를 재구현해야 함.
- Windows: 필요시 **PWABuilder → Microsoft Store**. macOS: Chrome/Edge 설치형 또는 Safari 17+ Dock 추가. **Mac App Store 는 PWA 로 불가** → 필요하면 Mac Catalyst.
- **Electron 비권장** — 자동 업데이트·코드서명·보안 패치 축이 늘어나는데 얻는 것(오프라인·로컬 FS·트레이) 중 필요한 게 없음.

---

## 운영 피드백 (원문 기준 26건 미처리)

**코드로 바로**: #213 메일 필터 접기 · #214(설계 승인) · #217(답변 대기) · #220 팀메일 발신자 표시 · #222 새 메일 폼 자동저장 · #225 문서 워드/PDF/엑셀 · #231 프로젝트 개요 자료·핀 · #232 드래그드롭 통일 · #241 음성노트 번역 기본 끄기 · #195 랜딩 도움말 카테고리 · **#244·#245(구현 완료)**

**Fable 설계 선행**: #208 출퇴근·휴가 · #211 B2B 타깃 검토 · #221 메일 분류 재정비 · #227 Cue 우측패널 · #228 파일 드래그 반출 · #229 프로젝트 히스토리 · #230 Today's 브리핑 · #233 통합검색 AI · #235 업무추출 자동화 · #236 업무 태그 · #237 오늘 나의 업무 · #238 Cue 완료 등록 · #239 문서 컨펌 · #240 프로젝트 완료 알림

---

## 이번 세션에서 배운 것 (재발 방지)

1. **★ 로그 라인 회계로 가설을 죽일 수 있다.** #244 에서 "네트워크 실패설"은 그럴듯했지만, 오늘분 로그가 정확히 3줄이라는 사실 하나로 반증됐다(요청이 서버에 닿았으므로). 로그가 적을 때는 **개수 자체가 증거**다.
2. **★ 한 축만 `overflow-y:auto` 로 두면 반대축이 auto 로 강제된다.** 소스에 `overflow-x` 글자가 없어 grep 으로 못 잡는다 — computed style 을 읽는 런타임 카나리만이 잡는다.
3. **★ 사용자 표현을 코드 용어로 번역하지 말 것.** #214 "이메일 알림"은 email 채널이 아니라 **"메일(도착) 알림"** 이었다. email_logs 0건으로 확정. 그대로 믿었으면 엉뚱한 데를 고쳤다.
4. **★ 전수검사는 파서로.** grep 기반 집계가 13건이라 했지만 실제는 7건 — 구현부/주석이 호출부로 잡히고, 다른 줄에서 전달하는 경우를 놓쳤다. 괄호 균형 파서로 세야 한다.
5. **★ 백그라운드 대기 조건은 초기 상태를 확인하고 짜라.** `.fable-gate.json` 이 어제 것으로 이미 존재해 대기 루프가 즉시 종료됐다.
6. **빌드 판정에 `grep -c` 를 마지막에 두지 말 것** — 0건일 때 exit 1 이라 성공한 빌드가 실패로 통보된다. REAL_EXIT 를 따로 찍을 것.
7. **idle autosave 가 작업 중 파일을 커밋한다** — 임시 테스트 스크립트까지 커밋됐다. Fable 에 diff 기준선을 명시적으로 넘겨야 한다.

---

## Git 상태
- `5d91e82` wip: auto-save 2026-08-03 10:53 — **#244·#245 구현 포함**
- 기준선(직전 정상 커밋): `48f5f8b`
- 작업 트리: `dev-backend/test-244.js` 삭제 1건만 (임시 테스트 스크립트 — CLAUDE.md 규칙대로 제거)
- 운영 배포 커밋: `37fb2f0` (#215) — **이번 변경은 미배포**

---

## 복구 가이드

새 Claude 세션 시작 시:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
