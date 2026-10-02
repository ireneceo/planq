// canary-holiday-capacity — 근무일·휴일 통합 (운영 #424, 2026-10-02) · 설계 docs/WORKDAY_HOLIDAY_DESIGN.md §6.4 P3
//
//   재는 것:
//     서버 — 이번 주 평일에 휴일 1행을 넣으면 my-week capacity.work_days 가 1 줄고 weekly_effective 가 daily×rate 만큼 준다
//     화면 — 폰·태블릿·데스크탑 3폭: Q task 「주간 가용시간」 에
//            ①「이번 주 근무일」 값이 **서버 work_days 와 같다**(보이는가까지) ②그 휴일 이름 줄이 보인다
//            ③옛 「휴일」 수동 입력칸(capacity-holidays)이 없다
//            ④가용시간 숫자(…/NNh)가 서버 weekly_effective 와 같다
//     실시간 — 화면을 연 채 휴일을 끄면 새로고침 없이 근무일이 돌아온다(holiday:updated)
//     대조군 — 휴일을 넣기 **전** 화면 값 = 서버 값(휴일 0) 이어야 «넣은 뒤 바뀜» 이 의미가 있다
//   ★ 넣은 휴일 행은 판정 뒤 지운다.
const b = require('./lib/browser');
const jwt = require('/opt/planq/dev-backend/node_modules/jsonwebtoken');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const API = 'http://localhost:3003';
const sql = (s, r) => sequelize.query(s, { replacements: r }).then(([x]) => x);
const tok = (uid) => jwt.sign({ userId: uid, id: uid }, process.env.JWT_SECRET, { expiresIn: '10m' });
const call = async (uid, path, opt = {}) => {
  const r = await fetch(API + path, { ...opt, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok(uid), ...(opt.headers || {}) } });
  const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body };
};
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VPS = [
  { key: '폰 390', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true },
  { key: '태블릿 834', vp: { width: 834, height: 1112, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true },
  { key: '데스크탑 1440', vp: { width: 1440, height: 900 }, touch: false },
];
const NAME = '카나리휴일';

// 「주간 가용시간」 블록을 화면에 꺼낸다 — 좁은 폭은 인사이트 패널을 연다
async function revealCapacity(page) {
  for (let i = 0; i < 3; i++) {
    const vis = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="capacity-workdays"]');
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10 || r.bottom <= 0 || r.top >= innerHeight) return false;
      const h = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(10, r.height / 2));
      return !!h && (h === el || el.contains(h));
    });
    if (vis) return true;
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button[aria-label]')]
        .find((x) => /인사이트 패널|Insights panel|패널 열기|Open panel/i.test(x.getAttribute('aria-label') || ''));
      if (btn) btn.click();
    });
    await sleep(800);
  }
  return false;
}

const readPanel = (page) => page.evaluate((nm) => {
  const box = document.querySelector('[data-testid="capacity-workdays"]');
  const v = document.querySelector('[data-testid="capacity-workdays-value"]');
  const panel = box ? box.closest('section, div') : null;
  // 가용시간 큰 숫자 — 같은 섹션 안 "/ NNh"
  let total = null;
  let sec = box; for (let i = 0; i < 4 && sec; i++) sec = sec.parentElement;
  const txt = sec ? sec.textContent : '';
  const m = txt.match(/\/\s*([\d.]+)h/);
  if (m) total = Number(m[1]);
  return {
    days: v ? Number((v.textContent.match(/[\d.]+/) || [])[0]) : null,
    holidayShown: !!box && box.textContent.includes(nm),
    manualInput: !!document.querySelector('[data-testid="capacity-holidays"]'),
    total, hasPanel: !!panel,
  };
}, NAME);

