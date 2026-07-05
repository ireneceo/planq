# PlanQ 검사 플레이북 (Inspection Playbook)

> **목적:** 운영 사용자 피드백 42건이 기존 검증(헬스체크·API 실호출·빌드 EXIT0·i18n grep·멀티테넌트 grep)을 **전부 통과했는데도 유출된** 문제군(특히 모바일·크로스커팅)을 **자동으로 잡는** 반복가능한 검사 체계.
> **설계:** Fable 검증 게이트 (2026-07-05). **상태:** 설계 완료 · 구축 착수 대기(노트북 이관).

---

## 0. 인프라 전제 (실측)
- **Puppeteer v24 설치됨** (`dev-backend/node_modules/puppeteer`, PDF용) → CDP 접근 가능, **회귀 스위트는 이걸로** (결정론적·exit-code, health-check.js 계열).
- Playwright MCP는 세션 의존적 → **신규 화면 탐색 검증**에만. 재발방지 스위트는 Puppeteer 스크립트로 박제.
- Chromium 바이너리: `~/.cache/ms-playwright/chromium-1217`.

## 1. 왜 기존 검증이 못 잡았나 — 구조적 5축
1. **렌더된 기하학(pixel geometry)을 아무도 안 봄** — 헬스=프로세스, API=JSON, 빌드=타입, grep=문자열. "키보드가 입력란을 가리는가"를 보는 게 없음. `main.tsx:88-119 ensureFocusedVisible()`가 각 페이지에서 실제 작동하는지 검증 부재 → 모바일 A부류 전량 유출.
2. **chrome 억제(FAB/배너) denylist 3중 분산** — `App.tsx:140-146`(isPopout/isMarketing) + `RightDock.tsx:34`(FAB_HIDDEN_PREFIXES) + 페이지별 `body.dataset.popout` setter. 신규 라우트 추가 시 하나라도 빠지면 노출(기본값=노출).
3. **크로스커팅 헬퍼는 "빠진 곳"이 결함** — `applyMemberDisplayName`은 적용된 14곳만 보이고, 안 부른 여집합(13파일)이 결함. 매번 신고된 화면만 고쳐 "몇 번째 요청" 반복.
4. **API 200 ≠ 상태머신 완결** — 버튼 부재·dead-end(공개 청구서 결제완료 버튼 없음, 테이블 삽입 후 편집 불가)는 검증 대상이 아니었음.
5. **"이번 변경분"만 검증** — 크로스커팅 결함은 안 건드린 페이지에서 터지는데 전 라우트 스캔 부재.

## 2. 하니스 구조 (구축 대상)
```
/opt/planq/scripts/e2e/
  run.js                     # 러너: --suite mobile|crosscut|regressions|all → 시나리오×판정 표 + exit code
  lib/  (login, route-inventory, cdp-keyboard, canary helpers)
  mobile-keyboard.js         # §3 A부류
  chrome-suppression.js      # §5 FAB/배너 라우트 전수
  canary-crawl.js            # §4 표시명/L1 크롤
  regressions/               # 피드백 1건 = 파일 1개 = assertion 1개
    R-001.mobile-inbox-input-occluded.js ...
docs/qa/FEEDBACK_REGRESSIONS.md   # 대장: ID | 원문요약 | 부류 | 스크립트 | 상태
```
- 실행: `node scripts/e2e/run.js --suite mobile,crosscut,regressions` → **exit≠0 = /검증 실패** (health-check.js 동급 게이트).
- **인터랙티브 요소에 `data-testid` 의무화** (selector 취약성 제거).

## 3. 모바일 키보드 검사 프로토콜
**원리:** 진짜 OS 키보드는 자동화 불가하나, `main.tsx:46` 실측("iOS PWA는 키보드 up 시 innerHeight 자체 축소 793→417")에 근거 — **CDP `Emulation.setDeviceMetricsOverride`로 focus 후 viewport height 667→337 축소 = iOS 키보드 이벤트 체인(visualViewport resize → main.tsx update() → data-keyboard-up → ensureFocusedVisible) 그대로 발화.** 앱의 실제 방어코드를 실제로 통과시키는 테스트.

