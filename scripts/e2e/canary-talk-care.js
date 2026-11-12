// canary-talk-care — Q talk 고객 문의 «응대 상태 · 담당자» 화면 (2026-11-12 · docs/QTALK_CARE_DESIGN.md, Fable DESIGN: READY)
//
// 재는 것 (폰 390 · 태블릿 820 · 데스크탑 1440):
//   ① 고객 방 밴드2 — «고객» 칩 바로 뒤에 상태·담당 칩이 그려지고(elementFromPoint) 밴드2 는 한 줄(높이 = 내부 방과 같음) ·
//      메시지 목록 시작 y 가 칩 없는 내부 방과 같다 · 내부 방에는 칩이 없다
//   ② 상태 칩 → 팝오버(보기 3개 그려짐 · 폰이면 화면 안) → «보류» 고르면 DB state = hold · 칩 글자 바뀜
//   ③ 담당 칩 → «내가 맡기» → DB assignee = 나
//   ④ 좌측 «답할 문의 N» — 라벨 숫자 = 걸렀을 때 행 수 · 내 것·미배정 방은 남고 남의 담당·보류 방은 빠진다 · 폰에서 세그먼트 3칸 한 줄(넘치면 가로 흘림)
//   ⑤ 모르는 state 는 글자 그대로 — 목록 응답을 가로채 'escalated' 를 넣으면 칩에 'escalated'
//   ⑥ 양성 대조군 — 상태 칩을 숨기는 CSS 를 넣으면 ① 의 «그려짐» 판정이 뒤집힌다
require('./lib/mem-slot');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const b = require('./lib/browser');

const BIZ = 5;
const OWNER = 5;            // health-check@planq.kr
const OTHER = 1000024;      // 같은 워크스페이스 멤버(Perm Member) — «남의 담당» 방
const VIEWPORTS = [
  { key: '폰 390×844', touch: true, phone: true, vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '태블릿 820×1180', touch: true, vp: { width: 820, height: 1180, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '데스크탑 1440×900', touch: false, vp: { width: 1440, height: 900 } },
];

async function mkConv(title, type = 'customer') {
  const [id] = await sequelize.query(
    `INSERT INTO conversations (business_id, title, channel_type, status, last_message_at, created_at, updated_at)
     VALUES (?, ?, ?, 'active', NOW(), NOW(), NOW())`, { replacements: [BIZ, title, type] });
  await sequelize.query(`INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at, created_at) VALUES (?, ?, 'member', NOW(), NOW())`, { replacements: [id, OWNER] });
  await sequelize.query(`INSERT INTO messages (conversation_id, sender_id, content, kind, created_at, updated_at) VALUES (?, ?, '[카나리] 응대 시험 글', 'text', NOW(), NOW())`, { replacements: [id, OWNER] });
  return id;
}
async function setCare(id, state, assignee) {
  await sequelize.query('DELETE FROM conversation_care WHERE conversation_id = ?', { replacements: [id] });
  if (!state) return;
  await sequelize.query(
    `INSERT INTO conversation_care (conversation_id, business_id, state, state_changed_at, assignee_user_id, created_at, updated_at)
     VALUES (?, ?, ?, NOW(), ?, NOW(), NOW())`, { replacements: [id, BIZ, state, assignee] });
}
async function seed() {
  const main = await mkConv('[카나리] 응대 — 칩');          // 행 없음에서 시작
  const internal = await mkConv('[카나리] 응대 — 내부', 'internal');
  const mineUn = await mkConv('[카나리] 응대 — 미배정');    // open · 미배정 → 답할 문의
  const mine = await mkConv('[카나리] 응대 — 내 담당');     // open · 나 → 답할 문의
  const other = await mkConv('[카나리] 응대 — 남의 담당');  // open · 남 → 빠짐
  const held = await mkConv('[카나리] 응대 — 보류');        // hold · 나 → 빠짐
  return { main, internal, mineUn, mine, other, held };
}
async function resetCare(ids) {
  await setCare(ids.main, null);
  await setCare(ids.mineUn, 'open', null);
  await setCare(ids.mine, 'open', OWNER);
  await setCare(ids.other, 'open', OTHER);
  await setCare(ids.held, 'hold', OWNER);
}
async function cleanup(ids) {
  for (const id of Object.values(ids || {})) {
    if (!id) continue;
    await sequelize.query('DELETE FROM conversation_care WHERE conversation_id = ?', { replacements: [id] }).catch(() => null);
    await sequelize.query('DELETE FROM messages WHERE conversation_id = ?', { replacements: [id] });
    await sequelize.query('DELETE FROM conversation_participants WHERE conversation_id = ?', { replacements: [id] });
    await sequelize.query('DELETE FROM conversations WHERE id = ?', { replacements: [id] });
  }
  // 배정 알림(나 → 나 는 0 이지만 혹시) · 감사 행은 남긴다(원장)
}

const PAINTED = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return { ok: false, why: 'none' };
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none') return { ok: false, why: 'hidden' };
  }
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return { ok: false, why: 'zero' };
  const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { ok: !!h && (h === el || el.contains(h)), why: h ? (h.getAttribute('data-testid') || h.tagName) : 'nohit',
    left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), vw: window.innerWidth };
};
const BAND = () => {
  const band = document.querySelector('[data-testid="chat-header-band2"]');
  const list = document.querySelector('[data-testid="qtalk-messages"]');
  if (!band || !list) return null;
  const r = band.getBoundingClientRect();
  return { h: Math.round(r.height), listTop: Math.round(list.getBoundingClientRect().top) };
};

