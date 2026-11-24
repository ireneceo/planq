#!/usr/bin/env node
// canary-qtalk-autojoin — 프로젝트 대화방 «프로젝트 멤버 자동 참여» 화면 (2026-11-24 · docs/PROJECT_ROOM_MEMBERSHIP_DESIGN.md · Fable 판정 10·11)
//
// 재는 것(폰 390 · 태블릿 820 · 데스크탑 1440):
//   ① 고객방 채팅 설정 — «자동 참여» 칸이 그려지고(elementFromPoint) 스위치는 꺼져 있다
//   ② 스위치를 누르면 확인창(aria-modal)이 뜨고 들어올 사람 이름 + «고객이 봅니다» 경고가 보인다 · 화면 안
//   ③ [취소] → DB 그대로(끔 · 참여자 수 같음) · 설정 창은 닫히지 않는다(확인창 클릭이 뒤 막으로 새지 않는다)
//   ④ (데스크탑) [켜기] → DB 켬 · 이름 둘이 참여자로 · 안내 줄 · 다시 끄기 → 참여자 그대로
//   ⑤ 멤버 계정 — 스위치가 «바꿀 수 없음»(disabled) + 안내
//   양성 대조군: ② 에서 확인창을 숨기면 판정이 뒤집힌다(폰 1회).
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
require('./lib/mem-slot');
const crypto = require('crypto');
const b = require('./lib/browser');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const BASE = process.env.E2E_BASE || 'https://dev.planq.kr';
const BIZ = 6, OWNER = 15, M1 = 16, M2 = 17, CUE = 19;
const b64u = (x) => Buffer.from(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function devCode(as, next = '/') {
  const p = b64u(JSON.stringify({ as, scope: { ws: BIZ }, exp: Date.now() + 90000, n: crypto.randomUUID(), next }));
  return `v1.${p}.${b64u(crypto.createHmac('sha256', process.env.DEV_LOGIN_SECRET).update(p).digest())}`;
}
const q = (s, r) => sequelize.query(s, { replacements: r }).then(([x]) => x);
const PAINTED = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return { ok: false, why: 'none' };
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  return { ok: r.width > 0 && r.height > 0 && !!hit && (el === hit || el.contains(hit) || hit.contains(el)), w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth };
};

async function seed() {
  const name = `[확인용] 자동 참여 화면 ${new Date().toISOString().slice(0, 10)}`;
  const pid = await q(`INSERT INTO projects (business_id, name, owner_user_id, status, created_at, updated_at) VALUES (?, ?, ?, 'active', NOW(), NOW())`, [BIZ, name, OWNER]);
  for (const [u, pm] of [[OWNER, 1], [M1, 0], [M2, 0]]) await q('INSERT INTO project_members (project_id, user_id, is_pm, role_order) VALUES (?, ?, ?, 0)', [pid, u, pm]);
  const cust = await q(`INSERT INTO conversations (business_id, project_id, title, channel_type, status, cue_enabled, auto_extract_enabled, project_auto_join, created_at, updated_at)
    VALUES (?, ?, '[확인용] 고객방', 'customer', 'active', 1, 0, 0, NOW(), NOW())`, [BIZ, pid]);
  for (const u of [OWNER, CUE]) await q("INSERT INTO conversation_participants (conversation_id, user_id, role, is_viewer, joined_at, created_at) VALUES (?, ?, 'member', 0, NOW(), NOW())", [cust, u]);
  // 멤버(⑤)가 그 방을 볼 수 있게 — 멤버는 참여한 방만 본다
  await q("INSERT INTO conversation_participants (conversation_id, user_id, role, is_viewer, joined_at, created_at) VALUES (?, ?, 'member', 0, NOW(), NOW())", [cust, M1]);
  return { pid, cust };
}
async function cleanup(ids) {
  if (!ids) return;
  await q('DELETE FROM conversation_participants WHERE conversation_id = ?', [ids.cust]);
  await q('DELETE FROM conversations WHERE id = ?', [ids.cust]);
  await q('DELETE FROM project_members WHERE project_id = ?', [ids.pid]);
  await q('DELETE FROM projects WHERE id = ?', [ids.pid]);
}
const state = async (ids) => {
  const [[c]] = await sequelize.query('SELECT project_auto_join a FROM conversations WHERE id = ?', { replacements: [ids.cust] });
  const ps = (await q('SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND is_viewer = 0', [ids.cust])).map((r) => Number(r.user_id)).sort((a, b) => a - b);
  return { on: !!Number(c.a), ps };
};
async function reset(ids) {
  await q('UPDATE conversations SET project_auto_join = 0 WHERE id = ?', [ids.cust]);
  await q('DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?', [ids.cust, M2]);
}

