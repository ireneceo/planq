// canary-chat-mine-right — Q talk «내가 보낸 글은 오른쪽» (2026-11-27)
//
//   Irene: "Q talk에서 내가 보낸 건 우측으로 배열되게 해서 기존 카톡이나 왓츠앱처럼 제대로 소통할 때 헷갈리지 않게."
//
// 재는 것 (폰 360·390 · 태블릿 820 · 데스크탑 1440):
//   ① 내 글 말풍선의 오른쪽 끝 ≈ 메시지 목록 오른쪽 끝(여백 ≤ 40px)
//   ② 남의 글 말풍선의 왼쪽 끝은 목록 왼쪽 1/4 안 · 말풍선 폭 < 목록 폭 90%
//   ③ 내 글 말풍선 색 ≠ 남의 글 색 (민트/회색)
//   ④ 긴 한 줄(공백 없는 문자열) 내 글 — 가로 넘침 없음(scrollWidth ≤ innerWidth)
//   ⑤ 반응 칩이 내 글이면 말풍선 아래 오른쪽 끝에 붙는다
//   ⑥ 양성 대조군 — 내 글의 줄 방향을 왼쪽으로 되돌리면 ① 판정이 뒤집힌다
require('./lib/mem-slot');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const b = require('./lib/browser');

