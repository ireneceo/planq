/**
 * 공개 표면(public surface) 판정 — 비로그인 방문자에게 노출되는 경로.
 *
 * 설계: docs/qa/GUEST_QUICKMENU_WIKI_DESIGN.md
 *
 * 여기 해당하는 경로에서는
 *   - 워크스페이스 chrome(RightDock·Toaster·공지배너·MemoFab·TabMirror) 전부 숨김 (#71)
 *   - Q helper 드로어만 예외로 마운트하되 게스트 프레젠테이션(도움말+문의 2탭)
 * 로 동작한다. 로그인 사용자가 방문해도 같다 — 표면이 기준이지 로그인 여부가 기준이 아니다.
 *
 * App.tsx 의 isMarketing 목록이 원본이었고, 도움말이 빠져 있어 회원이 도움말에서
 * 워크스페이스 런처를 보던 회귀가 있었다. 그래서 단일 진실 원천으로 분리한다.
 * 새 공개 페이지를 추가하면 여기만 갱신하면 된다.
 */

/** 정확히 일치해야 하는 마케팅 경로 */
//   ★ '/service' 는 2026-10-02 에 들어왔다 — 빠져 있어 로그인 데스크탑이 서비스 페이지에서 워크스페이스 크롬을 볼 수 있었다.
//     그 아래 무료 자가진단(#426)도 공개다.
//   ★ '/security' 는 2026-10-23(보안·데이터 정책) — 빠지면 로그인 사용자가 열 때 워크스페이스 탭 셸이 가로채 빈 화면이 된다.
const EXACT = ['/', '/en', '/features', '/details', '/security', '/start', '/pricing', '/insights', '/blog', '/about', '/contact', '/service', '/service/diagnosis'];

/** 하위 경로까지 포함하는 prefix */
//   ★ '/g/' — #259 무로그인 게스트 링크. 고객이 카톡·메일로 받은 링크로 들어오는 자리라
//     워크스페이스 chrome 이 하나라도 뜨면 "남의 회사 도구" 로 보인다.
//   ★ '/wiki/' 는 2026-09-25 개명 전 주소다. 리다이렉트 전용으로 남아 있지만 여기서 빠지면
//     게스트가 옛 링크로 들어온 **그 순간** 워크스페이스 크롬이 번쩍인다.
// '/en/' — 영어 공개 페이지(2026-10-04). 로그인 데스크탑에서도 워크스페이스 크롬 없이 랜딩으로.
const PREFIX = ['/insights/', '/blog/', '/guide/', '/wiki/', '/g/', '/en/'];

export function isPublicSurfacePath(pathname: string): boolean {
  // ★ 끝 슬래시를 벗겨 비교한다(2026-10-02 Fable 실측). 공개 페이지는 SEO 생성 디렉터리라 nginx 가
  //   `/service/diagnosis` → 301 `/service/diagnosis/` 로 보낸다. 그대로 비교하면 EXACT 에 걸리지 않아
  //   로그인 데스크탑에서 `/about/`·`/pricing/`·`/service/` 까지 워크스페이스 셸로 떴다(PREFIX 인 /insights/ 만 멀쩡했다).
  const p = pathname.replace(/\/+$/, '') || '/';
  if (EXACT.includes(p)) return true;
  // '/guide' 자체(목록) + '/guide/a/:slug'. pathname 에는 query 가 없으므로
  // '/guide?category=' 는 '/guide' 로 들어온다. '/guidebook' 같은 오탐은 prefix 에 '/' 를 붙여 차단.
  if (p === '/guide') return true;
  if (p === '/wiki') return true;   // 옛 주소 — 위 주석
  return PREFIX.some((p) => pathname.startsWith(p));
}

/**
 * 링크로 여는 «웹 보기» 화면 — 공유 링크(`/public/…`)와 서명 화면(`/sign/…`).
 * 받은 사람이 링크 하나로 보는 단독 화면이라 **앱 크롬을 하나도 띄우지 않는다**(도크·메모·토스터·공지·Q helper 버튼까지).
 * 로그인 여부와 무관하다 — 로그인한 우리 쪽 서명자가 열어도 같은 화면이어야 한다.
 * ★ `/sign/` 이 이 판정에 빠져 있어 서명 화면에만 우측 하단 Q helper(채팅 모양) 버튼이 떴고, 로그인 상태면
 *   도크·메모 단추까지 붙었다(2026-10-12 Irene: «서명하기 페이지는 웹으로 보기처럼 … 우측하단 채팅버튼 없고»).
 */
// ★ '/c/' — 내 명함 공개 페이지(2026-10-17). 받는 사람은 대개 비회원이고, 로그인한 회원이 열어도 같은 단독 화면이다.
export function isPublicViewPath(pathname: string): boolean {
  return pathname.startsWith('/public/') || pathname.startsWith('/sign/') || pathname.startsWith('/c/');
}
