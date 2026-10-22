// 앱 첫 실행 «불러오는 중» 화면 켜기 — index.html #pq-boot 주석 참조. classic script(모듈보다 먼저, CSP 상 인라인 불가).
(function () {
  try {
    var cap = window.Capacitor;
    var native = !!(cap && (typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : cap.isNative));
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    if (!native && !standalone) return;
    var el = document.getElementById('pq-boot');
    if (!el) return;
    el.style.display = '';
    var ko = (navigator.language || '').slice(0, 2) === 'ko';
    document.getElementById('pq-boot-msg').textContent = ko ? '연결이 느립니다. 잠시만 기다리거나 다시 시도해 주세요.' : 'The connection is slow. Please wait or try again.';
    var btn = document.getElementById('pq-boot-retry');
    btn.textContent = ko ? '다시 시도' : 'Try again';
    btn.addEventListener('click', function () { location.reload(); });
    setTimeout(function () { if (el.parentNode) el.className = 'slow'; }, 15000);
  } catch (e) { /* 보조 화면 — 실패해도 앱은 그대로 뜬다 */ }
})();