**판정식 (main.tsx:107-109 계약을 assertion화):**
```
PASS ⟺ focusedRect.bottom ≤ visualViewport.height − 8       (가림 없음)
     ∧ body[data-keyboard-up] === '1'                        (키보드 감지 작동)
     ∧ documentElement.scrollWidth ≤ innerWidth              (가로 스크롤 0)
     ∧ |scrollTop(+600ms) − scrollTop| < 4                   (#111 자동 점프 0)
     ∧ focusedRect.height > 0                                (렌더됨)
```
contenteditable 은 캐럿 rect(`getSelection().getRangeAt(0).getClientRects()` 마지막) 기준 (main.tsx:100-106 동일).

**표준 시나리오 (SCENARIOS — 신규 입력화면 추가 시 1줄 추가가 PR 요건):**
`/inbox`(업무추가) · `/tasks`(업무추가·팝아웃) · `/talk`(채팅입력) · `/docs`(에디터+테이블) · `/notes`(메모FAB) · `/calendar`(일정추가) · `/help-popout`(팝아웃).

**FAB 기하학:** RightDock rect가 viewport 완전 내부 + w,h ≥ 36 + 팝아웃 열었을 때 팝아웃 rect도 viewport 내.

**문서 테이블(D부류):** 테이블 삽입 → (1) pathname 불변(에디터에서 안 튕김) (2) contenteditable 내 `<table>` row≥2 (3) 열 추가 후 scrollTop 드리프트 <4px.

뷰포트: `375×667, isMobile, hasTouch, dSF 2`. 키보드 높이 근사 330px.

