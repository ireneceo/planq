#!/usr/bin/env node
// canary-sticky — 서브헤더가 스크롤 시 **실제로 가려지는지** 좌표로 잰다.
//
// 운영 신고 (Irene 2026-09-03): "서브헤더가 제대로 스티키 기능 안되고 헤더 아래로 들어가는 것도 있어.
//   페이지 전수검사 해야 해"
//
// 왜 CSS 를 읽지 않고 화면을 재는가:
//   `position: sticky; top: 0` 은 **그 자체로는 옳고 그름이 없다.** 스크롤 조상이 무엇이냐에 따라
//   페이지 헤더 바로 아래에 붙기도 하고(PageShell — 헤더가 스크롤 밖) 헤더 뒤로 파고들기도 한다
//   (스크롤이 window 인 페이지). 선언만 보면 둘이 구별되지 않는다.
//   → 스크롤한 뒤 **그 지점에 무엇이 그려져 있는지**(elementFromPoint) 로 판정한다.
//     memory feedback_measure_the_screen_not_innertext · feedback_detector_must_report_coverage
//
// 판정 (스크롤 후):
//   ① 안 붙음   — 스크롤 조상 밖으로 밀려 사라졌다 (sticky 가 동작하지 않음)
//   ② 가려짐   — 자리는 지켰는데 그 좌표에 **다른 것**이 그려진다 (헤더 아래로 파고듦)
//   둘 다 아니면 통과.
const b = require('./lib/browser');

const PAGES = (process.env.STICKY_PAGES || [
  '/dashboard', '/inbox', '/talk', '/mail', '/tasks', '/projects', '/calendar',
  '/notes', '/docs', '/info', '/files', '/bills', '/personal-vault',
  '/stats/overview', '/stats/tasks', '/stats/weekly', '/stats/profit', '/stats/team',
  '/stats/finance', '/stats/reports',
  '/business/settings', '/business/members', '/business/clients', '/business/org',
  '/business/settings/plan', '/business/settings/work-env', '/business/settings/permissions',
  '/business/settings/storage', '/business/settings/notifications',
  '/profile', '/profile/integrations', '/me/work-settings', '/me/feedback',
].join(',')).split(',').map(s => s.trim()).filter(Boolean);
// 공개 공유 페이지(PublicSignPage·PublicPostPage·PublicDocPage·PublicInvoicePage·PublicKb*·PublicQNote)는
//   유효 토큰이 필요해 이 검사가 닿지 못한다. 커버리지 보고에 명시한다 — 안 본 것을 통과로 세지 않는다.
const OUT_OF_REACH = 7;

const SCROLL_BY = 700;

async function probe(page) {
  return page.evaluate((SCROLL_BY) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return el.offsetParent !== null && r.width > 4 && r.height > 4;
    };
    // 스크롤 조상 — overflow-y 가 auto/scroll 이고 실제로 넘치는 것. 없으면 문서 스크롤.
    const scrollParent = (el) => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 8) return p;
        p = p.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    };
    const label = (el) => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28);
      return `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}${t ? ` "${t}"` : ''}`;
    };

    const stickies = [...document.querySelectorAll('*')]
      .filter(el => getComputedStyle(el).position === 'sticky' && vis(el));

    const results = [];
    for (const el of stickies) {
      const sp = scrollParent(el);
      const before = el.getBoundingClientRect();
      const prevTop = sp.scrollTop;
      sp.scrollTop = prevTop + SCROLL_BY;
      // 레이아웃 강제 반영
      void sp.offsetHeight;
      const after = el.getBoundingClientRect();
      const moved = sp.scrollTop - prevTop;

      let verdict = 'ok', detail = '';
      if (moved < 40) {
        verdict = 'skip'; detail = '스크롤 여지 없음';
      } else if (after.bottom <= 1) {
        verdict = 'notstuck'; detail = `스크롤 후 화면 밖 (top ${Math.round(before.top)} → ${Math.round(after.top)})`;
      } else {
        // 가려짐 — 요소 상단 중앙에 무엇이 그려져 있는가
        const x = Math.min(window.innerWidth - 2, Math.max(2, after.left + Math.min(after.width / 2, 120)));
        const y = Math.max(2, after.top + 3);
        const hit = document.elementFromPoint(x, y);
        if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
          verdict = 'covered';
          detail = `그 자리에 ${label(hit)} 가 있다 (y=${Math.round(after.top)})`;
        }
      }
      sp.scrollTop = prevTop;
      results.push({ el: label(el), top: getComputedStyle(el).top, verdict, detail });
    }
    return results;
  }, SCROLL_BY);
}

