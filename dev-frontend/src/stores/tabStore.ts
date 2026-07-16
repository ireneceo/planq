// stores/tabStore.ts — ⑥ 멀티탭 TabStore (탭 상태 단일 원천)
//
// 설계: docs/MULTITAB_DESIGN.md §4. 전역 상태 라이브러리 미도입 원칙 유지 —
//   순수 외부 store + useSyncExternalStore(구독). Context 재렌더 폭발 회피.
//
// strangler(Fable 권장): 트리 스왑 전까지 store 는 "미러 모드"로 동작 — 현재 단일 BrowserRouter 의
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
  [/^\/business\/clients/, 'clients'], // 실 라우트(App.tsx). /^\/clients/ 보다 먼저 — 'other' 흡수 방지
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

// ── 외부 store 구현 ───────────────────────────────────────────
let state: TabState = load();
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }
function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
function getSnapshot(): TabState { return state; }

function persist() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs: state.tabs, activeId: state.activeId })); } catch { /* quota·비허용 무시 */ }
}
function load(): TabState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const j = JSON.parse(raw);
      if (Array.isArray(j.tabs)) return { tabs: j.tabs, activeId: j.activeId ?? null, mirror: true };
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

  setActive(id: string) {
    const now = Date.now();
    const tabs = state.tabs.map((t) => (t.id === id ? { ...t, alive: true, lastActiveAt: now } : t));
    set({ tabs: applyLru(tabs, id), activeId: id });
    const t = state.tabs.find((x) => x.id === id);
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
      if (next && state.mirror && navigateDelegate) navigateDelegate(next.path);
    }
    set({ tabs, activeId });
  },

  // 탭 내부 네비 역보고 (UrlMirror) — 활성 탭 path 갱신. 미러 모드에선 location 변화가 이걸 부른다.
  setTabPath(id: string, path: string) {
    if (!state.tabs.some((t) => t.id === id && t.path !== path)) return;
    set({ tabs: state.tabs.map((t) => (t.id === id ? { ...t, path, kind: kindOfPath(path) } : t)) });
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
