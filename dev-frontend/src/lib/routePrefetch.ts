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
  '/clients': () => import('../pages/Clients/ClientsPage'),
  '/profile': () => import('../pages/Profile/ProfilePage'),
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

// 앱 mount 시 한 번 호출 — idle 시점에 핵심 페이지 prefetch + 전역 hover/focus listener 등록.
// 반환값은 cleanup 함수 (StrictMode 더블 실행 안전).
export function installRoutePrefetch(): () => void {
  // 1) idle 시점에 핵심 페이지 prefetch
  const idleTargets = ['/dashboard', '/talk', '/tasks', '/calendar', '/notes'];
  type RIC = (cb: () => void, opts?: { timeout?: number }) => number;
  type CIC = (id: number) => void;
  const ricFn = (window as unknown as { requestIdleCallback?: RIC }).requestIdleCallback;
  const cicFn = (window as unknown as { cancelIdleCallback?: CIC }).cancelIdleCallback;
  const ric: RIC = ricFn || ((cb) => window.setTimeout(cb, 2000) as unknown as number);
  const cic: CIC = cicFn || ((id) => window.clearTimeout(id));
  const idleId = ric(() => { for (const p of idleTargets) prefetchRoute(p); }, { timeout: 5000 });

  // 2) 전역 hover/focus delegation — 모든 internal link 에 자동 적용
  const handler = (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (!target || !target.closest) return;
    const link = target.closest('a[href]') as HTMLAnchorElement | null;
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (href.startsWith('/') && !href.startsWith('//')) prefetchRoute(href);
  };
  document.addEventListener('mouseover', handler, { passive: true, capture: true });
  document.addEventListener('focusin', handler, { passive: true, capture: true });

  return () => {
    try { cic(idleId); } catch { /* noop */ }
    document.removeEventListener('mouseover', handler, true);
    document.removeEventListener('focusin', handler, true);
  };
}
