/**
 * 공개 표면(public surface) 판정 — 비로그인 방문자에게 노출되는 경로.
 *
 * 설계: docs/qa/GUEST_QUICKMENU_WIKI_DESIGN.md
 *
 * 여기 해당하는 경로에서는
 *   - 워크스페이스 chrome(RightDock·Toaster·공지배너·MemoFab·TabMirror) 전부 숨김 (#71)
 *   - Q helper 드로어만 예외로 마운트하되 게스트 프레젠테이션(Q위키+문의 2탭)
 * 로 동작한다. 로그인 사용자가 방문해도 같다 — 표면이 기준이지 로그인 여부가 기준이 아니다.
 *
 * App.tsx 의 isMarketing 목록이 원본이었고, /wiki 가 빠져 있어 회원이 위키에서
 * 워크스페이스 런처를 보던 회귀가 있었다. 그래서 단일 진실 원천으로 분리한다.
 * 새 공개 페이지를 추가하면 여기만 갱신하면 된다.
 */

/** 정확히 일치해야 하는 마케팅 경로 */
const EXACT = ['/', '/features', '/pricing', '/insights', '/blog', '/about', '/contact'];

/** 하위 경로까지 포함하는 prefix */
const PREFIX = ['/insights/', '/blog/', '/wiki/'];

export function isPublicSurfacePath(pathname: string): boolean {
  if (EXACT.includes(pathname)) return true;
  // '/wiki' 자체(목록) + '/wiki/a/:slug'. pathname 에는 query 가 없으므로
  // '/wiki?category=' 는 '/wiki' 로 들어온다. '/wikipedia' 같은 오탐은 prefix 에 '/' 를 붙여 차단.
  if (pathname === '/wiki') return true;
  return PREFIX.some((p) => pathname.startsWith(p));
}