## 4. 크로스커팅 감사 (카나리 크롤 — 라우트를 몰라도 잡음)
**표시명 누출:**
1. 시드: e2e member `User.name='계정명_CANARY'`, `BusinessMember.name='표시명_OK'` (영구 시드).
2. 라우트 인벤토리 자동수집 → owner 토큰으로 전 GET 크롤.
3. 응답 body에 `계정명_CANARY` 등장 = FAIL (허용: /users/me, /admin/*).

**정적 보조 (이미 실측 — 대상 확정):** User include 있는데 `applyMemberDisplayName` 없는 라우트. **사용자대면 수정 대상 6:** `businesses.js`(멤버리스트) · `dashboard.js` · `org.js` · `weekly_reviews.js` · `notifications.js` · `clients.js`. **예외(계정명 정상):** admin·auth_oauth·cloud·plan·stats·feedback·inquiries → `scripts/lint-allowlist.json`에 사유 명시.

**L1/visibility 누출:** userA가 L1 자산 4종(file/post/kb/calendar) 제목에 `CANARY_L1_<ts>` → userB(같은 워크스페이스)·userC(다른 워크스페이스) 토큰 전 GET 크롤 → 등장(id만이라도) = FAIL. try/finally 정리.
> ⚠️ **정적 린트 규칙:** vlevel/legacy visibility 이중 컬럼은 반드시 `vlevel IS NULL` AND로 legacy 게이트 (vlevel 우선). 위반 = 누출. `grep -nE "visibility: 'L[234]'"` 후 `vlevel: null` 동반 확인.

## 5. chrome 억제 라우트 전수
`App.tsx` 라우트 목록 자동추출 → CHROMELESS(`-popout$`|`/memo`|`/public/`|`/p/`|마케팅6종) vs APP 분류. 각 CHROMELESS 라우트 **URL 직접 진입**(최악경로)으로:
```
assert !$('[data-testid="right-dock"]')            // FAB 없음
assert !$('[data-testid="announcement-banner"]')   // 배너 없음
assert !$('[data-testid="notification-toaster"]')
```
+ APP 샘플은 역방향(과잉숨김 회귀). **정적:** 3중 denylist 대칭차 = 0. (장기: denylist → App.tsx 단일원천 통합 리팩터 별도 사이클.)

## 6. 피드백 → 회귀 전환 규칙
- **운영 피드백 1건 = R-번호 + 재현 스크립트 먼저(RED) → fix → GREEN.** 재현 없이 fix 커밋 금지.
- 42건 소급은 **부류 대표 우선**(A 7시나리오 · B 카나리2 · C 카나리2 · D 개별6) = 42건 감시면 커버. 1:1 파일 42개가 목표 아님.
- `run.js --suite regressions` = health-check 동급 게이트.
- OAuth 부류: `GET /api/auth/google/start` 302 Location redirect_uri가 `GOOGLE_REDIRECT_URI` origin 일치 + state HMAC 왕복 smoke까지만 자동화.

## 7. /검증 스킬 개정안 (`.claude/commands/검증.md`)
- **신규 11단계 — 모바일·크로스커팅 스위트 (입력 UI 만졌으면 필수):** `node scripts/e2e/run.js --suite mobile,crosscut,regressions` → exit 0 + 전건 ✅. 0단계 헬스체크 동급.
- **8-D 반응형 개정:** "curl + @media grep" 삭제 → "11단계 mobile 스위트 결과 첨부".
- **6단계에 dead-end 스캔:** 상태별 페이지 nav 제외 enabled button 0개 = FAIL.
- **CLAUDE.md 개발규칙 3줄:** ①입력 신규화면 = SCENARIOS 1줄 추가가 완료조건 ②인터랙티브=data-testid 필수 ③팝아웃/공개/마케팅 라우트는 App.tsx 단일원천에만.

## 8. 커버리지 정직 추정 + 사람 눈 잔여
| 부류 | 추정 | 자동검출 |
|---|---|---|
| A 모바일 키보드 가림·점프 | ~15 | ~80% |
| A' FAB/팝아웃 위치·재노출 | ~5 | ~90% |
| B 표시명·배너 크로스커팅 | ~8 | ~95% |
| C L1/visibility 누출 | ~4 | ~90% |
| D 완결성(버튼·테이블·다음단계) | ~10 | ~55% |
| D' 외부 OAuth | ~3 | ~30% |
| **합계 42** | | **~70~75%** |

**사람 눈 잔여(실기기 5분 체크리스트로 분리):** ①iOS Safari 실기기(키보드 애니메이션 중 캐럿추종·한글 IME·phantom scroll main.tsx:57) ②"위치·크기 안 맞아 보임" 미학(스크린샷 자동저장 `/tmp/e2e-snapshots/`로 사람 리뷰 1분 압축) ③구글 OAuth 전구간(실계정·동의화면 월1회 수동) ④"다음 단계 자연스러운가" UX 서사.

## 9. 구축 로드맵 (노트북 세션)
1. **하니스 골격** `scripts/e2e/run.js` + `lib/`(login·route-inventory·cdp-keyboard) + `docs/qa/FEEDBACK_REGRESSIONS.md` 대장.
2. **모바일 키보드 스위트**(§3, 가장 아픈 모바일부터) → 7 시나리오 RED 확인 → 각 페이지 `--vvh`/스크롤부모 fix.
3. **카나리 크롤**(§4) → 표시명 6곳·L1 자동검출 → 수정. (L1 fileListWhereByLevel OR-누출은 2026-07-05 이미 fix·배포됨 — c57d672. 카나리로 회귀 감시.)
4. **42건 회귀 전환**(§6, 부류대표).
5. **/검증 개정**(§7) + CLAUDE.md 규칙 3줄.

## 부록 — 조사 중 발견/처리한 활성 버그
- **L1 개인파일 누출** (`access_scope.js fileListWhereByLevel`) — **FIXED·배포됨** (c57d672, 2026-07-05, canary 검증). legacy visibility에 `vlevel:null` 게이트.
- **표시명 누락 6 라우트** — **TODO** (businesses·dashboard·org·weekly_reviews·notifications·clients). 카나리 크롤로 검증하며 수정.
- **청구서 열람(viewed) 봇/스캐너 오탐** — **FIXED·배포됨** (088a6fd, isBotOrScanner). 잔여=비로그인 실브라우저 본인은 사람 눈.
