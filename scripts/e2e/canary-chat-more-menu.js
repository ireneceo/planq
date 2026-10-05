// canary-chat-more-menu — 채팅 메시지 [더보기] 가 화면을 죽이지 않는가 (2026-10-05)
//
//   운영 크래시 로그(2026-10-05 03:21, /talk?conv=3, 직전 조작 «더보기»):
//     Cannot read properties of null (reading 'getBoundingClientRect')
//   원인: 버튼 onClick 이 `setMoreMenu((cur) => … anchorEl: e.currentTarget)` 로 **갱신 함수 안에서**
//   e.currentTarget 을 읽었다. 갱신 함수는 그 컴포넌트에 대기 중인 갱신이 있으면 이벤트가 끝난 뒤
//   렌더 단계에서 돈다 — 그때 currentTarget 은 null 이고, 메뉴를 그리다 화면 전체가 죽는다.
//   한 번 연 뒤 닫고 다시 열거나, 메시지를 누른 직후 열면 그 조건이 된다.
//
// 재는 것 (3폭):
//   ① 메시지 도구줄 → [더보기] 를 열고·닫고·다시 열기를 서로 다른 메시지에서 반복 — pageerror 0 · 오류 화면 0
//   ② 열 때마다 메뉴가 **그려져 있다**(elementFromPoint) · 화면 안
//   ③ 같은 버튼을 다시 누르면 닫힌다(재클릭 토글)
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const b = require('./lib/browser');

const BIZ = 5;
const OWNER = 5;           // health-check@planq.kr
const VIEWPORTS = [
  { key: '폰 390×844', touch: true, vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '태블릿 834×1112', touch: true, vp: { width: 834, height: 1112, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '데스크탑 1440×900', touch: false, vp: { width: 1440, height: 900 } },
];

async function seed() {
  const [convId] = await sequelize.query(
    `INSERT INTO conversations (business_id, title, channel_type, status, last_message_at, created_at, updated_at)
     VALUES (?, '[카나리] 더보기', 'internal', 'active', NOW(), NOW(), NOW())`, { replacements: [BIZ] });
  await sequelize.query(
    `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at, created_at)
     VALUES (?, ?, 'member', NOW(), NOW())`, { replacements: [convId, OWNER] });
  for (let i = 1; i <= 6; i++) {
    await sequelize.query(
      `INSERT INTO messages (conversation_id, sender_id, content, kind, created_at, updated_at)
       VALUES (?, ?, ?, 'text', DATE_SUB(NOW(), INTERVAL ? MINUTE), NOW())`,
      { replacements: [convId, OWNER, `[카나리] 더보기 확인용 메시지 ${i}`, 10 - i] });
  }
  return convId;
}
async function cleanup(convId) {
  if (!convId) return;
  await sequelize.query('DELETE FROM messages WHERE conversation_id = ?', { replacements: [convId] });
  await sequelize.query('DELETE FROM conversation_participants WHERE conversation_id = ?', { replacements: [convId] });
  await sequelize.query('DELETE FROM conversations WHERE id = ?', { replacements: [convId] });
}

const MENU_STATE = () => {
  const m = document.querySelector('[data-more-menu-popover="1"]');
  // ErrorBoundary 화면 = role="alert" 안에 [다시 시도] 버튼
  const crashed = [...document.querySelectorAll('[role="alert"]')].some((a) => a.querySelectorAll('button').length >= 2 && /getBoundingClientRect|다시 시도|Try again|Retry/.test(a.innerText));
  if (!m) return { open: false, crashed };
  const r = m.getBoundingClientRect();
  const h = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 14));
  const inView = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
  return { open: true, painted: !!h && m.contains(h), inView, crashed };
};

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let convId = null, browser = null;
  try {
    convId = await seed();
    const launched = await b.launch();
    browser = launched.browser;
    const page = launched.page;
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 160)));
    // ErrorBoundary 가 잡은 크래시는 pageerror 가 아니다 — 경계가 남기는 콘솔 줄로 센다.
    page.on('console', (m) => { if (m.type() === 'error' && /\[ErrorBoundary\]/.test(m.text())) errors.push('boundary: ' + m.text().slice(0, 140)); });
    await b.login(page);

    for (const { key, vp, touch } of VIEWPORTS) {
      await page.setViewport(vp);
      await b.goto(page, `/talk?conv=${convId}`);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="qtalk-messages"] [data-msg-id]').length >= 6, { timeout: 20000 }).catch(() => null);
      await b.sleep(1200);
      const ids = await page.evaluate(() => [...document.querySelectorAll('[data-testid="qtalk-messages"] [data-msg-id]')].map((e) => e.getAttribute('data-msg-id')));
      if (ids.length < 6) { push(`${key} · 픽스처`, false, `메시지 ${ids.length}개 — 미측정`); continue; }
      const errBefore = errors.length;
      let opened = 0, painted = 0, inView = 0, toggledClosed = 0, crashed = false, missing = 0;
      // 서로 다른 메시지 세 개에서: 메시지 누르기 → 더보기 열기 → 같은 버튼으로 닫기 → 다시 열기
      for (const id of ids.slice(-4, -1)) {
        const box = await page.evaluate((mid) => { const r = document.querySelector(`[data-msg-id="${mid}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 14) }; }, id);
        if (touch) await page.touchscreen.tap(box.x, box.y); else await page.mouse.move(box.x, box.y);
        await b.sleep(350);
        const btnSel = `[data-msg-id="${id}"] .pq-msg-toolbar button[aria-label="더보기"], [data-msg-id="${id}"] .pq-msg-toolbar button[aria-label="More"]`;
        for (let round = 0; round < 3; round++) {
          const pt = await page.evaluate((s) => { const x = document.querySelector(s); if (!x) return null; const r = x.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, btnSel);
          if (!pt) { missing++; break; }
          if (touch) await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y);
          await b.sleep(300);
          const st = await page.evaluate(MENU_STATE);
          if (st.crashed) { crashed = true; break; }
          if (round === 1) { if (!st.open) toggledClosed++; continue; }
          if (st.open) { opened++; if (st.painted) painted++; if (st.inView) inView++; }
        }
        if (crashed) break;
        // 닫기는 Esc 로만 — 폰·태블릿에서 화면 구석(2,2)은 햄버거라 누르면 메뉴 덮개가 채팅을 가린다(실측).
        await page.keyboard.press('Escape');
        await b.sleep(250);
      }
      const newErr = errors.slice(errBefore);
      push(`${key} · 더보기 반복해도 화면이 안 죽음`, !crashed && newErr.length === 0 && missing === 0,
        `오류 화면=${crashed} · pageerror ${newErr.length}${newErr.length ? ' (' + newErr[0] + ')' : ''} · 버튼 못 찾음 ${missing}`);
      push(`${key} · 열 때마다 메뉴가 그려지고 화면 안`, opened === 6 && painted === 6 && inView === 6, `열림 ${opened}/6 · 그려짐 ${painted} · 화면 안 ${inView}`);
      push(`${key} · 같은 버튼 다시 누르면 닫힘`, toggledClosed === 3, `닫힘 ${toggledClosed}/3`);
    }
  } catch (e) {
    results.push({ name: 'canary-chat-more-menu', fail: 0, fatal: 1, details: ['FATAL ' + e.message] });
  } finally {
    if (browser) await browser.close().catch(() => null);
    await cleanup(convId).catch(() => null);
  }
  return results;
}

module.exports = { run, name: 'canary-chat-more-menu' };
