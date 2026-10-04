// 앱(iOS·Android WebView) 안의 «새 창» 링크를 앱 안으로 돌린다 — 단일 지점 (2026-10-04).
//
// Irene: *"좌측 메뉴 Cue, 팝아웃 Q helper 가 링크가 웹으로 날라가. 아이패드 앱에서 했는데 …
//         앱에서 누르면 앱 안에서 되어야지."*
// Capacitor WebView 는 window.open · <a target="_blank"> 를 **시스템 브라우저(사파리/크롬)** 로 보낸다.
// 화면마다 분기를 넣으면 반드시 하나가 빠지므로(새 창 링크가 수십 곳이다) 앱 안에서는 여기서 한 번에 가로챈다.
//   · 우리 주소   → 앱 안(탭 모드면 새 탭, 아니면 이동). 팝아웃 전용 주소는 앱 안 대응 화면으로 바꾼다.
//   · 바깥 주소   → 인앱 브라우저(@capacitor/browser) — 앱을 떠나지 않고 닫으면 돌아온다.
//   · mailto/tel/blob/data · download 속성 링크 → 건드리지 않는다(OS·다운로드 흐름이 맡는다).
// 웹(브라우저·PWA)에서는 설치하지 않는다 — 웹의 새 창 동작은 그대로다.
import { tabStore } from '../stores/tabStore';

/** 팝아웃 전용 주소 → 앱 안에서 여는 방법. null 이면 그대로 그 경로로 간다. */
function inAppTarget(path: string): { tool: 'qhelper' | 'qnote' } | { path: string } {
  const [pathname, search = ''] = path.split('?');
  const sp = new URLSearchParams(search);
  if (pathname === '/help-popout') return { tool: 'qhelper' };
  if (pathname === '/note-popout') return { tool: 'qnote' };
  if (pathname === '/task-popout') return { path: '/tasks' };
  if (pathname === '/talk-popout') return { path: sp.get('conv') ? `/talk?conv=${encodeURIComponent(sp.get('conv') as string)}` : '/talk' };
  const memo = /^\/memo\/([^/]+)$/.exec(pathname);
  if (memo) return { path: `/notes/${memo[1]}` };
  return { path };
}

/** 같은 출처면 앱 안 경로("/x?y#z"), 아니면 null */
function sameOriginPath(raw: string): string | null {
  try {
    const u = new URL(raw, window.location.href);
    if (u.origin !== window.location.origin) return null;
    return u.pathname + u.search + u.hash;
  } catch { return null; }
}

export function openInsideApp(path: string): void {
  const t = inAppTarget(path);
  if ('tool' in t) { window.dispatchEvent(new CustomEvent('planq:open-tool', { detail: { tool: t.tool } })); return; }
  tabStore.openInNewTab(t.path);
}

// 가로채기 전의 window.open — 인앱 브라우저가 실패하면 예전 동작(시스템 브라우저)으로 돌아간다.
//   ★ location.href 로 대신하지 않는다 — 그러면 앱 화면 자체가 PDF·API 주소로 넘어가 돌아올 길이 없다.
let nativeOpen: typeof window.open | null = null;

async function openOutside(url: string): Promise<void> {
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } catch (e) {
    console.warn('[nativeLinks] in-app browser failed, falling back', e);
    try { (nativeOpen || window.open)(url, '_blank'); } catch { /* 열 수 없음 — 앱 화면은 그대로 둔다 */ }
  }
}

/** 처리했으면 true. 우리가 맡지 않는 스킴이면 false(원래 동작으로 둔다). */
function route(raw: string): boolean {
  if (!raw) return false;
  if (/^(mailto:|tel:|sms:|blob:|data:|javascript:)/i.test(raw)) return false;
  const path = sameOriginPath(raw);
  // 우리 주소라도 화면이 아닌 것(/api/ PDF·첨부, /uploads/ 파일)은 SPA 탭으로 열면 빈 탭이 된다 — 인앱 브라우저로 연다
  //   (딥링크 쪽 NativeBridge 도 /api/ 를 같은 이유로 거른다)
  if (path !== null && /^\/(api|uploads)\//.test(path)) { void openOutside(new URL(path, window.location.origin).href); return true; }
  if (path !== null) { openInsideApp(path); return true; }
  if (/^https?:\/\//i.test(raw)) { void openOutside(raw); return true; }
  return false;
}

// NativeBridge 는 두 렌더 트리(App · ChromeOverlays)에 하나씩 뜬다 — 참조 수로 한 번만 설치·마지막에 해제.
let refs = 0;
let teardown: (() => void) | null = null;
/** NativeBridge 가 앱 안에서만 부른다. 해제 함수를 돌려준다. */
export function installNativeLinkRouting(): () => void {
  refs += 1;
  if (refs === 1) teardown = install();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    refs -= 1;
    if (refs === 0 && teardown) { teardown(); teardown = null; }
  };
}

function install(): () => void {
  const origOpen = window.open.bind(window);
  nativeOpen = origOpen;
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const raw = url == null ? '' : String(url);
    if (route(raw)) return null;
    return origOpen(url as string, target, features);
  }) as typeof window.open;

  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.hasAttribute('download')) return;
    const href = a.getAttribute('href') || '';
    const external = sameOriginPath(href) === null;
    // 같은 창 이동인 우리 링크는 라우터가 처리한다 — 새 창(_blank)이거나 바깥 주소일 때만 가로챈다
    if (a.target !== '_blank' && !external) return;
    if (route(a.href)) e.preventDefault();
  };
  document.addEventListener('click', onClick, true);
  return () => {
    window.open = origOpen as typeof window.open;
    nativeOpen = null;
    document.removeEventListener('click', onClick, true);
  };
}
