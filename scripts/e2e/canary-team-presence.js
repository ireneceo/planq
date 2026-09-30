// canary-team-presence — 동료 오늘 상태 (운영 #429, 2026-09-30)
//
//   결정: 워크스페이스 멤버 전원이 서로의 **상태만** 본다(시각·기록 없음) · 고객에게는 안 보인다.
//   재는 것:
//     서버 — 멤버 200 + 응답 키가 정확히 user_id·state·on_leave_today(시각이 섞이면 실패) · 임시 고객 403
//     화면 — 폰·태블릿·데스크탑 3폭: 사이드바 «팀 N명 근무 중» 줄이 **보이고** 누르면 목록이 뜬다(좌표·가시성)
//     실시간 — 다른 멤버가 출근하면 **새로고침 없이** 목록·숫자가 바뀐다(음성 대조군: 출근 전엔 근무중 아님)
//     채팅 — 그 멤버 이름 옆 점(고객 화면에는 없음)은 판정이 데이터 의존이라 참고로만 센다
//   ★ 출근시킨 기록은 판정 뒤 지운다(attendance_days/events/audit).
const b = require('./lib/browser');
const jwt = require('/opt/planq/dev-backend/node_modules/jsonwebtoken');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const API = 'http://localhost:3003';
const sql = (s, r) => sequelize.query(s, { replacements: r }).then(([x]) => x);
const tok = (uid) => jwt.sign({ userId: uid, id: uid }, process.env.JWT_SECRET, { expiresIn: '10m' });
const call = async (uid, path, opt = {}) => {
  const r = await fetch(API + path, { ...opt, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok(uid), ...(opt.headers || {}) } });
  const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body, text };
};
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VPS = [
  { key: '폰 390', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true },
  { key: '태블릿 834', vp: { width: 834, height: 1112, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true },
  { key: '데스크탑 1440', vp: { width: 1440, height: 900 }, touch: false },
];

// 사이드바 줄을 화면에 꺼낸다 — 폰은 메뉴를 열고, 데스크탑은 접힌 요약을 펼친다
async function revealRow(page) {
  for (let i = 0; i < 3; i++) {
    const vis = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="sidebar-team-presence"]');
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10 || r.bottom <= 0 || r.top >= innerHeight || r.left >= innerWidth || r.right <= 0) return false;
      const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!h && (h === el || el.contains(h));
    });
    if (vis) return true;
    await page.evaluate(() => {
      const sum = document.querySelector('[data-testid="sidebar-status-summary"]');
      if (sum && sum.getBoundingClientRect().width > 0) { sum.click(); return; }
      const ham = document.querySelector('[data-pq-mobile-header] button, [data-testid="tab-menu"]');
      if (ham) ham.click();
    });
    await sleep(600);
  }
  return false;
}

