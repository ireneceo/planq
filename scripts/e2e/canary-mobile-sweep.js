// canary-mobile-sweep — 폰 전 화면 «크롬·입력 전후» 전수 점검 (2026-09-30)
//
//   Irene: "모바일에서 상단헤더 제대로 체크해서 모두 통일하고 서브헤더들 체크하고 필터영역들 주요 콘텐츠 영역에
//           문제 없이 최소화 했는지도 중요하고, 무엇보다 입력란 누르면 전후 확인하면서 입력하는데 문제 없게
//           제대로 되는지 모바일 기능으로 확장되어서 레이아웃 안돌아가는 말도 안되는 현상이 다른 곳에 없는지."
//
//   기존 mobile(키보드) 스위트는 «키보드가 떠 있는 동안» 입력이 보이는지만 본다. 여기서는 그 **앞뒤**를 잰다:
//     ① 상단 헤더 — 전 화면에서 같은 자리·같은 높이인가, 다른 것이 그 위를 덮지 않는가
//     ② 크롬 합계 — 헤더+서브헤더+필터가 화면의 몇 %를 먹는가(콘텐츠 시작 y). 45% 초과 = 실패, 35% 초과 = 경고
//     ③ 입력 중 — 입력이 키보드 위에 보이고, **고정 헤더 밑에 숨지 않고**, 위아래 맥락이 조금이라도 보이는가
//     ④ 입력 후 — 키보드를 내리고 포커스를 풀면 **원래대로 돌아오는가**
//        (키보드 표식 해제 · 헤더 자리 · 콘텐츠 영역 높이 · 가로 넘침 0 · 문서 스크롤 0)
//   두 폭: 390×844(아이폰 표준) · 360×740(작은 안드로이드).
//
//   ★ 양성 대조군 — ④는 «키보드 표식이 남은 채» 를 심어 실패로 뒤집히는지, ②는 높은 가짜 서브헤더를 심어
//     비율이 커지는지로 검사기 자체를 먼저 검증한다.
const b = require('./lib/browser');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VPS = [
  { key: '폰 390', w: 390, h: 844 },
  { key: '폰 360', w: 360, h: 740 },
];
const KEYBOARD_H = 330;

// 실제로 여는 화면(목록 + 입력이 있는 모달·상세). {conv}·{task} 는 DB 에서 채운다.
const ROUTES = [
  '/dashboard', '/inbox', '/tasks', '/tasks?create=1', '/tasks?task={task}', '/talk', '/talk/{conv}',
  '/calendar', '/calendar?create=1', '/notes', '/docs', '/files', '/mail', '/bills', '/bills?tab=invoices&new=1',
  '/sale', '/info', '/projects', '/business/clients', '/business/members', '/business/settings',
  '/profile', '/me/work-settings', '/attendance',
  '/docs?post={post}', '/mail?thread={thread}', '/sale/{client}',
];

async function fixtures() {
  const { sequelize } = require('/opt/planq/dev-backend/config/database');
  const [[u]] = await sequelize.query("SELECT id, active_business_id AS biz FROM users WHERE email = ?", { replacements: [b.CREDS.email] });
  const [[c]] = await sequelize.query(
    `SELECT c.id FROM conversations c JOIN conversation_participants p ON p.conversation_id = c.id
     WHERE p.user_id = ? AND c.business_id = ? ORDER BY c.id DESC LIMIT 1`, { replacements: [u.id, u.biz] });
  const [[t]] = await sequelize.query(
    `SELECT id FROM tasks WHERE business_id = ? AND (assignee_id = ? OR created_by = ?) AND status NOT IN ('completed','canceled')
     ORDER BY id DESC LIMIT 1`, { replacements: [u.biz, u.id, u.id] });
  const one = async (q) => { const [[r]] = await sequelize.query(q, { replacements: [u.biz] }); return r && r.id; };
  return {
    conv: c && c.id, task: t && t.id,
    post: await one('SELECT id FROM posts WHERE business_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1'),
    thread: await one('SELECT id FROM email_threads WHERE business_id = ? ORDER BY id DESC LIMIT 1'),
    client: await one('SELECT id FROM clients WHERE business_id = ? ORDER BY id DESC LIMIT 1'),
  };
}