const BIZ = 5;
const OWNER = 5;           // health-check@planq.kr (lib/browser 기본 계정)
const VIEWPORTS = [
  { key: '폰 360×780', vp: { width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '폰 390×844', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '태블릿 820×1180', vp: { width: 820, height: 1180, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '데스크탑 1440×900', vp: { width: 1440, height: 900 } },
];

async function seed() {
  const [[other]] = await sequelize.query(
    'SELECT u.id FROM users u JOIN business_members bm ON bm.user_id = u.id WHERE bm.business_id = ? AND u.id <> ? AND u.is_ai = 0 ORDER BY u.id LIMIT 1',
    { replacements: [BIZ, OWNER] });
  const [conv] = await sequelize.query(
    `INSERT INTO conversations (business_id, title, channel_type, status, last_message_at, created_at, updated_at)
     VALUES (?, '[카나리] 내 글 오른쪽', 'internal', 'active', NOW(), NOW(), NOW())`, { replacements: [BIZ] });
  for (const uid of [OWNER, other.id]) {
    await sequelize.query(
      `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at, created_at) VALUES (?, ?, 'member', NOW(), NOW())`,
      { replacements: [conv, uid] });
  }
  const ins = async (uid, text, min) => {
    const [id] = await sequelize.query(
      `INSERT INTO messages (conversation_id, sender_id, content, kind, created_at, updated_at) VALUES (?, ?, ?, 'text', DATE_SUB(NOW(), INTERVAL ? MINUTE), NOW())`,
      { replacements: [conv, uid, text, min] });
    return id;
  };
  const otherMsg = await ins(other.id, '[카나리] 상대가 보낸 글입니다', 30);
  const mineMsg = await ins(OWNER, '[카나리] 내가 보낸 짧은 글', 20);
  const longMsg = await ins(OWNER, '[카나리] ' + 'x'.repeat(240), 10);
  await sequelize.query('INSERT INTO message_reactions (message_id, user_id, business_id, emoji, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
    { replacements: [mineMsg, other.id, BIZ, '👍'] });
  return { conv, otherMsg, mineMsg, longMsg };
}
async function cleanup(ids) {
  if (!ids?.conv) return;
  const id = ids.conv;
  await sequelize.query('DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)', { replacements: [id] });
  await sequelize.query('DELETE FROM message_reads WHERE conversation_id = ?', { replacements: [id] }).catch(() => null);
  await sequelize.query('DELETE FROM messages WHERE conversation_id = ?', { replacements: [id] });
  await sequelize.query('DELETE FROM conversation_participants WHERE conversation_id = ?', { replacements: [id] });
  await sequelize.query('DELETE FROM conversations WHERE id = ?', { replacements: [id] });
}

const MEASURE = (ids) => {
  const list = document.querySelector('[data-testid="qtalk-messages"]');
  if (!list) return { err: 'no list' };
  const L = list.getBoundingClientRect();
  const one = (mid) => {
    const item = document.querySelector(`[data-msg-id="${mid}"]`);
    if (!item) return null;
    const bub = item.querySelector('[data-testid="chat-msg-bubble"]');
    const r = bub && bub.getBoundingClientRect();
    const h = r && document.elementFromPoint(r.left + Math.min(r.width / 2, 20), r.top + r.height / 2);
    const reactRow = [...item.querySelectorAll('button')].find((x) => /👍/.test(x.textContent || ''));
    const rr = reactRow && reactRow.getBoundingClientRect();
    return {
      mine: item.getAttribute('data-mine'),
      left: r ? Math.round(r.left - L.left) : null,
      rightGap: r ? Math.round(L.right - r.right) : null,
      width: r ? Math.round(r.width) : null,
      painted: !!h && (h === bub || bub.contains(h)),
      bg: bub ? getComputedStyle(bub).backgroundColor : null,
      reactRightGap: rr ? Math.round(L.right - rr.right) : null,
      reactBelow: rr && r ? rr.top >= r.bottom - 1 : null,
    };
  };
  return {
    listW: Math.round(L.width),
    other: one(ids.otherMsg), mine: one(ids.mineMsg), long: one(ids.longMsg),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
};

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let ids = null, browser = null;
  try {
    ids = await seed();
    const launched = await b.launch();
    browser = launched.browser;
    const page = launched.page;
    await b.login(page);
    for (const { key, vp } of VIEWPORTS) {
      await page.setViewport(vp);
      await b.goto(page, `/talk?conv=${ids.conv}`);
      await page.waitForFunction((m) => !!document.querySelector(`[data-msg-id="${m}"] [data-testid="chat-msg-bubble"]`), { timeout: 20000 }, ids.mineMsg).catch(() => null);
      await b.sleep(600);
      const s = await page.evaluate(MEASURE, ids);
      if (s.err || !s.mine || !s.other) { push(`${key} · 측정`, false, s.err || JSON.stringify(s)); continue; }
      push(`${key} · ① 내 글은 오른쪽 끝`, s.mine.mine === '1' && s.mine.painted && s.mine.rightGap <= 40 && s.mine.left > s.listW * 0.3,
        `오른쪽 여백 ${s.mine.rightGap}px · 왼쪽 ${s.mine.left}px · 목록 ${s.listW}px · 그려짐=${s.mine.painted}`);
      push(`${key} · ② 남의 글은 왼쪽 · 폭 < 90%`, s.other.mine === '0' && s.other.painted && s.other.left < s.listW * 0.25 && s.other.width < s.listW * 0.9,
        `왼쪽 ${s.other.left}px · 폭 ${s.other.width}/${s.listW}`);
      push(`${key} · ③ 말풍선 색 다름`, s.mine.bg !== s.other.bg, `${s.mine.bg} / ${s.other.bg}`);
      push(`${key} · ④ 긴 내 글 가로 넘침 없음`, s.overflow <= 0 && s.long && s.long.rightGap <= 40 && s.long.left >= 0,
        `넘침 ${s.overflow}px · 긴 글 왼쪽 ${s.long && s.long.left} 오른쪽 여백 ${s.long && s.long.rightGap}`);
      push(`${key} · ⑤ 반응 칩은 내 글 아래 오른쪽`, s.mine.reactRightGap != null && s.mine.reactRightGap <= 40 && s.mine.reactBelow === true,
        `칩 오른쪽 여백 ${s.mine.reactRightGap} · 아래=${s.mine.reactBelow}`);
      if (key.startsWith('데스크탑')) {
        // ⑥ 양성 대조군 — 내 글 줄 방향을 되돌리면 ① 이 실패해야 한다
        await page.addStyleTag({ content: '[data-mine="1"]{flex-direction:row !important;} [data-mine="1"] > div{align-items:flex-start !important;}' });
        await b.sleep(200);
        const c = await page.evaluate(MEASURE, ids);
        const wouldPass = c.mine && c.mine.rightGap <= 40 && c.mine.left > c.listW * 0.3;
        push(`${key} · ⑥ 대조군: 왼쪽으로 되돌리면 ① 이 실패로 뒤집힘`, !wouldPass, `되돌린 뒤 오른쪽 여백 ${c.mine && c.mine.rightGap}px`);
      }
    }
  } catch (e) {
    results.push({ name: 'canary-chat-mine-right', fail: 0, fatal: 1, details: ['FATAL ' + e.message] });
  } finally {
    if (browser) await browser.close().catch(() => null);
    await cleanup(ids).catch(() => null);
  }
  return results;
}

module.exports = { run, name: 'canary-chat-mine-right' };