async function run() {
  const results = [];
  const push = (name, ok, msg, extra = {}) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')], ...extra });
  const st = { dayIds: [] };
  let browser = null;
  try {
    const [owner] = await sql('SELECT id, active_business_id biz FROM users WHERE email=?', [b.CREDS.email]);
    const biz = owner.biz;
    // 오늘 기록이 없는 다른 멤버 한 명(출근시켜 볼 대상)
    const [mate] = await sql(
      `SELECT bm.user_id, COALESCE(bm.name, u.name) nm FROM business_members bm JOIN users u ON u.id=bm.user_id
       WHERE bm.business_id=? AND bm.removed_at IS NULL AND bm.role IN ('member','admin') AND u.status='active' AND u.is_ai=0
         AND bm.user_id <> ? AND NOT EXISTS (SELECT 1 FROM attendance_days d WHERE d.user_id=bm.user_id AND d.business_id=bm.business_id AND d.work_date >= CURDATE() - INTERVAL 1 DAY)
       LIMIT 1`, [biz, owner.id]);
    const [cli] = await sql(`SELECT c.user_id FROM clients c JOIN users u ON u.id=c.user_id WHERE c.business_id=? AND u.status='active' AND c.user_id NOT IN (SELECT user_id FROM business_members WHERE business_id=?) LIMIT 1`, [biz, biz]);

    // ── 서버
    const m = await call(owner.id, `/api/attendance/presence?business_id=${biz}`);
    const keys = [...new Set((m.body?.data || []).flatMap((r) => Object.keys(r)))].sort().join(',');
    push('서버: 멤버 200 · 키는 상태뿐(시각 없음)', m.status === 200 && keys === 'on_leave_today,state,user_id', `${m.status} ${keys}`);
    if (cli) {
      const c = await call(cli.user_id, `/api/attendance/presence?business_id=${biz}`);
      push('서버: 고객 403', c.status === 403, String(c.status));
    } else push('서버: 고객 403', false, '고객 픽스처 없음', { unmeasured: true });
    if (!mate) { push('실시간 픽스처', false, '오늘 기록 없는 동료가 없음', { unmeasured: true }); return results; }

    browser = (await b.launch()).browser;
    for (const v of VPS) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      try {
        await page.setViewport(v.vp);
        if (v.touch) await page.setUserAgent(UA);
        await b.login(page);
        await b.goto(page, '/dashboard');
        await b.dismissBlockers(page);
        const shown = await revealRow(page);
        push(`${v.key} · 사이드바 «팀 근무» 줄이 보인다`, shown, shown ? '보임' : '안 보임/가려짐');
        if (!shown) continue;
        await page.click('[data-testid="sidebar-team-presence"]');
        await page.waitForSelector('[data-testid="team-presence-item"]', { timeout: 5000 }).catch(() => null);
        const pop = await page.evaluate((nm) => {
          const p = document.querySelector('[data-testid="team-presence-popover"]');
          if (!p) return null;
          const r = p.getBoundingClientRect();
          const items = [...p.querySelectorAll('[data-testid="team-presence-item"]')];
          const mine = items.find((i) => i.textContent.includes(nm));
          const h = document.elementFromPoint(r.left + r.width / 2, r.top + 20);
          return { inView: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1, top: !!h && p.contains(h), n: items.length, mate: mine ? mine.textContent : null };
        }, mate.nm);
        push(`${v.key} · 누르면 목록이 화면 안에 뜬다`, !!pop && pop.inView && pop.top && pop.n > 0, JSON.stringify(pop));
        if (v.key === '폰 390') {
          // 실시간 — 음성 대조군(출근 전) → 출근 → 새로고침 없이 반영
          const beforeWorking = pop && pop.mate && /근무중|Working/.test(pop.mate);
          const ci = await call(mate.user_id, '/api/attendance/clock-in', { method: 'POST', body: JSON.stringify({ business_id: biz }) });
          if (ci.body?.data?.id) st.dayIds.push(ci.body.data.id);
          let after = null;
          for (let i = 0; i < 10; i++) {
            await sleep(500);
            after = await page.evaluate((nm) => {
              const it = [...document.querySelectorAll('[data-testid="team-presence-item"]')].find((i) => i.textContent.includes(nm));
              return it ? it.textContent : null;
            }, mate.nm);
            if (after && /근무중|Working/.test(after)) break;
          }
          push('실시간: 동료 출근이 새로고침 없이 반영(대조: 출근 전 근무중 아님)', ci.status === 200 && !beforeWorking && /근무중|Working/.test(after || ''),
            `clock-in ${ci.status} · 전 ${pop && pop.mate} → 후 ${after}`);
        }
        // 닫힘 — 바깥 누르면 닫힌다
        await page.mouse.click(v.vp.width - 5, v.vp.height - 5);
        await sleep(300);
        const closed = await page.evaluate(() => !document.querySelector('[data-testid="team-presence-popover"]'));
        push(`${v.key} · 바깥을 누르면 닫힌다`, closed, String(closed));
      } catch (e) {
        push(`${v.key} · 오류`, false, e.message.slice(0, 160));
      } finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      if (st.dayIds.length) {
        await sql('DELETE FROM attendance_events WHERE attendance_day_id IN (?)', [st.dayIds]);
        await sql("DELETE FROM audit_logs WHERE target_type IN ('attendance_day','AttendanceDay') AND target_id IN (?)", [st.dayIds]).catch(() => null);
        await sql('DELETE FROM attendance_days WHERE id IN (?)', [st.dayIds]);
      }
      const left = st.dayIds.length ? await sql('SELECT COUNT(*) n FROM attendance_days WHERE id IN (?)', [st.dayIds]) : [{ n: 0 }];
      results.push({ name: 'cleanup: 출근시킨 기록 삭제', fail: Number(left[0].n) === 0 ? 0 : 1, details: [`남음 ${left[0].n}`] });
    } catch (e) { results.push({ name: 'cleanup', fail: 1, details: [e.message] }); }
  }
  return results;
}

module.exports = { name: '동료 오늘 상태 (#429) — 서버 범위·3폭 화면·실시간', run };
