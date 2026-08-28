// stores/tabStore.ts — ⑥ 멀티탭 TabStore (탭 상태 단일 원천)
//
// 설계: docs/MULTITAB_DESIGN.md §4. 전역 상태 라이브러리 미도입 원칙 유지 —
//   순수 외부 store + useSyncExternalStore(구독). Context 재렌더 폭발 회피.
//
// strangler(Fable 권장): 트리 스왑 전까지 store 는 미러 모드로 동작 — 현재 단일 BrowserRouter 의
//   location 을 활성 탭 path 로 반영. chrome(사이드바·알림 등)이 이 store 를 소비하도록 하나씩 전환하면
//   각 단계가 단일탭에서 무회귀 검증 가능. P1 트리 스왑 시 미러 어댑터를 끄고 탭별 MemoryRouter 로 승격.

export type TabKind =
  | 'dashboard' | 'inbox' | 'talk' | 'task' | 'note' | 'docs' | 'calendar'
  | 'bill' | 'mail' | 'project' | 'projectDetail' | 'files' | 'clients' | 'info' | 'other';

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  path: string;          // 이 탭의 현재 location path+search (단일 원천, 직렬화 가능)
  alive: boolean;        // true=마운트 유지, false=suspend
  lastActiveAt: number;  // LRU
  indicator?: 'recording' | null; // Q Note 녹음 등 상태 dot (비영속)
}

interface TabState {
  tabs: Tab[];
  activeId: string | null;
  mirror: boolean;       // 미러 모드(트리 스왑 전 단일탭). true 면 openOrFocus 가 실제 네비를 위임.
}

const MAX_ALIVE = 4;
const OPEN_MAX = 10;   // 열린 탭 소프트캡 — 초과 시 최오래 비활성 탭 자동 close
const STORAGE_KEY = 'planq_tabs_v1';

// ── kind ↔ path 매핑 ──────────────────────────────────────────
// path prefix → kind (긴 것 우선). projectDetail 은 id별 복수 탭 허용.
const PREFIX_KIND: Array<[RegExp, TabKind]> = [
  [/^\/projects\/p\//, 'projectDetail'],
  [/^\/projects/, 'project'],
  [/^\/tasks/, 'task'],
  [/^\/talk/, 'talk'],
  [/^\/notes/, 'note'],
  [/^\/docs/, 'docs'],
  [/^\/calendar/, 'calendar'],
  [/^\/bills/, 'bill'],
  [/^\/mail/, 'mail'],
  [/^\/files/, 'files'],
  [/^\/business\/clients/, 'clients'], // 실 라우트(App.tsx). /^\/clients/ 보다 먼저 — other kind 흡수 방지
  [/^\/clients/, 'clients'],
  [/^\/info/, 'info'],
  [/^\/inbox/, 'inbox'],
  [/^\/dashboard/, 'dashboard'],
];

export function kindOfPath(path: string): TabKind {
  const p = (path || '/').split('?')[0];
  for (const [re, kind] of PREFIX_KIND) if (re.test(p)) return kind;
  return 'other';
}

// 탭 identity 키 — kind 기준 1개 원칙. projectDetail·docs 상세는 id별 복수 허용.
export function identityOfPath(path: string): string {
  const kind = kindOfPath(path);
  if (kind === 'projectDetail') {
    const m = path.match(/^\/projects\/p\/(\d+)/);
    return m ? `projectDetail:${m[1]}` : 'projectDetail';
  }
  return kind;
}

// 운영 #340 — "데스크탑앱이든 다른 앱이든 삭제했다 다시 열면 모든 탭이 그대로 열리게 할 수 있어?
//   마지막 있던 곳으로 바로 들어가고."
//
//   여태 탭 상태는 sessionStorage 에만 있었다 — **앱/브라우저를 닫는 순간 지워지는 저장소**다.
//   그래서 다시 열면 언제나 빈 탭이었다.
//
//   그렇다고 localStorage 로 통째로 옮기면 안 된다: localStorage 는 창끼리 공유되므로
//   PlanQ 를 두 창에 띄운 사람은 두 창이 서로의 탭 목록을 덮어써 싸운다.
//   → 이중 저장. 살아있는 상태는 창별(sessionStorage), **복원용 스냅샷만** 공유(localStorage).
//     새로 켠 창은 sessionStorage 가 비어 있으므로 그때만 스냅샷을 씨앗으로 쓴다.
const RESTORE_KEY = `${STORAGE_KEY}_restore`;

// ★ 2026-08-27 — 이 상수는 반드시 `let state = load()` **위**에 있어야 한다.
//   load() 는 함수 선언이라 호이스팅되지만 여기 const 는 TDZ 라, 아래에 두면 load() 안에서
//   RESTORE_KEY 를 읽는 순간 ReferenceError 가 나고 그 자리의 `catch {}` 가 그것을 삼킨다.
//   증상: 복원이 조용히 "없는 기능" 이 된다(운영: 앱을 다시 열면 언제나 확인 필요 한 탭).
//   실제로 그 상태로 배포돼 있었다(2026-08-27 실측 — 스냅샷은 저장돼 있는데 부팅 시 탭 0개).

// 복원 스냅샷(다른 창/지난 실행분)으로 부팅했는가 — 첫 경로 확정 때 한 번만 소비한다.
let bootRestorePending = false;

// 앱(PWA·홈화면·네이티브) 재실행인가 — 브라우저 주소창 진입과 구분한다.
//   앱은 언제나 manifest 의 start_url(=/inbox)로 뜨므로 그 경로는 "사용자가 가려던 곳" 이 아니다.
//   반면 브라우저에서 /inbox 를 직접 연 것은 명시 의도라 복원이 이겨선 안 된다.
function isAppRelaunch(): boolean {
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform?.()) return true;                       // Capacitor 네이티브 앱
    if ((window.navigator as unknown as { standalone?: boolean }).standalone === true) return true; // iOS 홈화면
    return window.matchMedia?.('(display-mode: standalone)').matches ?? false;  // 설치형 PWA(데스크탑 앱)
  } catch { return false; }
}

