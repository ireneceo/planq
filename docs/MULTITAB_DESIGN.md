# PlanQ 앱 내 멀티탭 (노션 방식, keep-alive) — 기술 설계

> **결정 (Irene, 2026-07-02):** "처음부터 진짜 keep-alive" — 여러 페이지를 언마운트하지 않고 동시에 살려두고, 탭 클릭 시 즉시 전환 + 모든 컨텍스트(스크롤·입력·드로어·소켓 수신) 완전 유지.
> **협업:** 개발=Opus / 게이트=Fable. 본 문서는 Fable의 15개 게이트 질문(§9)에 전부 답하는 것을 목표로 한다.
> **선행 조사:** Explore(현행 아키텍처 맵) + Fable(타당성·리스크 독립검증) 두 관점 수렴 결과 기반.

---

## 0. 범위 (SCOPE)

| 항목 | 결정 | 근거 |
|------|------|------|
| 방향 | **진짜 keep-alive** (스냅샷 방식 아님) | Irene 확정 |
| 대상 디바이스 | **데스크탑 전용 (≥1025px)** | iOS PWA 메모리 퇴출·탭 스트립 자리 없음. 모바일은 현행 단일페이지+햄버거 유지 |
| 동시 alive 탭 | **LRU 4개** (그 이상은 suspend=언마운트+스냅샷) | 메모리·소켓·리렌더 상한. 탭 스트립엔 4개 초과 표시 가능하되 살아있는 건 ≤4 |
| 탭 대상 페이지(화이트리스트) | Q Talk / Q Task / Q Note / Q docs / Q Calendar / Q Bill / Projects / Project 상세 / Files / Clients / Dashboard / Inbox | 업무 멀티태스킹 컨텍스트 |
| 탭 비대상(항상 단일·교체) | 설정 / admin / 프로필 / 공개(`/public/*`)·마케팅 | keep-alive 가치 없음, 리스크만 |

---

## 1. 아키텍처 개요

```
BrowserRouter (main.tsx — 단일 유지)
 └ App
    └ MainLayout (사이드바 + chrome, 1회 마운트 유지)
       └ TabHost                       ← [신규] 멀티탭 오케스트레이터
          ├ TabStrip                    ← [신규] 상단 탭 바 (데스크탑만)
          └ TabPanes
             ├ TabPane(talk)   ─ alive, display:block   ← 활성
             ├ TabPane(task)   ─ alive, display:none    ← 백그라운드(살아있음)
             ├ TabPane(docs)   ─ alive, display:none
             └ TabPane(bill)   ─ suspended(언마운트, 스냅샷만)
```

**5개 신규 축 (선행 인프라 → 탭 코어 순):**

| # | 축 | 역할 | 커밋 단위 |
|---|-----|------|-----------|
| P0-A | **공유 소켓 서비스** `services/socket.ts` | 세션당 소켓 1개, 페이지는 room 구독만 | 독립(멀티탭 없이도 부채청산) |
| P0-B | **앱탭 활성 컨텍스트** `useTabActive()` | 페이지가 "내가 지금 보이는 탭인가" 판단 | 독립(단일탭에선 항상 true) |
| P1 | **TabStore** (탭 상태 단일원천) | 열린 탭·활성·location·alive/suspend | 탭 코어 |
| P1 | **per-tab location** (탭마다 독립 history) | 탭별 URL·드로어·뒤로가기 격리 | 탭 코어 |
| P1 | **TabHost/TabStrip/TabPane** | keep-alive 렌더 + UI | 탭 코어 |

---

## 2. 선행 인프라 (Phase 0 — 멀티탭 전 독립 검증·커밋)

### 2.1 공유 소켓 서비스 (P0-A)

**문제:** 현재 24개 파일이 각자 `io()` 생성. 탭 N개 alive → 소켓 N+2개, 브로드캐스트 1건 N벌 중복 수신, `reconnectionAttempts:Infinity` 재연결 폭주. (근거: `QTalkPage.tsx:393`, `QTaskPage.tsx:561`, `PostsPage.tsx:317`, `useUnreadTotal.ts:71`…)

