// canary-admin-inbox — 플랫폼 관리자 «확인 필요» 와 메뉴 배지 (2026-10-08)
//
//   Irene: "플랫폼관리자에서 입금확인해야 하는거 알림이 안떠. 여기도 할일필요 메뉴랑 알림표시들 다 제대로"
//   고객이 «입금했어요» 를 눌러도 관리자 화면 어디에도 표시가 없었다(메일만 갔다).
//
//   재는 것 — 폰 390 · 태블릿 820 · 데스크탑 1440:
//     ① 입금 통보를 심으면 /admin/inbox 에 그 행이 **보인다**(elementFromPoint 로 가려지지 않았는지까지)
//     ② 탭 «입금 확인» 숫자 = 서버(services/adminTodo) 숫자
//     ③ 사이드바가 보이는 폭에서는 «확인 필요»·«구독 관리» 배지 숫자 = 서버 숫자 (안 보이는 폭은 ⬜ 미측정)
//     ④ 행을 누르면 구독 관리 «결제대기» 탭이 열리고 그 워크스페이스 행이 있다
//     ⑤ 음성 대조군: 통보를 지우면 행이 사라지고 숫자가 1 줄어든다
//
//   ★ 기존 계정의 비밀번호는 바꾸지 않는다 — 임시 platform_admin 을 만들고 finally 에서 지운다.
//   ★ 픽스처(입금 통보)는 원래 값으로 되돌린다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
const { collectAdminTodo } = require('/opt/planq/dev-backend/services/adminTodo');
const b = require('./lib/browser');

const WIDTHS = [
  { name: '폰 390', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: '태블릿 820', width: 820, height: 1180, isMobile: true, hasTouch: true },
  { name: '데스크탑 1440', width: 1440, height: 900 },
];