// manifest start_url + 루트 — 앱이 스스로 여는 기본 경로(사용자 의도 아님).
const RELAUNCH_DEFAULT = new Set(['/', '/inbox']);

// ── 외부 store 구현 ───────────────────────────────────────────
let state: TabState = load();
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }
function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
function getSnapshot(): TabState { return state; }


function persist() {
  const payload = JSON.stringify({ tabs: state.tabs, activeId: state.activeId });
  try { sessionStorage.setItem(STORAGE_KEY, payload); } catch { /* quota·비허용 무시 */ }
  // 복원 스냅샷 — 마지막으로 쓴 창의 것이 남는다(last-writer-wins). "지난번 그대로" 에는 충분하다.
  try { localStorage.setItem(RESTORE_KEY, payload); } catch { /* quota·비허용 무시 */ }
}
function load(): TabState {
  // ① 이 창의 살아있는 상태 (새로고침·같은 창 내 이동)
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const j = JSON.parse(raw);
      if (Array.isArray(j.tabs)) return { tabs: j.tabs, activeId: j.activeId ?? null, mirror: true };
    }
  } catch { /* 무시 */ }
  // ② 앱을 새로 켠 경우 — 지난번 스냅샷으로 복원한다(#340).
  //    alive 는 되살리지 않는다: 한 번에 전 탭을 마운트하면 첫 화면이 느려지고 LRU 도 즉시 터진다.
  //    활성 탭만 살아나고 나머지는 suspend 상태로 서 있다가 누르면 깨어난다(기존 LRU 동작 그대로).
  try {
    const raw = localStorage.getItem(RESTORE_KEY);
    if (raw) {
      const j = JSON.parse(raw);
      if (Array.isArray(j.tabs) && j.tabs.length) {
        const activeId = j.activeId ?? null;
        const tabs = j.tabs.map((tb: Tab) => ({ ...tb, alive: tb.id === activeId }));
        bootRestorePending = true;   // 첫 경로 확정 때 앱이 연 기본 경로로 덮이지 않게 (applyBootPath/seedFromPath)
        return { tabs, activeId, mirror: true };
      }
    }
  } catch { /* 무시 */ }
  return { tabs: [], activeId: null, mirror: true };
}

