#!/usr/bin/env node
// canary-menu-hide.js — 멤버 메뉴 권한 «숨김» 을 화면이 따른다 (0-E E-2, docs/FIX_0CDEF_ACCESS_DESIGN.md)  run.js `--suite menuhide`
//
// 왜 실브라우저인가: 여태 서버만 403 이었고 사이드바·검색·탭 + 는 권한을 안 읽었다 — 메뉴는 보이는데 누르면 빈 화면.
//   그래서 «서버가 막는다» 가 아니라 **화면에 없는가 / 주소로 들어오면 이유를 말하는가 / 새로고침 없이 돌아오는가** 를 잰다.
//
// 대조군: 오너(같은 워크스페이스)는 전 단계에서 Q mail 이 보인다(음성 대조군 — 전부 안 보여 거짓 통과하는 것을 막는다).
// 픽스처는 Node 에서 만든다(page.evaluate 안에서 만들면 하니스가 죽는다 — memory feedback_fixture_inside_browser_kills_harness).
const b = require('./lib/browser');
const crypto = require('crypto');

const API = (process.env.E2E_BASE || 'https://dev.planq.kr') + '/api';
const WIDTHS = [{ w: 1440, h: 900, mobile: false }, { w: 820, h: 1100, mobile: false }, { w: 390, h: 800, mobile: true }];
const results = [];
const P = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg], hasCanary: true });

let sequelize = null;
const db = () => { if (!sequelize) ({ sequelize } = require('/opt/planq/dev-backend/config/database')); return sequelize; };

async function apiLogin(email, password) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json().catch(() => ({}));
  return j?.data?.token || null;
}

/** 사이드바 Q mail 링크가 **DOM 에 있는가**(폰은 메뉴가 접혀 있어도 DOM 은 그린다) + 검색 목록에 있는가 */
const PROBE = `(() => {
  const side = [...document.querySelectorAll('a[href="/mail"]')].filter((a) => !a.closest('[aria-modal="true"]')).length;
  return { side, path: location.pathname };
})()`;