// ── 화면 한 장의 크롬 측정 ──
function chromeProbe() {
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh;
  };
  const hdr = document.querySelector('[data-pq-mobile-header]');
  const hr = hdr && vis(hdr) ? hdr.getBoundingClientRect() : null;
  let headerCovered = null;
  if (hr) {
    // 헤더 한가운데와 양 끝 버튼 자리를 찍어 본다 — 헤더가 아닌 것이 잡히면 무언가 덮고 있다
    for (const x of [30, vw / 2, vw - 30]) {
      const h = document.elementFromPoint(x, hr.top + hr.height / 2);
      if (h && !hdr.contains(h) && !h.closest('[aria-modal="true"],[data-pq-drawer-panel],[role="dialog"]')) {
        headerCovered = `${h.tagName.toLowerCase()}.${String(h.className).split(' ')[0].slice(0, 24)} @x${Math.round(x)}`;
        break;
      }
    }
  }
  // 콘텐츠 시작 — 화면 안에서 **세로로 스크롤되는** 가장 큰 상자의 top. 모달이 열려 있으면 그 안에서.
  const scope = document.querySelector('[aria-modal="true"]') || document.body;
  let best = null, bestArea = 0;
  for (const el of scope.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowY)) continue;
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.6 || r.height < 80) continue;
    const area = r.width * Math.min(r.height, vh);
    if (area > bestArea) { bestArea = area; best = el; }
  }
  let contentTop = null, scrollerDesc = null;
  if (best) {
    // 스크롤 상자 안의 첫 «보이는» 자식 — sticky 머리줄·필터를 품은 상자라면 그 아래가 콘텐츠다
    const br = best.getBoundingClientRect();
    contentTop = br.top;
    const stickies = [...best.querySelectorAll('*')].filter((e) => {
      const cs = getComputedStyle(e);
      return (cs.position === 'sticky') && vis(e) && e.getBoundingClientRect().top <= br.top + 2;
    });
    for (const s of stickies) contentTop = Math.max(contentTop, s.getBoundingClientRect().bottom);
    scrollerDesc = `${best.tagName.toLowerCase()}.${String(best.className).split(' ')[0].slice(0, 20)}`;
    document.querySelectorAll('[data-sweep-scroller]').forEach((x) => x.removeAttribute('data-sweep-scroller'));
    best.setAttribute('data-sweep-scroller', '1');   // 대조군이 **같은 상자**에 끼우도록
  }
  const bandEls = [...document.querySelectorAll('[data-testid="page-header"],[data-testid="panel-header"]')].filter(vis);
  const bands = bandEls.map((e) => Math.round(e.getBoundingClientRect().height));
  // 제목이 한 줄인데 머리줄만 큰 것 — 버튼이 줄 높이를 밀어 올린 경우(화면마다 56/65 로 갈라진 원인)
  const tallOneLine = bandEls.map((e) => {
    const t = e.querySelector('h1,h2');
    const th = t ? t.getBoundingClientRect().height : 0;
    return { h: Math.round(e.getBoundingClientRect().height), th: Math.round(th) };
  }).filter((x) => x.h > 60 && x.th > 0 && x.th < 30);
  const offRight = [...document.querySelectorAll('button,a[href],input,select,textarea')].filter((e) => {
    if (!vis(e)) return false;
    const r = e.getBoundingClientRect();
    if (r.right <= vw + 1) return false;
    // 가로 스크롤 상자 안이면 의도
    for (let q = e.parentElement; q && q !== document.body; q = q.parentElement) {
      const cs = getComputedStyle(q);
      if (/(auto|scroll|hidden)/.test(cs.overflowX) && q.getBoundingClientRect().right <= vw + 1) return false;
    }
    return true;
  }).length;
  return {
    vw, vh, header: hr ? { top: Math.round(hr.top), h: Math.round(hr.height), bottom: Math.round(hr.bottom) } : null,
    headerCovered, contentTop: contentTop == null ? null : Math.round(contentTop), scrollerDesc, bands, tallOneLine,
    modal: !!document.querySelector('[aria-modal="true"]'), offRight,
  };
}

