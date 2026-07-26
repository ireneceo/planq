/* Fable — §2-10 3차 재판정 (MODE=broken|fixed). 실행 후 삭제 */
process.chdir('/opt/planq/dev-backend');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');
const API = 'http://localhost:3003';
const BASE = 'https://dev.planq.kr';
const BIZ = 5;
const MODE = process.argv[2] || 'fixed';
const fs = require('fs');
const assert = (name, cond, extra) => { console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 300) : ''}`); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const lr = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'health-check@planq.kr', password: 'HealthCheck2026!' }) });
  const lj = await lr.json();
  if (!lj.success) { console.log('login blocked:', lj.message); process.exit(2); }
  const tok = lj.data.token; const hcId = lj.data.user.id;
  const call = async (path, opts = {}) => { const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, ...(opts.headers || {}) } }); return { status: r.status, j: await r.json().catch(() => null) }; };
  // A: 드로어에서 보류할 업무 / B: 사전 on_hold / C: in_progress (혼합 전환용)
  const mk = async (title) => (await call('/api/tasks', { method: 'POST', body: JSON.stringify({ business_id: BIZ, title, assignee_id: hcId }) })).j.data.id;
  const ta = await mk(`FABLE206T3-${MODE} A보류대상`);
  const tb = await mk(`FABLE206T3-${MODE} B사전보류`);
  const tc = await mk(`FABLE206T3-${MODE} C진행중`);
  for (const id of [ta, tb, tc]) await call(`/api/tasks/by-business/${BIZ}/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'in_progress' }) });
  await call(`/api/tasks/by-business/${BIZ}/${tb}`, { method: 'PUT', body: JSON.stringify({ status: 'on_hold', hold_reason: 'B사전' }) });

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    await page.evaluate(async (c) => { const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(c) }); return (await r.json()).success; }, { email: 'health-check@planq.kr', password: 'HealthCheck2026!' });
    await page.goto(BASE + `/tasks?tab=all&task=${ta}`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    await page.evaluate(() => {
      window.__focusLog = [];
      document.addEventListener('focusin', (e) => {
        const t = e.target;
        window.__focusLog.push({ at: Date.now(), tid: t.getAttribute && t.getAttribute('data-testid'), tag: t.tagName, txt: (t.textContent || t.placeholder || '').slice(0, 18) });
      }, true);
    });
    await page.evaluate(() => document.querySelector('[data-testid="task-hold"]').click());
    await sleep(600);
    await page.keyboard.type('3차사유', { delay: 15 });
    await page.evaluate(() => document.querySelector('[data-testid="task-hold-confirm"]').click());
    await sleep(2500);
    const foc = await page.evaluate(() => ({
      active: document.activeElement ? { tid: document.activeElement.getAttribute('data-testid'), txt: (document.activeElement.textContent || '').slice(0, 18) } : null,
      log: window.__focusLog.map((l) => ({ tid: l.tid, tag: l.tag, txt: l.txt })),
    }));
    fs.writeFileSync(`/tmp/claude-1000/-opt-planq/2d401771-6f4d-4d11-972f-490d2b6d16be/scratchpad/focuslog-${MODE}.json`, JSON.stringify(foc.log));
    console.log(`focusLog(${MODE}):`, JSON.stringify(foc.log));
    if (MODE === 'broken') {
      assert('★반증: 무력화 빌드 — task-resume focusin 0 + activeElement ≠ task-resume', foc.log.every((l) => l.tid !== 'task-resume') && (!foc.active || foc.active.tid !== 'task-resume'), foc.active);
    } else {
      assert('★기준1: focusin 로그에 task-resume 등장', foc.log.some((l) => l.tid === 'task-resume'), undefined);
      assert('★기준1: activeElement = task-resume (t+2.5s)', foc.active && foc.active.tid === 'task-resume', foc.active);
      // trap 순서 경쟁 — task-resume focusin 이후 다른 focusin 이 덮었는지
      const idx = foc.log.map((l) => l.tid).lastIndexOf('task-resume');
      const after = foc.log.slice(idx + 1);
      assert('★trap 경쟁 없음: task-resume 이후 회수 focusin 0', after.length === 0, after);
      await sleep(2500);
      const later = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
      assert('activeElement 유지 (t+5s)', later === 'task-resume', later);

      // ★기준2: 혼합 전환 — A(on_hold) → C(in_progress) → B(on_hold). task-resume 도둑 focusin 0
      await page.evaluate(() => { window.__focusLog = []; });
      await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, `/tasks?tab=all&task=${tc}`);
      await sleep(2200);
      const onC = await page.evaluate((t2) => ({ has: document.body.innerText.includes(t2), banner: !!document.querySelector('[data-testid="task-hold-banner"]') }), `FABLE206T3-${MODE} C진행중`);
      assert('전환: C(in_progress) 드로어 — 배너 없음', onC.has && !onC.banner, onC);
      await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, `/tasks?tab=all&task=${tb}`);
      await sleep(2200);
      const onB = await page.evaluate((t2) => ({
        has: document.body.innerText.includes(t2),
        banner: !!document.querySelector('[data-testid="task-hold-banner"]'),
        stole: window.__focusLog.some((l) => l.tid === 'task-resume'),
        log: window.__focusLog.map((l) => ({ tid: l.tid, tag: l.tag })).slice(0, 6),
      }), `FABLE206T3-${MODE} B사전보류`);
      assert('★기준2: in_progress→on_hold 혼합 전환 — 포커스 도둑 0 (task-resume focusin 0)', onB.has && onB.banner && !onB.stole, onB.log);

      // 같은 세션 2번째 보류(C)도 동작하는지 — 틱 증가 재발화
      await page.evaluate(() => { window.__focusLog = []; });
      await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, `/tasks?tab=all&task=${tc}`);
      await sleep(2200);
      await page.evaluate(() => document.querySelector('[data-testid="task-hold"]').click());
      await sleep(500);
      await page.evaluate(() => document.querySelector('[data-testid="task-hold-confirm"]').click());
      await sleep(2500);
      const foc2 = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
      assert('2번째 보류(C, 사유 없음)도 포커스 이동 — 틱 재발화', foc2 === 'task-resume', foc2);
    }
    const d = await call(`/api/tasks/${ta}/detail`);
    assert('A 서버 반영 (on_hold + 사유)', d.j?.data?.status === 'on_hold' && d.j?.data?.hold_reason === '3차사유', { s: d.j?.data?.status, r: d.j?.data?.hold_reason });
  } finally {
    for (const id of [ta, tb, tc]) { try { console.log('cleanup', id, ':', (await call(`/api/tasks/by-business/${BIZ}/${id}`, { method: 'DELETE' })).status); } catch (e) { console.log('cleanup err', e.message); } }
    await browser.close();
  }
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(2); });
