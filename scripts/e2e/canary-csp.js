// scripts/e2e/canary-csp.js — CSP 가 앱을 깨뜨리지 않는가 (2026-09-02 보안감사 H-1)
//
// 화면(HTML)에 CSP 를 처음 켠다. CSP 는 **전 화면에 걸리는 정책**이라 값이 하나만 틀려도
// 그 기능이 조용히 죽는다 — 콘솔에만 `Refused to …` 가 뜨고 화면은 "그냥 안 되는" 것으로 보인다.
// 정적 검사로는 잡을 수 없다(실제 브라우저가 정책을 집행해야 드러난다).
//
// ★ 양성 대조군 없이 "위반 0건" 은 증거가 못 된다 — 정책이 **아예 없어도** 0건이다.
//   그래서 먼저 문서 응답에 CSP 헤더가 실렸는지 확인하고, 없으면 그 자체로 실패로 낸다.
//
// 특히 무는 것: PDF 미리보기(blob: iframe) · 메일 본문(srcDoc iframe) · 폰트 · 소켓(wss:) ·
//               styled-components 런타임 <style> 주입.
//
// ★ 적용 전 리허설은 **응답 헤더로** 해야 한다. <meta> 를 스크립트로 꽂는 방식은 통하지 않는다 —
//   Chrome 은 파서가 만난 meta CSP 만 집행하고, DOM 으로 넣은 것은 조용히 무시한다.
//   실측(2026-09-02): 일부러 frame-src 'none' 을 주입했는데 blob: iframe 이 멀쩡히 떴고
//   "위반 0건" 이 나왔다 — 정책이 아예 안 걸린 것을 통과로 읽는 **거짓 통과 기계**였다.
//   그래서 리허설은 샌드박스 nginx(고포트)에 실제 헤더를 붙여 놓고 E2E_BASE 로 가리킨다.
const { launch, login, goto, gotoSPA, sleep, BASE } = require('./lib/browser');

const results = [];
const ok = (msg) => results.push({ name: msg, fail: false });
const bad = (msg) => results.push({ name: msg, fail: true });

// CSP 집행 로그만 고른다 — 앱 자체 오류(404 등)는 이 카나리의 대상이 아니다.
const CSP_RE = /Content Security Policy|Refused to (load|connect|execute|apply|frame|create)/i;

const ROUTES = ['/dashboard', '/talk', '/tasks', '/docs', '/mail', '/calendar', '/bill', '/files', '/info'];
// 운영에는 검사 계정이 없다 — 로그인 없이도 CSP 집행은 같으므로 공개 화면으로 정책을 검증한다.
const PUBLIC_ROUTES = ['/login', '/privacy', '/terms'];