**설계:** 세션 싱글턴 + refCount + room dedup.
```ts
// services/socket.ts
let sock: Socket | null = null;
const roomRefs = new Map<string, number>();   // 'business:5' -> refCount
export function getSocket(): Socket { /* io(origin,{auth:getAccessToken}) 1회 */ }
export function joinRoom(room: string) { /* refCount++; 0→1 일 때만 emit('join', room) */ }
export function leaveRoom(room: string) { /* refCount--; 1→0 일 때만 emit('leave', room) */ }
export function on(evt, cb): () => void   // 구독 해제 함수 반환
```
- 페이지는 `getSocket()`·`joinRoom('business:'+bizId)`·`onSocket('task:new', cb)` 만 사용. **직접 `io()` 금지.**
- `useUnreadTotal.ts`가 이미 모듈캐시+refCount 싱글턴이므로 그 패턴을 일반화·승격.
- `NotificationToaster`(세션당 1개)도 공유 소켓 구독으로 이관.
- **`connect_error` 토큰갱신 핸들러는 공유 소켓 1곳에 이관 필수** — 기존 24곳(예 `QTalkPage.tsx:405-411`)이 각자 `apiFetch('/api/auth/me')` 로 refresh 트리거하던 것을 `services/socket.ts` `ensureSocket()` 1곳으로 통합(누락 시 토큰 만료 후 영구 재연결 실패 — Fable ④). **구현 완료** (services/socket.ts).
- **마이그레이션 대상 24곳 전수 목록**은 §10-A. 각 전환 = "io() 제거 → getSocket/joinRoom/onSocket".
- 백엔드 무변경(connection당 `autoJoinUserBusinesses` 유지) — 세션당 소켓이 1개로 줄어 서버 부하 오히려 감소.

**⚠ switchWorkspace 정합 (Fable ④ 반영):** 백엔드 `autoJoinUserBusinesses`(`server.js:115-141`)가 connection 시 **사용자의 전 멤버 워크스페이스 room 을 자동 join** 한다 → room 격리 축이 애초에 워크스페이스 단위가 아님(공유 소켓이 여러 워크스페이스 이벤트 동시 수신, 이게 정상). 따라서 **`switchWorkspace` 시 소켓 재handshake·room 재조인 불필요** — 같은 세션 소켓 유지, active 워크스페이스 UI 필터만 전환. `AuthContext.switchWorkspace`(`:534-553`)의 `setUser` 만으로 충분. (v1 검증문의 "전환 시 room leave/join" 은 백엔드 동작과 안 맞아 삭제.) `WorkspaceSwitcher.tsx:145` 의 `location.href` 전체 새로고침 우회는 공유 소켓 도입 후 제거 가능(선택).

**검증(독립):** 단일탭 상태에서 세션 WS 커넥션 = **1** (DevTools Network/WS), 페이지 이동 시 listener 누수 0(chrome memory heap), switchWorkspace 후에도 소켓 1개 유지 + 신 워크스페이스 이벤트 수신, CLAUDE.md #16 2-탭 실시간 반영 회귀 0, connect_error→토큰만료 재연결 정상.

### 2.2 앱탭 활성 컨텍스트 (P0-B)

**문제:** 코드 전반이 `document.visibilityState==='visible'` = "사용자가 보고 있음"으로 가정(pages 내 34건). `useVisibilityRefresh`(16개 파일)도 document 레벨. 멀티탭에선 백그라운드 앱탭도 `visible`이라 오작동.

**설계:**
```ts
// contexts/TabActiveContext.tsx
const TabActiveContext = createContext<boolean>(true);   // 단일탭 fallback = true
export const useTabActive = () => useContext(TabActiveContext);
// 진짜 "사용자가 이걸 보고 있음" = 브라우저 탭 visible AND 이 앱탭이 활성.
// ⚠ Fable 검수 반영: 두 hook 을 조건 없이 먼저 호출한 뒤 값만 결합 (단축평가 조건부 hook 호출 금지 — Rules of Hooks).
export const useReallyVisible = () => {
  const tabActive = useTabActive();
  const docVisible = useSyncExternalStore(subVisibility, () => document.visibilityState === 'visible');
  return tabActive && docVisible;
};
```
- 각 `TabPane`이 자기 `active` 여부를 Provider로 주입. 페이지는 `useTabActive()`/`useReallyVisible()` 소비.
- `useVisibilityRefresh` → **`useTabForeground(refetch)`** 로 교체: (a) 브라우저 visible 복귀, **또는** (b) 이 앱탭이 비활성→활성 전환 시 refetch. document 레벨 단독 발화 제거.
- **마이그레이션 목록**: `document.visibilityState` 34건(§10-B), `useVisibilityRefresh` 16개 파일(§10-C).

