// OAuth 마지막 화면이 쓰는 같은 출처 스크립트 2개 (무인증 · 정적 · 값 없음).
//
// 왜 파일인가: 백엔드 응답에는 helmet CSP `script-src 'self'; script-src-attr 'none'` 이 붙는다 —
//   인라인 <script> 는 돌지 않는다(2026-10-12 «닫기가 안 된다» 의 원인). 같은 출처 파일은 허용된다.
//   스크립트는 자기 값을 body 의 data- 속성에서 읽으므로 여기엔 사용자 값이 하나도 없다.
//   - popup-done.js  : utils/oauthPopupPage (개인·회사 연동 팝업) — 완료 신호 + 닫기 시도 + 안내 교체
//   - native-return.js: utils/nativeReturn (앱 복귀 화면) — 앱 스킴 자동 시도
const express = require('express');
const router = express.Router();

const POPUP_DONE_JS = `(function(){
  var d = document.body ? document.body.dataset : {};
  var payload = { type: d.type || '', provider: d.provider || null, ok: d.ok === '1', ts: Date.now() };
  // opener 는 구글 경유 COOP 로 끊겨 있을 수 있다 — 같은 출처 채널(BroadcastChannel + localStorage)도 같이 쏜다.
  try { var bc = new BroadcastChannel('planq:oauth'); bc.postMessage(payload); bc.close(); } catch (e) {}
  try { localStorage.setItem('planq:oauth:done', JSON.stringify(payload)); } catch (e) {}
  try { if (window.opener) window.opener.postMessage(payload, location.origin); } catch (e) {}
  var showFallback = function () {
    var p = document.getElementById('primary'), f = document.getElementById('fallback');
    if (p && f && f.style.display !== 'block') { p.style.display = 'none'; f.style.display = 'block'; }
  };
  var tryClose = function () { try { window.close(); } catch (e) {} };
  // 닫기를 눌렀는데 아무 일도 없으면 고장으로 읽힌다 — 닫히지 않으면 곧바로 «직접 닫아 주세요» 로 바꾼다.
  var btn = document.getElementById('closeBtn');
  if (btn) btn.addEventListener('click', function () { tryClose(); setTimeout(showFallback, 200); });
  setTimeout(tryClose, 700);
  setTimeout(showFallback, 1500);
})();
`;

const NATIVE_RETURN_JS = `(function(){
  // 스킴 자동 시도 — 실패해도 이 페이지는 남는다(핸들러가 없으면 이동 자체가 취소된다).
  //   iOS SFSafariViewController 는 JS 가 시작한 커스텀 스킴 이동을 무시하므로 사람이 버튼을 눌러야 한다.
  var url = document.body ? document.body.getAttribute('data-return-url') : '';
  if (!url || url.indexOf('planq://') !== 0) return;
  try { location.replace(url); } catch (e) {}
  setTimeout(function () { try { location.href = url; } catch (e) {} }, 400);
})();
`;

function sendJs(res, body) {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300');
  res.send(body);
}

// deadroute-exempt: 서버가 내는 OAuth 마지막 화면 HTML(utils/oauthPopupPage)이 <script src> 로 부른다
router.get('/oauth/popup-done.js', (req, res) => sendJs(res, POPUP_DONE_JS));
// deadroute-exempt: utils/nativeReturn 앱 복귀 화면이 <script src> 로 부른다
router.get('/oauth/native-return.js', (req, res) => sendJs(res, NATIVE_RETURN_JS));

module.exports = router;
