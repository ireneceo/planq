// utils/openOwnLink.ts — 앱 안에서 누른 **우리 공유 링크**(/public/{종류}/:token)를 여는 문 하나 (2026-09-27).
//
// Irene: *"웹페이지 열릴 때 데스크탑앱에서 우리 앱이랑 같은 크기에 같은 스타일로 열리는데 … 같은게 두개
//         열리는 것처럼 열리고 또 나는 작게 보고 있어서 웹페이지가 작게 열려. 불편하게."*
//
// 원인은 창 크기가 아니다(Fable 판단). 설치한 앱(PWA)은 scope 가 '/' 라 planq.kr 링크를 **앱 창을 하나 더**
//   열어 보여주고, 그 창의 크기는 지금 창을 따라간다. 그런데 링크를 누른 사람이 팀원이면 그 공유 페이지는
//   결국 같은 상세를 가리킨다 — 같은 것을 창 두 개로 보는 셈이다.
//   → 볼 수 있는 사람이면 **앱 안 새 탭**으로 그 상세를 연다(«하던 일 위에 얹히는 진입점은 새 탭» 규칙).
//   → 못 보는 사람(또는 판정할 수 없는 종류)이면 공유 페이지를 연다. 설치한 앱에서는 **기본 크기 창**으로.
// 매니페스트로는 못 푼다 — scope 는 접두어라 /public/ 만 뺄 수 없다.
import { apiFetch, getAccessToken } from '../contexts/AuthContext';
import { tabStore } from '../stores/tabStore';
import { isStandalonePWA } from '../services/push';

// 공개 경로 종류 → «이 사람이 앱에서 직접 볼 수 있나» 를 묻는 서버 주소. 판정은 각 라우트의 auth-check 한 곳.
const AUTH_CHECK: Record<string, (token: string) => string> = {
  tasks: (t) => `/api/tasks/public/by-token/${t}/auth-check`,
  files: (t) => `/api/files/public/by-token/${t}/auth-check`,
  posts: (t) => `/api/posts/public/${t}/auth-check`,
  invoices: (t) => `/api/invoices/public/${t}/auth-check`,
  calendar: (t) => `/api/calendar-events/public/by-token/${t}/auth-check`,
  kb: (t) => `/api/kb-documents/public/by-token/${t}/auth-check`,
};
const PUBLIC_RE = /^\/public\/([a-z-]+)\/([A-Za-z0-9_-]+)\/?$/;

/** 우리 오리진의 공개 공유 링크인가 — 맞으면 { kind, token }. */
export function parseOwnPublicLink(href: string): { kind: string; token: string } | null {
  try {
    const u = new URL(href, window.location.href);
    if (u.origin !== window.location.origin) return null;
    const m = PUBLIC_RE.exec(u.pathname);
    return m ? { kind: m[1], token: m[2] } : null;
  } catch { return null; }
}

function openPublicPage(href: string): void {
  if (isStandalonePWA()) {
    // 설치한 앱 — 팝업 크기를 주면 지금 창 크기를 복제하지 않는다.
    const w = Math.min(1100, window.screen.availWidth || 1100);
    const h = Math.min(800, window.screen.availHeight || 800);
    const win = window.open(href, 'pq-share', `popup=1,width=${w},height=${h}`);
    if (win) return;
  }
  window.open(href, '_blank');   // ★ noopener 를 붙이면 반환값이 늘 null 이라 실패 판정을 못 한다
}

/**
 * 링크 클릭 처리. 우리 공유 링크면 기본 동작을 막고 여기서 연다. 아니면 아무것도 안 한다(false).
 * @returns 처리했으면 true
 */
export function handleOwnLinkClick(e: { preventDefault: () => void }, href: string): boolean {
  const own = parseOwnPublicLink(href);
  if (!own) return false;
  e.preventDefault();
  const check = AUTH_CHECK[own.kind];
  if (!check || !getAccessToken()) { openPublicPage(href); return true; }
  void (async () => {
    try {
      const r = await apiFetch(check(own.token));
      const j = await r.json();
      if (j?.success && j.data?.canAccess && typeof j.data.appUrl === 'string' && j.data.appUrl.startsWith('/')) {
        tabStore.openInNewTab(j.data.appUrl);
        return;
      }
    } catch { /* 판정 실패 — 공유 페이지로 */ }
    openPublicPage(href);
  })();
  return true;
}
