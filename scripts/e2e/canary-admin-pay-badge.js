// canary-admin-pay-badge — 플랫폼 관리자 좌측 배지 합 = 확인 필요 · 결제 이력 «처리 필요»·«환불 요청» 탭 (2026-10-23)
//
//   Irene: "결제이력이 1개 알림이 표시되는데 왜지? … 환불요청이 대기업무에 같이 들어가던지 따로 나와야지 …
//           좌측 메뉴 모든 알림 숫자 합산 = 확인필요 알림숫자"
//
//   재는 것 — 폰 390 · 태블릿 820 · 데스크탑 1440:
//     ① «처리 필요» 탭 숫자 = 서버 결제 이력 배지(애드온 통보 + 세금계산서 + 환불 요청) · 그 행이 보이고 사유 표시가 붙는다
//     ② 사이드바가 보이는 폭: 관리자 메뉴 배지 합 = «확인 필요» 배지 · 결제 이력 링크가 «처리 필요» 탭을 연다
//     ③ 대조군: 그 결제에 환불 요청을 걸면 «환불 요청» 탭으로 옮겨 가고 «세금계산서» 탭에서 빠진다(합은 그대로)
//   ★ 임시 platform_admin 을 만들고 finally 에서 지운다. 픽스처 값은 되돌린다.
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
const BADGES = ['nav-badge-admin-inquiries', 'nav-badge-admin-feedback', 'nav-badge-admin-subscriptions', 'nav-badge-admin-payments'];

