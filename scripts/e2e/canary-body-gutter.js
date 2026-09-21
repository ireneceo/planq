#!/usr/bin/env node
// canary-body-gutter — PageShell 화면의 **본문 좌측 여백**이 표준(데스크탑·태블릿 20 / 폰 14)과 같은가. 3폭 전수.
//
// Irene 2026-09-21 (#422): "개인>받은 서명 메뉴가 모바일에서 레이아웃 전체 여백이 넓어. 다른 페이지랑
//   다르게. … 이런 문제있는 페이지 또 없는지 찾아서 다 통일해."
//   원인: 목록 컴포넌트가 PageShell Body(20/14) 안에서 **자기 padding 20 을 또 줬다** → 폰 34px.
//
// ★ 무엇을 재는가
//   본문 상자(`page-body`) 왼쪽 가장자리 → **처음 보이는 것**(테두리·배경이 있는 상자, 또는 글자를 가진 잎)
//   까지의 거리. 카드 안쪽 여백은 디자인이므로 카드 **테두리**가 제자리면 맞는 것이다(카드 안 글자는
//   카드 상자보다 오른쪽이라 min 에 안 걸린다). 음수(탭바가 여백을 상쇄해 가장자리까지 뻗는 것)는 의도라
//   실패로 보지 않는다 — 넓어진 것만 잡는다.
// ★ bodyPadding="0" 으로 여백을 자기가 책임지는 화면도 **같은 표준**으로 잰다(계약은 결과다).
const b = require('./lib/browser');

const ALL_VPS = [
  { key: '폰',       w: 390,  h: 844,  std: 14 },
  { key: '태블릿',   w: 834,  h: 1112, std: 20 },
  { key: '데스크탑', w: 1440, h: 900,  std: 20 },
];
const WANT_VPS = (process.env.GUT_VPS || '').split(',').map((x) => x.trim()).filter(Boolean);
const VPS = WANT_VPS.length ? ALL_VPS.filter((v) => WANT_VPS.includes(v.key)) : ALL_VPS;
const TOL = 3;
const PAGE_RECYCLE = 12;

// App.tsx 의 실제 path 와 대조한 목록 (SPA 는 없는 경로도 200 — 손잡이 없음으로만 보인다)
const ROUTES = (process.env.GUT_ROUTES || [
  '/dashboard', '/inbox', '/todo', '/projects', '/calendar', '/files', '/bills', '/billing', '/sale',
  '/knowledge', '/personal-vault', '/records', '/attendance', '/insights', '/signatures/received',
  '/stats', '/business/settings', '/business/members', '/business/clients', '/business/org',
  '/business/settings/notifications', '/business/settings/billing', '/business/settings/email',
  '/profile', '/profile/integrations', '/me/work-settings', '/me/feedback',
  '/notifications', '/whats-new', '/settings', '/admin/dashboard', '/admin/users', '/admin/wiki',
].join(',')).split(',').map((s) => s.trim()).filter(Boolean);

const results = [];
const P = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

const MEASURE = `() => {
  // ★ 탭 모드(태블릿·데스크탑)는 keep-alive 로 **숨은 탭의 본문**이 DOM 에 여럿 남는다. 첫 번째를 집으면
  //   숨은 것이라 폭 0 → 미측정이 된다(첫 실행 68건 미측정의 원인). 보이는 것 중 가장 큰 것을 고른다.
  const body = [...document.querySelectorAll('[data-testid="page-body"]')]
    .map((el) => [el, el.getBoundingClientRect()])
    .filter(([, r]) => r.width >= 40 && r.height >= 40 && r.left < innerWidth && r.top < innerHeight)
    .sort((a, b) => b[1].width * b[1].height - a[1].width * a[1].height)[0]?.[0];
  if (!body) return { none: true };
  const br = body.getBoundingClientRect();
  const bodyPad = parseFloat(getComputedStyle(body).paddingLeft) || 0;
  let min = Infinity, who = '';
  const all = body.querySelectorAll('*');
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.bottom < br.top || r.top > br.bottom) continue;       // 본문 창 밖
    const s = getComputedStyle(el);
    if (s.position === 'fixed' || s.visibility === 'hidden' || s.opacity === '0') continue;
    const boxy = (parseFloat(s.borderLeftWidth) > 0 && s.borderLeftStyle !== 'none')
      || (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent')
      || el.tagName === 'IMG' || el.tagName === 'svg' || el.tagName === 'INPUT' || el.tagName === 'BUTTON';
    let x = null;
    if (boxy) x = r.left;
    else {
      const t = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (t) { const rg = document.createRange(); rg.selectNodeContents(t); const rr = rg.getBoundingClientRect(); if (rr.width > 0) x = rr.left; }
    }
    if (x === null) continue;
    // 조상 클리핑으로 안 보이는 것 제외
    const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, x + 2)), Math.max(0, Math.min(innerHeight - 1, r.top + Math.min(r.height / 2, 10))));
    if (!hit || !(el.contains(hit) || hit.contains(el))) continue;
    if (x < min) { min = x; who = el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ')[0].slice(0, 24); }
  }
  if (min === Infinity) return { empty: true, bodyPad };
  return { gutter: Math.round(min - br.left), bodyPad, who };
}`;

