// scripts/e2e/canary-agenda-today.js — 폰 일정(목록 보기)에 들어가면 «오늘» 묶음이 맨 위에 보이는가
//
//   2026-11-07 신고(두 번째 — 첫 번째 10-16 17d546f7): «모바일에서 일정 들어가면 오늘 날짜로 안 보여주고 월초가 나와».
//   원인: 창 전체의 touchmove 하나로 «사용자가 움직였다» 고 보고, 화면이 뜨는 동안 손가락이 닿으면
//   그 뒤 도착한 일정·업무가 오늘 위에 끼어도 다시 맞추지 않았다 → 1일부터 보였다. puppeteer 는 터치를 안 해서 초록이었다.
//
//   ① 그대로 들어감 → 오늘 묶음이 스크롤 상자 위 끝
//   ② 조회 지연 + 들어가는 동안 손가락 닿음(touchmove, 스크롤 없음) + 업무 늦게 도착 → 오늘 묶음이 위 끝  (옛 코드에서 실패해야 한다 = 양성 대조군)
//   ③ 맞춘 뒤 사용자가 실제로 끌어 올림(scrollTop 변화) → 늦게 온 업무가 그 자리를 빼앗지 않는다  (음성 쪽 — 10-16 의도 유지)
//   ④ 다음 달 → «오늘» 버튼 → 오늘 묶음이 위 끝
//   폭: 폰 390×844 · 360×740. 픽스처: 이번 달 1일~(오늘-1) 일정 `__AGT`(끝나면 지운다) + 가짜 업무 응답(가로채기 — DB 안 씀).
const { launch, login, goto, sleep, dismissBlockers } = require('./lib/browser');

const API = process.env.E2E_API || 'http://localhost:3003';
const { CREDS } = require('./lib/browser');

let _tok = null; let _biz = null; let _tz = 'Asia/Seoul';
async function api(p, init = {}) {
  if (!_tok) {
    const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: CREDS.email, password: CREDS.password }) });
    const j = await r.json().catch(() => ({}));
    _tok = j.data && (j.data.token || j.data.accessToken);
    _biz = j.data.user.active_business_id || j.data.user.business_id;
    if (j.data.user.workspace_timezone) _tz = j.data.user.workspace_timezone;
  }
  const r = await fetch(`${API}${p}`, { ...init, headers: { Authorization: `Bearer ${_tok}`, 'Content-Type': 'application/json', 'X-Workspace-Id': String(_biz), ...(init.headers || {}) } });
  let body = null; try { body = await r.json(); } catch { /* */ }
  return { status: r.status, body };
}

// 옛 빌드(손잡이 없음)에서도 대조군을 돌리려고 «오늘» 꼬리표(버튼 아님)의 묶음으로도 찾는다.
const FIND_TODAY = null;
function installFinder() {
  window.__findToday = () => {
    const t = document.querySelector('[data-testid="agenda-today"]');
    if (t) return t;
    const tag = [...document.querySelectorAll('span,div')].find((e) => e.children.length === 0 && /^(오늘|Today)$/.test(e.textContent.trim()) && !e.closest('button'));
    return tag && tag.parentElement ? tag.parentElement.parentElement : null;
  };
}

