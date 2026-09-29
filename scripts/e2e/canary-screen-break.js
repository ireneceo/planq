// canary-screen-break — 주요 화면 × 3폭 «깨짐» 전수 점검 (2026-09-29)
//
//   Irene 2026-09-28: "이런 UI/UX 깨짐 현상이 사용자가 겪을 일 없게 점검할 방법이 없어?"
//   기존 visual-audit 은 스크린샷을 **사람이 보는** 도구이고, mobile-layout-audit 은 표만 낸다 — 판정이 없었다.
//   여기서는 기계가 참/거짓을 가르는 것만 실패로 센다:
//     ① 화면 밖으로 삐져나감 — 누를 것이 화면 오른쪽 끝을 넘는데 가두는 스크롤 상자가 없다(잘린 채 보인다)
//        ★ 문서 폭(scrollWidth)으로 재면 안 된다 — 앱 셸이 html 을 화면 크기로 고정해 늘 0 이다(대조군이 잡았다)
//     ② 누를 것끼리 겹침 — **같은 층**의 보이는 버튼·링크·입력 두 개가 면적 30% 이상 겹친다
//        (층이 다르면 — 우하단 떠 있는 버튼·배너·드로어 — 의도된 겹침이다. 스크롤 상자에 잘려 안 보이는 것도 뺀다)
//     ③ 그려지지 않는 버튼 — 화면 안에 있는데 가운데를 눌러도 그 버튼이 아닌 것이 잡힌다
//        (단, 우하단 떠 있는 버튼·드로어처럼 **의도적으로 위에 뜨는 것**에 가린 것은 따로 센다 — 경고)
//   경고(실패 아님): 터치 폭에서 36px 미만 누를 것 개수 — 전부 고칠 대상이 아니라 추세를 본다.
//
//   ★ 양성 대조군 — 가로로 넘치는 요소와 겹치는 버튼 두 개를 심으면 ①② 가 실패로 뒤집혀야 한다.
const b = require('./lib/browser');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROUTES = [
  '/dashboard', '/inbox', '/tasks', '/talk', '/calendar', '/notes', '/docs', '/files', '/mail',
  '/bills', '/sale', '/info', '/projects', '/business/clients', '/business/members', '/business/settings',
  '/profile', '/me/work-settings',
];
const VPS = [
  { key: '폰 390', touch: true, vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '태블릿 834', touch: true, vp: { width: 834, height: 1112, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '데스크탑 1440', touch: false, vp: { width: 1440, height: 900 } },
];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function probe(touch) {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const SEL = 'button, a[href], [role="button"], input:not([type="hidden"]), select, textarea';
  const ROOTS = new Set([document.documentElement, document.body]);
  // 안쪽 스크롤 상자(overflow)에 잘려 **보이지 않는** 요소는 뺀다 — html·body 는 뺀다(앱 셸이 둘을
  //   화면 크기로 고정해 두므로, 그걸 넣으면 화면 밖으로 삐져나간 것까지 «잘려서 안 보임» 이 된다).
  const clipOf = (el) => {
    for (let q = el.parentElement; q && !ROOTS.has(q); q = q.parentElement) {
      const cs = getComputedStyle(q);
      if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return q;
    }
    return null;
  };
  const clippedAway = (el, r) => {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let q = el.parentElement; q && !ROOTS.has(q); q = q.parentElement) {
      const cs = getComputedStyle(q);
      if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const qr = q.getBoundingClientRect();
      if (cx < qr.left || cx > qr.right || cy < qr.top || cy > qr.bottom) return true;
    }
    return false;
  };
  // 떠 있는 층 — 가장 가까운 fixed 조상(없으면 문서). 층이 다르면 겹쳐 보이는 것이 **의도**다(FAB·배너·드로어).
  //   ★ fixed 만 보면 안 된다 — 폰에서는 목록 패널(absolute·z30)이 빈 상세 패널을 **덮는 것이 설계**라,
  //     그 밑 상세의 [새 메모]·[새 메일] 을 «안 그려짐» 으로 셌다(거짓 실패 4건). z-index 를 가진 배치 요소도 층이다.
  const layerOf = (el) => {
    for (let q = el; q && !ROOTS.has(q); q = q.parentElement) {
      const cs = getComputedStyle(q);
      if (cs.position === 'fixed') return q;
      if (cs.position !== 'static' && cs.zIndex !== 'auto') return q;
    }
    return document.body;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0 || cs.pointerEvents === 'none') return null;
    if (el.closest('[aria-hidden="true"], [inert]')) return null;
    if (clippedAway(el, r)) return null;
    return r;
  };
  const els = [];
  for (const el of document.querySelectorAll(SEL)) {
    const r = visible(el);
    if (r) els.push({ el, r, layer: layerOf(el) });
  }
  const desc = (el) => {
    const t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.getAttribute('placeholder') || el.tagName).trim().replace(/\s+/g, ' ');
    return `${el.tagName.toLowerCase()}「${t.slice(0, 18)}」`;
  };
  // ① 화면 밖으로 삐져나감 — 누를 것이 화면 오른쪽 끝을 넘는데, 그것을 가두는 안쪽 스크롤 상자가 없다
  //   (= 옆으로 굴릴 수도 없고 잘린 채 보인다). 가로 스크롤 상자 안의 것은 굴리면 보이므로 뺀다.
  const offRight = [];
  for (const { el, r } of els) {
    if (r.right > vw + 1 && !clipOf(el) && offRight.length < 4) offRight.push(`${desc(el)} 오른쪽 ${Math.round(r.right - vw)}px`);
  }
  // ② 같은 층 안의 겹침 — 한쪽이 다른 쪽을 품는(중첩) 경우는 뺀다
  const overlaps = [];
  for (let i = 0; i < els.length && overlaps.length < 8; i++) {
    for (let j = i + 1; j < els.length; j++) {
      const a = els[i], c = els[j];
      if (a.layer !== c.layer) continue;
      if (a.el.contains(c.el) || c.el.contains(a.el)) continue;
      if (a.el.closest('label') && a.el.closest('label') === c.el.closest('label')) continue;
      const x = Math.max(0, Math.min(a.r.right, c.r.right) - Math.max(a.r.left, c.r.left));
      const y = Math.max(0, Math.min(a.r.bottom, c.r.bottom) - Math.max(a.r.top, c.r.top));
      const inter = x * y;
      const small = Math.min(a.r.width * a.r.height, c.r.width * c.r.height);
      if (small > 0 && inter / small >= 0.3) {
        overlaps.push(`${desc(a.el)} ↔ ${desc(c.el)} ${Math.round((inter / small) * 100)}%`);
        if (overlaps.length >= 8) break;
      }
    }
  }
  // ③ 그려지지 않는 버튼 — 같은 층의 무언가에 덮였다(다른 층이 덮은 것은 의도 — 따로 센다)
  const hidden = [];
  let coveredByFloating = 0;
  let small = 0;
  for (const { el, r, layer } of els) {
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
    const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    const h = document.elementFromPoint(cx, cy);
    if (touch && (r.width < 36 || r.height < 36) && el.tagName !== 'INPUT' && el.tagName !== 'A') small += 1;
    if (!h || h === el || el.contains(h) || h.contains(el)) continue;
    if (layerOf(h) !== layer) { coveredByFloating += 1; continue; }
    if (hidden.length < 6) hidden.push(`${desc(el)} ← ${h.tagName.toLowerCase()}.${String(h.className).split(' ')[0].slice(0, 20)}`);
  }
  return { offRight, overlaps, hidden, coveredByFloating, small, n: els.length, path: location.pathname };
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  const { browser } = await b.launch();
  try {
    for (const v of VPS) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport(v.vp);
      if (v.touch) await page.setUserAgent(UA);
      await b.login(page);
      await b.goto(page, '/dashboard');
      await b.dismissBlockers(page);
      // 양성 대조군 — 심은 결함을 잡아야 이 검사기를 믿는다
      await page.evaluate(() => {
        // 같은 층(문서)에 둔다 — body 바로 밑 absolute. 셋째 버튼은 화면 오른쪽 밖으로 삐져나간다.
        const w = document.createElement('div'); w.id = '__sb_probe';
        w.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;z-index:99999;';
        const mk = (txt, css) => { const x = document.createElement('button'); x.textContent = txt; x.style.cssText = 'position:absolute;height:44px;width:120px;' + css; w.appendChild(x); };
        mk('AAAA', 'top:300px;left:40px;');
        mk('BBBB', 'top:305px;left:60px;');
        mk('CCCC', `top:380px;left:${window.innerWidth - 40}px;`);
        document.body.appendChild(w);
      });
      const ctl = await page.evaluate(probe, v.touch);
      await page.evaluate(() => { const x = document.getElementById('__sb_probe'); x && x.remove(); });
      push(`${v.key} · 대조군: 심은 삐져나감·겹침을 잡는다`, ctl.offRight.some((o) => /CCCC/.test(o)) && ctl.overlaps.some((o) => /AAAA/.test(o) && /BBBB/.test(o)),
        `삐져나감 ${JSON.stringify(ctl.offRight)} · 겹침 ${JSON.stringify(ctl.overlaps.filter((o) => /AAAA/.test(o)))}`);

      for (const route of ROUTES) {
        await b.gotoSPA(page, route);
        await sleep(900);
        await b.dismissBlockers(page);
        const at = await page.evaluate(() => location.pathname);
        if (at.startsWith('/login')) { push(`${v.key} · ${route}`, false, '로그인으로 튕김 — 미측정'); continue; }
        const m = await page.evaluate(probe, v.touch);
        const bad = [];
        if (m.offRight.length) bad.push(`화면 밖으로 삐져나감 ${m.offRight.length}: ${m.offRight.join(' / ')}`);
        if (m.overlaps.length) bad.push(`겹침 ${m.overlaps.length}: ${m.overlaps.slice(0, 3).join(' / ')}`);
        if (m.hidden.length) bad.push(`안 그려짐 ${m.hidden.length}: ${m.hidden.slice(0, 3).join(' / ')}`);
        const info = `누를 것 ${m.n} · 떠 있는 층에 가림 ${m.coveredByFloating}${v.touch ? ` · 36px 미만 ${m.small}(경고)` : ''}`;
        push(`${v.key} · ${route}`, bad.length === 0, bad.length ? `${bad.join(' · ')} · ${info}` : info);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

module.exports = { name: '화면 깨짐 전수 점검 — 가로 넘침·버튼 겹침·안 그려진 버튼 (주요 18화면 × 3폭)', run };