async function run() {
  const results = [];
  const push = (n, ok, m) => results.push({ name: n, fail: ok === null ? 0 : (ok ? 0 : 1), details: [(ok === null ? '⬜ 미측정 — ' : '') + m] });
  let uid = null;
  let fixture = null;
  const cred = { email: `admininbox-${Date.now()}@test.planq.kr`, password: 'AdminInbox2026!' };
  try {
    // 픽스처 — 살아 있는 워크스페이스의 pending 플랜 결제 중 통보가 없는 것 하나
    const [[pay]] = await sequelize.query(
      `SELECT p.id, p.business_id, p.subscription_id, p.notify_paid_at, p.notify_payer_name, COALESCE(b.brand_name, b.name) AS biz
         FROM payments p JOIN businesses b ON b.id = p.business_id AND b.deleted_at IS NULL
         JOIN subscriptions s ON s.id = p.subscription_id AND s.status = 'pending'
        WHERE p.status = 'pending' AND p.kind = 'plan' AND p.notify_paid_at IS NULL
        ORDER BY p.id DESC LIMIT 1`);
    if (!pay) { push('픽스처', null, '통보 없는 pending 플랜 결제가 dev 에 없다'); return results; }
    fixture = pay;
    await sequelize.query("UPDATE payments SET notify_paid_at = NOW(), notify_payer_name = '카나리입금' WHERE id = ?", { replacements: [pay.id] });

    const [[ps]] = await sequelize.query('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1');
    const [id] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role,
                          terms_version, terms_accepted_at, privacy_version, privacy_accepted_at, created_at, updated_at)
       VALUES (?, ?, 'AdminInbox Canary', ?, 'platform_admin', ?, NOW(), ?, NOW(), NOW(), NOW())`,
      { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `adib${Date.now()}`,
                       (ps && ps.terms_version) || '1.0', (ps && ps.privacy_version) || '1.0'] });
    uid = id;

    const server = await collectAdminTodo();
    const depositN = server.counts.deposit_plan + server.counts.deposit_addon;
    const rowSel = `[data-testid="admin-inbox-row-deposit_plan-${pay.id}"]`;

    const { browser, page } = await b.launch();
    try {
      await page.setViewport({ width: 1440, height: 900 });
      await b.login(page, cred);
      for (const vp of WIDTHS) {
        await page.setViewport(vp);
        await b.goto(page, '/admin/inbox');
        await page.waitForSelector(rowSel, { timeout: 10000 }).catch(() => null);
        await b.sleep(800);
        const st = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          let visible = false;
          if (el) {
            el.scrollIntoView({ block: 'center' });
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + Math.min(40, r.width / 2), r.top + r.height / 2);
            visible = r.width > 0 && r.height > 0 && !!hit && el.contains(hit);
          }
          const tab = document.querySelector('[data-testid="admin-inbox-tab-deposit"]');
          const tabN = tab ? Number((tab.textContent || '').replace(/\D+/g, '') || 0) : null;
          const badge = (tid) => {
            const x = document.querySelector(`[data-testid="${tid}"]`);
            if (!x) return null;
            const r = x.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return null;
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return hit && x.contains(hit) ? (x.textContent || '').trim() : null;
          };
          return {
            visible, text: el ? (el.textContent || '').replace(/\s+/g, ' ').slice(0, 90) : null, tabN,
            inboxBadge: badge('nav-badge-admin-inbox'), subsBadge: badge('nav-badge-admin-subscriptions'),
            hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
          };
        }, rowSel);
        push(`${vp.name} · 입금 통보 행이 보인다`, st.visible, st.text ? `"${st.text}"` : '행 없음');
        push(`${vp.name} · «입금 확인» 탭 숫자 = 서버`, st.tabN === depositN, `화면 ${st.tabN} · 서버 ${depositN}`);
        push(`${vp.name} · 가로 넘침 없음`, !st.hScroll, st.hScroll ? '가로 스크롤 생김' : 'ok');
        const exp = (n) => (n > 99 ? '99+' : String(n));
        if (st.inboxBadge === null) push(`${vp.name} · 사이드바 «확인 필요» 배지`, null, '사이드바가 이 폭에서 안 보인다');
        else push(`${vp.name} · 사이드바 «확인 필요» 배지 = 서버 total`, st.inboxBadge === exp(server.total), `화면 ${st.inboxBadge} · 서버 ${server.total}`);
        if (st.subsBadge === null) push(`${vp.name} · 사이드바 «구독 관리» 배지`, null, '사이드바가 이 폭에서 안 보인다');
        else push(`${vp.name} · 사이드바 «구독 관리» 배지 = 플랜 입금 통보`, st.subsBadge === exp(server.counts.deposit_plan), `화면 ${st.subsBadge} · 서버 ${server.counts.deposit_plan}`);
      }

      // ④ 눌러서 처리 화면으로
      await page.setViewport({ width: 1440, height: 900 });
      await b.goto(page, '/admin/inbox');
      await page.waitForSelector(rowSel, { timeout: 10000 }).catch(() => null);
      await page.click(rowSel).catch(() => null);
      await b.sleep(2500);
      const after = await page.evaluate((biz) => {
        const sel = Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).map((x) => (x.textContent || '').trim());
        return { path: location.pathname + location.search, sel, hasBiz: (document.body.innerText || '').includes(biz) };
      }, pay.biz);
      push('행을 누르면 구독 관리 «결제대기» 탭 + 그 워크스페이스', after.path.startsWith('/admin/subscriptions') && after.hasBiz && after.sel.some((x) => /결제대기|Pending/i.test(x)),
        `${after.path} · 선택 탭 ${JSON.stringify(after.sel)} · 워크스페이스 ${after.hasBiz ? '있음' : '없음'}`);

      // ④-b 그 구독 행이 표시되고 [입금 확인] 버튼이 화면 안에서 눌리는 자리에 있다 (2026-10-09 — "어디서 입금완료해야 하는지 모르겠어")
      const focus = await page.evaluate((subId) => {
        const row = document.querySelector(`[data-sub-id="${subId}"]`);
        const btn = document.querySelector(`[data-testid="admin-sub-markpaid-${subId}"]`);
        if (!row || !btn) return { row: !!row, btn: !!btn };
        const r = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const cs = getComputedStyle(row);
        return { row: true, btn: true, inView: r.top >= 0 && r.bottom <= innerHeight && r.width > 0,
          hitIsBtn: !!hit && (hit === btn || btn.contains(hit)), border: cs.borderTopColor };
      }, pay.subscription_id);
      push('그 구독 행으로 가서 [입금 확인] 이 화면 안·눌리는 자리 + 강조 테두리',
        !!(focus.row && focus.btn && focus.inView && focus.hitIsBtn && focus.border === 'rgb(20, 184, 166)'),
        JSON.stringify(focus));

      // ⑤ 음성 대조군 — 통보를 지우면 사라진다
      await sequelize.query('UPDATE payments SET notify_paid_at = ?, notify_payer_name = ? WHERE id = ?', { replacements: [fixture.notify_paid_at, fixture.notify_payer_name, fixture.id] });
      const server2 = await collectAdminTodo();
      await b.goto(page, '/admin/inbox');
      await b.sleep(1500);
      const gone = await page.evaluate((sel) => !document.querySelector(sel), rowSel);
      push('음성 대조군 — 통보를 지우면 행이 빠지고 total 이 1 줄어든다', gone && server2.total === server.total - 1,
        `행 ${gone ? '없음' : '남아 있음'} · total ${server.total} → ${server2.total}`);
    } finally { await browser.close().catch(() => null); }
  } catch (e) {
    push('카나리 실행', false, String((e && e.message) || e));
  } finally {
    if (fixture) await sequelize.query('UPDATE payments SET notify_paid_at = ?, notify_payer_name = ? WHERE id = ?', { replacements: [fixture.notify_paid_at, fixture.notify_payer_name, fixture.id] }).catch(() => {});
    if (uid) {
      await sequelize.query('DELETE FROM refresh_tokens WHERE user_id = ?', { replacements: [uid] }).catch(() => {});
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [uid] }).catch(() => {});
    }
  }
  return results;
}

module.exports = { run };