async function run() {
  const { browser, page: firstPage } = await b.launch({});
  let page = firstPage;
  let measured = 0;
  const unmeasured = [];
  try {
    await b.login(page);
    let since = 0;
    for (const vp of VPS) {
      await page.setViewport({ width: vp.w, height: vp.h });
      const bad = [];
      const seen = [];
      for (const r of ROUTES) {
        if (++since >= PAGE_RECYCLE) {
          since = 0;
          const fresh = await browser.newPage();
          fresh.setDefaultTimeout(30000);
          await fresh.setViewport({ width: vp.w, height: vp.h });
          await page.close().catch(() => {});
          page = fresh;
        }
        let m;
        try {
          await b.goto(page, r);
          await b.sleep(1400);
          await b.dismissBlockers(page).catch(() => {});
          m = await page.evaluate((src) => eval(src)(), MEASURE);
        } catch (e) { bad.push(`${r} ERR ${String(e.message).slice(0, 40)}`); continue; }
        if (m.none || m.empty) { unmeasured.push(`${vp.key}:${r}`); continue; }
        measured++;
        seen.push(`${r}=${m.gutter}`);
        if (m.gutter > vp.std + TOL) bad.push(`${r} 여백 ${m.gutter}px (표준 ${vp.std}, 첫 요소 ${m.who})`);
      }
      P(`[${vp.key}] 본문 좌측 여백이 표준(${vp.std}px)보다 넓지 않다`, bad.length === 0,
        bad.length ? bad.join(' | ') : seen.join(' '));
    }

    // ★ 양성 대조군 — 받은 서명 목록에 옛 이중 여백(padding 20)을 되살리면 잡아야 한다
    const vp = VPS.find((v) => v.key === '폰') || VPS[0];
    await page.setViewport({ width: vp.w, height: vp.h });
    await b.goto(page, '/signatures/received');
    await b.sleep(1500); await b.dismissBlockers(page).catch(() => {});
    const before = await page.evaluate((src) => eval(src)(), MEASURE);
    await page.evaluate(() => {
      const body = [...document.querySelectorAll('[data-testid="page-body"]')]
        .find((el) => el.getBoundingClientRect().width >= 40);
      const first = body && body.firstElementChild;
      if (first) first.style.padding = '20px';
    });
    await b.sleep(200);
    const after = await page.evaluate((src) => eval(src)(), MEASURE);
    P('양성 대조군 — 이중 여백을 되살리면 **잡는다**',
      !before.none && !after.none && before.gutter <= vp.std + TOL && after.gutter > vp.std + TOL,
      `전 ${before.gutter}px → 되살림 ${after.gutter}px (${vp.key})`);

    P('커버리지', true, `${VPS.length}폭 × ${ROUTES.length}라우트 · 판정 ${measured}건 · 미측정 ${unmeasured.length}${unmeasured.length ? ': ' + unmeasured.join(' ') : ''}`);
  } finally { await browser.close(); }
  return results;
}

module.exports = { name: 'bodygutter', run };

if (require.main === module) {
  run().then((rs) => {
    let f = 0;
    for (const x of rs) { if (x.fail) f++; console.log(`${x.fail ? '✗' : '✓'} ${x.name}${x.details.length ? '\n    ' + x.details.join('\n    ') : ''}`); }
    console.log(f ? `\n✗ 실패 ${f}/${rs.length}` : `\n✓ 전부 통과 (${rs.length})`);
    process.exit(f ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e); process.exit(1); });
}