// 입력 전후를 비교할 상태 스냅샷
function snapProbe() {
  const hdr = document.querySelector('[data-pq-mobile-header]');
  const hr = hdr ? hdr.getBoundingClientRect() : null;
  const main = document.querySelector('[data-panel-main]') || document.querySelector('main') || document.getElementById('root');
  const mr = main ? main.getBoundingClientRect() : null;
  return {
    kb: document.body.getAttribute('data-keyboard-up'),
    hTop: hr ? Math.round(hr.top) : null, hH: hr ? Math.round(hr.height) : null,
    mainH: mr ? Math.round(mr.height) : null, mainTop: mr ? Math.round(mr.top) : null,
    scrollY: Math.round(window.scrollY), vvTop: Math.round((window.visualViewport && window.visualViewport.offsetTop) || 0),
    hScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    rootH: Math.round(document.getElementById('root') ? document.getElementById('root').getBoundingClientRect().height : 0),
  };
}

async function inputsOf(page) {
  const hs = await page.$$('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]):not([type=range]):not([type=color]), textarea, [contenteditable="true"]');
  const hasModal = !!(await page.$('[aria-modal="true"]'));
  const out = [];
  for (const h of hs) {
    const ok = await h.evaluate((el, hasModal) => {
      if (el.disabled || el.readOnly) return false;
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      if (!(r.height > 10 && r.width > 10 && el.offsetParent !== null && s.visibility !== 'hidden' && Number(s.opacity) > 0)) return false;
      if (r.bottom <= 0 || r.top >= window.innerHeight) return false;
      if (hasModal) return !!el.closest('[aria-modal="true"]');
      return true;
    }, hasModal).catch(() => false);
    if (ok) out.push(h);
  }
  return out;
}

async function setVp(page, v, h) {
  const cdp = await page.target().createCDPSession();
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: v.w, height: h, mobile: true, deviceScaleFactor: 2 });
  await cdp.detach().catch(() => {});
}

