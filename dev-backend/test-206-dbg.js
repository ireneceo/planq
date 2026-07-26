/* Fable — 디버그 빌드 콘솔 캡처. 실행 후 삭제 */
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
  const cr = await call('/api/tasks', { method: 'POST', body: JSON.stringify({ business_id: BIZ, title: 'FABLE206DBG', assignee_id: lj.data.user.id }) });
  const id = cr.j.data.id;
  await call(`/api/tasks/by-business/${BIZ}/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'in_progress' }) });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    page.on('console', (m) => { const t = m.text(); if (t.includes('F206-DEBUG')) console.log('BROWSER:', t); });
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    await page.evaluate(async (c) => { const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(c) }); return (await r.json()).success; }, { email: 'health-check@planq.kr', password: 'HealthCheck2026!' });
    await page.goto(BASE + `/tasks?tab=all&task=${id}`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    await page.evaluate(() => document.querySelector('[data-testid="task-hold"]').click());
    await sleep(600);
    await page.evaluate(() => document.querySelector('[data-testid="task-hold-confirm"]').click());
    await sleep(3000);
    const active = await page.evaluate(() => document.activeElement && (document.activeElement.getAttribute('data-testid') || document.activeElement.tagName + ':' + (document.activeElement.textContent || '').slice(0, 12)));
    console.log('activeElement:', active);
  } finally {
    console.log('cleanup:', (await call(`/api/tasks/by-business/${BIZ}/${id}`, { method: 'DELETE' })).status);
    await browser.close();
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