async function run() {
  const { browser, page } = await launch({ mobile: false });
  const violations = [];
  try {
    await page.setViewport({ width: 1440, height: 900 });
    page.on('console', (m) => { const t = m.text(); if (CSP_RE.test(t)) violations.push(t.slice(0, 220)); });
    page.on('pageerror', (e) => { const t = String(e && e.message || e); if (CSP_RE.test(t)) violations.push(t.slice(0, 220)); });

    // ── 0) 양성 대조군 — 정책이 실제로 실려 오는가 ────────────────────────────
    const resp = await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    const csp = resp && (resp.headers()['content-security-policy'] || '');
    if (!csp) {
      bad('문서 응답에 CSP 헤더가 없다 — 정책이 없으면 위반 0건은 통과의 증거가 아니다');
    } else {
      ok(`CSP 헤더 수신 (지시문 ${csp.split(';').filter(Boolean).length}개)`);
      // 값 자체의 알려진 지뢰 — 이 둘은 실제 기능을 죽인다(실측).
      if (/frame-src\s+'none'/.test(csp)) bad("CSP frame-src 'none' — PDF 미리보기·메일 본문이 죽는다");
      if (/frame-ancestors\s+'none'/.test(csp)) bad("CSP frame-ancestors 'none' — 핀 PiP 가 자기 화면을 못 띄운다");
      if (!/frame-ancestors/.test(csp)) bad('CSP frame-ancestors 없음 — 클릭재킹이 열린다');
    }

    // ── 1) 주요 화면 순회 ────────────────────────────────────────────────────
    // 검사 계정은 dev 전용이다. 운영에는 없으므로 로그인 실패 시 **공개 라우트만** 돌되,
    // ★ 어느 모드로 돌았는지 결과에 박는다 — 커버리지를 숨기면 통과가 증거가 못 된다.
    let authed = true;
    try { await login(page); } catch { authed = false; }
    const routes = authed ? ROUTES : PUBLIC_ROUTES;
    await goto(page, routes[0]);
    for (const r of routes.slice(1)) { await gotoSPA(page, r); await sleep(1200); }
    const landed = page.url();
    if (authed && /\/login(\?|$)/.test(landed)) {
      bad(`순회가 로그인 화면에서 끝났다 (${landed}) — 인증이 안 된 순회는 검사가 아니다`);
    } else if (authed) {
      ok(`인증 모드 — 주요 화면 ${routes.length}곳 순회 (착지 ${landed.replace(BASE, '')})`);
    } else {
      ok(`미인증 모드 — 공개 라우트 ${routes.length}곳만 순회 (검사 계정 없음: ${BASE})`);
    }

    // ── 2) blob: iframe / 폰트 / 소켓 — CSP 가 무는 지점을 직접 만든다 ────────
    const probe = await page.evaluate(async () => {
      const out = {};
      // PDF 미리보기와 같은 방식: blob: URL 을 iframe 으로 띄운다 (frame-src blob: 없으면 차단)
      out.blobFrame = await new Promise((res) => {
        try {
          const url = URL.createObjectURL(new Blob(['<p>planq-probe</p>'], { type: 'text/html' }));
          const f = document.createElement('iframe');
          f.src = url; f.style.cssText = 'width:1px;height:1px;opacity:0';
          // ★ 차단돼도 onload 는 뜬다(about:blank 오류 문서). 내용이 실제로 들어왔는지를 본다 —
          //   실측 2026-09-02: frame-src 'none' 인데 이 probe 가 'ok' 를 냈다.
          f.onload = () => {
            let body = '';
            try { body = (f.contentDocument && f.contentDocument.body && f.contentDocument.body.textContent) || ''; } catch { body = 'cross-origin'; }
            f.remove(); res(body.includes('planq-probe') ? 'ok' : 'blocked');
          };
          f.onerror = () => { f.remove(); res('error'); };
          document.body.appendChild(f);
          setTimeout(() => { try { f.remove(); } catch {} res('timeout'); }, 3000);
        } catch (e) { res('throw:' + e.message); }
      });
      // ★ 핀 PiP 와 같은 방식: **앱 자신의 현재 경로**를 same-origin iframe 으로 띄운다
      //   (utils/pinHost.ts:538). frame-ancestors 'none' 이면 여기서만 막힌다 —
      //   blob:·srcDoc 프로브는 멀쩡히 통과해서 이 결함을 못 잡는다(2026-09-02 Fable 게이트).
      out.selfFrame = await new Promise((res) => {
        try {
          const f = document.createElement('iframe');
          f.src = location.pathname + location.search;
          f.style.cssText = 'width:1px;height:1px;opacity:0';
          f.onload = () => {
            // ★ contentDocument 접근이 throw 하면 그것은 **막힌 것**이다 — 옛 코드는 catch 에서
            //   'cross-origin' 이라는 **길이 12짜리 문자열**을 넣고 `length > 0` 으로 판정해
            //   차단을 통과로 읽었다 (2026-09-02 Fable 재게이트 지적).
            let body = '', path = '';
            try {
              body = (f.contentDocument && f.contentDocument.body && f.contentDocument.body.innerHTML) || '';
              path = (f.contentWindow && f.contentWindow.location && f.contentWindow.location.pathname) || '';
            } catch { f.remove(); res('blocked'); return; }
            f.remove();
            if (!body.length) return res('blocked');
            // 우리 경로가 그대로 떠야 한다 — 엉뚱한 문서가 떠도 'ok' 가 되지 않게.
            res(path === location.pathname ? 'ok' : `other-path:${path}`);
          };
          document.body.appendChild(f);
          setTimeout(() => { try { f.remove(); } catch {} res('timeout'); }, 6000);
        } catch (e) { res('throw:' + e.message); }
      });
      // 메일 본문과 같은 방식: srcDoc iframe
      out.srcDocFrame = await new Promise((res) => {
        try {
          const f = document.createElement('iframe');
          f.srcdoc = '<p>planq-probe</p>'; f.style.cssText = 'width:1px;height:1px;opacity:0';
          f.onload = () => {
            let body = '';
            try { body = (f.contentDocument && f.contentDocument.body && f.contentDocument.body.textContent) || ''; } catch { body = 'cross-origin'; }
            f.remove(); res(body.includes('planq-probe') ? 'ok' : 'blocked');
          };
          document.body.appendChild(f);
          setTimeout(() => { try { f.remove(); } catch {} res('timeout'); }, 3000);
        } catch (e) { res('throw:' + e.message); }
      });
      // ★ 차단된 <link> 도 document.styleSheets 에는 남는다 — 목록에 있는 것은 증거가 아니다
      //   (실측 2026-09-02: style-src 로 막았는데 이 검사가 ✅ 를 냈다).
      //   폰트가 **실제로 로드됐는지**를 폰트 API 로 묻는다.
      try { await document.fonts.ready; } catch {}
      //   ★ document.fonts.check('1rem Inter') 도 못 쓴다 — @font-face 가 아예 없으면 시스템 폰트로
      //     간주해 **true** 를 낸다(실측). 실제 로드된 FontFace 항목을 센다.
      out.fontLoaded = (() => {
        try { return [...document.fonts].some((f) => /Inter|Noto Sans KR|Outfit/.test(f.family) && f.status === 'loaded'); }
        catch { return false; }
      })();
      // styled-components 런타임 주입 (style-src 'unsafe-inline')
      // ★ <style> 태그 **개수**는 차단돼도 줄지 않는다 — 규칙이 실제로 붙었는지를 센다.
      out.injectedStyles = [...document.styleSheets].reduce((n, sh) => {
        try { return n + (sh.href ? 0 : sh.cssRules.length); } catch { return n; }
      }, 0);
      return out;
    });
    if (probe.blobFrame === 'ok') ok('blob: iframe 로드 (PDF 미리보기 경로)');
    else bad(`blob: iframe 이 뜨지 않는다 (${probe.blobFrame}) — frame-src 에 blob: 필요`);
    if (probe.selfFrame === 'ok') ok('자기 경로 same-origin iframe 로드 (핀 PiP 경로)');
    else bad(`자기 경로를 iframe 으로 못 띄운다 (${probe.selfFrame}) — frame-ancestors 'self' 필요. 핀 PiP 고정창이 빈 화면이 된다`);
    if (probe.srcDocFrame === 'ok') ok('srcDoc iframe 로드 (메일 본문 경로)');
    else bad(`srcDoc iframe 이 뜨지 않는다 (${probe.srcDocFrame}) — 메일 본문이 빈칸이 된다`);
    if (probe.injectedStyles > 0) ok(`styled-components 런타임 스타일 규칙 ${probe.injectedStyles}개 적용`);
    else bad('런타임 <style> 이 하나도 없다 — style-src 가 막고 있다(화면이 통째로 무너진다)');
    if (probe.fontLoaded) ok('Google Fonts 웹폰트 실제 로드');
    else bad('Google Fonts 웹폰트가 로드되지 않았다 — style-src/font-src 확인');

    // ── 3) 소켓(wss:/ws:) — 실시간이 죽으면 숫자 뱃지·채팅이 멈춘다 ───────────
    await sleep(1500);
    const sockOk = await page.evaluate(() => !!(window.io || document.querySelector('body')));
    if (sockOk) ok('페이지 살아 있음 (소켓 위반은 아래 콘솔 집계로 판정)');

    // ── 4) 콘솔 집계 ─────────────────────────────────────────────────────────
    if (violations.length === 0) ok('CSP 위반 콘솔 로그 0건');
    else { bad(`CSP 위반 ${violations.length}건`); violations.slice(0, 12).forEach((v) => bad('  ' + v)); }
  } finally {
    await browser.close().catch(() => {});
  }
  return results;
}

module.exports = { run, name: 'csp' };

if (require.main === module) {
  run().then((rs) => {
    const failed = rs.filter((r) => r.fail);
    rs.forEach((r) => console.log(`${r.fail ? '✗' : '✓'} ${r.name}`));
    console.log(failed.length ? `\n✗ CSP 카나리 실패 ${failed.length}건` : '\n✓ CSP 카나리 통과');
    process.exit(failed.length ? 1 : 0);
  }).catch((e) => { console.error('✗ 카나리 자체 오류:', e.message); process.exit(1); });
}