// 입력 한 개의 «누르기 전 → 입력 중 → 끝낸 뒤»
async function checkInput(page, v, el) {
  const writes0 = (page.__writes || []).length;
  const before = await page.evaluate(snapProbe);
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await sleep(150);
  const pre = await page.evaluate(snapProbe);   // 스크롤로 맞춘 뒤의 기준(헤더·높이는 before 와 같아야 한다)
  await el.focus();
  await sleep(120);
  await setVp(page, v, v.h - KEYBOARD_H);
  await sleep(800);
  const during = await el.evaluate((e) => {
    const vvh = Math.round((window.visualViewport && window.visualViewport.height) || window.innerHeight);
    let r = e.getBoundingClientRect();
    if (e.isContentEditable) {
      const s = getSelection();
      try {
        const rg = document.createRange(); rg.selectNodeContents(e); rg.collapse(false); s.removeAllRanges(); s.addRange(rg);
        const rs = rg.getClientRects(); if (rs.length) r = rs[rs.length - 1];
      } catch { /* 요소 rect */ }
    }
    const cy = Math.min(Math.max(r.top + Math.min(r.height, 20) / 2, 0), vvh - 1);
    const cx = Math.min(Math.max(r.left + 12, 0), window.innerWidth - 1);
    const hit = document.elementFromPoint(cx, cy);
    const hdr = document.querySelector('[data-pq-mobile-header]');
    const hb = hdr ? hdr.getBoundingClientRect() : null;
    return {
      top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(e.getBoundingClientRect().height), vvh,
      hitSelf: !!hit && (hit === e || e.contains(hit) || hit.contains(e)),
      hitDesc: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0].slice(0, 22)}` : 'null',
      active: document.activeElement === e,
      kb: document.body.getAttribute('data-keyboard-up'),
      hScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      hdrBottom: hb && getComputedStyle(hdr).display !== 'none' ? Math.round(hb.bottom) : 0,
      // 입력 중 «앞뒤를 보며 쓸 수 있는» 내용 영역 — 화면 안에서 가장 큰 세로 스크롤 상자의 보이는 높이
      view: (() => {
        let best = 0;
        for (const q of document.querySelectorAll('*')) {
          const cs = getComputedStyle(q);
          if (!/(auto|scroll)/.test(cs.overflowY) || cs.display === 'none') continue;
          // 실제로 스크롤되는 상자만 — 화면 전체를 감싼 셸(넘치지 않음)을 재면 늘 크게 나온다(첫 판정이 그랬다)
          if (q.scrollHeight <= q.clientHeight + 4) continue;
          const qr = q.getBoundingClientRect();
          if (qr.width < window.innerWidth * 0.6) continue;
          const vis = Math.min(qr.bottom, vvh) - Math.max(qr.top, hb ? hb.bottom : 0);
          if (vis > best) best = vis;
        }
        return best > 0 ? Math.round(best) : null;   // 스크롤되는 상자가 없으면 판정 대상 아님
      })(),
      tag: e.tagName.toLowerCase() + (e.getAttribute('data-testid') ? `[${e.getAttribute('data-testid')}]` : (e.placeholder ? `[${String(e.placeholder).slice(0, 14)}]` : '')),
    };
  });
  // 키보드 내림 + 포커스 해제
  await setVp(page, v, v.h);
  await page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
  await sleep(800);
  const after = await page.evaluate(snapProbe);
  await sleep(400);
  const wrote = (page.__writes || []).slice(writes0);

  const fails = [];
  // 눌렀다 떼기만 했다 — 아무것도 저장되면 안 된다(2026-09-30 실측: 시간 칸 blur 가 PATCH 를 쏴
  //   반복 업무 창이 뜨고 자동 누적이 멈췄다)
  if (wrote.length) fails.push(`입력 없이 눌렀다 뗐는데 저장이 나감: ${wrote.slice(0, 2).join(' , ')}`);
  if (!during.active) fails.push('포커스가 안 잡힘(누르면 다른 것이 가로챈다)');
  if (during.kb !== '1') fails.push('키보드 감지 안 걸림');
  const small = during.h > during.vvh * 0.8; // 본문 에디터처럼 화면보다 큰 입력 — 캐럿으로 잰 값
  if (during.bottom > during.vvh - 4 && !small) fails.push(`키보드에 가림 (bottom ${during.bottom} > ${during.vvh})`);
  if (during.top < during.hdrBottom - 2 && !small) fails.push(`헤더 밑에 숨음 (top ${during.top} < 헤더 ${during.hdrBottom})`);
  else if (!during.hitSelf && during.top >= 0 && during.top < during.vvh) fails.push(`입력 자리를 다른 것이 덮음 (${during.hitDesc})`);
  if (during.hScroll > 1) fails.push(`입력 중 가로 넘침 ${during.hScroll}px`);
  if (during.view !== null && during.view < 96) fails.push(`입력 중 볼 수 있는 내용 영역 ${during.view}px — 앞뒤를 보며 쓸 수 없다`);
  // 끝낸 뒤 — 원래대로
  if (after.kb === '1') fails.push('키보드 내린 뒤에도 «키보드 올라옴» 상태가 남음');
  if (before.hTop !== null && (after.hTop !== before.hTop || after.hH !== before.hH)) fails.push(`헤더가 제자리로 안 돌아옴 (${before.hTop}/${before.hH} → ${after.hTop}/${after.hH})`);
  if (before.rootH && Math.abs(after.rootH - before.rootH) > 2) fails.push(`화면 높이가 안 돌아옴 (${before.rootH} → ${after.rootH})`);
  if (pre.mainH !== null && after.mainH !== null && Math.abs(after.mainH - pre.mainH) > 2) fails.push(`본문 영역 높이 변함 (${pre.mainH} → ${after.mainH})`);
  if (after.scrollY !== 0 || after.vvTop !== 0) fails.push(`문서가 밀린 채 남음 (scrollY ${after.scrollY}, vvTop ${after.vvTop})`);
  if (after.hScroll > 1) fails.push(`끝낸 뒤 가로 넘침 ${after.hScroll}px`);
  return { tag: during.tag, fails, ctx: `위 ${during.top - during.hdrBottom}px · 아래 ${during.vvh - during.bottom}px · 내용 ${during.view}px` };
}

async function run() {
  const results = [];
  const push = (name, ok, details, extra = {}) => results.push({ name, fail: ok ? 0 : 1, details: [].concat(details), ...extra });
  const fx = await fixtures();
  const { browser } = await b.launch();
  try {
    for (const v of VPS) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: v.w, height: v.h, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await page.setUserAgent(UA);
      page.__writes = [];
      page.on('request', (r) => {
        const m = r.method();
        if (!['PUT', 'PATCH', 'POST', 'DELETE'].includes(m)) return;
        const u = r.url();
        // 읽기 성격의 POST·로그 수집은 뺀다(검색·집계·크래시·방문·토큰 갱신)
        if (!/\/api\//.test(u) || /\/(auth|crash|client-errors|landing-visits|search|presence|typing|read|seen|heartbeat|focus|events\/track)/.test(u)) return;
        page.__writes.push(`${m} ${u.replace(/.*\/api/, '')}`);
      });
      await b.login(page);
      await b.goto(page, '/dashboard');
      await b.dismissBlockers(page);

      // ── 대조군 ①: 키보드 표식이 남은 상태를 심으면 ④가 실패해야 한다
      {
        const ins = await inputsOf(page);
        let flipped = null;
        if (!ins.length) { await b.goto(page, '/tasks'); await b.dismissBlockers(page); }
        const ins2 = ins.length ? ins : await inputsOf(page);
        if (ins2.length) {
          await page.evaluate(() => {
            // 키보드 표식을 되돌리지 못하게 막는다 — «레이아웃이 안 돌아가는» 상태를 인위로 만든다
            const orig = document.body.removeAttribute.bind(document.body);
            window.__sweepOrig = orig;
            document.body.removeAttribute = (n) => (n === 'data-keyboard-up' ? undefined : orig(n));
          });
          // 같은 입력에 «blur 때 저장을 쏘는» 결함도 심는다 — 저장 나감 판정이 뒤집혀야 한다
          await ins2[0].evaluate((e) => e.addEventListener('blur', () => { fetch('/api/__sweep_probe', { method: 'PUT' }).catch(() => {}); }, { once: true }));
          const r = await checkInput(page, v, ins2[0]);
          flipped = r.fails.some((f) => /키보드 내린 뒤/.test(f)) && r.fails.some((f) => /저장이 나감/.test(f));
          await page.evaluate(() => { document.body.removeAttribute = window.__sweepOrig; document.body.removeAttribute('data-keyboard-up'); });
        }
        push(`${v.key} · 대조군: 안 돌아간 키보드 상태·blur 저장을 잡는다`, flipped === true, flipped === null ? '입력이 없어 대조군 미측정' : `뒤집힘 ${flipped}`,
          flipped === null ? { unmeasured: true } : {});
      }
      // ── 대조군 ②: 높은 가짜 머리줄을 심으면 콘텐츠 시작이 내려가야 한다
      {
        await b.goto(page, '/tasks'); await b.dismissBlockers(page);
        const a = await page.evaluate(chromeProbe);
        await page.evaluate(() => {
          const s = document.querySelector('[data-sweep-scroller]');
          if (!s) return;
          // 스크롤 상자 **안 첫 자리**에 sticky 머리줄을 끼운다 — 판정기가 sticky 누적을 세는지 본다
          const p = document.createElement('div'); p.id = '__sweep_band';
          p.style.cssText = 'position:sticky;top:0;height:300px;flex-shrink:0;background:#fee;z-index:5;';
          s.insertBefore(p, s.firstChild);
        });
        await sleep(200);
        const bb = await page.evaluate(chromeProbe);
        await page.evaluate(() => { const x = document.getElementById('__sweep_band'); x && x.remove(); });
        const ok = a.contentTop != null && bb.contentTop != null && bb.contentTop - a.contentTop >= 250;
        push(`${v.key} · 대조군: 끼운 머리줄만큼 콘텐츠 시작이 내려간다`, ok, `${a.contentTop} → ${bb.contentTop}`);
      }

      const headers = [];
      const only = (process.env.SWEEP_ROUTES || '').split(',').filter(Boolean);
      for (const raw of ROUTES.filter((r) => !only.length || only.includes(r))) {
        const miss = (raw.match(/\{(\w+)\}/g) || []).map((k) => k.slice(1, -1)).find((k) => !fx[k]);
        if (miss) { push(`${v.key} · ${raw}`, false, `${miss} 픽스처 없음 — 미측정`, { unmeasured: true }); continue; }
        const route = raw.replace(/\{(\w+)\}/g, (_, k) => fx[k]);
        await b.goto(page, route);
        await b.dismissBlockers(page);
        await sleep(500);
        const at = await page.evaluate(() => location.pathname);
        if (at.startsWith('/login')) { push(`${v.key} · ${raw}`, false, '로그인으로 튕김 — 미측정', { unmeasured: true }); continue; }
        const c = await page.evaluate(chromeProbe);
        const bad = [], warn = [];
        if (c.header) headers.push({ route: raw, ...c.header });
        if (c.headerCovered && !c.modal) bad.push(`상단 헤더를 덮음: ${c.headerCovered}`);
        if (c.offRight) bad.push(`화면 밖으로 삐져나간 컨트롤 ${c.offRight}`);
        let ratio = null;
        if (c.contentTop != null) {
          ratio = c.contentTop / c.vh;
          if (!c.modal && ratio > 0.45) bad.push(`크롬이 화면의 ${Math.round(ratio * 100)}% (콘텐츠 시작 y ${c.contentTop}/${c.vh})`);
          else if (!c.modal && ratio > 0.35) warn.push(`경고: 크롬 ${Math.round(ratio * 100)}%`);
        }
        if (c.tallOneLine.length) bad.push(`머리줄 ${c.tallOneLine.map((x) => x.h).join(',')}px — 제목은 한 줄(${c.tallOneLine.map((x) => x.th).join(',')}px)인데 버튼이 줄을 키움`);
        const tall = c.bands.filter((h) => h > 72);
        if (tall.length) warn.push(`경고: 머리줄 높이 ${tall.join(',')}px(두 줄?)`);
        // 입력 전후
        const ins = (await inputsOf(page)).slice(0, 4);
        const inputNotes = [];
        for (const el of ins) {
          try {
            const r = await checkInput(page, v, el);
            if (r.fails.length) bad.push(`입력 ${r.tag}: ${r.fails.join(' / ')}`);
            else inputNotes.push(`${r.tag}(${r.ctx})`);
          } catch (e) { inputNotes.push(`입력 판정 오류 ${e.message.slice(0, 60)}`); }
        }
        const info = `콘텐츠 시작 ${c.contentTop ?? '?'}/${c.vh}${ratio != null ? ` (${Math.round(ratio * 100)}%)` : ''} · 스크롤 ${c.scrollerDesc || '없음'} · 머리줄 ${c.bands.join(',') || '-'} · 입력 ${ins.length}${inputNotes.length ? ' ✓ ' + inputNotes.join(' ') : ''}`;
        push(`${v.key} · ${raw}`, bad.length === 0, [...bad, ...warn, info]);
      }
      // 상단 헤더 통일 — 전 화면에서 같은 자리·같은 높이
      const sig = (h) => `${h.top}/${h.h}`;
      const counts = {};
      headers.forEach((h) => { counts[sig(h)] = (counts[sig(h)] || 0) + 1; });
      const mode = Object.keys(counts).sort((x, y) => counts[y] - counts[x])[0];
      const odd = headers.filter((h) => sig(h) !== mode);
      push(`${v.key} · 상단 헤더 통일 (${headers.length}화면)`, headers.length > 0 && odd.length === 0,
        headers.length ? `기준 top/높이 ${mode}${odd.length ? ' · 다름: ' + odd.map((h) => `${h.route}=${sig(h)}`).join(', ') : ''}` : '헤더 못 찾음',
        headers.length ? {} : { unmeasured: true });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

module.exports = { name: '모바일 전수 — 상단 헤더 통일·크롬 비율·입력 전후 복원 (27화면 × 폰 2폭)', run };
