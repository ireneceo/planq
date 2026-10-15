// 초대 인앱 알림 클릭 카나리 — docs/INVITE_INAPP_NOTIFY_DESIGN.md §4 (Fable 2026-10-15 D2·D4-4)
//   알림이 /invite/<token>(앱 셸 밖 경로)을 가리킨다. 탭 모드에서 이것을 탭으로 열면 그릴 화면이 없어 **빈 탭**이 된다.
//   그래서 알림 클릭은 utils/notificationLink.openNotificationTarget 이 문서 이동으로 보낸다.
//   판정: 종 → 그 알림 클릭 → ① 주소가 /invite/<token> ② 수락 화면이 **보인다**(받는 이메일이 달라 «다른 계정» 안내가 뜬다)
//         데스크탑(탭 모드) · 폰(미러 모드) 두 폭.
//   ★ 픽스처는 Node 에서 만든다(page.evaluate 안에서 만들면 하니스가 죽는다 — memory). 끝나면 지운다.
const crypto = require('crypto');
const b = require('./lib/browser');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

async function fixture() {
  const [[u]] = await sequelize.query('SELECT id FROM users WHERE email = ?', { replacements: [b.CREDS.email] });
  const token = crypto.randomBytes(24).toString('hex');
  const stamp = Date.now();
  const [bmId] = await sequelize.query(
    `INSERT INTO business_members (business_id, user_id, role, invited_by, invited_at, invite_token, invite_email, created_at, updated_at)
     VALUES (7, NULL, 'member', 1, NOW(), ?, ?, NOW(), NOW())`, { replacements: [token, `ic-${stamp}@invite-check.test`] });
  const title = `[확인용] 초대 알림 클릭 ${stamp}`;
  const [nId] = await sequelize.query(
    `INSERT INTO notifications (user_id, business_id, event_kind, title, body, link, entity_type, entity_id, email_escalated_at, preview_policy, created_at, updated_at)
     VALUES (?, NULL, 'invite', ?, 'canary', ?, 'business_member', ?, NOW(), 'default', NOW(), NOW())`,
    { replacements: [u.id, title, `/invite/${token}`, bmId] });
  return { token, title, bmId, nId };
}
async function cleanup(f) {
  if (!f) return;
  await sequelize.query('DELETE FROM notifications WHERE id = ?', { replacements: [f.nId] });
  await sequelize.query('DELETE FROM business_members WHERE id = ? AND invite_email LIKE ?', { replacements: [f.bmId, '%@invite-check.test'] });
}

async function one(label, viewport, results) {
  let f = null;
  const { browser, page } = await b.launch({ mobile: viewport.width < 640 });
  try {
    await page.setViewport(viewport);
    f = await fixture();
    await b.login(page);
    await b.goto(page, '/dashboard');
    await b.sleep(3500);
    const tabsBefore = await page.evaluate(() => document.querySelectorAll('[data-testid="tabstrip"] [role="tab"]').length);
    // 폰은 종이 헤더에 없을 수 있다 — 같은 클릭 경로인 전체 알림 화면으로 간다
    let opened = await page.evaluate(() => { const el = document.querySelector('[data-testid="header-notifications"]'); if (el && el.getBoundingClientRect().width > 0) { el.click(); return true; } return false; });
    if (!opened) { await b.goto(page, '/notifications'); await b.sleep(2500); }
    else await b.sleep(1500);
    const clicked = await page.evaluate((title) => {
      // 종 드롭다운([role=menu])의 항목 버튼 → 없으면(폰 · 전체 알림 화면) 그 화면의 항목 버튼. 넓은 선택자로 찾으면 다른 줄을 집는다.
      const pick = (root) => [...root.querySelectorAll('button')].find((e) => e.textContent.includes(title) && e.getBoundingClientRect().height > 0);
      const menu = [...document.querySelectorAll('[role="menu"]')].find((e) => e.getBoundingClientRect().width > 0);
      const it = (menu && pick(menu)) || pick(document);
      if (!it) return false; it.click(); return true;
    }, f.title);
    if (!clicked) { results.push({ name: `${label}-click`, ok: false, msg: `🔴 ${label}: 초대 알림 항목을 못 찾았다. 판정 불가` }); return; }
    await b.sleep(4000);
    const st = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="invite-email-mismatch"]');
      const r = el && el.getBoundingClientRect();
      const visible = !!(r && r.width > 0 && r.height > 0 && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      return { path: location.pathname, visible, tabs: document.querySelectorAll('[data-testid="tabstrip"] [role="tab"]').length };
    });
    results.push({ name: `${label}-path`, ok: st.path === `/invite/${f.token}`, msg: st.path === `/invite/${f.token}` ? `${label}: 주소 /invite/… 로 이동` : `🔴 ${label}: 주소 ${st.path}` });
    results.push({ name: `${label}-screen`, ok: st.visible, msg: st.visible ? `${label}: 수락 화면이 보인다(탭 ${tabsBefore}개였음)` : `🔴 ${label}: 수락 화면이 안 보인다(빈 탭 의심 · 탭 ${tabsBefore}→${st.tabs})` });
  } catch (e) {
    results.push({ name: `${label}-error`, ok: false, msg: `🔴 ${label}: ${e.message}` });
  } finally {
    await cleanup(f).catch(() => {});
    await browser.close().catch(() => {});
  }
}