async function run() {
  const results = [];
  const push = (name, ok, msg, extra = {}) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')], ...extra });
  const st = { ids: [], users: [] };
  let browser = null;
  try {
    const [owner] = await sql('SELECT id, active_business_id biz FROM users WHERE email=?', [b.CREDS.email]);
    const biz = owner.biz;
    // 이번 주 월~금 중 휴일이 아닌 날 하나(워크스페이스 시간대 기준 이번 주)
    const capNow = await call(owner.id, `/api/tasks/my-week?business_id=${biz}`);
    const base = capNow.body?.data?.capacity;
    const monday = capNow.body?.data?.week || null;
    if (!base || !monday) { push('픽스처', false, `my-week 응답에 capacity/주 시작 없음 ${JSON.stringify(Object.keys(capNow.body?.data || {}))}`, { unmeasured: true }); return results; }
    const taken = new Set((base.holiday_list || []).map((h) => h.date));
    let target = null;
    for (let i = 0; i < 5; i++) {
      const d = new Date(`${monday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
      const y = d.toISOString().slice(0, 10);
      if (!taken.has(y)) { target = y; break; }
    }
    const exists = await sql('SELECT id FROM workspace_holidays WHERE business_id=? AND date=?', [biz, target]);
    if (!target || exists.length) { push('픽스처', false, `이번 주에 넣을 빈 평일 없음 ${target}`, { unmeasured: true }); return results; }

    browser = (await b.launch()).browser;
    for (const v of VPS) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      try {
        await page.setViewport(v.vp);
        if (v.touch) await page.setUserAgent(UA);
        await b.login(page);
        await b.goto(page, '/tasks');
        await b.dismissBlockers(page);
        await sleep(1500);
        const shown = await revealCapacity(page);
        push(`${v.key} · 「이번 주 근무일」 이 보인다`, shown, shown ? '보임' : '안 보임/가려짐');
        if (!shown) continue;
        const before = await readPanel(page);
        push(`${v.key} · 대조군: 휴일 넣기 전 근무일 = 서버(${base.work_days})`, before.days === base.work_days, JSON.stringify(before));
        push(`${v.key} · 옛 수동 휴일 입력칸이 없다`, !before.manualInput, String(before.manualInput));
        push(`${v.key} · 가용 숫자 = 서버 weekly_effective(${base.weekly_effective})`, before.total === base.weekly_effective, String(before.total));

        // 휴일 추가 — 화면은 연 채로(실시간)
        const add = await call(owner.id, `/api/businesses/${biz}/holidays`, { method: 'POST', body: JSON.stringify({ date: target, name: NAME }) });
        if (add.body?.data?.id) st.ids.push(add.body.data.id);
        const srv = (await call(owner.id, `/api/tasks/my-week?business_id=${biz}`)).body.data.capacity;
        const per = Math.round(base.daily * base.rate * 10) / 10;
        push(`${v.key} · 서버: 근무일 −1 · 가용 −${per}h`, add.status === 201 && srv.work_days === base.work_days - 1
          && Math.abs(srv.weekly_effective - Math.max(0, base.weekly_effective - per)) < 0.11, `${add.status} ${base.work_days}→${srv.work_days} · ${base.weekly_effective}→${srv.weekly_effective}`);
        let after = null;
        for (let i = 0; i < 12; i++) { await sleep(500); after = await readPanel(page); if (after.days === srv.work_days && after.holidayShown) break; }
        push(`${v.key} · 실시간: 새로고침 없이 근무일 ${srv.work_days} · 휴일 줄 보임`, after.days === srv.work_days && after.holidayShown, JSON.stringify(after));
        push(`${v.key} · 가용 숫자 = 서버(${srv.weekly_effective})`, after.total === srv.weekly_effective, String(after.total));

        // 끄면 돌아온다
        await call(owner.id, `/api/businesses/${biz}/holidays/${add.body.data.id}`, { method: 'PATCH', body: JSON.stringify({ is_off: false }) });
        let back = null;
        for (let i = 0; i < 12; i++) { await sleep(500); back = await readPanel(page); if (back.days === base.work_days) break; }
        push(`${v.key} · 휴일을 끄면 근무일이 돌아온다`, back.days === base.work_days && !back.holidayShown, JSON.stringify(back));
        await call(owner.id, `/api/businesses/${biz}/holidays/${add.body.data.id}`, { method: 'DELETE' });
        st.ids = st.ids.filter((x) => x !== add.body.data.id);
        await sleep(400);
      } catch (e) {
        push(`${v.key} · 오류`, false, e.message.slice(0, 160));
      } finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
    }

    // ── 캘린더 휴일 표시 (#424 Q3 후속) — 월 보기 날짜 칸에 이름이 보이고, 지우면 새로고침 없이 사라진다
    for (const v of VPS) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      let hid = null;
      try {
        await page.setViewport(v.vp);
        if (v.touch) await page.setUserAgent(UA);
        await b.login(page);
        await b.goto(page, '/calendar?view=month');
        await b.dismissBlockers(page);
        await sleep(1800);
        const before = await page.evaluate((nm) => [...document.querySelectorAll('[data-testid="calendar-holiday"]')].some((e) => e.textContent.includes(nm)), NAME);
        const add = await call(owner.id, `/api/businesses/${biz}/holidays`, { method: 'POST', body: JSON.stringify({ date: target, name: NAME }) });
        hid = add.body?.data?.id || null;
        let shown = null;
        for (let i = 0; i < 12; i++) {
          await sleep(500);
          shown = await page.evaluate((nm) => {
            const el = [...document.querySelectorAll('[data-testid="calendar-holiday"]')].find((e) => e.textContent.includes(nm));
            if (!el) return null;
            el.scrollIntoView({ block: 'center' });
            const r = el.getBoundingClientRect();
            const h = document.elementFromPoint(r.left + Math.min(4, r.width / 2), r.top + r.height / 2);
            return { w: Math.round(r.width), vis: r.width > 0 && !!h && (h === el || el.contains(h)) };
          }, NAME);
          if (shown && shown.vis) break;
        }
        push(`${v.key} · 캘린더 월 보기에 휴일 이름이 보인다(대조: 추가 전 없음 · 새로고침 없이)`, !before && !!shown && shown.vis, JSON.stringify({ before, shown }));
        await call(owner.id, `/api/businesses/${biz}/holidays/${hid}`, { method: 'DELETE' }); hid = null;
        let gone = false;
        for (let i = 0; i < 12; i++) { await sleep(500); gone = await page.evaluate((nm) => ![...document.querySelectorAll('[data-testid="calendar-holiday"]')].some((e) => e.textContent.includes(nm)), NAME); if (gone) break; }
        push(`${v.key} · 휴일을 지우면 캘린더에서 사라진다`, gone, String(gone));
      } catch (e) {
        push(`${v.key} · 캘린더 오류`, false, e.message.slice(0, 160));
      } finally {
        if (hid) await call(owner.id, `/api/businesses/${biz}/holidays/${hid}`, { method: 'DELETE' }).catch(() => {});
        await page.close().catch(() => {}); await ctx.close().catch(() => {});
      }
    }

    // ── admin 역할 메뉴 (설계 §1.4) — admin 은 「근태 관리」 가 보이고 휴일을 고칠 수 있다 · member 는 메뉴가 없다
    const [ps] = await sql('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1').then((x) => [x]);
    const tv = ps[0]?.terms_version || '1.0'; const pv = ps[0]?.privacy_version || '1.0';
    for (const role of ['admin', 'member']) {
      const cred = { email: `holcap-${role}-${Date.now()}@test.planq.kr`, password: 'HolCap2026!' };
      const [uid] = await sequelize.query(
        `INSERT INTO users (email, password_hash, name, username, active_business_id,
           terms_accepted_at, terms_version, privacy_accepted_at, privacy_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NOW(), ?, NOW(), ?, NOW(), NOW())`,
        { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `HolCap ${role}`, `holcap${role}${Date.now()}`, biz, tv, pv] });
      st.users.push(uid);
      await sql(`INSERT INTO business_members (business_id, user_id, role, joined_at, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW(), NOW())`, [biz, uid, role]);
      const put = await call(uid, `/api/businesses/${biz}/holiday-country`, { method: 'PUT', body: JSON.stringify({ country: null }) });
      push(`${role} · 서버 휴일 쓰기 ${role === 'admin' ? '200' : '403'}`, role === 'admin' ? put.status === 200 : put.status === 403, String(put.status));
      for (const v of [VPS[0], VPS[2]]) {
        const ctx = await browser.createBrowserContext();
        const page = await ctx.newPage();
        try {
          await page.setViewport(v.vp);
          if (v.touch) await page.setUserAgent(UA);
          await b.login(page, cred);
          await b.goto(page, '/business/settings/attendance');
          await b.dismissBlockers(page);
          await sleep(1200);
          // 폰은 사이드바를 한 번 연다(토글이라 반복해 누르면 다시 닫힌다)
          if (v.touch) {
            await page.evaluate(() => { const ham = document.querySelector('[data-pq-mobile-header] button'); if (ham) ham.click(); });
            await sleep(900);
          }
          // 메뉴는 두 벌(데스크탑 보조 패널 · 폰 아코디언)이라 같은 링크가 둘 있다 — **보이는 것이 하나라도** 있는가.
          const nav = await page.evaluate(() => {
            const all = [...document.querySelectorAll('a[href="/business/settings/attendance"]')];
            if (!all.length) return { exists: false };
            const visible = all.some((a) => {
              if (a.getBoundingClientRect().width < 4) return false;
              a.scrollIntoView({ block: 'center' });
              const r = a.getBoundingClientRect();
              if (r.height < 4 || r.top < 0 || r.bottom > innerHeight) return false;
              const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return !!h && (h === a || a.contains(h));
            });
            return { exists: true, n: all.length, visible };
          });
          if (role === 'admin') push(`${v.key} · admin 에게 「근태 관리」 메뉴가 보인다`, !!nav.visible, JSON.stringify(nav));
          else push(`${v.key} · member 에게 「근태 관리」 메뉴가 없다(대조군)`, !nav.exists, JSON.stringify(nav));
          if (role === 'admin') {
            if (v.touch) { await page.evaluate(() => { const ham = document.querySelector('[data-pq-mobile-header] button'); if (ham) ham.click(); }); await sleep(600); }
            const sec = await page.evaluate(() => {
              const el = document.querySelector('[data-testid="holiday-section"]');
              if (!el) return null;
              el.scrollIntoView({ block: 'start' });
              const r = el.getBoundingClientRect();
              return { w: Math.round(r.width), inView: r.left >= 0 && r.right <= innerWidth + 1, add: !!el.querySelector('[data-testid="holiday-add-open"]') };
            });
            push(`${v.key} · admin 설정 화면에 「휴일·근무일」 섹션 + 추가 버튼`, !!sec && sec.inView && sec.add, JSON.stringify(sec));
          }
        } catch (e) { push(`${v.key} · ${role} 오류`, false, e.message.slice(0, 160)); }
        finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      await sql("DELETE FROM workspace_holidays WHERE name=?", [NAME]);
      if (st.users.length) {
        await sql('DELETE FROM refresh_tokens WHERE user_id IN (?)', [st.users]).catch(() => {});
        await sql('DELETE FROM business_members WHERE user_id IN (?)', [st.users]);
        await sql('DELETE FROM audit_logs WHERE user_id IN (?)', [st.users]).catch(() => {});
        await sql('DELETE FROM users WHERE id IN (?)', [st.users]);
      }
      const left = await sql('SELECT COUNT(*) n FROM workspace_holidays WHERE name=?', [NAME]);
      results.push({ name: 'cleanup: 넣은 휴일 삭제', fail: Number(left[0].n) === 0 ? 0 : 1, details: [`남음 ${left[0].n}`] });
    } catch (e) { results.push({ name: 'cleanup', fail: 1, details: [e.message] }); }
  }
  return results;
}

module.exports = { name: '근무일·휴일 (#424) — Q task 가용시간 3폭·서버 일치·실시간', run };