**검증(독립):** 단일탭에선 `useTabActive()===true` 로 기존 동작 100% 동일(무회귀). 멀티탭 준비 완료.

---

## 3. 탭별 location 전략 (Fable Q1 — "설계의 심장", v2 재설계)

**요구:** 탭A=`/talk/5?drawer=...`, 탭B=`/tasks?task=42` 가 서로 독립. 활성 탭 URL은 브라우저 주소창·뒤로가기에 반영. 숨은 탭 내부 `useNavigate`/`<Link>`/`useSearchParams` 는 자기 탭에서만 작동.

> **⚠ v1 반려 (Fable 치명 결함):** "최상위 BrowserRouter 유지 + 탭마다 저수준 `<Router>` 중첩" 안은 **react-router v7.14 에서 확정 throw** — `invariant(!useInRouterContext(), "You cannot render a <Router> inside another <Router>")` (prod 번들 확인, dev 전용 아님). 또한 `history` 패키지는 직접 의존성 아님(내부 번들), 저수준 `Router` 는 `history` prop 을 받지 않음(`{location,navigator,navigationType,static}`). → v1 폐기.

**채택 (v2): 탭별 형제(sibling) `<MemoryRouter>` — BrowserRouter 를 탭의 조상으로 두지 않는다.**

핵심: **중첩 Router 가 문제이지, 형제 Router 는 합법.** `useInRouterContext()` 는 상위에 Router 가 있을 때만 true 다. 따라서 라우팅 경계를 옮긴다:

```
<AuthProvider>
  { !loggedIn || !isDesktop
    ? <BrowserRouter><ShellRoutes/></BrowserRouter>   // 로그인·공개·마케팅·모바일 (단일탭 현행)
    : <TabAppShell>                                    // ← BrowserRouter 조상 없음
        {/* chrome 과 탭 pane 들은 서로 형제. 어느 것도 다른 것의 조상이 아니다. */}
        <ChromeZone>                                   // router-less. TabStore 로 네비/활성표시
          <Sidebar/><TabStrip/><RightDock/><Toaster/><BuildGuard/>
        </ChromeZone>
        <TabPanes>
          {tabs.filter(t=>t.alive).map(t =>
            <TabPane key={t.id} hidden={t.id!==activeId}>
              <MemoryRouter initialEntries={[t.path]}>  // ← 탭마다 독립. 형제(중첩 아님) → invariant 통과
                <UrlMirror active={t.id===activeId} onNav={p=>store.setTabPath(t.id,p)}/>
                <PageRoutesForTab kind={t.kind}/>       // useNavigate/useParams/useSearchParams/Link = 이 탭 전용
              </MemoryRouter>
            </TabPane>
          )}
        </TabPanes>
      </TabAppShell>
  }
</AuthProvider>
```