function set(next: Partial<TabState>) { state = { ...state, ...next }; persist(); emit(); }

// LRU — alive 탭이 MAX 초과면 가장 오래된 비활성 탭 suspend
function applyLru(tabs: Tab[], activeId: string | null): Tab[] {
  const alive = tabs.filter((t) => t.alive);
  if (alive.length <= MAX_ALIVE) return tabs;
  const victims = alive
    .filter((t) => t.id !== activeId)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
    .slice(0, alive.length - MAX_ALIVE);
  const vset = new Set(victims.map((t) => t.id));
  return tabs.map((t) => (vset.has(t.id) ? { ...t, alive: false } : t));
}

// ── 액션 ─────────────────────────────────────────────────────
let idSeq = 0;
function newId() { return `t${Date.now().toString(36)}_${(idSeq++).toString(36)}`; }

// 미러 모드에서 실제 네비를 위임할 콜백(트리 스왑 전 BrowserRouter 로 이동). setNavigator 로 주입.
// ★ 탭 전환이 끝날 때까지 location→store 역보고를 무시하기 위한 표식 (2026-08-25).
//   증상: "분명 문서가 열려 있었는데 그 탭을 누르면 다른 페이지로 바뀐다."
//   원인: setActive 는 activeId 를 먼저 바꾸고 navigate 를 건다. 그 사이에 라우터가 내는
//   중간 location(직전 화면의 경로·리다이렉트 결과)이 seedFromPath 로 들어와
//   **방금 활성화한 탭의 path 를 덮어썼다.** 사용자에겐 탭이 제멋대로 바뀐 것으로 보이고,
//   그 값이 저장까지 되므로 되돌아오지도 않는다.
//   해결: 전환 시 "이 탭이 가야 할 경로" 를 기억하고, 그 경로가 실제로 도착하기 전까지는
//   역보고를 받지 않는다. 사용자가 탭 안에서 직접 이동한 경우는 도착 이후이므로 정상 반영된다.
let pendingSwitch: { id: string; path: string } | null = null;
let navigateDelegate: ((path: string) => void) | null = null;
export function setTabNavigator(fn: ((path: string) => void) | null) { navigateDelegate = fn; }

// 트리 스왑 후 각 탭 pane 의 MemoryRouter navigate 통로 (mirror 모드에선 navigateDelegate 우선).
const paneNavigators = new Map<string, (path: string) => void>();

// path 에서 대화 id 파싱 (/talk/123 또는 ?conv=123). Toaster 단일 소스.
function convIdOfPath(path: string): number | null {
  const m = path.match(/^\/talk\/(\d+)/) || path.match(/[?&]conv=(\d+)/);
  return m ? Number(m[1]) : null;
}

