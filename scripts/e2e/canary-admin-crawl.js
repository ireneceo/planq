// canary-admin-crawl — 플랫폼 관리자 화면 16개가 **열리는가** (2026-09-08)
//
//   Irene: "나 플랫폼관리자로 가서 뭐 좀 보려는데 이런 에러야. … Minified React error #185
//          … 이렇게 에러가 나는 건 우리가 미리 미리 몰라?"
//
//   몰랐다. 크롤 카나리(canary-crawl)는 **워크스페이스 라우트만** 돌고 `/admin/*` 은
//   한 번도 연 적이 없다. 관리자 화면은 platform_admin 이라야 열리니 로그인 계정이 달라서
//   빠져 있었고, 그래서 이 계열은 언제나 사용자가 먼저 만났다.
//
//   여기서 재는 것 — 화면마다:
//     ① 렌더 크래시(ErrorBoundary 문구)가 없다
//     ② React #185(무한 setState 루프) 콘솔 에러가 없다  ← 이번 신고가 정확히 이것
//     ③ 통째로 빈 화면이 아니다 (len < 60 이면 "눌렀는데 아무것도 없다")
//
//   ★ 기존 계정의 비밀번호는 절대 바꾸지 않는다(CLAUDE.md 금지사항).
//     임시 platform_admin 을 만들고 finally 에서 지운다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
const b = require('./lib/browser');

// App.tsx 의 /admin 라우트 전부. 새 관리자 화면을 만들면 여기 같이 추가한다.
const ROUTES = [
  '/admin/dashboard', '/admin/businesses', '/admin/feedback', '/admin/dev-status', '/admin/wiki',
  '/admin/updates', '/admin/email-logs', '/admin/push-logs', '/admin/platform-settings',
  '/admin/subscriptions', '/admin/payments', '/admin/billing-settings', '/admin/inquiries',
  '/admin/notifications', '/admin/audit-logs', '/admin/users',
];
const MIN_TEXT = 60;   // 이보다 짧으면 사실상 빈 화면

async function run() {
  const results = [];
  const push = (n, ok, m) => results.push({ name: n, fail: ok ? 0 : 1, details: [m] });
  let uid = null;
  const cred = { email: `admincrawl-${Date.now()}@test.planq.kr`, password: 'AdminCrawl2026!' };
  try {
    const [id] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role, terms_accepted_at, privacy_accepted_at, created_at, updated_at)
       VALUES (?, ?, 'AdminCrawl Canary', ?, 'platform_admin', NOW(), NOW(), NOW(), NOW())`,
      { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `adcr${Date.now()}`] });
    uid = id;

    const { browser, page } = await b.launch();
    try {
      await page.setViewport({ width: 1440, height: 900 });
      await b.login(page, cred);
      for (const route of ROUTES) {
        const errs = [];
        const onC = (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); };
        const onE = (e) => errs.push('PAGEERROR ' + String(e.message).slice(0, 200));
        page.on('console', onC); page.on('pageerror', onE);
        await b.goto(page, route);
        await b.sleep(3500);
        const st = await page.evaluate(() => {
          const txt = document.body.innerText || '';
          return {
            // ★ ErrorBoundary 는 i18n 이 깨져도 뜨도록 **ko/en 문구를 하드코딩**해 두고
            //   사용자 언어에 따라 고른다. 한국어만 보면 영어 계정에서는 크래시를 **놓친다** —
            //   실제로 이 카나리가 그랬다(반증 중 발견: 심은 크래시가 영어로 떠서 초록이었다).
            //   두 언어 + React 오류 코드를 같이 본다.
            crashed: /문제가 발생했습니다|예기치 못한 오류|Something went wrong|unexpected error occurred|Minified React error/i.test(txt),
            len: txt.replace(/\s+/g, ' ').trim().length,
            head: txt.replace(/\s+/g, ' ').trim().slice(0, 80),
          };
        });
        // ★ 목록만 열어서는 **편집기·상세를 여는 순간** 나는 크래시를 못 잡는다.
        //   좌측 목록의 항목 몇 개를 실제로 눌러 본다(사용자가 하는 동작).
        let clickCrash = null;
        try {
          const labels = await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('button, li, [role="button"], a')).filter((el) => {
              const t = (el.textContent || '').trim();
              const r = el.getBoundingClientRect();
              return t.length > 3 && t.length < 90 && r.width > 80 && r.height > 18 && r.left < 420;
            });
            return els.slice(0, 5).map((el, i) => { el.setAttribute('data-ac-i', String(i)); return (el.textContent || '').trim().slice(0, 30); });
          });
          for (let i = 0; i < labels.length; i += 1) {
            try { await page.click(`[data-ac-i="${i}"]`); } catch { continue; }
            await b.sleep(1400);
            const s2 = await page.evaluate(() => {
              const t = document.body.innerText || '';
              return /문제가 발생했습니다|예기치 못한 오류|Something went wrong|unexpected error occurred|Minified React error/i.test(t);
            });
            if (s2) { clickCrash = labels[i]; break; }
          }
        } catch { /* 목록이 없는 화면은 넘어간다 */ }

        page.off('console', onC); page.off('pageerror', onE);
        const loop = errs.filter((e) => /React error #185|Maximum update depth/.test(e));
        push(`${route} 이 크래시 없이 열리고 눌러진다`,
          !st.crashed && loop.length === 0 && st.len >= MIN_TEXT && !clickCrash,
          `글자 ${st.len}${st.crashed ? ' · 🔴 크래시 화면' : ''}${loop.length ? ` · 🔴 무한루프 #185 ×${loop.length}` : ''}`
          + `${st.len < MIN_TEXT ? ' · 🔴 사실상 빈 화면' : ''}${clickCrash ? ` · 🔴 "${clickCrash}" 를 누르니 크래시` : ''} — "${st.head}"`);
      }
    } finally { await browser.close().catch(() => null); }
  } catch (e) {
    push('카나리 실행', false, String((e && e.message) || e));
  } finally {
    if (uid) await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [uid] }).catch(() => {});
  }
  return results;
}

module.exports = { run };