- **왜 크래시 안 나나:** `TabAppShell` 에 Router 조상이 없으므로 각 `<MemoryRouter>` 는 자기 subtree 의 **최상위 Router** = 형제. `useInRouterContext()===false` 통과 (SSR PoC 실증 §13-3).
- **★ 52파일 shim 불필요:** 페이지 내부 `useNavigate/useParams/useSearchParams/Link/useLocation` 이 **무수정** 각 탭 MemoryRouter 바인딩.
- **🔴 chrome 은 react-router 를 쓰지 않는다 (Fable Part2-① 반영 — v1의 치명 함정):** `MainLayout`(사이드바 active·nav `useLocation`/`useNavigate` 20+곳), `NotificationToaster`(activePathRef `useLocation`), `RightDock`, `CueHelpDrawer`, `BuildVersionGuard` 는 router-less zone 에 놓이므로 **이들의 RR 훅 호출은 `throw "useLocation() may be used only in the context of a <Router>"`** (Fable TEST2 실측). → **chrome 을 TabStore 기반으로 리팩터**: 사이드바 active = `store.activeTab.kind`(경로 아님), 사이드바 클릭 = `store.openOrFocus(kind)`(navigate 아님), Toaster 링크매칭 = `store.activeTab.path` + 열린 conv 맵. 이 chrome 리팩터 비용은 **P1 필수 선행**(§13-P1-a에 포함). 페이지(52파일)엔 shim 불필요하나 **chrome(5개)은 RR 탈피 필요** — 이게 v1→v2에서 이동한 진짜 비용.
- **비-탭 페이지(설정·admin·프로필):** TabAppShell 안 "단일 인스턴스 replace 탭"(역시 MemoryRouter pane).
- **브라우저 주소창 + back/forward (Fable Part2-③ 정정):** UrlMirror 는 활성 탭 내부 네비 시 `window.history.pushState`(replaceState 아님 — pushState 라야 back 엔트리 생성), 탭 전환 시엔 `replaceState`(탭 전환은 브라우저 히스토리에 안 쌓음). `popstate` → 현재 window path 를 활성 탭의 MemoryRouter 로 `navigate(path)`. **단일 브라우저 히스토리에 여러 탭 네비가 interleave → back 이 탭 경계를 넘을 수 있음**: 수용 정책 = "브라우저 back = 활성 탭의 직전 path 로만, 탭 경계 넘으면 그 path 소유 탭으로 자동 전환"(§8 재타겟 규칙 재사용). 인브라우저 SPIKE 필수 검증(§13-3).
- **딥링크 진입 (Fable Part2-⑤ 정정):** 미인증 딥링크는 `ProtectedRoute` 가 `/login?next=<path>` 로 보존(shell 라우터). 로그인 성공 → `loggedIn` flip 직전, AuthContext 가 `next` 를 sessionStorage(`planq_boot_deeplink`)에 적재 → TabAppShell 마운트 시 그 값으로 첫 탭 seed(없으면 `/dashboard`). auth flip 과 seed 순서를 sessionStorage 로 디커플 — 트리 스왑으로 shell navigate 가 유실돼도 딥링크 보존.
- **isDesktop 런타임 전환 (Fable Part2-④ 정정):** 창 리사이즈로 1024px 경계 넘을 때 `TabAppShell↔ShellRouter` 트리 스왑 = 전체 remount(탭 소멸). 방지 = **`isDesktop` 는 마운트 시 1회 확정(초기값 고정), 리사이즈로 재평가 안 함.** 데스크탑에서 진입하면 세션 동안 탭 모드 유지(폰 폭으로 줄여도 탭 유지, 단 탭 스트립은 반응형 축소 §5). 진짜 기기 전환은 새로고침으로만.
- **URL 상태 격리 근본 해결:** 탭마다 MemoryRouter → `?task=`·`?post=` 오염(Explore §5-E) 원천 차단.

**수용 한계(명시):** MemoryRouter 내부 back-stack 직렬화 불가 → 새로고침 후 복원은 **각 탭 현재 path 1개**뿐(§7). 탭 내부 뒤로가기 히스토리는 리로드 후 초기화(핵심 목표 아님, Fable ③ 수용).

---

## 4. TabStore — 탭 상태 단일원천

```ts
interface Tab {
  id: string;                 // 안정 id (nanoid)
  kind: TabKind;              // 'talk'|'task'|'note'|'docs'|'calendar'|'bill'|'project'|'projectDetail'|'files'|'clients'|'dashboard'|'inbox'
  title: string;             // 동적 (대화명·프로젝트명…)
  icon: string;              // Q 시리즈 아이콘 키
  path: string;              // 이 탭의 현재 location path (단일 원천). UrlMirror 가 내부 네비 시 store.setTabPath 로 갱신
  alive: boolean;            // true=마운트 유지, false=suspend(스냅샷만)
  lastActiveAt: number;      // LRU
  snapshot?: TabSnapshot;    // suspend/복원용 (scroll·열린 드로어·선택항목)
}
```
> **Fable Part2-② 정정:** `MemoryRouter` 는 내부에서 자기 history 를 생성하고 외부 `MemoryHistory` 객체를 주입받지 않는다 → 옛 `history: MemoryHistory` 필드 폐기. TabStore 는 **`path` 문자열만** 소유(직렬화 가능·§7 복원 정합). MemoryRouter 는 `initialEntries={[tab.path]}` 로 seed 되고, 탭 내부 네비는 `<UrlMirror onNav>` 가 `store.setTabPath(id, path)` 로 역보고 → suspend/새로고침 시 그 path 로 재seed.
- Context + `useSyncExternalStore` (전역 상태 라이브러리 미도입 원칙 유지 — AuthContext/Pwa 2개뿐).
- **탭 identity 규칙:** kind 기준 1개 원칙(예: Talk 탭은 세션당 1개, 대화 전환은 그 탭 안에서). 단 **Project 상세**·**docs 상세**는 id별 복수 허용(`projectDetail:123`).
- **LRU:** alive 탭 > 4 되면 `lastActiveAt` 최오래 비활성 탭 → `alive=false`(언마운트, 스냅샷 저장). 재클릭 시 재마운트+복원(빠름).
- **영속:** 탭 목록 + 각 탭 path + snapshot → `sessionStorage`(브라우저 탭 스코프) 저장, 새로고침 복원(§7).

