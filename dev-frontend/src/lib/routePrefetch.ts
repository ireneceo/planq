// 라우트 청크 prefetch — lazy() 로 분리된 페이지 모듈을 미리 받아 페이지 이동 지연 최소화.
//
// 동작:
//   - 같은 path 의 dynamic import 는 Vite 가 module promise 단위로 캐시함.
//   - lazy(() => import(X)) 가 처음 트리거되거나, 여기서 prefetch 가 먼저 호출되면 그 promise 가 캐시됨.
//   - 둘 다 동일 import path 면 어느 쪽이 먼저 든 module 다운로드는 한 번만.
//
// 트리거 시점:
//   1) 앱 mount idle 시 — 핵심 페이지 (대시보드/Q Talk/Q Task/Q Calendar/Q Note)
//   2) 사용자가 메뉴/링크 hover 또는 focus — 모든 internal link 자동 (전역 mouseover delegation)

const ROUTE_PREFETCH: Record<string, () => Promise<unknown>> = {
  '/dashboard': () => import('../pages/Dashboard/DashboardPage'),
  '/inbox': () => import('../pages/Todo/TodoPage'),
  '/todo': () => import('../pages/Todo/TodoPage'),
  '/talk': () => import('../pages/QTalk/QTalkPage'),
  '/tasks': () => import('../pages/QTask/QTaskPage'),
  '/projects': () => import('../pages/QProject/QProjectPage'),
  '/calendar': () => import('../pages/QCalendar/QCalendarPage'),
  '/notes': () => import('../pages/QNote/QNotePage'),
  '/docs': () => import('../pages/QDocs/QDocsPage'),
  '/info': () => import('../pages/Knowledge/KnowledgePage'),
  '/knowledge': () => import('../pages/Knowledge/KnowledgePage'),
  '/files': () => import('../pages/QFile/QFilePage'),
  '/bills': () => import('../pages/QBill/QBillPage'),
  '/personal-vault': () => import('../pages/PersonalVault/PersonalVaultPage'),
  '/insights': () => import('../pages/Insights/InsightsPage'),
  '/profile': () => import('../pages/Profile/ProfilePage'),
  // 경로가 아닌 큰 조각 — 링크로는 안 걸리고 idle 순서에만 쓴다(@ 로 시작)
  '@task-drawer': () => import('../components/QTask/TaskDetailDrawer'),
};

// 이미 한 번이라도 prefetch 시도한 path — 동일 hover 반복 시 모듈 promise 재호출 비용 절감.
const fetched = new Set<string>();

function normalize(path: string): string {
  // 쿼리/해시 제거 + 첫 segment 만 매칭 (예: /tasks?week=1 → /tasks, /docs/123 → /docs)
  const noQuery = path.split('?')[0].split('#')[0];
  if (ROUTE_PREFETCH[noQuery]) return noQuery;
  const seg = '/' + noQuery.split('/').filter(Boolean)[0];
  return ROUTE_PREFETCH[seg] ? seg : '';
}

export function prefetchRoute(path: string): void {
  const key = normalize(path);
  if (!key || fetched.has(key)) return;
  fetched.add(key);
  ROUTE_PREFETCH[key]?.().catch(() => {
    // 청크 다운로드 실패 — 실제 진입 시 ErrorBoundary 의 chunk reload 흐름으로 처리됨
    fetched.delete(key);
  });
}

