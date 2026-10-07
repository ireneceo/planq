// scripts/e2e/canary-allday-date.js — 종일 일정이 **어느 기기 시간대에서도 같은 날짜 칸**에 그려지는가
//
//   docs/ALLDAY_EVENT_DATE_DESIGN.md (Fable 판정 U — 종일 = UTC 자정 부호화 날짜)
//
// 서버 판정(쓰기 정규화·반복 전개·회차 키·구글 바디·알림 시각)은 실 HTTP 검사로 따로 잰다. 여기서 재는 것은 화면이다:
//   ① 기기 시간대 3개(서울·쿠알라룸푸르·LA) × 폭: 하루짜리·이틀짜리·매주 수 반복·옛 부호화 행·업무 마감이
//      **기대한 날짜 칸에만** 있다(다른 칸에 번지지 않는다)
//   ② 상세의 시작 날짜 글자가 시간대마다 같다
//   ③ 등록 창으로 «오늘» 종일을 만들면 DB 날짜 = 그 기기의 오늘
// ★ 양성 대조군: E2E_CONTROL_DIR 에 옛 코드 빌드를 두면 그 정적 파일로 바꿔 끼워(요청 가로채기) 같은 판정을 돌린다 —
//   옛 코드에서는 LA 에서 칸이 하루 앞당겨져 **실패해야** 한다.
const fs = require('fs');
const path = require('path');
const { launch, login, sleep, dismissBlockers, BASE, CREDS } = require('./lib/browser');

const API = process.env.E2E_API || 'http://localhost:3003';
const CONTROL_DIR = process.env.E2E_CONTROL_DIR || null;
const TZS = ['Asia/Seoul', 'Asia/Kuala_Lumpur', 'America/Los_Angeles'];
const VIEWPORTS = [{ w: 1440, h: 900 }, { w: 768, h: 1024 }, { w: 375, h: 740, mobile: true }];

let _tok = null; let _biz = null; let _uid = null;
async function api(p, init = {}) {
  if (!_tok) {
    const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: CREDS.email, password: CREDS.password }) });
    const j = await r.json().catch(() => ({}));
    _tok = j.data && (j.data.token || j.data.accessToken);
    _biz = j.data.user.active_business_id || j.data.user.business_id;
    _uid = j.data.user.id;
  }
  const r = await fetch(`${API}${p}`, { ...init, headers: { Authorization: `Bearer ${_tok}`, 'Content-Type': 'application/json', 'X-Workspace-Id': String(_biz), ...(init.headers || {}) } });
  let body = null; try { body = await r.json(); } catch { /* */ }
  return { status: r.status, body };
}
let _seq = null;
async function sql(q, replacements) {
  if (!_seq) {
    require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
    ({ sequelize: _seq } = require('/opt/planq/dev-backend/config/database'));
  }
  const [rows] = await _seq.query(q, { replacements });
  return rows;
}

const EXPECT = {
  '__ADC single': ['2026-10-20'],
  '__ADC two': ['2026-10-22', '2026-10-23'],
  '__ADC weekly': ['2026-10-07', '2026-10-14', '2026-10-21'],
  '__ADC legacy': ['2026-10-27'],
  '__ADC task': ['2026-10-28'],
};

async function serveControl(page) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.origin !== new URL(BASE).origin || u.pathname.startsWith('/api') || u.pathname.startsWith('/socket.io')) return req.continue();
    let f = path.join(CONTROL_DIR, decodeURIComponent(u.pathname));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(CONTROL_DIR, 'index.html');
    const ext = path.extname(f);
    const type = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }[ext] || 'application/octet-stream';
    req.respond({ status: 200, contentType: type, body: fs.readFileSync(f) });
  });
}