---

## 5. 렌더링 — keep-alive

- `TabHost` 는 **alive 탭 전부를 동시 렌더**. 비활성 탭 `TabPane` 은 `hidden`(=`display:none` + `aria-hidden` + `inert`) 처리(언마운트 안 함).
  - `inert` 로 숨은 탭의 포커스·클릭·탭이동 차단(전역 리스너 격리의 1차 방어, §6과 병행).
- 각 `TabPane` = `<TabActiveContext value={isActive}><MemoryRouter initialEntries={[tab.path]}><UrlMirror active={isActive}/>{lazyPageByKind}</MemoryRouter></TabActiveContext>` (§3 v2 형제 MemoryRouter).
- **lazy 유지:** 페이지별 `lazy()` 그대로. 탭 최초 활성화 시 chunk 로드.
- **MainLayout 1회 마운트 유지:** 사이드바·chrome 소켓(뱃지·토스터)은 layout 1회 마운트로 공유(§2.1 공유소켓 이관 후 자연 해결). 사이드바 `isActive` 하이라이트는 "활성 탭 kind" 기준.

---

## 6. 전역 리소스 격리 (Fable Q7)

숨은 탭도 마운트 상태라 리스너가 살아있음. **활성 탭만 전역 자원을 잡도록** 재정의:

| 자원 | 현행 | 멀티탭 설계 |
|------|------|------------|
| keydown/단축키 | 페이지 직접 등록(`QTaskPage.tsx:213,615,640,1118`, `QTalkPage.tsx:364`) | `useTabActive()` 게이트 — 비활성 탭 핸들러 no-op. `inert` 로 1차 차단 + 가드 2차 |
| Esc 스택 | `useEscapeStack` 모듈 전역 스택 | **탭 스코프화** — 스택에 tabId 태그, pop 시 활성 탭 항목만 |
| body scroll lock | `useBodyScrollLock` | 활성 탭 드로어만 lock. 숨은 탭 드로어는 lock 해제(재활성 시 재적용) |
| focus trap | `useFocusTrap` | 비활성 탭에서 trap 해제 |
| Q Note 폴링 | `setInterval` 5s/4s(`QNotePage.tsx:359,578`) | 비활성 탭 폴링 **일시정지**(`useTabActive` false 시 clearInterval), 활성 복귀 시 재개 |
| Q Note **녹음 heartbeat** | `setInterval` 5s(`QNotePage.tsx:965`, 409 시 녹음중단) | **정지 화이트리스트에서 제외 — 항상 유지** (숨은 탭에서 녹음 지속이 §11 의도. 정지 시 녹음이 죽음 — Fable Q10). §11 red dot 로 표시 |

---

## 7. 새로고침·빌드갱신·PWA 복귀 (Fable Q8)

