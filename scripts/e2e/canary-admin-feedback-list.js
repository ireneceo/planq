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
//     ④ 승인 체계(2026-10-22) — 탭 6개 · 검토중 건 [승인 — 진행대기로] → DB queued + approved_at · 상태 셀렉트에 «진행대기» 가
//        접수 건엔 없다 · 서버가 전이를 거절하면 이유가 화면에 보이고 창이 닫히지 않는다
//
//     ⑤ (2026-10-29 Irene «보류로 바꿨더니 리스트에서 없어졌는데 보류에도 안나와 · 파일 넣었는데 제대로 볼 수가 없어»)
//        검토중 건 [보류] 한 번 → DB wontfix(승인 없음) · «옮겼어요» 줄 → [보러 가기] 로 보류 탭에 그 건이 보인다
//        첨부 썸네일을 누르면 확대 보기가 상세 창 **위에** 뜬다(elementFromPoint) · Esc 로 닫힌다
//        (옛 화면: 승인 버튼이 고른 상태를 덮어써 진행대기로 갔고, 썸네일은 data: 주소 새 탭이라 막혔다)
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
      // ⑤-b 썸네일 → 확대 보기가 맨 위
      for (const vp of [WIDTHS[2], WIDTHS[0]]) {
        await page.setViewport(vp);
        await b.goto(page, '/admin/feedback');
        await page.waitForSelector('[data-testid="admin-feedback-row"]', { timeout: 15000 }).catch(() => null);
        await page.evaluate((tag) => {
          const row = Array.from(document.querySelectorAll('[data-testid="admin-feedback-row"]')).find((r) => (r.textContent || '').includes(tag));
          if (row) row.click();
        }, TAG);
        await page.waitForSelector('[data-testid="admin-feedback-attach"]', { timeout: 15000 }).catch(() => null);
        await b.sleep(400);
        const lb = await page.evaluate(async () => {
          const th = document.querySelector('[data-testid="admin-feedback-attach"]');
          if (!th) return { err: 'no thumb' };
          th.scrollIntoView({ block: 'center' }); th.click();
          await new Promise((r) => setTimeout(r, 500));
          const dl = document.querySelector('[data-testid="lightbox-download"]');
          if (!dl) return { err: 'no lightbox' };
          const r = dl.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const top = !!hit && dl.contains(hit);
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await new Promise((r2) => setTimeout(r2, 400));
          return { top, closed: !document.querySelector('[data-testid="lightbox-download"]'), drawerOpen: !!document.querySelector('[data-testid="admin-feedback-attach"]') };
        });
        push(`${vp.name} · 첨부 누르면 확대 보기가 상세 위에 · Esc 닫힘`, !!lb.top && lb.closed && lb.drawerOpen, JSON.stringify(lb));
      }
      await page.setViewport(WIDTHS[2]);

      // ④ 승인 체계
      const [rv] = await sequelize.query(
        `INSERT INTO feedback_items (user_id, kind, category, priority, title, body, status, is_popout, created_at, updated_at)
         VALUES (?, 'feedback', 'improve', 'normal', ?, ?, 'reviewing', 0, NOW(), NOW())`,
        { replacements: [uid, `${TAG} 검토중`, `${TAG} 검토중 본문`] });
      await b.goto(page, `/admin/feedback?id=${rv}`);
      await page.waitForSelector('[data-testid="admin-feedback-approve"]', { timeout: 15000 }).catch(() => null);
      const tabs = await page.evaluate(() => document.querySelectorAll('[role="tab"], button').length && Array.from(document.querySelectorAll('button')).filter((x) => /진행대기|반영중|Approved|In progress/.test(x.textContent || '')).length);
      push('탭에 «진행대기»·«반영중» 이 있다', tabs >= 2, `버튼 ${tabs}`);
      const hasApprove = await page.$('[data-testid="admin-feedback-approve"]');
      const where = await page.evaluate(() => ({ url: location.pathname + location.search, modal: !!document.querySelector('[aria-modal="true"]'),
        btns: Array.from(document.querySelectorAll('[aria-modal="true"] button')).map((x) => (x.textContent || '').trim()).filter(Boolean) }));
      if (hasApprove) await page.click('[data-testid="admin-feedback-approve"]');
      await b.sleep(1500);
      const [[after]] = await sequelize.query('SELECT status, approved_by, approved_at FROM feedback_items WHERE id = ?', { replacements: [rv] });
      push('검토중 건 [승인] → DB 진행대기 + 승인자·시각', !!hasApprove && after.status === 'queued' && after.approved_by === uid && !!after.approved_at, JSON.stringify({ ...after, where }));
      // ⑤-a 검토중 → [보류] 한 번 → 보류 탭에 보인다
      for (const vp of [WIDTHS[0], WIDTHS[2]]) {
        await sequelize.query("UPDATE feedback_items SET status='reviewing', approved_by=NULL, approved_at=NULL WHERE id = ?", { replacements: [rv] });
        await page.setViewport(vp);
        await b.goto(page, `/admin/feedback?id=${rv}`);
        await page.waitForSelector('[data-testid="admin-feedback-move-wontfix"]', { timeout: 15000 }).catch(() => null);
        const btnVis = await page.evaluate(() => {
          const e = document.querySelector('[data-testid="admin-feedback-move-wontfix"]'); if (!e) return false;
          e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!h && e.contains(h);
        });
        await page.click('[data-testid="admin-feedback-move-wontfix"]').catch(() => null);
        await b.sleep(1500);
        const [[w]] = await sequelize.query('SELECT status, approved_at FROM feedback_items WHERE id = ?', { replacements: [rv] });
        const movedVis = await page.evaluate(() => { const e = document.querySelector('[data-testid="admin-feedback-moved"]'); return !!e && e.getBoundingClientRect().height > 0; });
        await page.evaluate(() => { const e = document.querySelector('[data-testid="admin-feedback-moved"] button'); if (e) e.click(); });
        await b.sleep(1500);
        const inHold = await page.evaluate((id) => Array.from(document.querySelectorAll('[data-testid="admin-feedback-row"]')).length > 0
          && !!document.querySelector('[aria-modal="true"]') && (document.querySelector('[aria-modal="true"]').textContent || '').includes('#' + id), rv);
        push(`${vp.name} · 검토중 [보류] 한 번 → DB 보류 · «옮겼어요» · 보류 탭에서 그 건 열림`,
          btnVis && w.status === 'wontfix' && !w.approved_at && movedVis && inHold, JSON.stringify({ btnVis, ...w, movedVis, inHold }));
      }
      await page.setViewport(WIDTHS[2]);
      await sequelize.query("UPDATE feedback_items SET status='reviewing', approved_by=NULL, approved_at=NULL WHERE id = ?", { replacements: [rv] });
      // 거절 이유가 보이는가 — 서버 409 를 흉내(전이 표 자체는 서버 검사에서 잰다)
      await sequelize.query("UPDATE feedback_items SET status='reviewing', approved_by=NULL, approved_at=NULL WHERE id = ?", { replacements: [rv] });
      await page.setRequestInterception(true);
      const on409 = (req) => {
        if (/\/api\/feedback\/\d+\/respond/.test(req.url())) req.respond({ status: 409, contentType: 'application/json', body: '{"success":false,"message":"review_required","code":"review_required"}' });
        else req.continue();
      };
      page.on('request', on409);
      await b.goto(page, `/admin/feedback?id=${rv}`);
      await page.waitForSelector('[data-testid="admin-feedback-approve"]', { timeout: 15000 }).catch(() => null);
      await page.click('[data-testid="admin-feedback-approve"]').catch(() => null);
      await page.waitForSelector('[data-testid="admin-feedback-submit-error"]', { timeout: 5000 }).catch(() => null);
      const errShown = await page.evaluate(() => {
        const e = document.querySelector('[data-testid="admin-feedback-submit-error"]');
        if (!e) return null;
        const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + 2, r.top + r.height / 2);
        return { text: (e.textContent || '').trim(), visible: r.width > 0 && !!hit && e.contains(hit), open: !!document.querySelector('[aria-modal="true"]') };
      });
      page.off('request', on409);
      await page.setRequestInterception(false);
      push('서버가 거절하면 이유가 보이고 창은 열린 채', !!errShown && errShown.visible && errShown.open && /검토중/.test(errShown.text), JSON.stringify(errShown));
      // 접수 건 상태 셀렉트에 «진행대기» 가 없다
      const [[pend]] = await sequelize.query("SELECT id FROM feedback_items WHERE user_id = ? AND status = 'pending' ORDER BY id LIMIT 1", { replacements: [uid] });
      await b.goto(page, `/admin/feedback?id=${pend.id}`);
      await page.waitForSelector('[data-testid="admin-feedback-save"]', { timeout: 15000 }).catch(() => null);
      const noApprove = await page.evaluate(() => !document.querySelector('[data-testid="admin-feedback-approve"]') && !!document.querySelector('[data-testid="admin-feedback-save"]'));
      push('접수 건에는 [승인] 버튼이 없다(검토중을 먼저)', noApprove, noApprove ? 'ok' : '승인 버튼이 보인다');

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
