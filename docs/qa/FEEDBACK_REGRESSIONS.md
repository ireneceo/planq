# 피드백 회귀 대장 (Feedback Regressions)

> 운영 피드백 1건 = 검사 1개. 하니스(`scripts/e2e/`)가 자동 검출. INSPECTION_PLAYBOOK.md §6.
> 실행: `node scripts/e2e/run.js --suite mobile,crosscut,l1` (exit 0/1/2, health-check 동급 게이트).

## 상태 (v2 — 2026-07-09)
- **하니스 v2** — 판정 엔진 오염 교정 + 스위트 3종 등록(mobile · crosscut · l1) + URL-파라미터/data-testid 결정론적 opener.
- 스위트별 exit: `0`=통과 · `1`=실버그/누출 · `2`=**FATAL(하니스 환경 오염 — 판정 자체 신뢰 불가)**.

### ★ 시뮬 보정 함정 2가지 (반드시 준수 — 위반 시 오탐/오해)
1. **CDP `setDeviceMetricsOverride` 에 `screenOrientation` 넣지 말 것** — 앱 orientationchange 가 fullH 를 축소값으로 리셋 → 키보드 판정(isUp = vv.height < fullH*0.70) 깨짐.
2. **판정 종료 후 `clearDeviceMetricsOverride` 쓰지 말 것 (v2 신규 박제)** — clear 는 puppeteer 의 `setViewport(375×667)` 오버라이드까지 제거 → 브라우저 원시 창(실측 780×493, `mq=false` 데스크탑 환경)으로 복귀. 그러면 **페이지당 첫 입력만 모바일 환경에서 판정**되고 두 번째 입력부터는 focus 시점 innerWidth=780 → main.tsx `(max-width:768px)` 가드가 걸려 `ensureFocusedVisible` 이 즉시 return → **가림 오탐**. 반드시 모바일 뷰포트로 재-override 후 세션 detach. `browser.js assertKeyboardSafe` 는 판정 직전 `innerWidth===375` self-assert → 오염 재발 시 FAIL(앱 탓) 아닌 **FATAL(환경 탓)** 로 구분.

## 1차 전수(모바일 키보드) 결과 — v1 → v2 재판정

| 화면 | v1 판정 | v2 재판정(교정) | 결론 |
|------|---------|----------------|------|
| /business/clients (검색·초대) | ✅ | ✅ | 정상 |
| /docs · /wiki | ✅ | ✅ | 정상 |
| **/business/settings** | ❌ 3 입력 가림(390/467/544>337) | ✅ 18입력 전부 통과 | **v1 오탐** (판정환경 오염 + role="dialog" 배너 스코핑 오염) |
| **/calendar (일정 모달)** | ❌ 3 입력 가림(470/614/598) | ✅ 4입력 전부 통과 | **v1 오탐** (NewEventModal 은 `--vvh` 바운드 이미 구현) |
| **/tasks** | ❌ 1 입력 가림(342>337) | ❌→**수정 후 ✅** (335→197) | **진짜 버그** (아래 R-TASKS) |

### v1 오탐의 두 원인 (박제)
1. **판정환경 오염** — 위 함정 #2. settings/calendar 의 2번째 입력부터 데스크탑 환경에서 판정돼 가림 오탐.
2. **배너 스코핑 오염** — `InstallPromptBanner` 가 비모달 배너에 `role="dialog"` 를 달아 하니스 `visibleInputs` 가 "모달 열림"으로 오판 → 배경 페이지 입력 0개 반환(settings 0-input 플레이크). v2: 배너 role→`complementary`, 하니스는 `[aria-modal="true"]` 만 모달로 취급.

## R-TASKS — /tasks CueTaskBar 키보드 가림 (진짜 버그, 수정 완료)
- **증상:** 키보드 업(vvh 337) 시 CueTaskBar textarea bottom 335 > vvh−8=329.
- **근본원인:** vvh 337 을 MobileHeader(56) + **인플로우 프로모 배너(~138)** 가 잠식 → PageScroll 143px < Panel 고정크롬(PanelHeader 60+TabBar 41+CueTaskBar 48=149). Panel `overflow:hidden` 이라 하단 6px 침몰. CueTaskBar 는 스크롤영역 밖 flex 고정크롬 소속 → `findScrollParent` 가 `overflow:hidden` 조상 건너뛰어 **ensureFocusedVisible 이 구제 불가**(구조적 가림).
- **정석 fix:** 키보드 업 시 모바일에서 프로모 배너 억제(UX상으로도 죽은 공간). `main.tsx` `body[data-keyboard-up='1']` 계약 재사용. `MainLayout.tsx PushPromptWrap` + `InstallPromptBanner.tsx Banner` 에 `@media(max-width:768px){ body[data-keyboard-up='1'] & { display:none } }`. **(max-width:768px) 게이트 필수** — flag 는 세로축소만으로도 켜져 데스크탑 배너 회귀 방지.
- **검증:** v2 하니스 `tasks-week` bottom 335→PASS, 총 실패 0.

## 스위트 v2 (등록 완료)
- **mobile** (`mobile-keyboard.js`) — 키보드 가림/점프/가로스크롤. opener 는 URL 파라미터(`?create=1`·`?new=1`) + `data-testid` 결정론적. 시나리오: clients-search/invite · qbill-list · **bill-new** · tasks-week · **tasks-create** · inbox · calendar-add · docs · wiki · settings.
- **crosscut** (`canary-crawl.js`) — 표시명(계정명) 누출. biz5 표시명 카나리 심고 전 워크스페이스 라우트 SPA 크롤 → 계정명 렌더 시 FAIL. **현재 누출 0**(applyMemberDisplayName 완결 확증).
- **l1** (`canary-l1.js`) — L1 개인파일 누출. `fileListWhereByLevel` 를 실제 scope+실제 DB 쿼리로 직접 검증. 트랩: `vlevel='L1'`+legacy `visibility='L3'`(c57d672 회귀 지점). 대조군(L3 보임)·본인 L1(보임)으로 과잉차단도 감시. **현재 누출 0**.

## data-testid 부여 규칙 (개발 요건 — CLAUDE.md 박제)
- **모달/드로어 오프너·FAB·폼 제출 버튼은 `data-testid` 부여**. 네이밍 `{화면}-{동작}`.
- 부여 완료: `right-dock-fab` · `dock-create-{task,mail,event}` · `bill-new-invoice` · `clients-invite-open`.

## 다음 보강 (미착수)
- **chrome-suppression 스위트** — FAB/배너가 팝아웃·마케팅 라우트에서 억제되는지 전 라우트 전수(§5). data-testid 셀렉터(`right-dock`, `install-banner` 등) 기반.
- canary-crawl 라우트 자동 인벤토리(App.tsx `<Route>` 정적 파싱) — 신규 라우트 drift 차단.
- 기능완결성(상태머신 dead-end) 스위트.