async function run() {
  const results = [];
  const push = (n, ok, m) => results.push({ name: n, fail: ok === null ? 0 : (ok ? 0 : 1), details: [(ok === null ? '⬜ 미측정 — ' : '') + m] });
  let uid = null; let fixture = null; let added = false;
  const cred = { email: `adminpay-${Date.now()}@test.planq.kr`, password: 'AdminPay2026!' };
  try {
    // 픽스처 — 세금계산서 요청 중인 결제 완료 건(없으면 하나 만든다)
    const [[pay]] = await sequelize.query(
      `SELECT p.id, p.tax_invoice_status, p.refund_requested_at FROM payments p JOIN businesses b ON b.id = p.business_id AND b.deleted_at IS NULL
        WHERE p.status = 'paid' AND p.tax_invoice_status IN ('requested','failed') AND p.refund_requested_at IS NULL ORDER BY p.id LIMIT 1`);
    if (!pay) { push('픽스처', null, '세금계산서 요청 중인 결제가 dev 에 없다'); return results; }
    fixture = pay;
    const [[ps]] = await sequelize.query('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1');
    const [id] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role, terms_version, terms_accepted_at, privacy_version, privacy_accepted_at, created_at, updated_at)
       VALUES (?, ?, 'AdminPay Canary', ?, 'platform_admin', ?, NOW(), ?, NOW(), NOW(), NOW())`,
      { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `adpb${Date.now()}`, (ps && ps.terms_version) || '1.0', (ps && ps.privacy_version) || '1.0'] });
    uid = id;

    const measure = (page, tab) => page.evaluate((payId, tab, ids) => {
      const tabBtns = Array.from(document.querySelectorAll('[role="tab"]'));
      const num = (re) => { const x = tabBtns.find((e) => re.test(e.textContent || '')); return x ? Number(((x.textContent || '').match(/\d+/) || ['0'])[0]) : null; };
      const row = document.querySelector(`[data-payment-id="${payId}"]`);
      let visible = false;
      if (row) {
        row.scrollIntoView({ block: 'center' });
        const r = row.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + Math.min(40, r.width / 2), r.top + r.height / 2);
        visible = r.width > 0 && r.height > 0 && !!hit && row.contains(hit);
      }
      const badge = (tid) => {
        const x = document.querySelector(`[data-testid="${tid}"]`);
        if (!x) return 0;
        const r = x.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit && x.contains(hit) ? Number((x.textContent || '').trim()) : null;
      };
      const payLink = document.querySelector('a[href^="/admin/payments"]');
      return {
        todoTab: num(/처리 필요|Needs action/), refundTab: num(/환불 요청|Refund requests/), taxTab: num(/세금계산서 발행 필요|Tax invoice due/),
        // 앱 위 탭 줄도 role=tab 이다 — 결제 이력 화면의 탭 줄(처리 필요 칸이 있는 tablist) 안에서만 고른다
        selected: (() => { const tl = Array.from(document.querySelectorAll('[role="tablist"]')).find((x) => /처리 필요|Needs action/.test(x.textContent || ''));
          const sel = tl && tl.querySelector('[role="tab"][aria-selected="true"]'); return sel ? sel.textContent || '' : ''; })(),
        row: !!row, visible, rowText: row ? (row.textContent || '').replace(/\s+/g, ' ').slice(0, 120) : '',
        inbox: badge('nav-badge-admin-inbox'), menu: ids.map(badge), payHref: payLink ? payLink.getAttribute('href') : null,
        hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    }, fixture.id, tab, BADGES);

    const { browser, page } = await b.launch();
    try {
      await page.setViewport({ width: 1440, height: 900 });
      await b.login(page, cred);
      const s = await collectAdminTodo();
      const payN = s.counts.deposit_addon + s.counts.tax_invoice + s.counts.refund_request;
      for (const vp of WIDTHS) {
        await page.setViewport(vp);
        await b.goto(page, '/admin/payments?todo=1');
        await page.waitForSelector(`[data-payment-id="${fixture.id}"]`, { timeout: 10000 }).catch(() => null);
        await b.sleep(800);
        const m = await measure(page, 'todo');
        push(`${vp.name} · «처리 필요» 탭 선택 + 숫자 = 결제 이력 배지`, /처리 필요|Needs action/.test(m.selected) && m.todoTab === payN, `선택 ${m.selected.trim()} · 탭 ${m.todoTab} · 서버 ${payN}`);
        push(`${vp.name} · 그 결제 행이 보이고 «세금계산서 요청» 표시`, m.visible && /세금계산서 요청|발행 실패|Tax invoice requested/.test(m.rowText), m.rowText || '행 없음');
        push(`${vp.name} · 가로 넘침 없음`, !m.hScroll, m.hScroll ? '가로 스크롤' : 'ok');
        if (m.inbox === null || m.menu.some((x) => x === null)) push(`${vp.name} · 좌측 배지 합 = 확인 필요`, null, '사이드바가 이 폭에서 안 보인다');
        else {
          const sum = m.menu.reduce((a, x) => a + x, 0);
          push(`${vp.name} · 좌측 배지 합 = 확인 필요`, sum === m.inbox && m.inbox === s.total, `메뉴 ${JSON.stringify(m.menu)} 합 ${sum} · 확인 필요 ${m.inbox} · 서버 ${s.total}`);
          push(`${vp.name} · 결제 이력 메뉴 → «처리 필요» 탭`, m.payHref === '/admin/payments?todo=1', String(m.payHref));
        }
      }
      // ③ 대조군 — 환불 요청을 걸면 환불 요청 탭으로 옮긴다
      await sequelize.query('UPDATE payments SET refund_requested_at = NOW() WHERE id = ?', { replacements: [fixture.id] });
      added = true;
      const s2 = await collectAdminTodo();
      await page.setViewport({ width: 1440, height: 900 });
      await b.goto(page, '/admin/payments?refund=requested');
      await page.waitForSelector(`[data-payment-id="${fixture.id}"]`, { timeout: 10000 }).catch(() => null);
      await b.sleep(800);
      const m2 = await measure(page, 'refund');
      push('대조군 — 환불 요청 탭에 그 행 · 세금계산서 탭 -1 · 합 그대로',
        m2.visible && /환불 요청|Refund/.test(m2.rowText) && m2.refundTab === s2.counts.refund_request && m2.taxTab === s.counts.tax_invoice - 1 && s2.total === s.total,
        `행 ${m2.visible} · 환불 탭 ${m2.refundTab}/${s2.counts.refund_request} · 세금계산서 탭 ${m2.taxTab} (전 ${s.counts.tax_invoice}) · total ${s.total}→${s2.total}`);
    } finally { await browser.close().catch(() => null); }
  } catch (e) {
    push('카나리 실행', false, String((e && e.message) || e));
  } finally {
    if (added && fixture) await sequelize.query('UPDATE payments SET refund_requested_at = ? WHERE id = ?', { replacements: [fixture.refund_requested_at, fixture.id] }).catch(() => null);
    if (uid) {
      await sequelize.query('DELETE FROM refresh_tokens WHERE user_id = ?', { replacements: [uid] }).catch(() => null);
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [uid] }).catch(() => null);
    }
  }
  return results;
}
module.exports = { run };
