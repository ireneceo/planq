# 비로그인 방문자 UX — 게스트 퀵메뉴 · Q helper · /wiki 네비게이션 (설계 확정)

> 2026-07-18 Fable 정리 + Irene 결정. **다음 섹션에서 구현.** 백엔드 변경 0 — 100% 프론트엔드 배선.
> Irene 요구 원문: "워크스페이스가 아니면 Q helper가 그대로 열리고 탭을 Q 위키랑 문의만 남기고 로그인 안 한 고객 기준으로 제공. Q 위키에도 워크스페이스용 퀵메뉴가 아니라 랜딩페이지와 같은 걸로. /wiki는 랜딩/워크스페이스로 갈 방법이 없고 전환되어 버리면 안 됨."

## 진짜 원인 (파일:라인)
- `App.tsx:156-159` — `isMarketing = ['/','/features','/pricing','/insights','/blog','/about','/contact'].includes(...)`, `hideAppChrome = isPopout || isMarketing`. `App.tsx:544-548` — **마케팅 경로에선 CueHelpDrawer 마운트조차 안 됨** → 게스트 Q helper FAB 소멸(#71 회귀).
- `/wiki` 는 `isMarketing` 목록에 **없어서** chrome 마운트 → **회원이 /wiki 보면 워크스페이스 RightDock 이 뜸**(요구와 반대).
- `CueHelpDrawer.tsx:22-25,434-510` — 게스트 모드(Q위키+문의 2탭·게스트 API `/api/cue/help-public`·문의 `/api/inquiries`)는 **이미 완성**. 입구(App.tsx 마운트)만 막힘.
- `App.tsx:175-177` — `/wiki`,`/wiki/a/:slug` 는 **레이아웃 없는 standalone** → 막다른 길. `WikiArticlePage.tsx:37` "← 목록"만, 홈/로그인/워크스페이스 링크 0.
- **백엔드 경계 이미 안전** (`wiki.js:72-77` 게스트 public 강제, `cue.js:148` /help-public 공개+IP limit, `inquiries.js:28` 공개+limiter). **wiki.js/cue.js/inquiries.js 무변경.**

## 결정 사항
| # | 결정 |
|---|------|
| 1 게스트 퀵메뉴 | 새 컴포넌트 X. "공개 표면" = 마케팅 7경로 + `/wiki*`. 이 경로에서 RightDock 숨김 + **CueHelpDrawer 를 `publicSurface` prop 으로 마운트**(자체 FloatingTrigger FAB + 게스트 2탭). 로그인 사용자도 공개 표면에선 게스트 프레젠테이션(2탭)이되 API 는 본인 권한. |
| 2 /wiki 막다른 길 | `/wiki`,`/wiki/a/:slug` 를 **LandingLayout(transparentTop=false) 으로 감쌈**. GNB(홈·기능·가격·문의 + 비로그인 로그인/가입, 로그인 시 "내 워크스페이스"→/inbox)가 이미 구현됨(LandingLayout.tsx:76-115) → 위키 코드 0줄로 해결. 팝아웃 창(`isPopoutWindow()`)에선 GNB 미표시(WikiShell 소형 래퍼로 분기). |
| 3 위키 위 퀵메뉴 | `/wiki` 는 공개 표면 → 로그인 무관 **게스트형(위키+문의 2탭)**. "전환되어 버림" 해소: **회원이 워크스페이스(앱 경로)에서 위키 링크 클릭 시 `window.open(path,'_blank','noopener')` 새 탭**. 공개 표면(랜딩·위키)에선 같은 탭 유지. |
| 4 경계 | 백엔드 무변경. 프론트는 publicSurface 에서 workspace/feedback 모드 진입 차단(탭 미렌더 + `planq:open-tool`/`cue:ask` 핸들러 가드 + 모드 보정 effect 확장). |
| D 화면열기 버튼 | **위키·문의는 비회원 완전 자유(로그인 벽 0).** `WikiArticlePage.tsx:50-53` "화면 열기 →"(`linked_route`, 회원 앱 화면으로 점프)만 **비회원에겐 숨김**(`useAuth()` 게스트 분기). "로그인 후 사용" 라벨 아님 — 그냥 숨김. 회원엔 그대로. |

## 변경 파일 (5개, 백엔드 0)
1. **신규 `utils/publicSurface.ts`** — `isPublicSurfacePath(pathname)`: 마케팅 7 exact + `/insights/`·`/blog/` prefix + `/wiki`·`/wiki/` prefix. App.tsx:156 목록의 단일 진실.
2. **`App.tsx`** — `isMarketing`→`isPublicSurface = isPublicSurfacePath(loc.pathname)`; `hideAppChrome = isPopout || isPublicSurface` 유지하되 **CueHelpDrawer 만 예외**: `{!isPopout && <CueHelpDrawer publicSurface={isPublicSurface} />}`. RightDock/TabMirror/Toaster/Banner 는 기존 `!hideAppChrome` 유지(→ /wiki 에서 RightDock 자동 소멸). `/wiki` 라우트를 `WikiShell`(isPopoutWindow ? children : LandingLayout) 로 감쌈. LandingLayout lazy import 추가.
3. **`CueHelpDrawer.tsx`** — `publicSurface?` prop. `guestView = isGuest || publicSurface` 도입해 **탭/버튼 렌더 분기만** `isGuest`→`guestView`(게스트 2탭 :498, 회원 3탭 :478, 피드백 버튼 :461/467, 헤더 타이틀 :456, 단축키 힌트 :574). **API 분기(:231,239,276,308)는 `isGuest` 그대로**(로그인=인증호출·prefill). FAB 노출 `:434` `!dockManaged`→`(!dockManaged||publicSurface)`. FAB 클릭 `:437`/`planq:open-tool` `:126` `setMode(guestView?'qhelper':'workspace')`. 모드 보정 `:117` 에 `||publicSurface`. **openWikiPath `:111`**: `inWorkspaceCtx = dockManaged && !publicSurface`; `if(inWorkspaceCtx||standalone) window.open(path,'_blank','noopener'); else { navigate(path); setOpen(false); }`.
4. **`RightDock.tsx`** — 심층방어: `:35`/`pathHidden` 에 `isPublicSurfacePath(location.pathname)` OR 추가. `:6` 주석 갱신.
5. **`WikiArticlePage.tsx`** — `:50-53` "화면 열기" 를 `useAuth()` 게스트면 미렌더.

## 검증 매트릭스 (비로그인/로그인 × 랜딩/위키/워크스페이스)
| 상태 | 경로 | FAB | 드로어 탭 | 확인 |
|---|---|---|---|---|
| 비로그인 | `/` | 게스트 FloatingTrigger | 위키+문의 | `/api/cue/help-public` 호출·문의 제출 성공 |
| 비로그인 | `/wiki`,`/wiki/a/:slug` | 게스트 FAB | 위키+문의 | GNB(홈·로그인·가입)·푸터 표시, public article 만, "화면열기" 숨김 |
| 로그인 회원 | `/`,`/wiki` | 게스트형(RightDock 없음) | 위키+문의(워크스페이스·피드백 탭 없음) | `/api/cue/help`(인증)·문의 prefill·GNB "내 워크스페이스"→/inbox |
| 로그인 회원 | `/inbox` 등 | RightDock 런처(기존) | 3탭+피드백 | 위키 클릭 → **새 탭**·원화면 유지, /memo·popout FAB 숨김 유지 |
- help-popout 창 위키 링크 → 새 탭 풀사이즈. 팝아웃서 /wiki → GNB 미표시(WikiShell).

## 회귀 위험
① `hideAppChrome` 분해 시 마케팅에 Toaster/Banner 되살아나면 #71 재발 — CueHelpDrawer 만 예외인지 diff 확인. ② CueHelpDrawer lazy chunk 가 랜딩 로드에 추가(LCP 확인). ③ LandingLayout 안 PageShell `height:100%` 스크롤 정상 동작(위키 200건). ④ help-popout 위키 링크 새 탭 전환.

## 열린 질문 (기본 결정 = 진행)
- A /contact FAB → 노출(통일). B /wiki 이중헤더 → 수용(후속 위키헤더 랜딩화 검토). C /wiki 회원 토스터·배너 → 숨김. D 화면열기 → **숨김 확정(위 표)**.
