// canary-mail-sent-via — 보낸메일함 «어디서 보냈나» 필터 (2026-10-12)
//
//   Irene: *"내 이메일주소에서 다른 ai 나 플랫폼에서 보낸 이메일도 보낸메일에서 봐야 해. 그냥 나오게 하고
//     우리가 보낸 메일은 여기서 보낸 메일은 제대로 체크해주고 필터링으로 각각 볼 수 있게"*
//
//   ① 서버 — 전체 = PlanQ ∪ 다른 곳 · 각 필터의 행은 자기 쪽 표시만 · 받은 메일 폴더는 sent_via 를 무시
//   ② 화면 3폭 — 보낸메일함에만 알약 줄이 보인다(elementFromPoint) · 누르면 그 쪽 행만 · PlanQ 발송 표시는 PlanQ 행에만
//   ★ 픽스처는 카나리 워크스페이스(biz 5)에 이미 있는 보낸 메일이다(다른 곳 100여 건 · PlanQ 1건). 없으면 ⬜ 미측정.
const b = require('./lib/browser');

const BIZ = Number(process.env.E2E_MAIL_BIZ || 5);
const WIDTHS = [
  { name: '폰', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: '태블릿', width: 820, height: 1180 },
  { name: '데스크탑', width: 1440, height: 900 },
];

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  const { browser, page } = await b.launch();
  try {
    await b.login(page);
    // ── ① 서버 ──────────────────────────────────────────
    await b.goto(page, '/mail?folder=sent&account=0');
    const api = await page.evaluate(async (biz) => {
      const tok = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }).then((r) => r.json()).then((j) => j?.data?.token).catch(() => null);
      const H = { Authorization: `Bearer ${tok}`, 'X-Workspace-Id': String(biz) };
      const get = (q) => fetch(`/api/businesses/${biz}/email-threads?limit=500${q}`, { credentials: 'include', headers: H }).then((r) => r.json());
      const [all, pq, ot, inbox] = await Promise.all([get('&folder=sent'), get('&folder=sent&sent_via=planq'), get('&folder=sent&sent_via=other'), get('&folder=all&sent_via=planq')]);
      const ids = (j) => (j.data || []).map((d) => d.id);
      return {
        ok: !!(all.success && pq.success && ot.success),
        total: [all.pagination?.total, pq.pagination?.total, ot.pagination?.total],
        allIds: ids(all), pqIds: ids(pq), otIds: ids(ot),
        pqVia: [...new Set((pq.data || []).map((d) => d.sent_via))],
        otVia: [...new Set((ot.data || []).map((d) => d.sent_via))],
        inboxVia: [...new Set((inbox.data || []).map((d) => d.sent_via))],
        allTotal: all.pagination?.total, inboxTotal: inbox.pagination?.total,
      };
    }, BIZ);
    if (!api.ok || !api.pqIds.length || !api.otIds.length) {
      results.push({ name: '픽스처 — 두 종류 보낸 메일', unmeasured: true, details: [`planq ${api.pqIds.length} / other ${api.otIds.length} — 둘 다 있어야 잰다`] });
      return results;
    }
    const A = new Set(api.allIds);
    push('서버 — PlanQ·다른 곳 모두 전체 안', api.pqIds.every((i) => A.has(i)) && api.otIds.every((i) => A.has(i)), `total all/planq/other = ${api.total.join('/')}`);
    push('서버 — 전체 = PlanQ ∪ 다른 곳', api.allIds.every((i) => api.pqIds.includes(i) || api.otIds.includes(i)), `빠진 행이 있으면 필터 사이로 메일이 사라진다`);
    push('서버 — 필터 행은 자기 쪽 표시만', api.pqVia.join() === 'planq' && api.otVia.join() === 'other', `planq=${api.pqVia} other=${api.otVia}`);
    push('서버 — 받은 메일 폴더는 sent_via 무시 (음성 대조군)', api.inboxVia.every((v) => v === null) && api.inboxTotal > 0, `via=${api.inboxVia} total=${api.inboxTotal}`);

    // ── ② 화면 3폭 ──────────────────────────────────────
    for (const vp of WIDTHS) {
      await page.setViewport({ width: vp.width, height: vp.height, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch });
      await b.goto(page, '/mail?folder=sent&account=0');
      await b.dismissBlockers?.(page);
      await page.waitForSelector('[data-testid="mail-sent-via"]', { timeout: 10000 }).catch(() => null);
      const bar = await page.evaluate(() => {
        const out = {};
        for (const k of ['all', 'planq', 'other']) {
          const el = document.querySelector(`[data-testid="mail-sent-via-${k}"]`);
          if (!el) { out[k] = null; continue; }
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          out[k] = { w: Math.round(r.width), h: Math.round(r.height), seen: !!hit && (hit === el || el.contains(hit)), text: el.textContent.trim() };
        }
        out.overflow = document.documentElement.scrollWidth - window.innerWidth;
        return out;
      });
      push(`${vp.name} — 알약 3개가 보인다`, ['all', 'planq', 'other'].every((k) => bar[k] && bar[k].seen && bar[k].h >= 26),
        JSON.stringify({ all: bar.all, planq: bar.planq, other: bar.other }));
      push(`${vp.name} — 가로 넘침 없음`, bar.overflow <= 0, `overflow=${bar.overflow}`);

      const pick = async (k) => {
        await page.click(`[data-testid="mail-sent-via-${k}"]`);
        await b.sleep(1800);
        return page.evaluate(() => {
          const rows = [...document.querySelectorAll('[data-thread-id]')];
          return {
            url: location.search,
            rows: rows.length,
            tagged: rows.filter((r) => r.querySelector('[data-testid="mail-sent-via-planq-tag"]')).length,
            sel: [...document.querySelectorAll('[data-testid^="mail-sent-via-"][aria-selected="true"]')].map((e) => e.getAttribute('data-testid')),
          };
        });
      };
      const p = await pick('planq');
      push(`${vp.name} — PlanQ에서: 그 행만 · 전부 표시`, p.url.includes('via=planq') && p.rows > 0 && p.tagged === p.rows && p.sel.join() === 'mail-sent-via-planq',
        JSON.stringify(p));
      const o = await pick('other');
      push(`${vp.name} — 다른 곳에서: 행 있음 · PlanQ 표시 0`, o.url.includes('via=other') && o.rows > 0 && o.tagged === 0, JSON.stringify(o));
      const a = await pick('all');
      push(`${vp.name} — 전체로 돌아오면 다른 곳 행도 보인다`, !a.url.includes('via=') && a.rows >= o.rows && a.rows > 0, JSON.stringify(a));

      await b.goto(page, '/mail?folder=all');
      await b.sleep(800);
      const none = await page.evaluate(() => !document.querySelector('[data-testid="mail-sent-via"]'));
      push(`${vp.name} — 받은 메일 폴더엔 줄 없음 (음성 대조군)`, none, 'folder=all');
    }
  } catch (e) {
    push('실행', false, String((e && e.message) || e));
  } finally {
    await browser.close().catch(() => null);
  }
  return results;
}

module.exports = { name: '보낸메일함 — PlanQ에서 / 다른 곳에서 필터 · PlanQ 발송 표시', run };