const ymdIn = (tz, d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// 오늘 묶음 위치 — 스크롤 상자 위 끝과의 차이(px). 상자 = 가장 가까운 overflow auto/scroll 조상.
async function measure(page) {
  return page.evaluate((F) => {
    const el = window.__findToday();
    if (!el) return { found: false };
    let sc = el.parentElement;
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    const top = el.getBoundingClientRect().top;
    const scTop = sc ? sc.getBoundingClientRect().top : 0;
    const groups = el.parentElement ? el.parentElement.children.length : 0;
    const idx = el.parentElement ? [...el.parentElement.children].indexOf(el) : -1;
    return { found: true, off: Math.round(top - scTop), scrollTop: sc ? Math.round(sc.scrollTop) : null, max: sc ? sc.scrollHeight - sc.clientHeight : null, groups, idx, vh: innerHeight };
  }, FIND_TODAY);
}

// 업무·일정 응답을 늦추고, 업무는 «오늘 위에 끼는» 가짜 마감 업무로 돌려준다.
async function intercept(page, { evDelay, taskDelay, taskDay, biz }) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (req.method() === 'GET' && u.includes(`/api/tasks/by-business/${biz}`)) {
      setTimeout(() => {
        req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [{
          id: 990000001, business_id: biz, project_id: null, title: '__AGT late task', description: null, status: 'in_progress',
          assignee_id: null, start_date: null, due_date: taskDay, progress_percent: 0,
        }] }) }).catch(() => null);
      }, taskDelay);
      return;
    }
    if (req.method() === 'GET' && u.includes(`/api/calendar/by-business/${biz}`) && evDelay) {
      setTimeout(() => req.continue().catch(() => null), evDelay);
      return;
    }
    req.continue().catch(() => null);
  });
}

const near = (m) => m.found && m.idx > 0 && Math.abs(m.off) <= 24;