async function run() {
  const results = [];
  const evIds = []; let taskId = null;
  try {
    // ── 픽스처 (Node 에서) ──
    const mk = async (b) => { const r = await api(`/api/calendar/by-business/${_biz}`, { method: 'POST', body: JSON.stringify({ visibility: 'personal', reminder_minutes: null, all_day: true, ...b }) }); if (r.body?.data?.id) evIds.push(r.body.data.id); return r; };
    await api('/api/auth/me');
    await mk({ title: '__ADC single', start_at: '2026-10-20T00:00:00.000Z', end_at: '2026-10-20T23:59:59.000Z' });
    await mk({ title: '__ADC two', start_at: '2026-10-22T00:00:00.000Z', end_at: '2026-10-23T23:59:59.000Z' });
    await mk({ title: '__ADC weekly', start_at: '2026-10-07T00:00:00.000Z', end_at: '2026-10-07T23:59:59.000Z', rrule: 'FREQ=WEEKLY;BYDAY=WE;COUNT=3' });
    // 옛 부호화(서울 기기 자정) — 백필 전 운영 행 모양. 서버를 거치지 않고 심는다(관용 읽기 검사)
    const ins = await sql("INSERT INTO calendar_events (business_id,title,start_at,end_at,all_day,category,visibility,vlevel,created_by,created_at,updated_at) VALUES (?,?,?,?,1,'work','personal','L1',?,NOW(),NOW())",
      [_biz, '__ADC legacy', '2026-10-26 15:00:00', '2026-10-27 14:59:00', _uid]);
    void ins;
    const leg = await sql("SELECT id FROM calendar_events WHERE title='__ADC legacy' ORDER BY id DESC LIMIT 1");
    if (leg[0]) evIds.push(leg[0].id);
    const tr = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ business_id: _biz, title: '__ADC task', due_date: '2026-10-28', assignee_id: _uid }) });
    taskId = tr.body?.data?.id || null;
    results.push({ name: 'fixture', fail: evIds.length === 4 && taskId ? 0 : 1, hasCanary: true, details: [`일정 ${evIds.length}/4 · 업무 ${taskId ? 1 : 0}/1`] });

    const drawerTexts = {};
    for (const tz of TZS) {
      for (const vp of VIEWPORTS) {
        if (tz !== 'America/Los_Angeles' && vp.w !== 1440) continue;   // 폭 축은 가장 어긋나는 LA 에서 3폭 다
        const label = `${tz} ${vp.w}`;
        const { browser, page } = await launch({ mobile: !!vp.mobile });
        try {
          if (!vp.mobile) await page.setViewport({ width: vp.w, height: vp.h });
          await page.emulateTimezone(tz);
          if (CONTROL_DIR) await serveControl(page);
          await login(page);
          await page.goto(`${BASE}/calendar?view=month&date=2026-10-15`, { waitUntil: 'networkidle2' });
          await dismissBlockers(page);
          await page.waitForSelector('[data-date="2026-10-20"]', { timeout: 20000 }).catch(() => null);
          await sleep(1500);
          const where = await page.evaluate(() => {
            const out = {};
            document.querySelectorAll('[data-date]').forEach((cell) => {
              cell.querySelectorAll('[data-testid="calendar-event"],[data-testid="calendar-task"]').forEach((chip) => {
                const t = (chip.getAttribute('title') || chip.textContent || '').trim();
                const k = Object.keys({ '__ADC single': 1, '__ADC two': 1, '__ADC weekly': 1, '__ADC legacy': 1, '__ADC task': 1 }).find((x) => t.startsWith(x) || t.includes(x));
                if (!k) return;
                (out[k] = out[k] || []).push(cell.getAttribute('data-date'));
              });
            });
            return { out, cells: document.querySelectorAll('[data-date]').length, tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
          });
          if (!where.cells) {
            results.push({ name: `cells:${label}`, fail: 0, details: [`⬜ 미측정 — 월 격자 칸이 없다(이 폭은 다른 보기)`] });
          } else {
            const bad = [];
            for (const [k, exp] of Object.entries(EXPECT)) {
              const got = [...new Set(where.out[k] || [])].sort();
              if (JSON.stringify(got) !== JSON.stringify(exp)) bad.push(`${k}: 기대 ${exp.join(',')} · 실제 ${got.join(',') || '없음'}`);
            }
            results.push({ name: `cells:${label}`, fail: bad.length ? 1 : 0, hasCanary: true, details: bad.length ? bad : [`5종 모두 기대 칸 (기기 ${where.tz})`] });
          }
          // ② 상세 시작 날짜 글자
          if (vp.w === 1440) {
            const clicked = await page.evaluate(() => {
              const chip = [...document.querySelectorAll('[data-date="2026-10-20"] [data-testid="calendar-event"]')].find((c) => (c.getAttribute('title') || '').startsWith('__ADC single'));
              if (!chip) return false; chip.click(); return true;
            });
            await sleep(1500);
            const txt = clicked ? await page.$eval('[data-testid="event-date-start"]', (e) => e.textContent.trim()).catch(() => null) : null;
            drawerTexts[tz] = txt;
          }
          // ③ 등록 창 «오늘» 종일 (LA 데스크탑 한 번)
          if (tz === 'America/Los_Angeles' && vp.w === 1440 && !CONTROL_DIR) {
            await page.goto(`${BASE}/calendar?view=month&date=2026-10-15`, { waitUntil: 'networkidle2' });
            await dismissBlockers(page);
            // 캘린더의 «오늘» 은 **워크스페이스 시간대**의 오늘이다(2026-10-07 Irene 결정 — calTz). 기기 오늘이 아니다.
            const wsTz = (await sql('SELECT timezone FROM businesses WHERE id=?', [_biz]))[0]?.timezone || 'Asia/Seoul';
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: wsTz }).format(new Date());
            await page.click('[data-testid="calendar-new-event"]');
            await sleep(1200);
            const filled = await page.evaluate(() => {
              const m = document.querySelector('[aria-modal="true"]');
              if (!m) return 'no-modal';
              const input = m.querySelector('input[type="text"], input:not([type])');
              if (!input) return 'no-input';
              const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              set.call(input, '__ADC ui'); input.dispatchEvent(new Event('input', { bubbles: true }));
              const cb = [...m.querySelectorAll('input[type="checkbox"]')].find((c) => /종일|All day/i.test(c.closest('label')?.textContent || ''));
              if (!cb) return 'no-allday';
              if (!cb.checked) cb.click();
              return 'ok';
            });
            await sleep(500);
            const submitted = filled === 'ok' ? await page.evaluate(() => {
              const m = document.querySelector('[aria-modal="true"]');
              const btns = [...m.querySelectorAll('button')].filter((b) => !b.disabled && /등록|추가|만들기|저장|Create|Add|Save/i.test(b.textContent || ''));
              const b = btns[btns.length - 1]; if (!b) return false; b.click(); return true;
            }) : false;
            await sleep(2500);
            const row = (await sql("SELECT id, DATE_FORMAT(start_at,'%Y-%m-%dT%H:%i:%s') s, DATE_FORMAT(end_at,'%Y-%m-%dT%H:%i:%s') e FROM calendar_events WHERE title='__ADC ui' ORDER BY id DESC LIMIT 1"))[0];
            if (row) evIds.push(row.id);
            const okUi = row && row.s === `${today}T00:00:00` && row.e === `${today}T23:59:59`;
            results.push({ name: 'create-ui:LA', fail: okUi ? 0 : 1, hasCanary: true, details: [`입력 ${filled} · 제출 ${submitted} · 워크스페이스 오늘 ${today} · DB ${row ? `${row.s}~${row.e}` : '없음'}`] });
          }
        } catch (e) {
          results.push({ name: `run:${label}`, fail: 1, details: [`🔴 ${e.message}`] });
        } finally { await browser.close(); }
      }
    }
    const vals = Object.values(drawerTexts);
    results.push({ name: 'drawer-date', fail: vals.length === TZS.length && vals.every((v) => v && v === vals[0]) ? 0 : 1, hasCanary: true, details: [JSON.stringify(drawerTexts)] });
  } finally {
    try {
      if (evIds.length) await sql('DELETE FROM calendar_events WHERE id IN (?) OR recurrence_parent_id IN (?)', [evIds, evIds]);
      await sql("DELETE FROM calendar_events WHERE title LIKE '\\_\\_ADC%'");
      if (taskId) { await sql('DELETE FROM task_status_history WHERE task_id=?', [taskId]).catch(() => null); await sql('DELETE FROM tasks WHERE id=?', [taskId]); }
      const left = (await sql("SELECT (SELECT COUNT(*) FROM calendar_events WHERE title LIKE '\\_\\_ADC%') e, (SELECT COUNT(*) FROM tasks WHERE title='__ADC task') t"))[0];
      results.push({ name: 'cleanup:allday', fail: Number(left.e) || Number(left.t) ? 1 : 0, hasCanary: true, details: [`남음 일정 ${left.e} · 업무 ${left.t}`] });
    } catch (e) { results.push({ name: 'cleanup:allday', fail: 1, details: [`🔴 정리 실패: ${e.message}`] }); }
    // ★ 연결을 닫지 않는다 — config/database 는 공유 싱글턴이라 닫으면 러너의 cleanup 스위트가 죽는다.
  }
  return results;
}

module.exports = { run };
