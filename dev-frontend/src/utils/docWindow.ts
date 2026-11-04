// 문서를 **별도 브라우저 창**으로 연다 (2026-11-04 Irene «작은 팝업 형태는 안될 것 같아 … 새창팝업으로»).
//   창은 pages/QDocs/DocStandalonePage(/doc-popout) — 문서 상세와 같은 화면을 사이드바 없이 띄운다.
//   창을 열 수 없는 곳(앱 WebView·폰 폭 — utils/popout.canOpenSeparateWindow)과 팝업 차단이면 false → 호출측이 앱 안 미리보기로.
import { canOpenSeparateWindow } from './popout';

export function openDocWindow(postId: number): boolean {
  if (!postId || !canOpenSeparateWindow()) return false;
  const w = Math.min(1200, Math.max(820, Math.round(window.screen.availWidth * 0.75)));
  const h = Math.min(1000, Math.max(640, Math.round(window.screen.availHeight * 0.9)));
  const left = Math.max(0, Math.round((window.screen.availWidth - w) / 2));
  const top = Math.max(0, Math.round((window.screen.availHeight - h) / 2));
  // 같은 문서는 같은 창 이름 — 두 번 누르면 창이 하나 더 생기지 않고 그 창이 앞으로 온다.
  //   이름이 pq- 로 시작해야 창이 자기를 팝아웃으로 안다(utils/popout.markPopoutWindow).
  const win = window.open(`/doc-popout?post=${postId}`, `pq-doc-${postId}`,
    `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
  if (!win) return false;
  try { win.focus(); } catch { /* 무시 */ }
  return true;
}
