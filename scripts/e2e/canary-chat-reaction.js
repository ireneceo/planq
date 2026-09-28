// canary-chat-reaction — 메시지 **반응(이모지)** 이 폰·태블릿·데스크탑에서 깨지지 않는가 (2026-09-28)
//
//   Irene: "채팅에서 모바일에서만 채팅마다 이모티콘 넣을 수 있게 나오는데 왜 모바일에만 나와?
//           다른 메뉴랑 누르는게 겹쳐서 제대로 누를 수가 없어. 눌러서 이모티콘 나오면 왜 글자가
//           왼쪽으로 쏠려? … 이런 UI/UX 깨짐 현상이 사용자가 겪을 일 없게 점검할 방법이 없어?"
//   canary-chat-emoji 는 **입력창** 이모지(보내는 쪽)만, 데스크탑 한 폭만 쟀다. 메시지 반응은 계측 밖이었다.
//
// 재는 것 (3폭):
//   ① 가만히 있을 때 반응 버튼이 **안 보인다** — 폭과 무관하게 같은 규칙(폰에서만 보이던 것)
//   ② 메시지를 누르거나(터치) 올리면(마우스) 도구줄이 뜨고, 반응 버튼이 **그려져 있다**(elementFromPoint)
//      · 도구줄 버튼끼리 겹치지 않는다 · 터치에서는 36px 이상
//   ③ 반응 버튼을 누르면 고르는 줄이 뜬다 — 화면 안 · 모든 이모지가 그려짐 ·
//      **그 메시지 글자를 덮지 않는다** · **글자가 움직이지 않는다**(쏠림)
//   ④ 👍 를 고르면 칩이 생긴다(실제로 저장) → 칩을 누르면 사라진다
//   ⑤ 양성 대조군 — 도구줄을 늘 보이게 만든 CSS 를 넣으면 ① 이 **실패로 뒤집힌다**
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
     VALUES (?, '[카나리] 반응', 'internal', 'active', NOW(), NOW(), NOW())`, { replacements: [BIZ] });
  await sequelize.query(
    `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at, created_at)
     VALUES (?, ?, 'member', NOW(), NOW())`, { replacements: [convId, OWNER] });
  for (let i = 1; i <= 6; i++) {
    await sequelize.query(
      `INSERT INTO messages (conversation_id, sender_id, content, kind, created_at, updated_at)
       VALUES (?, ?, ?, 'text', DATE_SUB(NOW(), INTERVAL ? MINUTE), NOW())`,
      { replacements: [convId, OWNER, `[카나리] 반응 확인용 메시지 ${i} — 글자가 옆으로 쏠리는지 본다`, 10 - i] });
  }
  return convId;
}
async function cleanup(convId) {
  if (!convId) return;
  await sequelize.query('DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)', { replacements: [convId] });
  await sequelize.query('DELETE FROM messages WHERE conversation_id = ?', { replacements: [convId] });
  await sequelize.query('DELETE FROM conversation_participants WHERE conversation_id = ?', { replacements: [convId] });
  await sequelize.query('DELETE FROM conversations WHERE id = ?', { replacements: [convId] });
}

// 화면에 **그려진** 반응 버튼 수 — opacity 사슬 + 좌표에 자기 자신
const PAINTED_REACTION_BUTTONS = () => {
  const vis = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none') return false;
    }
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!h && (h === el || el.contains(h));
  };
  const btns = [...document.querySelectorAll('[data-testid^="chat-reaction-open-"], button[aria-label="반응 남기기"], button[aria-label="Add reaction"]')]
    .filter((x) => !x.closest('[data-testid="chat-reaction-picker"]'));
  return { total: btns.length, painted: btns.filter(vis).length };
};

const textRect = (id) => {
  const item = document.querySelector(`[data-msg-id="${id}"]`);
  if (!item) return null;
  // 본문 글자 — 메시지 안에서 그 문구를 가진 가장 안쪽 요소
  const leaf = [...item.querySelectorAll('*')].filter((e) => e.children.length === 0 && /반응 확인용 메시지/.test(e.textContent || '')).pop();
  if (!leaf) return null;
  const r = leaf.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), r: Math.round(r.right) };
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
    await b.login(page);

    for (const { key, vp, touch } of VIEWPORTS) {
      await page.setViewport(vp);
      await b.goto(page, `/talk?conv=${convId}`);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="qtalk-messages"] [data-msg-id]').length >= 6, { timeout: 20000 }).catch(() => null);
      await b.sleep(1200);
      const ids = await page.evaluate(() => [...document.querySelectorAll('[data-testid="qtalk-messages"] [data-msg-id]')].map((e) => e.getAttribute('data-msg-id')));
      if (ids.length < 6) { push(`${key} · 픽스처`, false, `메시지 ${ids.length}개 — 미측정`); continue; }
      const target = ids[ids.length - 3];   // 가운데쯤 — 위·아래 자리가 다 있다

      // ① 가만히 있을 때
      await page.mouse.move(2, 2);
      await b.sleep(300);
      const idle = await page.evaluate(PAINTED_REACTION_BUTTONS);
      push(`${key} · 가만히 있을 때 반응 버튼 안 보임`, idle.total > 0 && idle.painted === 0, `버튼 ${idle.total}개 중 그려진 것 ${idle.painted}`);

      // ⑤ 양성 대조군 (첫 폭에서만) — 도구줄을 늘 보이게 하면 ① 이 뒤집혀야 한다
      if (key.startsWith('폰')) {
        await page.addStyleTag({ content: '.pq-msg-toolbar{opacity:1!important;pointer-events:auto!important;transition:none!important}' }).then(async (h) => {
          await b.sleep(300);   // 도구줄에 opacity 전환(0.12s)이 있다 — 전환 중에 재면 0 으로 읽힌다
          const bad = await page.evaluate(PAINTED_REACTION_BUTTONS);
          push(`${key} · 대조군: 늘 보이게 하면 ① 이 실패로 뒤집힘`, bad.painted > 0, `그려진 것 ${bad.painted}`);
          await page.evaluate((el) => el.remove(), h);
          await b.sleep(300);
        });
      }

      // ② 도구줄 열기
      if (process.env.DBG) await page.evaluate(() => { window.__ev = []; ['scroll', 'resize'].forEach((n) => window.addEventListener(n, (e) => window.__ev.push(n + ':' + String((e.target && (e.target.className || e.target.nodeName)) || 'win').slice(0, 30)), true)); ['pointerdown', 'click', 'keydown'].forEach((n) => document.addEventListener(n, (e) => window.__ev.push(n + ':' + e.target.tagName), true)); const mo = new MutationObserver((recs) => { for (const r of recs) { r.addedNodes.forEach((n) => window.__ev.push('+' + (n.getAttribute && (n.getAttribute('data-testid') || n.className || n.tagName)))); r.removedNodes.forEach((n) => window.__ev.push('-' + (n.getAttribute && (n.getAttribute('data-testid') || n.className || n.tagName)))); } }); mo.observe(document.body, { childList: true }); });
      const before = await page.evaluate(textRect, target);
      const box = await page.evaluate((id) => { const r = document.querySelector(`[data-msg-id="${id}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 14) }; }, target);
      await page.evaluate(() => { window.__clk = []; document.addEventListener('click', (e) => window.__clk.push(e.target.closest('button') ? 'BUTTON' : e.target.tagName), { capture: true, once: true }); });
      if (touch) await page.touchscreen.tap(box.x, box.y); else await page.mouse.move(box.x, box.y);
      await b.sleep(400);
      if (touch) {
        // ★ 유령 클릭 — 탭하는 순간 :hover 로 도구줄이 손가락 밑에 뜨면 click 이 버튼에 떨어진다(2026-09-28 실측)
        const ghost = await page.evaluate(() => ({ clk: window.__clk[0] || 'none', picker: !!document.querySelector('[data-testid="chat-reaction-picker"]') }));
        push(`${key} · 메시지 탭이 도구줄 버튼을 누르지 않음`, ghost.clk !== 'BUTTON' && !ghost.picker, `클릭 대상=${ghost.clk} · 고르는 줄 열림=${ghost.picker}`);
      }
      if (process.env.DBG) console.log(key, 'AFTER-MSG-TAP', JSON.stringify(box), await page.evaluate(() => window.__ev.join(' | ')));
      const tb = await page.evaluate((id) => {
        const item = document.querySelector(`[data-msg-id="${id}"]`);
        const bar = item && item.querySelector('.pq-msg-toolbar');
        if (!bar) return { err: 'no_toolbar' };
        const btns = [...bar.querySelectorAll('button')].map((x) => x.getBoundingClientRect());
        let overlap = 0;
        for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
          const a = btns[i], c = btns[j];
          if (a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5) overlap++;
        }
        const rb = item.querySelector('[data-testid^="chat-reaction-open-"]');
        const r = rb && rb.getBoundingClientRect();
        const h = r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { n: btns.length, overlap, minSize: Math.min(...btns.map((x) => Math.min(x.width, x.height))), painted: !!h && (h === rb || rb.contains(h)) };
      }, target);
      push(`${key} · 도구줄에 반응 버튼이 보이고 겹치지 않음`, !tb.err && tb.painted && tb.overlap === 0 && (!touch || tb.minSize >= 36),
        tb.err || `버튼 ${tb.n}개 · 겹침 ${tb.overlap} · 최소 ${Math.round(tb.minSize)}px · 반응버튼 그려짐=${tb.painted}`);
      if (tb.err || !tb.painted) continue;

      // ③ 고르는 줄
      const sel = `[data-msg-id="${target}"] [data-testid^="chat-reaction-open-"]`;
      if (touch) { const r = await page.evaluate((s) => { const x = document.querySelector(s).getBoundingClientRect(); return { x: x.left + x.width / 2, y: x.top + x.height / 2 }; }, sel); await page.touchscreen.tap(r.x, r.y); }
      else await page.click(sel);
      await b.sleep(500);
      if (process.env.DBG) console.log(key, await page.evaluate(() => window.__ev.join(' | ')), await page.evaluate((s) => { const x = document.querySelector(s); return [getComputedStyle(x).backgroundColor, document.querySelectorAll('[data-testid="qtalk-messages"]').length, document.querySelectorAll(s).length]; }, sel));
      const pk = await page.evaluate(() => {
        const p = document.querySelector('[data-testid="chat-reaction-picker"]');
        if (!p) return { err: 'no_picker (scrollTop=' + document.querySelector('[data-testid="qtalk-messages"]').scrollTop + ')' };
        const r = p.getBoundingClientRect();
        const inView = r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
        const btns = [...p.querySelectorAll('button')];
        const painted = btns.filter((x) => { const q = x.getBoundingClientRect(); const h = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return h === x || x.contains(h); }).length;
        return { inView, n: btns.length, painted, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
      });
      const after = await page.evaluate(textRect, target);
      const shift = before && after ? Math.max(Math.abs(before.x - after.x), Math.abs(before.w - after.w), Math.abs(before.y - after.y)) : -1;
      const covers = !pk.err && after && !(pk.bottom <= after.y || pk.top >= after.b || pk.right <= after.x || pk.left >= after.r);
      push(`${key} · 고르는 줄: 화면 안·전부 보임`, !pk.err && pk.inView && pk.painted === pk.n && pk.n >= 8, pk.err || `이모지 ${pk.painted}/${pk.n} 보임 · 화면 안=${pk.inView}`);
      push(`${key} · 고르는 줄이 글자를 밀지도 덮지도 않음`, !pk.err && shift === 0 && !covers,
        pk.err || `글자 이동 ${shift}px · 덮음=${covers} (줄 ${pk.top}~${pk.bottom}, 글자 ${after && after.y}~${after && after.b})`);
      if (pk.err) continue;

      // ④ 👍 → 칩 → 다시 누르면 사라짐
      await page.evaluate(() => { const p = document.querySelector('[data-testid="chat-reaction-picker"]'); [...p.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === '👍').click(); });
      await page.waitForFunction((id) => /👍/.test(document.querySelector(`[data-msg-id="${id}"]`)?.innerText || ''), { timeout: 5000 }, target).catch(() => null);
      const [[{ n: saved }]] = await sequelize.query('SELECT COUNT(*) n FROM message_reactions WHERE message_id = ? AND emoji = ?', { replacements: [target, '👍'] });
      const chip = await page.evaluate((id) => !![...document.querySelectorAll(`[data-msg-id="${id}"] button`)].find((x) => /👍/.test(x.textContent || '') && !x.closest('[data-testid="chat-reaction-picker"]')), target);
      push(`${key} · 👍 저장되고 칩이 보임`, saved === 1 && chip, `DB ${saved}건 · 칩=${chip}`);
      await page.evaluate((id) => { const c = [...document.querySelectorAll(`[data-msg-id="${id}"] button`)].find((x) => /👍/.test(x.textContent || '')); c && c.click(); }, target);
      await b.sleep(1500);
      const [[{ n: left }]] = await sequelize.query('SELECT COUNT(*) n FROM message_reactions WHERE message_id = ?', { replacements: [target] });
      push(`${key} · 칩을 다시 누르면 취소`, left === 0, `DB 남은 반응 ${left}건`);
      await page.keyboard.press('Escape');
    }
  } catch (e) {
    results.push({ name: 'canary-chat-reaction', fail: 0, fatal: 1, details: ['FATAL ' + e.message] });
  } finally {
    if (browser) await browser.close().catch(() => null);
    await cleanup(convId).catch(() => null);
  }
  return results;
}

module.exports = { run, name: 'canary-chat-reaction' };