async function run() {
  const results = [];
  const ids = [];
  try {
    await api('/api/auth/me');
    const today = ymdIn(_tz);
    const [Y, M, D] = today.split('-').map(Number);
    if (D < 3) {
      results.push({ name: 'agendatoday:skip', fail: 0, details: [`오늘 ${today} — 이달 초라 오늘 위에 묶음을 둘 수 없어 건너뜀`] });
      return results;
    }
    const pad = (n) => String(n).padStart(2, '0');
    // 2일은 비워 둔다 — 늦게 온 업무(2일 마감)가 오늘 위에 «새 묶음» 으로 끼게
    for (let d = 1; d < D; d++) {
      if (d === 2) continue;
      // 벽시계 10:00(워크스페이스 시간대) ≈ UTC 01:00(서울) — 날짜 칸만 맞으면 된다
      const r = await api(`/api/calendar/by-business/${_biz}`, { method: 'POST', body: JSON.stringify({
        title: `__AGT ${d}`, start_at: `${Y}-${pad(M)}-${pad(d)}T01:00:00.000Z`, end_at: `${Y}-${pad(M)}-${pad(d)}T02:00:00.000Z`,
        all_day: false, visibility: 'personal', reminder_minutes: null,
      }) });
      if (r.body?.data?.id) ids.push(r.body.data.id);
    }
    const taskDay = `${Y}-${pad(M)}-02`;
    const VPS = [{ width: 390, height: 844 }, { width: 360, height: 740 }];

    for (const vp of VPS) {
      const tag = `${vp.width}`;
      const fresh = async (opts) => {
        const { browser, page } = await launch({ mobile: true });
        await page.setViewport({ ...vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        await page.evaluateOnNewDocument(installFinder);
        await login(page);
        if (opts) await intercept(page, { ...opts, biz: _biz });
        return { browser, page };
      };

      // ① 그대로
      {
        const { browser, page } = await fresh({ evDelay: 0, taskDelay: 0, taskDay });
        try {
          await goto(page, '/calendar'); await dismissBlockers(page).catch(() => null); await sleep(1500);
          const m = await measure(page);
          results.push({ name: `plain:${tag}`, fail: near(m) ? 0 : 1, hasCanary: true, details: [JSON.stringify(m)] });
        } finally { await browser.close(); }
      }

      // ② 조회 지연 + 들어가는 동안 손가락 닿음 + 업무 늦게
      {
        const { browser, page } = await fresh({ evDelay: 1200, taskDelay: 2500, taskDay });
        try {
          await page.evaluateOnNewDocument(() => {
            const t0 = Date.now();
            const iv = setInterval(() => {
              if (Date.now() - t0 > 2000) { clearInterval(iv); return; }
              const tgt = document.elementFromPoint(innerWidth / 2, innerHeight / 2) || document.body;
              if (tgt) tgt.dispatchEvent(new Event('touchmove', { bubbles: true }));
            }, 120);
          });
          await page.goto(`${require('./lib/browser').BASE}/calendar`, { waitUntil: 'domcontentloaded' });
          await sleep(5000);
          const m = await measure(page);
          results.push({ name: `touch-while-loading:${tag}`, fail: near(m) ? 0 : 1, hasCanary: true, details: [JSON.stringify(m)] });
        } finally { await browser.close(); }
      }

      // ③ 맞춘 뒤 사용자가 실제로 끌어 올림 → 늦게 온 업무가 자리를 빼앗지 않는다
      {
        const { browser, page } = await fresh({ evDelay: 0, taskDelay: 4000, taskDay });
        try {
          await page.goto(`${require('./lib/browser').BASE}/calendar`, { waitUntil: 'domcontentloaded' });
          await page.waitForFunction((F) => !!window.__findToday(), { timeout: 15000 }, FIND_TODAY);
          await sleep(1200);
          const before = await measure(page);
          const userTop = await page.evaluate((F) => {
            const el = window.__findToday();
            let sc = el.parentElement;
            while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
            el.dispatchEvent(new Event('touchmove', { bubbles: true }));
            sc.scrollTop = Math.max(0, sc.scrollTop - 120);
            return Math.round(sc.scrollTop);
          }, FIND_TODAY);
          await sleep(300);
          const dragged = await measure(page);
          await sleep(4500);
          const m = await measure(page);
          // 업무 묶음이 오늘 위에 새로 끼었고(idx 증가), 오늘은 사용자가 끈 화면 위치 그대로(다시 맨 위로 당겨지지 않음).
          //   scrollTop 자체는 브라우저 스크롤 고정(anchoring)이 끼운 높이만큼 늘 수 있다 — 화면 위치로 판정한다.
          const kept = m.found && m.idx > before.idx && dragged.off > 24 && Math.abs(m.off - dragged.off) <= 4;
          results.push({ name: `user-drag-kept:${tag}`, fail: kept ? 0 : 1, hasCanary: true, details: [`손댄 뒤 scrollTop ${userTop} · 전 ${JSON.stringify(before)} · 끈 직후 off ${dragged.off} · 후 ${JSON.stringify(m)}`] });
        } finally { await browser.close(); }
      }

      // ④ 다음 달 → «오늘»
      {
        const { browser, page } = await fresh({ evDelay: 0, taskDelay: 0, taskDay });
        try {
          await goto(page, '/calendar'); await dismissBlockers(page).catch(() => null); await sleep(1000);
          await page.click('[data-testid="calendar-next"]'); await sleep(1500);
          const away = await measure(page);
          await page.click('[data-testid="calendar-today"]'); await sleep(2000);
          const m = await measure(page);
          results.push({ name: `next-then-today:${tag}`, fail: !away.found && near(m) ? 0 : 1, hasCanary: true, details: [`다음 달 오늘 묶음 ${away.found ? '있음(틀림)' : '없음'} · ${JSON.stringify(m)}`] });
        } finally { await browser.close(); }
      }
    }
  } catch (e) {
    results.push({ name: 'run:agendatoday', fail: 1, details: [`🔴 ${e.message}`] });
  } finally {
    try {
      const del = [];
      for (const id of ids) del.push((await api(`/api/calendar/by-business/${_biz}/${id}`, { method: 'DELETE' })).status);
      results.push({ name: 'cleanup:agendatoday', fail: del.every((s) => s < 300) ? 0 : 1, hasCanary: true, details: [`지움 ${del.length} · ${del.join(',')}`] });
    } catch (e) { results.push({ name: 'cleanup:agendatoday', fail: 1, details: [`🔴 ${e.message}`] }); }
  }
  return results;
}

module.exports = { name: 'agendatoday', run };
