/* public/mail-frame.js — 메일 본문 iframe 안에서 도는 유일한 스크립트.
 *
 * ★ 2026-09-07 — 왜 파일로 뺐나.
 *   이 코드는 srcDoc 안에 **인라인 <script>** 로 들어 있었다. 그런데 srcdoc iframe 은
 *   부모의 CSP 를 그대로 물려받고, 2026-09-02 에 들어온 정책이 `script-src 'self'` 라
 *   인라인 스크립트가 **전부 차단**됐다(실측 콘솔:
 *   "Executing inline script violates ... 'script-src 'self''").
 *   그래서 높이 보고(postMessage)가 한 번도 안 나갔고, 부모는 글자 수로 추정한 높이
 *   (본문 텍스트가 없으면 200px)에 iframe 을 고정한 채로 뒀다 — 실제 내용은 636px 인데
 *   200px 상자에 담겨 **아래가 텅 빈 것처럼** 보였다
 *   (Irene 2026-09-07: "이 내용 아래에 130-135px 정도 빈 여백").
 *   CSP 를 푸는 것은 오답이다(그 정책은 저장형 XSS 를 막으려고 넣었다). 파일로 빼면
 *   `'self'` 로 통과한다 — 정책은 그대로, 우리 스크립트만 산다.
 *
 * ★ 접기(인용문 fold)와 높이 보고를 **한 파일**에 둔다. 두 벌이면 접힌 높이가 아니라
 *   펼친 높이가 먼저 보고돼 "커졌다 줄어드는" 점프가 생긴다.
 *   설정값은 <script data-*> 로 받는다 — 코드가 문서마다 달라지면 캐시가 무의미해진다.
 */
(function () {
  var s = document.currentScript;
  var frameId = Number(s && s.getAttribute('data-frame-id'));
  var showLabel = (s && s.getAttribute('data-fold-show')) || '이전 내용 보기';
  var hideLabel = (s && s.getAttribute('data-fold-hide')) || '이전 내용 접기';

  // ── 인용문 접기 ────────────────────────────────────────────────
  //   Gmail·Outlook 이 붙이는 인용 블록을 접어 둔다. 첫 높이 보고가 **접힌 높이**여야
  //   커졌다 줄어드는 3단 점프가 없다 — 그래서 접기를 높이 보고보다 먼저 한다.
  try {
    var sel = ['.gmail_quote', 'blockquote[type="cite"]', '#divRplyFwdMsg',
      '.moz-cite-prefix', '[id^="OLK_SRC_BODY_SECTION"]'];
    var q = null;
    for (var i = 0; i < sel.length && !q; i++) q = document.querySelector(sel[i]);
    if (q && q.getBoundingClientRect().height > 40) {
      var wrap = document.createElement('div');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = showLabel;
      btn.style.cssText = 'margin:10px 0;padding:4px 10px;font:inherit;font-size:0.75rem;'
        + 'border:1px solid #E2E8F0;border-radius:999px;background:#F8FAFC;color:#475569;cursor:pointer;';
      q.parentNode.insertBefore(wrap, q);
      wrap.appendChild(btn);
      q.style.display = 'none';
      btn.addEventListener('click', function () {
        var open = q.style.display !== 'none';
        q.style.display = open ? 'none' : '';
        btn.textContent = open ? showLabel : hideLabel;
        send();
      });
    }
  } catch (e) { /* 접기는 부가 기능 — 실패해도 본문과 높이 보고는 살아야 한다 */ }

  // ── 높이 보고 ──────────────────────────────────────────────────
  //   documentElement.scrollHeight 는 iframe 높이보다 작아질 수 없어(html 이 뷰포트를 채운다)
  //   짧은 답장이 아래가 텅 빈 채 늘어졌다. body 실제 높이로 잰다.
  function send() {
    if (!frameId) return;
    var b = document.body;
    var h = Math.ceil(Math.max(b.scrollHeight, b.getBoundingClientRect().height, b.offsetHeight));
    parent.postMessage({ planqMailFrame: frameId, h: h }, '*');
  }
  send();
  window.addEventListener('load', send);
  if (window.ResizeObserver) new ResizeObserver(send).observe(document.body);
  setTimeout(send, 300);
  setTimeout(send, 1200);
  window.__planqSend = send;
})();
