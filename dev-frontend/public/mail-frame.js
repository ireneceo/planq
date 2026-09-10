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
        // ★ 펼치면 콘텐츠 폭이 달라진다 — 접힌 상태로 잰 배율은 더 이상 맞지 않는다.
        //   인용문 안에 고정폭 표가 있는 메일이 흔해서(Fable 실측 M4) 다시 잰다.
        fitWidth();
        send();
      });
    }
  } catch (e) { /* 접기는 부가 기능 — 실패해도 본문과 높이 보고는 살아야 한다 */ }

  // ── 폭 맞춤 축소 (2026-09-10, Irene: "모바일에서 메일 내용이 반응형에 맞지 않아") ──
  //
  //   메일 본문은 **발신자가 보낸 HTML** 이라 우리가 반응형으로 다시 짤 수 없다.
  //   실측(폰 375px): `<table width="750">` 로 온 메일이 iframe 342px 안에서 **408px 넘쳤다.**
  //   게다가 guard CSS 의 `body>table{margin:auto}`(데스크탑에서 뉴스레터를 가운데 두려고 넣은 것)가
  //   폰에서는 750px 을 좌우로 **균등하게 잘라내** 왼쪽은 텅 비고 내용은 오른쪽 화면 밖으로 갔다.
  //
  //   그래서 Gmail·Outlook 모바일이 하는 것과 같은 **폭 맞춤(fit to width)** 을 한다:
  //   콘텐츠가 iframe 보다 넓으면 그 비율만큼 축소한다. 내용을 바꾸지 않고 배율만 바꾼다.
  //
  //   지키는 선:
  //   · **폰에서만**(`screen.width` ≤ 640) — 데스크탑·태블릿 렌더는 한 픽셀도 안 바뀐다
  //     (#226·#200 회귀 방지). 판정을 `innerWidth` 로 하면 안 된다 — isPhone() 주석 참조.
  //   · **축소만** — 넓은 메일을 키우지 않는다(비율 > 1 이면 손대지 않는다)
  //   · **하한 0.4** — 그보다 작아지면 글씨를 못 읽는다. 그 경우는 종전대로 가로 스크롤
  //     ★ '전체보기'(MailBodyFullscreen)는 **같은 srcDoc·같은 이 스크립트**를 타므로
  //       거기서도 똑같이 축소된다 — 원본 크기로 보는 길이 아니다(Fable 지적).
  //     ★ 처음엔 0.5 로 뒀는데 **가장 흔한 케이스가 전부 걸러졌다** — 폰 342px 기준
  //       700px→0.489 · 750px→0.456 · 800px→0.427 이 모두 하한 미달이라 손도 못 댔다.
  //       실측(Irene 신고 메일)이 정확히 750px 이었다. 0.4 면 800px 까지 덮는다.
  //   · `zoom` 을 쓰는 이유 — transform:scale 은 레이아웃 폭을 안 줄여 가로 스크롤이 남는다.
  //     zoom 은 레이아웃 폭에 반영된다. ★ 다만 **높이는 그대로 맞지 않는다** — send() 주석 참조.
  var MIN_SCALE = 0.4;

  // ★ 기기 폭 판정은 `screen.width` 다. `window.innerWidth` 를 쓰면 **안 된다** —
  //   iframe 안에서 그 값은 기기 폭이 아니라 **읽기 패널 폭**이다.
  //   Fable 실측: 데스크탑 1440 에서 우측 패널을 연 3분할이면 iframe 이 551px 이라
  //   축소가 걸렸다("데스크탑은 한 픽셀도 안 바뀐다" 가 거짓이 됐다).
  //   screen.width 는 sandbox iframe 에서도 읽히고 기기 화면 폭을 준다.
  function isPhone() {
    try {
      var sw = (window.screen && window.screen.width) || 0;
      return sw > 0 && sw <= 640;
    } catch (e) { return false; }
  }

  // 가운데 정렬 해제 — 축소하든 못 하든, **좁은 화면이면 왼쪽부터 보여야** 한다.
  //   guard CSS 의 `body>table{margin:auto}` 는 데스크탑 뉴스레터용이라, 폰에서는
  //   넘치는 폭을 좌우로 균등하게 잘라내 왼쪽이 텅 비고 내용이 오른쪽 밖으로 간다.
  var alignedLeft = false;
  function leftAlign() {
    if (alignedLeft) return;
    alignedLeft = true;
    var st = document.createElement('style');
    st.textContent = 'body>table,body>div,body>center,body>a{margin-left:0!important;margin-right:0!important;}';
    document.head.appendChild(st);
  }

  function fitWidth() {
    try {
      if (!isPhone()) return;                      // 데스크탑·태블릿은 손대지 않는다
      var de = document.documentElement;
      var b = document.body;
      if (!b) return;
      // 다시 재기 전에 배율을 푼다 — 축소된 상태에서 재면 콘텐츠 폭이 이미 줄어 보인다.
      if (de.style.zoom) de.style.zoom = '';
      var vw = window.innerWidth || 0;             // 여기서는 iframe 폭이 맞다(맞출 대상)
      if (!vw) return;
      var content = Math.max(b.scrollWidth, de.scrollWidth);
      if (content <= vw + 2) return;               // 넘치지 않는다 — 정상 메일
      var r = vw / content;
      if (r >= 1) return;                          // 확대 금지
      // ★ 하한 미달이어도 **왼쪽 정렬은 한다.** 축소를 못 한다고 손을 떼면
      //   320px 폰에서 신고 증상(왼쪽 공백 + 내용이 오른쪽 밖)이 그대로 남는다(Fable 지적).
      if (r < MIN_SCALE) { leftAlign(); return; }
      de.style.zoom = r;
      leftAlign();
    } catch (e) { /* 폭 맞춤은 부가 기능 — 실패해도 본문과 높이 보고는 살아야 한다 */ }
  }

  // ── 높이 보고 ──────────────────────────────────────────────────
  //   documentElement.scrollHeight 는 iframe 높이보다 작아질 수 없어(html 이 뷰포트를 채운다)
  //   짧은 답장이 아래가 텅 빈 채 늘어졌다. body 실제 높이로 잰다.
  function send() {
    if (!frameId) return;
    var b = document.body;
    // ★ 표준 CSS zoom(Chrome 128+)에서 단위가 **섞인다**:
    //     scrollHeight · offsetHeight → 요소 로컬(축소 **전**) 단위
    //     getBoundingClientRect().height → 시각(축소 **후**) 단위
    //   Math.max 로 셋을 섞으면 언제나 축소 전 값이 나가고, 부모는 그 높이로 iframe 을 잡아
    //   **축소한 만큼 빈 공간**이 생긴다(Fable 실측 545px). 2026-09-07 의
    //   "200px 상자에 636px 내용" 과 같은 계열이다 → 배율을 곱해 시각 단위로 통일한다.
    var z = parseFloat(document.documentElement.style.zoom || '') || 1;
    var local = Math.max(b.scrollHeight, b.offsetHeight);
    var visual = b.getBoundingClientRect().height;
    var h = Math.ceil(z !== 1 ? Math.max(visual, local * z) : Math.max(local, visual));
    parent.postMessage({ planqMailFrame: frameId, h: h }, '*');
  }
  // 이미지가 붙기 전 폭은 실제보다 좁을 수 있다 — load 뒤에 한 번 더 잰다.
  fitWidth();
  send();
  window.addEventListener('load', function () { fitWidth(); send(); });
  if (window.ResizeObserver) new ResizeObserver(send).observe(document.body);
  setTimeout(send, 300);
  setTimeout(send, 1200);
  window.__planqSend = send;
})();