- **영속 대상:** 탭 목록(id·kind·path·title) + 각 탭 snapshot(scroll·열린 드로어 param·선택 항목) → `sessionStorage['planq_tabs']`.
- **복원:** 부팅 시 TabStore가 복원. **활성 탭만 즉시 alive 마운트**, 나머지는 `alive=false`(클릭 시 마운트) — 부팅 성능 보호.
- **`isReloadSafe()` 강화** (`BuildVersionGuard.tsx:52`): 현행은 focus된 입력/formDirty만 검사 → **모든 alive 탭 pane의 `[data-form-dirty="1"]` 전수 검사**로 확장. 숨은 탭에 미저장 입력 있으면 자동 reload 보류 → `<UpdateBanner>`.
- **탭별 draft:** 미저장 입력은 `useLocalDraft`(현재 사용처 0건 — 배선) + 기존 ChatPanel localStorage draft(`ChatPanel.tsx:338`) 로 이중 안전.

---

## 8. 링크 진입 규칙 — SmartRouting/알림/공유 (Fable Q9)

- **원칙:** 링크의 route 패턴이 **이미 열린 탭 kind와 일치하면 그 탭 재타겟**(내부 navigate), 아니면 **신규 탭**. 무한 증식 방지.
  - 예: 알림 "task#42" → Q Task 탭 열려있으면 그 탭에서 `?task=42`, 없으면 새 Task 탭.
  - Project 상세·docs 상세는 id별 탭이므로 같은 id면 재사용, 다른 id면 새 탭.
- **알림 링크 정합:** 기존 박제(`feedback_notify_link_must_match_route`)의 상대경로+App.tsx Route 대조 규칙 유지. 탭 오픈은 그 위에 얹힘.
- **외부 진입(주소창 직접/공유링크):** 활성 탭 1개로 부팅 후 규칙 적용.

---

## 9. Fable 15개 게이트 질문 — 답변 매핑

| # | 질문 | 답 (섹션) |
|---|------|-----------|
| 1 | 탭별 location | §3 — 탭별 memory history + 활성 탭 URL 미러 |
| 2 | 소켓 공유 싱글톤? | §2.1 — 예, `services/socket.ts`, 24곳 마이그레이션 |
| 3 | 앱탭 활성 컨텍스트 + 마이그레이션 | §2.2 + §10-B/C — `useTabActive`, document 34건·훅 16개 |
| 4 | 숨은 탭 갱신 정책 | §11 — 소켓 live merge 유지, 무거운 폴링·full refetch 일시정지 |
| 5 | 숨은 Q Talk 읽음 진실 | §11 — `useTabActive && visible && conv open` 3중 조건 |
| 6 | Toaster 활성 conv skip | §11 — **활성 탭** location 기준으로 판정 |
| 7 | Esc/스크롤락/keydown/포커스트랩 | §6 — 전부 활성 탭 스코프 + inert |
| 8 | 새로고침/빌드/PWA 복원 | §7 — sessionStorage 탭 복원 + isReloadSafe 전수 dirty |
| 9 | 링크=재사용 vs 새 탭 | §8 — route 패턴 일치 시 재타겟 |
| 10 | Q Note 녹음·Focus 지속? | §11 — 지속(의도) + 탭에 녹음중 표시(red dot) |
| 11 | 최대 탭·초과 정책 | §0/§4 — alive LRU 4, 초과 suspend |
| 12 | 화이트리스트 | §0 — 대상/비대상 표 |
| 13 | 모바일 | §0 — 제외, 현행 유지 |
| 14 | 검증 계획 | §12 — #16 × 숨은탭 조합, 읽음 시나리오 필수 |
| 15 | 메모리 실측 | §12 — 8 heavy 탭 데스크탑 측정 |

## 11. 숨은(백그라운드) 탭 동작 정책 (Q4·5·6·10 상세)

**★ 소켓 핸들러 heavy/light 판정 규칙 (Fable ② 반영 — "소켓 merge"로 뭉뚱그리지 않는다):**
소켓 이벤트 콜백을 **두 종류로 분류**하고 숨은 탭에서 다르게 처리한다.
- **(light) state-merge 콜백** — payload 로 setState 직접 갱신 (예 `QTalkPage.tsx:426` append, `QTaskPage.tsx:585` map). 숨은 alive 탭에서도 **계속 실행** (싸고, 돌아오면 최신).
- **(heavy) refetch 콜백** — 이벤트 수신 시 full-list GET (예 `TodoPage.tsx:124-135` 10 이벤트 → `silentLoad`, `QTaskPage.tsx:592` `project:updated`→`load()`). 숨은 탭에서는 **실행 대신 `dirty=true` 마킹만**, 재활성 시 **1회** refetch 로 강등. → 숨은 탭 4개가 `task:updated` 1건에 full GET 4벌 나던 HTTP 스탬피드 차단(§2.1 로 소켓은 1개여도 HTTP 는 별개).
- 구현: `onSocket` 래퍼 `onSocketMerge(evt,cb)` / `onSocketRefetch(evt,refetch)` 2종 — 후자가 `useTabActive()` 참조해 숨은 탭이면 defer.