(async () => {
  const { browser, page } = await b.launch({});
  await page.setViewport({ width: 1440, height: 900 });
  await b.login(page);

  // ★ 목록 페이지만 돌면 sticky 선언 27곳 중 대부분에 안 닿는다 (실측: 33페이지에 9개).
  //   남은 것은 **프로젝트 상세 탭·권한 매트릭스·드로어**에 몰려 있다. 거기까지 넓힌다.
  //   (공개 공유 페이지 7곳은 토큰이 필요해 이 검사 밖 — 아래 커버리지에 그렇게 적는다.)
  const extra = [];
  try {
    // ★ 페이지 안 fetch 는 쿠키만 실어 401 이 난다(실측) — 앱은 Bearer 토큰을 쓴다.
    //   그래서 조회는 Node 에서 토큰으로 한다. 안 그러면 프로젝트 탭에 영영 안 닿는다.
    const api = process.env.STICKY_API || 'http://127.0.0.1:3003/api';
    const jj = async (r) => { try { return JSON.parse(await r.text()); } catch { return {}; } };
    const lj = await jj(await fetch(`${api}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: b.CREDS.email, password: b.CREDS.password }),
    }));
    const tok = lj?.data?.accessToken || lj?.data?.access_token || lj?.data?.token;
    const H = { Authorization: `Bearer ${tok}` };
    const bz = await jj(await fetch(`${api}/businesses`, { headers: H }));
    const biz = (bz?.data || [])[0]?.id;
    const pj = biz ? await jj(await fetch(`${api}/projects?business_id=${biz}`, { headers: H })) : {};
    const found = { biz, project: (pj?.data || [])[0]?.id || null };
    if (found?.project) {
      for (const tab of ['dashboard', 'tasks', 'clients', 'files', 'docs', 'info', 'transactions', 'report', 'history']) {
        extra.push(`/projects/p/${found.project}?tab=${tab}`);
      }
    }
    extra.push('/business/settings/permissions');
  } catch { /* 못 찾으면 목록 페이지만 */ }
  if (extra.length) PAGES.push(...extra);
  // ★ 양성 대조군 — 검사기가 살아 있는지 먼저 증명한다.
  //   "0건" 이 정상인지 **아무것도 못 본 것**인지 구별되지 않으면 이 검사는 없는 것과 같다
  //   (memory feedback_empty_fixture_false_verdict · feedback_guard_must_be_falsified).
  await page.goto(b.BASE + '/tasks', { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise(r => setTimeout(r, 1500));
  const canary = await page.evaluate(() => {
    const sp = [...document.querySelectorAll('*')].find(el => {
      const cs = getComputedStyle(el);
      return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 200;
    });
    if (!sp) return { planted: false };
    // 스크롤 컨테이너 안에 sticky 서브헤더 + 그 위를 덮는 가짜 헤더를 심는다
    const sub = document.createElement('div');
    sub.id = '__sticky_canary__';
    sub.textContent = 'CANARY SUBHEADER';
    sub.style.cssText = 'position:sticky;top:0;height:40px;background:#fee;z-index:1;';
    sp.insertBefore(sub, sp.firstChild);
    const cover = document.createElement('div');
    cover.id = '__sticky_cover__';
    cover.textContent = 'CANARY COVER';
    const r = sp.getBoundingClientRect();
    cover.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:60px;background:#333;z-index:9999;`;
    document.body.appendChild(cover);
    return { planted: true };
  });
  if (!canary.planted) {
    console.log('[sticky] ⚠ 카나리를 심을 스크롤 컨테이너를 못 찾았다 — 검사기 신뢰도 미확인');
  } else {
    const cr = await probe(page);
    const caught = cr.find(r => /__sticky_canary__|CANARY SUBHEADER/.test(r.el) && r.verdict !== 'ok');
    console.log(caught
      ? `[sticky] 카나리 ✅ 검출됨 (${caught.verdict}: ${caught.detail})`
      : '[sticky] 카나리 ❌ **검출 실패 — 이 검사는 아무것도 못 잡는 상태다**');
    await page.evaluate(() => { document.getElementById('__sticky_canary__')?.remove(); document.getElementById('__sticky_cover__')?.remove(); });
    if (!caught) { await browser.close(); process.exit(2); }
  }

  const fails = [];
  let pagesChecked = 0, stickyChecked = 0, skipped = 0;
  const perPage = [];

  for (const path of PAGES) {
    try {
      await page.goto(b.BASE + path, { waitUntil: 'networkidle2', timeout: 45000 });
      await new Promise(r => setTimeout(r, 1600));
      const rows = await probe(page);
      pagesChecked += 1;
      perPage.push({ path, n: rows.length, ok: rows.filter(r => r.verdict === 'ok').length });
      for (const r of rows) {
        if (r.verdict === 'skip') { skipped += 1; continue; }
        stickyChecked += 1;
        if (r.verdict !== 'ok') fails.push({ path, ...r });
      }
    } catch (e) {
      fails.push({ path, el: '-', verdict: 'error', detail: String(e.message).slice(0, 90) });
    }
  }

  // ★ 커버리지를 반드시 뱉는다 — "0건" 이 정상인지 아무것도 안 본 것인지 구별되어야 한다
  console.log(`\n[sticky] 페이지 ${pagesChecked}/${PAGES.length} · sticky 요소 ${stickyChecked}개 판정 (스크롤 여지 없어 건너뜀 ${skipped}개)`);
  const zero = perPage.filter(p => p.n === 0).map(p => p.path);
  if (zero.length) console.log(`[sticky] sticky 요소가 하나도 없던 페이지 ${zero.length}개: ${zero.join(' ')}`);
  console.log(`[sticky] 이 검사가 못 닿는 곳: 공개 공유 페이지 ${OUT_OF_REACH}곳(토큰 필요) · 드로어/모달 내부(열어야 렌더)`);
  if (!fails.length) {
    console.log('[sticky] ✅ 가려지거나 안 붙는 서브헤더 0건');
  } else {
    console.log(`[sticky] ❌ ${fails.length}건`);
    for (const f of fails) console.log(`  - ${f.path} · ${f.el} (top:${f.top}) → ${f.verdict}: ${f.detail}`);
  }
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('[sticky] 크래시', e.message); process.exit(2); });
