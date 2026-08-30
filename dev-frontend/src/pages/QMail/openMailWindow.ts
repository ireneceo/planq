// 메일 본문을 **별도 브라우저 창**으로 연다 (Irene 2026-08-24)
//   "이메일에서 내용 전체보기는 팝업으로 열리면 마찬가지로 솔루션 창 안까지만 보이잖아.
//    웹용처럼 새로 열려야지. 웹 미리보기 처럼."
//
// 왜 이렇게 하나:
//   · 앱 안 모달은 아무리 크게 해도 **앱 창을 벗어나지 못한다**. 넓게 보려면 진짜 창이어야 한다.
//   · 새 라우트를 만들지 않는다 — 인증·번들 로딩이 또 필요해지고, 이미 만들어 둔 본문을 버리게 된다.
//   · 대신 이미 정화된 srcDoc 을 **새 창 안의 sandbox iframe** 에 그대로 넣는다.
//     sandbox 조합(allow-scripts, same-origin 없음)은 앱 안에서 쓰던 것과 동일 —
//     이 경로에서만 격리가 느슨해지면 정화 계약이 깨진다.
//
// 팝업 차단 대비: window.open 이 null 이면 false 를 돌려준다(호출측이 기존 모달로 폴백).

const esc = (v: string) => String(v || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function openMailWindow(opts: {
  title: string;
  subtitle?: string;
  srcDoc?: string;
  text?: string | null;
}): boolean {
  const w = Math.min(1100, Math.max(720, Math.round(window.screen.availWidth * 0.7)));
  const h = Math.min(900, Math.max(600, Math.round(window.screen.availHeight * 0.85)));
  const left = Math.max(0, Math.round((window.screen.availWidth - w) / 2));
  const top = Math.max(0, Math.round((window.screen.availHeight - h) / 2));
  // noopener 를 쓰면 핸들이 null 이라 문서를 못 쓴다 — 여기서는 핸들이 필요하다.
  const win = window.open('', `pq-mail-${Date.now()}`,
    `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
  if (!win) return false;   // 팝업 차단 — 호출측이 앱 안 모달로 폴백한다

  const body = opts.srcDoc
    ? `<iframe id="pq-body" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>`
    : `<pre class="plain">${esc(opts.text || '')}</pre>`;

  win.document.open();
  win.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title>
<style>
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;display:flex;flex-direction:column;background:#F8FAFC;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0F172A}
  header{flex-shrink:0;padding:12px 20px;background:#fff;border-bottom:1px solid #E2E8F0}
  h1{margin:0;font-size:1rem;font-weight:700;line-height:1.35;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sub{margin-top:3px;font-size:0.75rem;color:#64748B;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  /* ★ 2026-08-24 (Irene) — "전체보기 누르면 메일 내용이 위아래좌우 여백 없이 다 들러붙어서
     보기 안 좋아." 앱 안 전체보기(MailBodyFullscreen)는 바깥 컨테이너가 20px 24px 을 준다.
     새 창만 그게 없어서 본문이 창 벽에 닿았다 — 같은 여백을 여기서도 바깥이 준다.
     iframe 안(srcDoc)은 건드리지 않는다: 거기 margin:0 은 발신자 템플릿 보존용이다. */
  main{flex:1;min-height:0;background:#fff;padding:20px 24px;overflow:hidden}
  @media (max-width:768px){ main{padding:12px} }
  iframe{width:100%;height:100%;border:0;display:block;background:#fff}
  /* 여백은 main 이 담당 — 여기에도 주면 이중이 된다 */
  .plain{margin:0;padding:0;height:100%;overflow:auto;white-space:pre-wrap;word-break:break-word;
    font-family:inherit;font-size:0.875rem;line-height:1.7}
</style></head>
<body>
  <header>
    <h1>${esc(opts.title)}</h1>
    ${opts.subtitle ? `<div class="sub">${esc(opts.subtitle)}</div>` : ''}
  </header>
  <main>${body}</main>
</body></html>`);
  win.document.close();

  // srcdoc 은 write 로 넣으면 따옴표 이스케이프가 취약하다 — DOM 으로 직접 준다.
  if (opts.srcDoc) {
    const f = win.document.getElementById('pq-body') as HTMLIFrameElement | null;
    if (f) f.srcdoc = opts.srcDoc;
  }
  try { win.focus(); } catch { /* 포커스 실패는 무시 */ }
  return true;
}