async function run() {
  const M = require('/opt/planq/dev-backend/models');
  const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
  const owner = await M.User.findOne({ where: { email: b.CREDS.email } });
  const bizId = owner && owner.active_business_id;
  if (!bizId) { P('픽스처 — 검사 계정 워크스페이스 (판정 불가)', false, '검사 계정의 활성 워크스페이스가 없다'); return { name: 'menuhide', results }; }
  const pw = `Ha!${crypto.randomBytes(6).toString('hex')}`;
  const email = `ha-menuhide-${Date.now().toString(36)}@hm.invalid`;
  const member = await M.User.create({
    email, password_hash: await bcrypt.hash(pw, 10), name: '[canary] 숨김 멤버', status: 'active', active_business_id: bizId,
    terms_accepted_at: new Date(), privacy_accepted_at: new Date(),
  }, { hooks: false });
  await M.BusinessMember.create({ business_id: bizId, user_id: member.id, role: 'member', joined_at: new Date() });
  const ownerToken = await apiLogin(b.CREDS.email, b.CREDS.password);
  const setLevel = async (level) => {
    const r = await fetch(`${API}/businesses/${bizId}/members/${member.id}/permissions`, {
      method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ menu_key: 'qmail', level }),
    });
    return r.status;
  };
  try {
    for (const W of WIDTHS) {
      const tag = `[${W.w}]`;
      const st = await setLevel('none');
      if (st !== 200) { P(`${tag} 픽스처 — qmail=none (판정 불가)`, false, `권한 PUT ${st}`); continue; }

      // ── 멤버(숨김) ──
      const m = await b.launch({ mobile: W.mobile });
      try {
        await m.page.setViewport({ width: W.w, height: W.h, isMobile: W.mobile, hasTouch: W.mobile });
        await b.login(m.page, { email, password: pw });
        await b.goto(m.page, '/dashboard'); await b.sleep(1800); await b.dismissBlockers(m.page).catch(() => {});
        const p1 = await m.page.evaluate(PROBE);
        const navCount = await m.page.evaluate(() => document.querySelectorAll('a[href="/tasks"]').length);
        P(`${tag} ① 사이드바에 Q mail 이 없다 (같은 사이드바의 Q task 는 있다 — 판정 가능)`, p1.side === 0 && navCount > 0,
          `Q mail 링크 ${p1.side} · Q task 링크 ${navCount}`);

        // ③ 통합검색(탭 + 와 같은 함수)의 메뉴 목록
        const opened = await m.page.evaluate(() => { const x = document.querySelector('[data-testid="nav-search"]'); if (x) { x.click(); return true; } return false; });
        await b.sleep(900);
        const s = await m.page.evaluate(() => {
          const d = document.querySelector('[aria-modal="true"]');
          const txt = d ? d.innerText : '';
          return { open: !!d, mail: /Q mail/i.test(txt), task: /Q task/i.test(txt) };
        });
        P(`${tag} ③ 통합검색 메뉴 목록에 Q mail 이 없다 (Q task 는 있다)`, opened && s.open && !s.mail && s.task,
          `열림 ${s.open} · Q mail ${s.mail} · Q task ${s.task}`);
        await m.page.keyboard.press('Escape').catch(() => {}); await b.sleep(300);

        // ② 주소로 직접 → 안내가 **보인다**
        await b.goto(m.page, '/mail'); await b.sleep(2200);
        const v = await m.page.evaluate(() => {
          const el = document.querySelector('[data-testid="menu-hidden"]');
          if (!el) return { found: false };
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { found: true, w: Math.round(r.width), h: Math.round(r.height), mine: !!hit && (el === hit || el.contains(hit)), text: el.innerText.slice(0, 40) };
        });
        P(`${tag} ② /mail 직접 진입 — «숨겨진 메뉴» 안내가 보인다`, v.found && v.mine && v.w > 0,
          v.found ? `${v.w}×${v.h} · 좌표 명중 ${v.mine} · "${v.text}"` : '🔴 안내가 없다(빈 화면/본문이 그대로)');

        // ④ 권한을 되돌리면 새로고침 없이 메뉴가 돌아온다(소켓 permissions:updated → /me)
        await b.goto(m.page, '/dashboard'); await b.sleep(1500);
        const t0 = Date.now();
        await setLevel('write');
        let back = 0;
        for (let i = 0; i < 20; i++) { back = (await m.page.evaluate(PROBE)).side; if (back > 0) break; await b.sleep(150); }
        const ms = Date.now() - t0;
        P(`${tag} ④ 권한을 돌리면 새로고침 없이 Q mail 이 돌아온다(≤2초)`, back > 0 && ms <= 3200, `${back > 0 ? '돌아옴' : '🔴 안 돌아옴'} ${ms}ms`);
      } finally { await m.browser.close().catch(() => {}); }

      // ⑤ 오너(음성 대조군) — 같은 워크스페이스에서 Q mail 이 보인다
      const o = await b.launch({ mobile: W.mobile });
      try {
        await o.page.setViewport({ width: W.w, height: W.h, isMobile: W.mobile, hasTouch: W.mobile });
        await b.login(o.page);
        await b.goto(o.page, '/dashboard'); await b.sleep(1800);
        const p5 = await o.page.evaluate(PROBE);
        P(`${tag} ⑤ 오너는 Q mail 이 보인다(음성 대조군)`, p5.side > 0, `Q mail 링크 ${p5.side}`);
      } finally { await o.browser.close().catch(() => {}); }
    }
  } finally {
    await db().query('DELETE FROM business_member_permissions WHERE user_id = ?', { replacements: [member.id] }).catch(() => null);
    await db().query('DELETE FROM business_members WHERE user_id = ?', { replacements: [member.id] }).catch(() => null);
    await db().query('DELETE FROM refresh_tokens WHERE user_id = ?', { replacements: [member.id] }).catch(() => null);
    await db().query('DELETE FROM notifications WHERE user_id = ?', { replacements: [member.id] }).catch(() => null);
    await db().query('SET FOREIGN_KEY_CHECKS = 0').catch(() => null);
    await db().query('DELETE FROM users WHERE id = ?', { replacements: [member.id] }).catch(() => null);
    await db().query('SET FOREIGN_KEY_CHECKS = 1').catch(() => null);
  }
  return { name: 'menuhide', results };
}

module.exports = { run: async () => (await run()).results, name: 'menuhide' };

if (require.main === module) {
  require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
  run().then((r) => {
    let fail = 0;
    console.log('\n=== 메뉴 숨김 카나리 ===');
    for (const x of r.results) { console.log(`${x.fail ? '❌' : '✅'} ${x.name} — ${x.details[0]}`); fail += x.fail; }
    console.log(`\n검사 ${r.results.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.stack || e.message); process.exit(2); });
}