| 동작 | 활성 탭 | 숨은(alive) 탭 | suspend 탭 |
|------|---------|----------------|------------|
| 소켓 **merge** 콜백 (light) | O | **O** (컨텍스트 유지 핵심) | X (재활성 시 refetch) |
| 소켓 **refetch** 콜백 (heavy) | O | **defer → 재활성 시 1회** | X (재활성 시 1회) |
| visibility full refetch | O | **안 함** | 재활성 시 1회 |
| 무거운 폴링(Q Note 5s/4s) | O | **일시정지** | X |
| Q Talk 읽음 처리 | 3중조건 충족 시 O | **X** (읽음 안 됨 → 뱃지 오름) | X |
| Toaster 표시 | 활성 탭 conv면 skip | 그 conv가 숨은 탭이면 **토스터 표시** | 표시 |
| Q Note 녹음 heartbeat / Focus | O | **O** + 탭 red dot | (suspend 제외) |

**Toaster 활성 conv 판정 소스 단일화 (Fable ⑥ 반영):** `NotificationToaster` 는 전역 `useLocation()`(`:172-195`) 단일 URL 로 판정하던 것을, **TabStore 가 노출하는 "탭별 현재 conv 맵"** (`getOpenConversationIds(): Set<number>` + 활성 탭 convId) 을 구독하도록 변경. skip 조건 = "**활성 탭**이 그 conv 를 열고 있을 때만". 숨은 탭이 연 conv 도착 → 토스터 표시(§11 표 정합). TabStore 가 §6(격리)·§11(표시) 판정의 **단일 소스**.

→ **B2B 신뢰 핵심 회귀 차단:** 숨은 Q Talk 탭에 고객 메시지 도착 시 "읽음" 안 되고 unread 뱃지가 오르는 게 진실(현행 `QTalkPage.tsx:437-465` 주석의 과거 회귀 재발 방지).

---

## 10. 마이그레이션 목록 (게이트 실사 대상)

- **§10-A `io()` 24곳** → `getSocket/joinRoom/onSocket(Merge|Refetch)`: QTalkPage, QTaskPage, QCalendar, TodoPage, DashboardPage, Clients, Knowledge, QMail, PostsPage, QProject(Detail/Docs/Tasks/Canvas), QBill(Overview/Invoices/TaxInvoices), QTask 리포트 3종, NotificationToaster, useInboxCount, useNotifications(2), useUnreadTotal(승격 원천). 전환 시 각 리스너를 §11 merge/refetch 로 분류.
- **§10-B `document.visibilityState` 34건** → `useReallyVisible()`.
- **§10-C `useVisibilityRefresh` 16개 파일** → `useTabForeground()`.
- **§10-D `window.__planq_postsSocket` 전역 싱글턴 제거**(`PostsPage.tsx:325,328-332`) → 공유 소켓(멀티탭에서 즉시 깨지는 코드).
- (정확한 파일:라인은 구현 착수 시 재grep — 조사 시점 대비 drift 확인)

---

## 12. 검증 계획 (Fable 게이트 통과 기준)

**빌드/가드:** `node scripts/health-check.js` 29+ · `npm run build` EXIT0/TS0 · i18n ko/en 패리티 · 멀티테넌트 `business_id` WHERE.

