// utils/openPreviewWindow.ts — 공개 공유 미리보기(/public/...) 여는 단일 진입점.
//
// ★ 2026-08-27 운영 신고: "팝아웃에서 클릭해서 열면 웹페이지 미리보기가 작게 나와.
//   내가 솔루션을 열고 있어서 웹에서 안 열어주고 솔루션 내에서 여는 거야? pwa라서 그래?"
//   → 그렇다. 두 가지가 겹쳤다:
//     ① window.open 의 **세 번째 인자에 값이 있으면 브라우저는 탭이 아니라 팝업 창**으로 연다.
//        호출부들이 'noopener,noreferrer' 만 넘기고 크기를 안 줘서 브라우저 기본 크기의 작은 창이 떴다.
//     ② 설치형 앱(PWA)에는 탭이 없어 그 팝업이 **앱 창**으로 뜬다 — 미니 브라우저처럼 보인다.
//   여는 곳이 6곳으로 흩어져 있어 크기 규칙도 각자였다. 여기 하나로 모으고 **읽기 폭 기준**으로 연다
//   (공개 문서 카드가 820px + 좌우 여백 → 900 안팎이면 레이아웃이 접히지 않는다).
//
// noopener 를 features 에 넣지 않는다: 넣으면 반환 핸들이 **항상 null** 이라 팝업 차단과 구분이 안 된다
//   (memory feedback_window_open_noopener_null). 대신 핸들에서 opener 를 끊는다 — 보안 효과는 같다.

/** 문서 읽기 폭 — 공개 페이지 카드(820px) + 창 크롬 여유 */
const PREVIEW_W = 900;
const PREVIEW_H = 1000;

export function openPreviewWindow(url: string): void {
  try {
    const availW = window.screen?.availWidth || 1280;
    const availH = window.screen?.availHeight || 900;
    const width = Math.max(420, Math.min(PREVIEW_W, availW - 40));
    const height = Math.max(480, Math.min(PREVIEW_H, availH - 40));
    // 화면 가운데 — 부모 창 위치와 무관하게 예측 가능한 자리
    const left = Math.max(0, Math.round((availW - width) / 2));
    const top = Math.max(0, Math.round((availH - height) / 2));
    const features = `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`;
    const win = window.open(url, '_blank', features);
    if (win) {
      try { win.opener = null; } catch { /* cross-origin 등 — 무시 */ }
      try { win.focus(); } catch { /* noop */ }
      return;
    }
  } catch { /* 아래 폴백 */ }
  // 팝업이 막혔거나 features 를 못 쓰는 환경 — 평범한 새 탭으로
  window.open(url, '_blank', 'noopener,noreferrer');
}
