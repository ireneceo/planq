/* Fable — 런타임 계측: querySelector/focus 호출 추적. 실행 후 삭제 */
process.chdir('/opt/planq/dev-backend');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');
const API = 'http://localhost:3003';
const BASE = 'https://dev.planq.kr';
const BIZ = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const lr = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'health-check@planq.kr', password: 'HealthCheck2026!' }) });
  const lj = await lr.json();
  if (!lj.success) { console.log('login blocked:', lj.message); process.exit(2); }
  const tok = lj.data.token;
  const call = async (path, opts = {}) => { const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, ...(opts.headers || {}) } }); return { status: r.status, j: await r.json().catch(() => null) }; };
  const cr = await call('/api/tasks', { method: 'POST', body: JSON.stringify({ business_id: BIZ, title: 'FABLE206INS 계측', assignee_id: lj.data.user.id }) });
  const id = cr.j.data.id;
  await call(`/api/tasks/by-business/${BIZ}/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'in_progress' }) });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    await page.evaluate(async (c) => { const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(c) }); return (await r.json()).success; }, { email: 'health-check@planq.kr', password: 'HealthCheck2026!' });
    await page.goto(BASE + `/tasks?tab=all&task=${id}`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    await page.evaluate(() => {
      window.__log = [];
      const t0 = Date.now();
      const push = (kind, info) => window.__log.push({ t: Date.now() - t0, kind, ...info });
      const oQS = Document.prototype.querySelector;
      Document.prototype.querySelector = function (sel) {
        const r = oQS.call(this, sel);
        if (typeof sel === 'string' && sel.includes('task-resume')) push('qs', { sel, found: !!r });
        return r;
      };
      const oFocus = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function (...a) {
        push('focus', { tid: this.getAttribute && this.getAttribute('data-testid'), tag: this.tagName, txt: (this.textContent || '').slice(0, 14), connected: this.isConnected, disabled: !!this.disabled });
        return oFocus.apply(this, a);
      };
      document.addEventListener('focusin', (e) => push('focusin', { tid: e.target.getAttribute && e.target.getAttribute('data-testid'), tag: e.target.tagName, txt: (e.target.textContent || e.target.placeholder || '').slice(0, 14) }), true);
    });
    await page.evaluate(() => document.querySelector('[data-testid="task-hold"]').click());
    await sleep(600);
    await page.evaluate(() => document.querySelector('[data-testid="task-hold-confirm"]').click());
    await sleep(3000);
    const out = await page.evaluate(() => ({
      log: window.__log,
      active: document.activeElement ? { tid: document.activeElement.getAttribute('data-testid'), txt: (document.activeElement.textContent || '').slice(0, 14) } : null,
      resumeInDom: !!document.querySelector('[data-testid="task-resume"]'),
    }));
    console.log('active:', JSON.stringify(out.active), '| resumeInDom:', out.resumeInDom);
    out.log.forEach((l) => console.log(JSON.stringify(l)));
  } finally {
    console.log('cleanup:', (await call(`/api/tasks/by-business/${BIZ}/${id}`, { method: 'DELETE' })).status);
    await browser.close();
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