// 앱 mount 시 한 번 호출 — 첫 화면이 자리 잡은 뒤 핵심 페이지를 **하나씩** prefetch + 전역 hover/focus/누름 listener 등록.
// 반환값은 cleanup 함수 (StrictMode 더블 실행 안전).
//
// ★ 2026-11-02 (Irene «태블릿이랑 모바일앱에서 처음 열릴 때 너무 느리고 … 좌측메뉴 클릭할 때 제대로 안되고 여러 번 눌러도»)
//   옛 동작: idle 한 번에 5개 페이지(대시보드·Q talk·Q task·캘린더·Q note)를 **한꺼번에** import.
//   iOS Safari·아이폰/아이패드 앱(WKWebView)에는 requestIdleCallback 이 없어 **mount 2초 뒤 setTimeout** 으로 떨어졌고,
//   그 순간 편집기·차트·코드 강조까지 약 2.5MB 를 한 번에 해석해 메인 스레드가 0.9~1.0초 통째로 막혔다
//   (CPU ×4 실측 — 첫 화면이 막 뜬 뒤 사용자가 메뉴를 누르기 시작하는 바로 그때).
//   새 동작: ①첫 화면이 뜬 뒤 3초 기다림 ②한 번에 하나, 앞 것이 끝나고 쉼을 둔 뒤 다음 것
//   ③사용자가 최근 1.5초 안에 화면을 만졌으면 미룬다(누르는 동안 해석하지 않는다)
//   ④메뉴를 **누르는 순간**(pointerdown) 그 페이지를 먼저 받기 시작한다 — 터치 기기에는 hover 가 없다.
export function installRoutePrefetch(): () => void {
  // 업무 상세 패널을 맨 앞에 — 확인필요·업무·캘린더가 다 쓰는데 이제 열 때 받는다(첫 화면에서 뺐다)
  const idleTargets = ['@task-drawer', '/dashboard', '/talk', '/tasks', '/calendar', '/notes'];
  type RIC = (cb: () => void, opts?: { timeout?: number }) => number;
  const ricFn = (window as unknown as { requestIdleCallback?: RIC }).requestIdleCallback;
  let stopped = false;
  let timer: number | undefined;
  let lastInput = 0;

  const later = (fn: () => void, ms: number) => {
    timer = window.setTimeout(() => {
      if (stopped) return;
      // 브라우저가 쉬는 틈을 알려주면 그때, 아니면(iOS) 그냥 지금
      if (ricFn) ricFn(() => { if (!stopped) fn(); }, { timeout: 3000 });
      else fn();
    }, ms);
  };
  const next = (i: number) => {
    if (stopped || i >= idleTargets.length) return;
    const idleFor = Date.now() - lastInput;
    if (idleFor < 1500) { later(() => next(i), 1500 - idleFor + 200); return; }
    const key = normalize(idleTargets[i]);
    if (!key || fetched.has(key)) { next(i + 1); return; }
    fetched.add(key);
    const p = ROUTE_PREFETCH[key]?.();
    const go = () => later(() => next(i + 1), 800);
    if (p) p.then(go, () => { fetched.delete(key); go(); }); else go();
  };
  // 첫 것(업무 상세)은 첫 화면이 뜬 직후 — 확인필요에서 뺀 조각이라 늦으면 첫 메뉴 누름(Q task)이 그것을 기다린다
  //   (A/B 실측: 3초 뒤로 두었더니 첫 Q task 누름 0.29~0.39 → 0.41~0.80초). 나머지는 앞 것이 끝난 뒤 하나씩.
  const begin = () => later(() => next(0), 600);
  if (document.readyState === 'complete') begin();
  else window.addEventListener('load', begin, { once: true });

  // 전역 hover/focus/누름 delegation — 모든 internal link 에 자동 적용
  const handler = (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (!target || !target.closest) return;
    const link = target.closest('a[href]') as HTMLAnchorElement | null;
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (href.startsWith('/') && !href.startsWith('//')) prefetchRoute(href);
  };
  const onDown = (e: Event) => { lastInput = Date.now(); handler(e); };
  document.addEventListener('mouseover', handler, { passive: true, capture: true });
  document.addEventListener('focusin', handler, { passive: true, capture: true });
  document.addEventListener('pointerdown', onDown, { passive: true, capture: true });

  return () => {
    stopped = true;
    if (timer !== undefined) window.clearTimeout(timer);
    window.removeEventListener('load', begin);
    document.removeEventListener('mouseover', handler, true);
    document.removeEventListener('focusin', handler, true);
    document.removeEventListener('pointerdown', onDown, true);
  };
}
