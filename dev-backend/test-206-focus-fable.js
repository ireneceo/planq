// FABLE §2-10 접근성 실계측 — 보류 확정 후 [보류 해제](task-resume) 포커스 안착 여부.
//   판정 후 rm. 사용: node test-206-focus-fable.js
require('dotenv').config();
const { launch, login, sleep } = require('/opt/planq/scripts/e2e/lib/browser');

const API = 'http://localhost:3003';
let token = null;
async function api(path, method = 'GET', body) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch { /* noop */ }
  return { status: r.status, j };
}

(async () => {
  // 준비 — in_progress 업무 2개 (드로어 대상 + 포커스 도둑 회귀용)
  const lg = await api('/api/auth/login', 'POST', { email: 'health-check@planq.kr', password: 'HealthCheck2026!' });
  token = lg.j?.data?.token;
  if (!token) { console.error('login fail'); process.exit(2); }
  const mk = async (t) => {
    const c = await api('/api/tasks', 'POST', { business_id: 5, title: t, assignee_id: 5 });
    await api(`/api/tasks/by-business/5/${c.j.data.id}`, 'PUT', { status: 'in_progress' });
    return c.j.data.id;
  };
  const A = await mk('FABLE-206 FOCUS A (삭제예정)');
  const C = await mk('FABLE-206 FOCUS C (삭제예정)');
  console.log('tasks:', A, C);

  const { browser, page } = await launch();
  const consoleLines = [];
  page.on('console', (m) => { const s = m.text(); if (s.includes('F206-DEBUG')) consoleLines.push(`${Date.now() % 100000} ${s}`); });
  try {
    await login(page);
    await page.goto('https://dev.planq.kr/tasks?task=' + A, { waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-testid="task-hold"]', { timeout: 20000 });

    // 계측 설치 — focusin 시간축 로그
    await page.evaluate(() => {
      window.__focusLog = [];
      window.__t0 = performance.now();
      document.addEventListener('focusin', (e) => {
        const el = e.target;
        window.__focusLog.push({
          t: Math.round(performance.now() - window.__t0),
          id: el.dataset?.testid || null,
          tag: el.tagName,
          text: (el.textContent || '').slice(0, 20),
        });
      }, true);
    });

    // 보류 진입 → 확정
    await page.click('[data-testid="task-hold"]');
    await page.waitForSelector('[data-testid="task-hold-confirm"]', { timeout: 5000 });
    await page.type('[data-testid="task-hold-reason"]', '포커스 계측 사유');
    await page.click('[data-testid="task-hold-confirm"]');

    // 시간축 폴링 — 250ms 간격 10회 activeElement 스냅샷
    const timeline = [];
    for (let i = 0; i < 10; i++) {
      await sleep(250);
      timeline.push(await page.evaluate(() => {
        const el = document.activeElement;
        return { t: Math.round(performance.now() - window.__t0), id: el?.dataset?.testid || null, tag: el?.tagName || null };
      }));
    }
    const finalState = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        active: el?.dataset?.testid || el?.tagName,
        bannerExists: !!document.querySelector('[data-testid="task-hold-banner"]'),
        resumeExists: !!document.querySelector('[data-testid="task-resume"]'),
        focusLog: window.__focusLog,
      };
    });
    console.log('--- focusin log (계측):', JSON.stringify(finalState.focusLog));
    console.log('--- activeElement 폴링:', JSON.stringify(timeline));
    console.log('--- banner:', finalState.bannerExists, 'resumeBtn:', finalState.resumeExists, 'final active:', finalState.active);
    const landed = finalState.active === 'task-resume';
    console.log(landed ? 'FOCUS_LANDED=YES' : 'FOCUS_LANDED=NO');

    // 시도2 부작용 회귀 — 드로어 닫고 다른 업무 C 열기 → 포커스 도둑 없는가
    await page.keyboard.press('Escape');
    await sleep(600);
    await page.evaluate(() => { window.__focusLog = []; });
    await page.evaluate((cid) => {
      window.history.pushState({}, '', '/tasks?task=' + cid);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, C);
    await sleep(2000);
    const after = await page.evaluate(() => {
      const el = document.activeElement;
      return { active: el?.dataset?.testid || el?.tagName, focusLog: window.__focusLog,
        resumeInDom: !!document.querySelector('[data-testid="task-resume"]') };
    });
    console.log('--- C 드로어 열기 후 active:', JSON.stringify(after));
    const stolen = after.focusLog.some((f) => f.id === 'task-resume');
    console.log(stolen ? 'FOCUS_STOLEN=YES' : 'FOCUS_STOLEN=NO');
    console.log('--- F206 console:'); consoleLines.forEach((l) => console.log('   ', l));
  } finally {
    await browser.close();
    // cleanup — A 는 on_hold 라 resume 후 삭제, C 삭제
    await api(`/api/tasks/${A}/resume`, 'POST');
    const dA = await api(`/api/tasks/by-business/5/${A}`, 'DELETE');
    const dC = await api(`/api/tasks/by-business/5/${C}`, 'DELETE');
    console.log('cleanup:', dA.status, dC.status);
  }
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