async function tapOrClick(page, sel, touch) {
  const r = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const x = e.getBoundingClientRect(); return { x: x.left + x.width / 2, y: x.top + x.height / 2 }; }, sel);
  if (!r) return false;
  if (touch) await page.touchscreen.tap(r.x, r.y); else await page.mouse.click(r.x, r.y);
  return true;
}
async function openConv(page, id) {
  await b.goto(page, `/talk?conv=${id}`);
  await page.waitForFunction(() => !!document.querySelector('[data-testid="chat-header-band2"]') && !!document.querySelector('[data-testid="qtalk-messages"]'), { timeout: 20000 }).catch(() => null);
  await b.sleep(900);
}

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

    for (const { key, vp, touch, phone } of VIEWPORTS) {
      await resetCare(ids);
      await page.setViewport(vp);

      // ① 밴드2 — 내부 방(칩 없음) 기준선
      await openConv(page, ids.internal);
      const noChip = await page.evaluate(() => !document.querySelector('[data-testid="chat-care-state"]'));
      // 기준선 = 같은 고객 방에서 칩만 뺀 모습(고객 방엔 «고객 링크» 카드 등 내부 방과 다른 줄이 있어 내부 방과 비교하면 안 된다)
      await openConv(page, ids.main);
      const hideTag = await page.addStyleTag({ content: '[data-testid="chat-care-state"],[data-testid="chat-care-assignee"]{display:none!important}' });
      await b.sleep(250);
      const base = await page.evaluate(BAND);
      await page.evaluate((el) => el.remove(), hideTag);
      await b.sleep(250);
      const withChip = await page.evaluate(BAND);
      const st = await page.evaluate(PAINTED, '[data-testid="chat-care-state"]');
      const as = await page.evaluate(PAINTED, '[data-testid="chat-care-assignee"]');
      const stText = await page.evaluate(() => document.querySelector('[data-testid="chat-care-state"]')?.innerText || '');
      push(`${key} · 내부 방엔 칩 없음`, noChip, `칩 없음=${noChip}`);
      push(`${key} · 고객 방 상태·담당 칩이 그려짐(행 없음 → «응대 상태 정하기»)`, st.ok && as.ok && /응대 상태 정하기|Set status/.test(stText),
        `상태 ${JSON.stringify(st)} · 담당 ${JSON.stringify(as)} · «${stText}»`);
      push(`${key} · 밴드2 한 줄 · 본문 시작 y 같음(칩 없을 때와)`, !!base && !!withChip && base.h === withChip.h && base.listTop === withChip.listTop,
        `칩 없음 ${JSON.stringify(base)} · 칩 있음 ${JSON.stringify(withChip)}`);
      if (phone) {
        const h = await page.addStyleTag({ content: '[data-testid="chat-care-state"]{visibility:hidden!important}' });
        const bad = await page.evaluate(PAINTED, '[data-testid="chat-care-state"]');
        push(`${key} · 대조군: 상태 칩을 숨기면 판정이 뒤집힘`, !bad.ok, JSON.stringify(bad));
        await page.evaluate((el) => el.remove(), h);
        await b.sleep(200);
      }
      if (!st.ok) continue;

      // ② 상태 팝오버 → 보류
      await tapOrClick(page, '[data-testid="chat-care-state"]', touch);
      await b.sleep(500);
      const opts = [];
      for (const s of ['open', 'hold', 'resolved']) opts.push(await page.evaluate(PAINTED, `[data-testid="chat-care-state-opt-${s}"]`));
      const inScreen = opts.every((o) => o.ok && o.left >= 0 && o.right <= o.vw);
      push(`${key} · 상태 팝오버 보기 3개 그려짐${phone ? ' · 화면 안' : ''}`, inScreen, opts.map((o) => `${o.why}[${o.left},${o.right}]`).join(' '));
      await tapOrClick(page, '[data-testid="chat-care-state-opt-hold"]', touch);
      await b.sleep(1200);
      const [[r1]] = await sequelize.query('SELECT state, state_changed_by FROM conversation_care WHERE conversation_id = ?', { replacements: [ids.main] });
      const stText2 = await page.evaluate(() => document.querySelector('[data-testid="chat-care-state"]')?.innerText || '');
      push(`${key} · «보류» → DB hold · 칩 글자 바뀜`, r1 && r1.state === 'hold' && Number(r1.state_changed_by) === OWNER && /보류|On hold/.test(stText2), `DB ${JSON.stringify(r1)} · «${stText2}»`);

      // ③ 담당 → 내가 맡기
      await tapOrClick(page, '[data-testid="chat-care-assignee"]', touch);
      await b.sleep(500);
      const take = await page.evaluate(PAINTED, '[data-testid="chat-care-take"]');
      push(`${key} · 담당 팝오버 «내가 맡기» 그려짐${phone ? ' · 화면 안' : ''}`, take.ok && take.left >= 0 && take.right <= take.vw, JSON.stringify(take));
      if (take.ok) {
        await tapOrClick(page, '[data-testid="chat-care-take"]', touch);
        await b.sleep(1200);
        const [[r2]] = await sequelize.query('SELECT state, assignee_user_id FROM conversation_care WHERE conversation_id = ?', { replacements: [ids.main] });
        const asText = await page.evaluate(() => document.querySelector('[data-testid="chat-care-assignee"]')?.innerText || '');
        push(`${key} · «내가 맡기» → DB 담당 = 나 · 상태 그대로(hold)`, r2 && Number(r2.assignee_user_id) === OWNER && r2.state === 'hold', `DB ${JSON.stringify(r2)} · «${asText}»`);
      }

      // ④ 좌측 «답할 문의» — 목록이 보이는 화면(/talk, 연 방 없음)
      await resetCare(ids);
      await b.goto(page, '/talk');
      await page.waitForFunction((a) => !!document.querySelector(`[data-qtalk-chat="${a}"]`), { timeout: 15000 }, ids.mine).catch(() => null);
      await b.sleep(700);
      const seg = await page.evaluate(() => {
        const f = document.querySelector('[data-testid="qtalk-filter"]');
        const btns = [...(f ? f.querySelectorAll('button') : [])].map((x) => x.getBoundingClientRect());
        const fr = f ? f.getBoundingClientRect() : null;
        return { n: btns.length, oneRow: btns.length > 0 && btns.every((r) => Math.abs(r.top - btns[0].top) < 1), h: fr ? Math.round(fr.height) : 0, scrollW: f ? f.scrollWidth : 0, clientW: f ? f.clientWidth : 0 };
      });
      push(`${key} · 세그먼트 3칸 한 줄(높이 32 · 넘치면 가로 흘림)`, seg.n === 3 && seg.oneRow && seg.h === 32, JSON.stringify(seg));
      const mineBtn = await page.evaluate(PAINTED, '[data-testid="qtalk-filter-mine"]');
      if (!mineBtn.ok) { push(`${key} · 답할 문의 버튼 그려짐`, false, JSON.stringify(mineBtn)); continue; }
      const label = await page.evaluate(() => document.querySelector('[data-testid="qtalk-filter-mine"]').innerText);
      await tapOrClick(page, '[data-testid="qtalk-filter-mine"]', touch);
      await b.sleep(500);
      const rows = await page.evaluate((I) => {
        const ids = [...document.querySelectorAll('[data-qtalk-chat]')].map((x) => Number(x.getAttribute('data-qtalk-chat')));
        return { n: ids.length, has: { mineUn: ids.includes(I.mineUn), mine: ids.includes(I.mine), other: ids.includes(I.other), held: ids.includes(I.held), main: ids.includes(I.main) } };
      }, ids);
      const labelN = Number((label.match(/\d+/) || ['0'])[0]);
      push(`${key} · «답할 문의 N» = 걸렀을 때 행 수`, labelN === rows.n && rows.n >= 2, `라벨 «${label}» · 행 ${rows.n}`);
      push(`${key} · 내 담당·미배정만 남고 남의 담당·보류·문의 없음 빠짐`, rows.has.mineUn && rows.has.mine && !rows.has.other && !rows.has.held && !rows.has.main, JSON.stringify(rows.has));
      const tagMine = await page.evaluate((id) => document.querySelector(`[data-qtalk-chat="${id}"] [data-testid="qtalk-care-tag"]`)?.innerText || '', ids.mineUn);
      push(`${key} · 행 태그 — 미배정 방은 «미배정»`, /미배정|Unassigned/.test(tagMine), `«${tagMine}»`);
      await tapOrClick(page, '[data-testid="qtalk-filter-all"]', touch);
      await b.sleep(300);
      const tagHeld = await page.evaluate((id) => document.querySelector(`[data-qtalk-chat="${id}"] [data-testid="qtalk-care-tag"]`)?.innerText || '', ids.held);
      push(`${key} · 행 태그 — 보류 방은 [보류]`, /보류|On hold/.test(tagHeld), `«${tagHeld}»`);
    }

    // ⑤ 모르는 state 는 글자 그대로 (응답 가로채기 — 데스크탑 한 번)
    await resetCare(ids);
    const page2 = await browser.newPage();
    await page2.setViewport(VIEWPORTS[2].vp);
    await page2.evaluateOnNewDocument((cid) => {
      const orig = window.fetch;
      window.fetch = async (...args) => {
        const res = await orig(...args);
        const url = String(args[0] && args[0].url ? args[0].url : args[0]);
        if (!/\/api\/conversations\/\d+(\?|$)/.test(url)) return res;
        try {
          const j = await res.clone().json();
          if (Array.isArray(j.data)) for (const c of j.data) if (c.id === cid) c.care = { state: 'escalated', assignee_user_id: null, assignee: null };
          return new Response(JSON.stringify(j), { status: res.status, headers: res.headers });
        } catch { return res; }
      };
    }, ids.mine);
    await b.login(page2);
    await openConv(page2, ids.mine);
    const unk = await page2.evaluate(() => document.querySelector('[data-testid="chat-care-state"]')?.innerText || '');
    push('데스크탑 · 모르는 state 는 글자 그대로(가로챈 응답 escalated)', /escalated/.test(unk), `«${unk}»`);
    await page2.close();
  } catch (e) {
    results.push({ name: 'canary-talk-care', fail: 0, fatal: 1, details: ['FATAL ' + e.message] });
  } finally {
    if (browser) await browser.close().catch(() => null);
    await cleanup(ids).catch(() => null);
  }
  return results;
}

module.exports = { run, name: 'canary-talk-care' };