async function openSettings(page, as, ids) {
  await page.goto(`${BASE}/dev-login#code=${devCode(as, `/talk?conv=${ids.cust}`)}`, { waitUntil: 'domcontentloaded' });
  await b.sleep(5000);
  await b.dismissBlockers?.(page).catch(() => {});
  if (!/conv=/.test(page.url())) { await page.goto(`${BASE}/talk?conv=${ids.cust}`, { waitUntil: 'domcontentloaded' }); await b.sleep(4000); }
  await page.waitForSelector('[data-testid="chat-open-settings"]', { timeout: 20000 }).catch(() => null);
  await page.evaluate(() => document.querySelector('[data-testid="chat-open-settings"]')?.click());
  await page.waitForSelector('[data-testid="chat-settings-autojoin"]', { timeout: 10000 }).catch(() => null);
  await b.sleep(600);
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name: `qtalkautojoin:${name}`, fail: ok ? 0 : 1, details: [msg] });
  let ids = null;
  try {
    ids = await seed();
    const VPS = [['phone', { width: 390, height: 844, isMobile: true, hasTouch: true }], ['tablet', { width: 820, height: 1180 }], ['desktop', { width: 1440, height: 900 }]];
    for (const [label, vp] of VPS) {
      await reset(ids);
      const { browser, page } = await b.launch({});
      try {
        await page.setViewport(vp);
        await openSettings(page, 'owner', ids);
        const sec = await page.evaluate(PAINTED, '[data-testid="chat-settings-autojoin"]');
        const off = await page.evaluate(() => { const i = document.querySelector('[data-testid="chat-settings-autojoin-toggle"]'); return i ? { checked: i.checked, disabled: i.disabled } : null; });
        push(`${label} ① 고객방 «자동 참여» 칸 그려짐 · 꺼짐 · 바꿀 수 있음`, sec.ok && off && !off.checked && !off.disabled, `${JSON.stringify(sec)} ${JSON.stringify(off)}`);
        push(`${label} ① 설정 창 가로 넘침 0`, sec.right <= sec.vw && sec.left >= 0, `${sec.left}~${sec.right}/${sec.vw}`);

        await page.evaluate(() => document.querySelector('[data-testid="chat-settings-autojoin-toggle"]')?.click());
        // 확인창은 명단을 서버에서 받아 온 뒤 뜬다 — 고정 대기 대신 뜰 때까지(최대 8초)
        await page.waitForFunction(() => [...document.querySelectorAll('[aria-modal="true"]')].some((x) => /자동 참여 켜기|Turn on auto-join/.test(x.innerText || '')), { timeout: 8000 }).catch(() => null);
        await b.sleep(400);
        const dlg = await page.evaluate(() => {
          const ds = [...document.querySelectorAll('[aria-modal="true"]')];
          const d = ds.find((x) => /자동 참여 켜기|Turn on auto-join/.test(x.innerText || ''));
          if (!d) return { found: false, n: ds.length };
          const r = d.getBoundingClientRect();
          const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
          return { found: true, text: d.innerText.slice(0, 300), mine: !!hit && d.contains(hit), inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
        });
        const names = await q('SELECT u.id, COALESCE(bm.name, u.name) n FROM users u LEFT JOIN business_members bm ON bm.user_id = u.id AND bm.business_id = ? WHERE u.id = ?', [BIZ, M2]);
        const m2name = names[0]?.n || '';
        push(`${label} ② 확인창 뜸 · 화면 안 · 그려짐`, dlg.found && dlg.mine && dlg.inView, JSON.stringify({ ...dlg, text: undefined }));
        push(`${label} ② 확인창에 들어올 사람(${m2name}) + 고객 경고`, dlg.found && dlg.text.includes(m2name) && /고객이 참여자 목록에서|client will see/.test(dlg.text), (dlg.text || '').replace(/\n/g, ' / '));
        if (label === 'phone') {
          const h = await page.addStyleTag({ content: '[aria-modal="true"]{visibility:hidden!important}' });
          const hidden = await page.evaluate(() => { const ds = [...document.querySelectorAll('[aria-modal="true"]')]; const d = ds.find((x) => /자동 참여 켜기/.test(x.innerText || '')); if (!d) return false; const r = d.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && d.contains(hit); });
          push(`${label} 대조군: 확인창을 숨기면 «그려짐» 판정이 뒤집힘`, !hidden, String(hidden));
          await page.evaluate((el) => el.remove(), h);
          await b.sleep(200);
        }
        const before = await state(ids);
        // ③ 취소
        await page.evaluate(() => {
          const ds = [...document.querySelectorAll('[aria-modal="true"]')];
          const d = ds.find((x) => /자동 참여 켜기/.test(x.innerText || ''));
          const btn = d && [...d.querySelectorAll('button')].find((x) => /^(취소|Cancel)$/.test(x.innerText.trim()));
          btn?.click();
        });
        await b.sleep(1200);
        const afterCancel = await state(ids);
        const stillOpen = await page.evaluate(() => !!document.querySelector('[data-testid="chat-settings-autojoin"]'));
        push(`${label} ③ 취소 → DB 그대로 · 설정 창 열린 채`, !afterCancel.on && afterCancel.ps.join() === before.ps.join() && stillOpen, `${JSON.stringify(afterCancel)} open=${stillOpen}`);

        if (label === 'desktop') {
          await page.evaluate(() => document.querySelector('[data-testid="chat-settings-autojoin-toggle"]')?.click());
          await b.sleep(1500);
          await page.evaluate(() => {
            const ds = [...document.querySelectorAll('[aria-modal="true"]')];
            const d = ds.find((x) => /자동 참여 켜기/.test(x.innerText || ''));
            const btn = d && [...d.querySelectorAll('button')].find((x) => /^(켜기|Turn on)$/.test(x.innerText.trim()));
            btn?.click();
          });
          await b.sleep(2000);
          const on = await state(ids);
          const note = await page.evaluate(() => document.querySelector('[data-testid="chat-settings-autojoin"]')?.innerText || '');
          push(`${label} ④ 켜기 → DB 켬 · member2 참여`, on.on && on.ps.includes(M2), JSON.stringify(on));
          push(`${label} ④ 안내 줄 «1명이 들어왔어요»`, /1명이 들어왔어요|1 people joined/.test(note), note.replace(/\n/g, ' / '));
          await page.evaluate(() => document.querySelector('[data-testid="chat-settings-autojoin-toggle"]')?.click());
          await b.sleep(1500);
          const offAgain = await state(ids);
          push(`${label} ④ 다시 끄기 → 끔 · 참여자 그대로`, !offAgain.on && offAgain.ps.join() === on.ps.join(), JSON.stringify(offAgain));
        }
      } catch (e) { push(`${label} 실행`, false, e.message); } finally { await browser.close().catch(() => {}); }
    }
    // ⑤ 멤버 계정 — 바꿀 수 없음
    await reset(ids);
    const { browser, page } = await b.launch({});
    try {
      await page.setViewport({ width: 1440, height: 900 });
      await openSettings(page, 'member', ids);
      const st = await page.evaluate(() => { const i = document.querySelector('[data-testid="chat-settings-autojoin-toggle"]'); const s = document.querySelector('[data-testid="chat-settings-autojoin"]'); return i ? { disabled: i.disabled, text: s.innerText } : null; });
      push('member ⑤ 스위치 바꿀 수 없음 + 안내', !!st && st.disabled && /대표·관리자만|owners and admins/.test(st.text), JSON.stringify(st));
    } catch (e) { push('member 실행', false, e.message); } finally { await browser.close().catch(() => {}); }
  } catch (e) {
    push('픽스처', false, e.message);
  } finally {
    await cleanup(ids).catch(() => {});
  }
  return results;
}

module.exports = { run, name: 'qtalkautojoin' };
if (require.main === module) {
  run().then((r) => {
    let f = 0;
    for (const x of r) { if (x.fail) f += 1; console.log(`${x.fail ? '❌' : '✅'} ${x.name} — ${x.details[0]}`); }
    console.log(`\n${r.length - f} 통과 / ${f} 실패`);
    sequelize.close().finally(() => process.exit(f ? 1 : 0));
  });
}
