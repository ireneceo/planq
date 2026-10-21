// canary-admin-feedback-list — 관리자 «사용자 피드백» 목록이 **보이는가** (2026-10-21)
//
//   Irene: "플랫폼관리자의 사용자 피드백에서 리스트가 안나와."
//   원인: 목록 API 가 첨부(이미지 base64, 한 건 수 MB)까지 읽어 정렬하다 MySQL «Out of sort memory» 500.
//   화면은 그 실패를 삼켜 «해당 상태의 피드백이 없습니다» 로 보였다 — 탭 숫자는 맞는데 목록만 비었다.
//
//   재는 것 — 폰 390 · 태블릿 820 · 데스크탑 1440:
//     ① 첨부 큰 피드백 25건을 심은 상태에서 «접수» 목록 행 수 = 서버 pending 수(최대 200) · 첫 행이 가려지지 않고 보인다
//     ② 첨부 있는 행을 누르면 상세에 첨부 이미지가 그려진다(목록엔 원본이 없고 상세가 따로 읽는다)
//     ③ 음성 대조군: 목록 API 가 실패하면 «불러오지 못했습니다» + [다시 불러오기] 가 보인다(«없습니다» 가 아니다)
//
//   ★ 임시 platform_admin 을 만들고 finally 에서 지운다. 심은 피드백도 지운다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
const b = require('./lib/browser');

const WIDTHS = [
  { name: '폰 390', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: '태블릿 820', width: 820, height: 1180, isMobile: true, hasTouch: true },
  { name: '데스크탑 1440', width: 1440, height: 900 },
];
const TAG = '[카나리] 첨부 큰 피드백';

async function run() {
  const results = [];
  const push = (n, ok, m) => results.push({ name: n, fail: ok === null ? 0 : (ok ? 0 : 1), details: [(ok === null ? '⬜ 미측정 — ' : '') + m] });
  let uid = null;
  const cred = { email: `adminfb-${Date.now()}@test.planq.kr`, password: 'AdminFeedback2026!' };
  try {
    const [[ps]] = await sequelize.query('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1');
    const [id] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role,
                          terms_version, terms_accepted_at, privacy_version, privacy_accepted_at, created_at, updated_at)
       VALUES (?, ?, 'AdminFeedback Canary', ?, 'platform_admin', ?, NOW(), ?, NOW(), NOW(), NOW())`,
      { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `adfb${Date.now()}`,
                       (ps && ps.terms_version) || '1.0', (ps && ps.privacy_version) || '1.0'] });
    uid = id;

    // 픽스처 — 첨부 큰 피드백 25건(한 건 ≈ 2.8MB). 이만큼이면 옛 목록 쿼리가 정렬 메모리를 넘었다(실측).
    const big = 'data:image/png;base64,' + Buffer.alloc(700000, 7).toString('base64');
    const att = JSON.stringify([{ name: 'a.png', type: 'image/png', dataUrl: big }, { name: 'b.png', type: 'image/png', dataUrl: big }, { name: 'c.png', type: 'image/png', dataUrl: big }]);
    for (let i = 0; i < 25; i++) {
      await sequelize.query(
        `INSERT INTO feedback_items (user_id, kind, category, priority, title, body, attachments, status, is_popout, created_at, updated_at)
         VALUES (?, 'feedback', 'bug', 'normal', ?, ?, ?, 'pending', 0, NOW(), NOW())`,
        { replacements: [uid, `${TAG} ${i + 1}`, `${TAG} ${i + 1} 본문`, att] });
    }
    const [[{ n: serverPending }]] = await sequelize.query("SELECT COUNT(*) n FROM feedback_items WHERE status='pending'");
    const expectRows = Math.min(Number(serverPending), 200);

    const { browser, page } = await b.launch();
    try {
      await page.setViewport({ width: 1440, height: 900 });
      await b.login(page, cred);
      for (const vp of WIDTHS) {
        await page.setViewport(vp);
        await b.goto(page, '/admin/feedback');
        await page.waitForSelector('[data-testid="admin-feedback-row"]', { timeout: 15000 }).catch(() => null);
        await b.sleep(600);
        const st = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('[data-testid="admin-feedback-row"]'));
          let visible = false;
          if (rows[0]) {
            rows[0].scrollIntoView({ block: 'center' });
            const r = rows[0].getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            visible = r.width > 0 && r.height > 0 && !!hit && rows[0].contains(hit);
          }
          return { n: rows.length, visible, hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
            empty: !!document.querySelector('[data-testid="admin-feedback-load-error"]') };
        });
        push(`${vp.name} · «접수» 목록 행 수 = 서버`, st.n === expectRows, `화면 ${st.n} · 서버 ${expectRows}${st.empty ? ' (불러오기 실패 화면)' : ''}`);
        push(`${vp.name} · 첫 행이 보인다`, st.visible, st.visible ? 'ok' : '가려졌거나 없음');
        push(`${vp.name} · 가로 넘침 없음`, !st.hScroll, st.hScroll ? '가로 스크롤 생김' : 'ok');
      }

      // ② 첨부 있는 행 → 상세에 첨부 이미지
      await page.setViewport({ width: 1440, height: 900 });
      await b.goto(page, '/admin/feedback');
      await page.waitForSelector('[data-testid="admin-feedback-row"]', { timeout: 15000 }).catch(() => null);
      const clicked = await page.evaluate((tag) => {
        const row = Array.from(document.querySelectorAll('[data-testid="admin-feedback-row"]')).find((r) => (r.textContent || '').includes(tag));
        if (!row) return false; row.click(); return true;
      }, TAG);
      await page.waitForSelector('[aria-modal="true"] img', { timeout: 15000 }).catch(() => null);
      const imgs = await page.evaluate(() => Array.from(document.querySelectorAll('[aria-modal="true"] img')).filter((i) => i.getBoundingClientRect().width > 0).length);
      push('첨부 있는 행을 열면 상세에 첨부 이미지 3장', clicked && imgs === 3, `행 ${clicked ? '누름' : '없음'} · 이미지 ${imgs}`);

      // ③ 음성 대조군 — 목록 API 실패 → «불러오지 못했습니다»
      await page.setRequestInterception(true);
      const onReq = (req) => {
        if (/\/api\/feedback\/admin\?status=/.test(req.url())) req.respond({ status: 500, contentType: 'application/json', body: '{"success":false,"message":"canary"}' });
        else req.continue();
      };
      page.on('request', onReq);
      await b.goto(page, '/admin/feedback');
      await page.waitForSelector('[data-testid="admin-feedback-load-error"]', { timeout: 10000 }).catch(() => null);
      const err = await page.evaluate(() => ({
        shown: !!document.querySelector('[data-testid="admin-feedback-load-error"]'),
        rows: document.querySelectorAll('[data-testid="admin-feedback-row"]').length,
      }));
      page.off('request', onReq);
      await page.setRequestInterception(false);
      push('음성 대조군 — 목록 API 500 이면 «불러오지 못했습니다» (빈 목록 문구 아님)', err.shown && err.rows === 0, JSON.stringify(err));
    } finally { await browser.close().catch(() => null); }
  } catch (e) {
    push('카나리 실행', false, String((e && e.message) || e));
  } finally {
    if (uid) {
      await sequelize.query('DELETE FROM feedback_items WHERE user_id = ? AND title LIKE ?', { replacements: [uid, `${TAG}%`] }).catch(() => {});
      await sequelize.query('DELETE FROM refresh_tokens WHERE user_id = ?', { replacements: [uid] }).catch(() => {});
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [uid] }).catch(() => {});
    }
  }
  return results;
}

module.exports = { run };