export const tabStore = {
  subscribe,
  getSnapshot,

  // 브라우저 탭 모델 — 현재(활성) 탭의 경로를 바꾼다(안으로 들어가도 새 탭 X). 사이드바/본문 링크 내비.
  navigateActive(path: string) {
    if (state.mirror) { if (navigateDelegate) navigateDelegate(path); return; } // location→seedFromPath 가 store 갱신
    const id = state.activeId;
    if (id) { this.setTabPath(id, path); const nav = paneNavigators.get(id); if (nav) nav(path); }
    else this.newTab(path);
  },

  // 새 탭 — 같은 페이지도 중복 허용. '+' / 새탭 드롭다운. OPEN_MAX 초과면 최오래 비활성 탭 close.
  newTab(path = '/dashboard') {
    const now = Date.now();
    let tabs = state.tabs;
    if (tabs.length >= OPEN_MAX) {
      const victim = [...tabs].filter((t) => t.id !== state.activeId).sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0];
      if (victim) tabs = tabs.filter((t) => t.id !== victim.id);
    }
    const id = newId();
    tabs = [...tabs, { id, kind: kindOfPath(path), title: '', path, alive: true, lastActiveAt: now }];
    set({ tabs: applyLru(tabs, id), activeId: id });
    if (state.mirror && navigateDelegate) navigateDelegate(path);
  },

  // 부팅 경로 확정 (탭 모드 ModeGate 단일 착지점).
  //   explicit=true 는 알림/공유 딥링크 — 언제나 그 경로가 이긴다.
  //   그 밖에 "복원으로 시작 + 앱이 연 기본 경로(start_url)" 면 마지막 위치를 유지한다.
  applyBootPath(path: string, opts?: { explicit?: boolean }) {
    const restored = bootRestorePending;
    bootRestorePending = false;
    const act = activeTab(state);
    if (!act) { this.newTab(path || '/dashboard'); return; }
    // 앱(PWA·네이티브)이 스스로 연 기본 경로일 때만 마지막 위치가 이긴다.
    //   브라우저에서 /inbox 를 직접 연 것은 사용자의 명시 의도라 복원이 이겨선 안 된다(음성 대조군).
    if (!opts?.explicit && restored && RELAUNCH_DEFAULT.has((path || '/').split('?')[0]) && isAppRelaunch()) {
      if (state.mirror && navigateDelegate) navigateDelegate(act.path);  // 주소를 마지막 위치로
      return;
    }
    // 같은 종류의 탭이 이미 있으면 그 탭을 그 경로로 (탭이 실행 때마다 쌓이지 않게)
    const owner = state.tabs.find((t) => identityOfPath(t.path) === identityOfPath(path));
    if (!owner) { this.newTab(path); return; }
    this.setTabPath(owner.id, path);
    this.setActive(owner.id);
    const nav = paneNavigators.get(owner.id);
    if (nav) nav(path);
  },

  setActive(id: string) {
    const now = Date.now();
    const tabs = state.tabs.map((t) => (t.id === id ? { ...t, alive: true, lastActiveAt: now } : t));
    set({ tabs: applyLru(tabs, id), activeId: id });
    const t = state.tabs.find((x) => x.id === id);
    if (t) pendingSwitch = { id, path: t.path };
    if (state.mirror && navigateDelegate && t) navigateDelegate(t.path);
  },

  closeTab(id: string) {
    const idx = state.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tabs = state.tabs.filter((t) => t.id !== id);
    let activeId = state.activeId;
    if (activeId === id) {
      const next = tabs[idx] || tabs[idx - 1] || tabs[tabs.length - 1] || null;
      activeId = next ? next.id : null;
      if (next) pendingSwitch = { id: next.id, path: next.path };   // 전환과 같은 이유로 역보고 보류
      if (next && state.mirror && navigateDelegate) navigateDelegate(next.path);
    }
    set({ tabs, activeId });
  },

  // 탭 내부 네비 역보고 (UrlMirror) — 활성 탭 path 갱신. 미러 모드에선 location 변화가 이걸 부른다.
  setTabPath(id: string, path: string) {
    if (!state.tabs.some((t) => t.id === id && t.path !== path)) return;
    // 탭 제목("그 탭이 담고 있는 것")은 **경로가 다른 메뉴로 바뀔 때** 비운다.
    //   옛 구현은 useTabTitle 의 언마운트 cleanup 이 했는데, 탭 LRU 정지(alive:false)에서도
    //   똑같이 발화해 멀쩡한 탭 이름이 메뉴명으로 되돌아갔다. 정지는 이탈이 아니다.
    //   같은 화면 안의 이동(/docs → /docs?post=5)은 kind 가 같으므로 유지 — 깜빡임 방지.
    //   비운 뒤엔 새 화면이 자기 제목을 다시 쓴다. 안 쓰는 화면이면 메뉴명이 맞다.
    set({
      tabs: state.tabs.map((t) => {
        if (t.id !== id) return t;
        const nextKind = kindOfPath(path);
        return { ...t, path, kind: nextKind, title: nextKind === t.kind ? t.title : '' };
      }),
    });
  },

  setTabTitle(id: string, title: string) {
    if (!state.tabs.some((t) => t.id === id && t.title !== title)) return;
    set({ tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)) });
  },

  setMirror(on: boolean) { set({ mirror: on }); },

  // 탭 순서 이동 (드래그 정렬)
  moveTab(id: string, toIndex: number) {
    const from = state.tabs.findIndex((t) => t.id === id);
    if (from < 0) return;
    const arr = [...state.tabs];
    const [m] = arr.splice(from, 1);
    arr.splice(Math.max(0, Math.min(toIndex, arr.length)), 0, m);
    set({ tabs: arr });
  },

  // 상태 dot (녹음 등) — 비영속
  setTabIndicator(id: string, ind: 'recording' | null) {
    if (!state.tabs.some((t) => t.id === id && (t.indicator ?? null) !== ind)) return;
    set({ tabs: state.tabs.map((t) => (t.id === id ? { ...t, indicator: ind } : t)) });
  },

  // 트리 스왑 후 pane navigator 등록/해제
  registerPaneNavigator(id: string, fn: (path: string) => void) { paneNavigators.set(id, fn); },
  unregisterPaneNavigator(id: string) { paneNavigators.delete(id); },

  // Toaster 단일 소스 — 열린 대화들 / 활성 탭이 보고 있는 대화
  getOpenConversationIds(): Set<number> {
    const s = new Set<number>();
    for (const t of state.tabs) { const c = convIdOfPath(t.path); if (c != null) s.add(c); }
    return s;
  },
  getActiveConversationId(): number | null {
    const t = activeTab(state);
    return t ? convIdOfPath(t.path) : null;
  },

  // 미러 모드 location→store 단일 소스 — 활성 탭 path 갱신(없으면 생성). dedup 안 함(브라우저 탭 모델:
  //   탭 안에서 더 깊이 들어가면 새 탭 만들지 않고 그 탭의 경로만 바뀐다).
  seedFromPath(path: string) {
    const now = Date.now();
    const act = state.activeId ? state.tabs.find((t) => t.id === state.activeId) : null;
    // 부팅 1회 — 복원 스냅샷으로 시작한 뒤의 첫 location 은 "사용자의 이동" 이 아니라 "앱이 연 경로" 다.
    //   판정을 applyBootPath 단일 착지점에 위임한다(여기서 갈라 놓으면 두 벌이 되어 어긋난다).
    //   앱이 연 start_url 이면 마지막 위치 유지, 딥링크면 그 경로를 탭으로 연다 — 어느 쪽이든
    //   **복원된 활성 탭의 경로를 덮어쓰지 않는다**(옛 동작: 딥링크 부팅이 복원 탭을 잡아먹었다).
    if (bootRestorePending) { this.applyBootPath(path); return; }
    // 전환 대기 중 — 목표 경로에 도착하기 전의 중간 location 은 무시한다(위 pendingSwitch 주석).
    if (pendingSwitch) {
      if (pendingSwitch.id !== state.activeId) pendingSwitch = null;       // 그 사이 또 바뀌었다면 표식 폐기
      else if (path === pendingSwitch.path) { pendingSwitch = null; return; }  // 도착 — 값은 이미 같다
      else return;                                                         // 아직 도착 전 — 덮어쓰지 않는다
    }
    if (act) {
      if (act.path === path) return;
      set({ tabs: state.tabs.map((t) => (t.id === act.id ? { ...t, path, kind: kindOfPath(path), lastActiveAt: now } : t)) });
    } else {
      const id = newId();
      set({ tabs: [...state.tabs, { id, kind: kindOfPath(path), title: '', path, alive: true, lastActiveAt: now }], activeId: id });
    }
  },
};

// 활성 탭 (없으면 null)
export function activeTab(s: TabState): Tab | null {
  return s.activeId ? s.tabs.find((t) => t.id === s.activeId) || null : null;
}

// e2e/spike 테스트 훅 — spike 플래그 시에만 window 에 store 노출(tabs 스위트가 조작·검증). 운영 무영향.
if (typeof window !== 'undefined') {
  try {
    if (localStorage.getItem('planq_tabs_spike') === '1') {
      (window as unknown as { __pqTab?: typeof tabStore }).__pqTab = tabStore;
    }
  } catch { /* noop */ }
}