**실동작 E2E (숨은 탭 조합 — 핵심):**
1. **읽음 회귀** — 숨은 Q Talk 탭(대화 열림) + 다른 탭 활성 상태에서 고객 메시지 도착 → 읽음 **안 됨** + unread 뱃지 +1 + Toaster 표시 (★필수)
2. **소켓 수** — 탭 4개 alive 시 WS 커넥션 = **1** (공유 소켓 증명)
3. **실시간 반영(#16)** — 2브라우저: A가 task 추가 → 숨은 Task 탭이 alive면 merge, 활성화 시 즉시 최신
4. **URL 격리** — 탭A `?task=42`, 탭B `?post=7` 동시 → 상호 오염 0, 활성 탭만 주소창 미러
5. **Esc 격리** — 숨은 탭 드로어 열어둔 채 다른 탭에서 Esc → 숨은 드로어 안 닫힘
6. **새로고침 복원** — 탭 3개 + 각 스크롤/드로어 → F5 → 탭 목록·활성 탭 컨텍스트 복원
7. **빌드 자동 reload 안전** — 숨은 탭 입력 dirty 시 자동 reload 보류 → 배너
8. **메모리 (합격 임계치 명시 — Fable ⑮):** Chrome heap 스냅샷, alive 4탭(heavy: QTalk+QTask+ProjectCanvas+QBill) 30분 사용 후 **JS heap ≤ 400MB**, suspend 2탭 추가해도 증가 **≤ 40MB/탭**, 탭 전부 닫은 뒤 heap 이 baseline+50MB 이내로 회수(누수 게이트). 초과 시 반려.
9. **모바일** — ≤1024px 에서 탭 스트립 미노출, 현행 단일페이지 동일
10. **다중 디바이스(#16-3)** — user:N room 한쪽 액션 → 다른쪽 반영

---

## 13. 커밋 분할 (구현 순서)

1. **P0-A** 공유 소켓 서비스(`services/socket.ts` — 작성됨) + 24곳 마이그레이션 + connect_error 이관 (독립 검증·게이트)
2. **P0-B** 앱탭 활성 컨텍스트 + document(34)/hook(16) 마이그레이션 (독립 검증, 단일탭 무회귀). **※ `useReallyVisible` hook 버그 수정본(§2.2)으로 착수.**
3. **🚪 SPIKE (P1 진입 게이트, Fable 필수):** §3 v2 형제 MemoryRouter PoC.
   - ✅ **SSR 레벨 실증 (6/0 PASS, Fable 독립 재현):** 형제 MemoryRouter 2개 invariant 미발생 / 각 탭 자기 URL 독립 read / RR 훅 무수정 바인딩 / 반증대조 중첩 throw. **단 이건 "격리된 형제 pane"만 커버 — 아래가 진짜 게이트.**
   - ⬜ **🔴 SPIKE 통과 기준 상향 (Fable 필수):** 실앱 골격 = **chrome(TabStore 기반 사이드바+Toaster) + 형제 tab pane 2개를 router-less zone 에서 동시 렌더 무crash.** (현 6/0 은 chrome 이 없어 Part2-① router-less crash 를 못 봄. chrome 포함해야 게이트 의미.)
   - ⬜ **인브라우저:** StrictMode 이중마운트 MemoryRouter 안정성, UrlMirror `pushState`(back 엔트리) + `popstate` 탭경계 back/forward, 딥링크 seed(sessionStorage). **이 통과 전 P1-a 본구현 금지 — 통과해도 chrome 미포함이면 첫 렌더 crash.**
4. **P1-a** TabStore + 형제 MemoryRouter TabPane + UrlMirror(pushState/popstate) 브릿지 + **🔴 chrome RR 탈피 리팩터**(MainLayout 사이드바 active/nav 20+곳 + Toaster activePathRef + RightDock + CueHelpDrawer + BuildVersionGuard → TabStore 소비. Fable Part2-① — v1→v2 이동 비용, P1-a 필수 선행). 딥링크 seed + isDesktop 마운트1회 확정.
5. **P1-b** TabHost/TabStrip keep-alive 렌더 + 전역 리소스 격리(§6, Esc/scrolllock/keydown/focustrap 탭 스코프 + suspend cleanup 유령 엔트리 방지)
6. **P1-c** 링크 진입 규칙(§8) + 영속·복원(§7, path 1개/탭 + 데이터 로드 후 scroll 복원 훅 12페이지 배선) + LRU suspend
7. **P1-d** 숨은 탭 정책(§11 merge/refetch 분류) + Toaster TabStore 소스 + 검증 E2E 전수(§12)

각 단계 끝 검증 통과 후 다음. P0 2개는 멀티탭 없이도 라이브 가능(점진). SPIKE 는 버려도 되는 실험 코드 — 통과 시에만 P1 진입.