// 받는 이메일에 이미 계정이 있으면 그 계정만 수락한다(2026-10-15 Irene «권고대로») — 다른 계정으로 열면
//   «지금 계정으로 수락» 이 **없어야** 하고, 계정 없는 이메일 초대(대조군)에는 **있어야** 한다.
async function ownedInvite(results) {
  const rows = [];
  const { browser, page } = await b.launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    for (const [label, email] of [['owned', 'member2@test.planq.kr'], ['unowned', `ic-own-${Date.now()}@invite-check.test`]]) {
      const token = crypto.randomBytes(24).toString('hex');
      const [id] = await sequelize.query(
        `INSERT INTO business_members (business_id, user_id, role, invited_by, invited_at, invite_token, invite_email, created_at, updated_at)
         VALUES (7, NULL, 'member', 1, NOW(), ?, ?, NOW(), NOW())`, { replacements: [token, email] });
      rows.push({ id, token, label });
    }
    await b.login(page);
    for (const r of rows) {
      await b.goto(page, `/invite/${r.token}`);
      await b.sleep(3000);
      r.st = await page.evaluate(() => ({
        mismatch: !!document.querySelector('[data-testid="invite-email-mismatch"]'),
        acceptCurrent: !!document.querySelector('[data-testid="invite-accept-current"]'),
      }));
    }
    const own = rows[0].st; const un = rows[1].st;
    results.push({ name: 'owned-no-accept-current', ok: own.mismatch && !own.acceptCurrent,
      msg: own.mismatch && !own.acceptCurrent ? '계정 있는 이메일 초대: «지금 계정으로 수락» 없음' : `🔴 계정 있는 이메일 초대: mismatch=${own.mismatch} 지금계정수락=${own.acceptCurrent}` });
    results.push({ name: 'unowned-accept-current', ok: un.mismatch && un.acceptCurrent,
      msg: un.mismatch && un.acceptCurrent ? '대조군(계정 없는 이메일): «지금 계정으로 수락» 있음' : `🔴 대조군: mismatch=${un.mismatch} 지금계정수락=${un.acceptCurrent}` });
  } catch (e) {
    results.push({ name: 'owned-error', ok: false, msg: `🔴 owned: ${e.message}` });
  } finally {
    for (const r of rows) await sequelize.query('DELETE FROM business_members WHERE id = ? AND invite_token = ?', { replacements: [r.id, r.token] }).catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function run() {
  const results = [];
  await ownedInvite(results);
  await one('desktop', { width: 1440, height: 900 }, results);
  await one('phone', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, results);
  return results;
}

function toRunnerShape(rows) {
  return rows.map((r) => ({ name: r.name, fail: r.ok ? 0 : 1, details: [r.msg], hasCanary: true }));
}

module.exports = { run: async () => toRunnerShape(await run()), name: 'invitenotify' };

if (require.main === module) {
  run().then((res) => { res.forEach((r) => console.log(r.ok ? 'PASS' : 'FAIL', r.msg)); return sequelize.close(); })
    .then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
