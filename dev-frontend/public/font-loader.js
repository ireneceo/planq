// 웹폰트 시트 걸기 — index.html 주석 참조 (2026-10-22). classic script, <head> 안(CSP 상 인라인 불가).
//   웹: document.write 로 파서가 넣은 링크 = 종전과 같은 «그리기 차단» (첫 화면 글꼴이 바뀌며 튀지 않게).
//   앱(네이티브 WebView)·설치형 PWA: appendChild = 비차단 — 시트가 늦어도 «불러오는 중» 화면·로그인 폼이 먼저 그려진다.
(function () {
  var href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&family=Noto+Sans+KR:wght@400;500;600;700&display=swap';
  var app = false;
  try {
    var cap = window.Capacitor;
    app = !!(cap && (typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : cap.isNative))
      || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  } catch (e) { app = false; }
  if (!app) { document.write('<link href="' + href + '" rel="stylesheet" />'); return; }
  var l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  document.head.appendChild(l);
})();
