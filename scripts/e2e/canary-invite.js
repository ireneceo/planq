#!/usr/bin/env node
// canary-invite.js — 초대 링크로 들어온 가입·로그인이 «돌아갈 곳» 을 잃지 않는다 (0-F F-2)  run.js `--suite invite`
//
// 왜: 초대 링크(/invite/:token) → 로그인/가입 화면 → 구글 버튼을 누르면 redirect 가 사라져 새 워크스페이스가 생기고
//   초대가 수락되지 않았다. 화면 쪽 운반(링크 href · 구글 시작 URL)과 409 문구(영문 원문)를 실브라우저로 잰다.
// 서버 쪽(초대 모드 가입·state 운반)은 health-check `--category=invite` 가 잰다.
const b = require('./lib/browser');
const crypto = require('crypto');

const WIDTHS = [{ w: 1440, h: 900, mobile: false }, { w: 820, h: 1100, mobile: false }, { w: 390, h: 800, mobile: true }];
const results = [];
const P = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg], hasCanary: true });

let sequelize = null;
const db = () => { if (!sequelize) ({ sequelize } = require('/opt/planq/dev-backend/config/database')); return sequelize; };

async function run() {
  const M = require('/opt/planq/dev-backend/models');
  const owner = await M.User.findOne({ where: { email: b.CREDS.email } });
  const bizId = owner && owner.active_business_id;
  if (!bizId) { P('픽스처 — 초대 (판정 불가)', false, '검사 계정 워크스페이스 없음'); return { name: 'invite', results }; }
  const tok = `ha${crypto.randomBytes(16).toString('hex')}`;
  const row = await M.BusinessMember.create({ business_id: bizId, user_id: null, role: 'member', invite_token: tok, invite_email: `ha-invite-${Date.now()}@hm.invalid`, invited_at: new Date() });
  const enc = encodeURIComponent(`/invite/${tok}`);
  try {
    for (const W of WIDTHS) {
      const tag = `[${W.w}]`;
      const { browser, page } = await b.launch({ mobile: W.mobile });
      try {
        await page.setViewport({ width: W.w, height: W.h, isMobile: W.mobile, hasTouch: W.mobile });
        // ① 가입 → «로그인» 링크가 redirect 를 이어 간다
        await page.goto(`${b.BASE}/register?redirect=${enc}`, { waitUntil: 'domcontentloaded' });
        await b.sleep(1800);
        const href1 = await page.evaluate(() => document.querySelector('[data-testid="register-login-link"]')?.getAttribute('href') || null);
        P(`${tag} ① 가입 화면 «로그인» 링크에 같은 redirect`, !!href1 && href1.includes(enc), `href=${href1}`);
        // ② 구글 버튼 → 시작 URL 에 redirect (요청을 가로채 외부로 나가지 않는다)
        let started = null;
        await page.setRequestInterception(true);
        page.on('request', (rq) => {
          const u = rq.url();
          if (u.includes('/api/auth/google/initiate')) { if (!started) started = u; rq.abort().catch(() => {}); } else rq.continue().catch(() => {});
        });
        const hasBtn = await page.evaluate(() => { const x = document.querySelector('[data-testid="google-auth-btn"]'); if (x) { x.click(); return true; } return false; });
        for (let i = 0; i < 20 && !started; i++) await b.sleep(150);
        P(`${tag} ② 구글 버튼 시작 URL 에 redirect`, hasBtn && !!started && started.includes(`redirect=${enc}`), hasBtn ? `url=${started}` : '🔴 구글 버튼 없음(판정 불가)');
        await page.setRequestInterception(false).catch(() => {});
        // ①b 로그인 → «회원가입» 링크도 이어 간다
        await page.goto(`${b.BASE}/login?redirect=${enc}`, { waitUntil: 'domcontentloaded' });
        await b.sleep(1500);
        const href2 = await page.evaluate(() => document.querySelector('[data-testid="login-register-link"]')?.getAttribute('href') || null);
        P(`${tag} ①b 로그인 화면 «회원가입» 링크에 같은 redirect`, !!href2 && href2.includes(enc), `href=${href2}`);

        // ③ 이미 있는 이메일로 가입 → 영문 원문이 아니라 우리 문장(한 번만 — 가입 레이트리밋 3회/시간)
        if (W.w === 1440) {
          await page.goto(`${b.BASE}/register`, { waitUntil: 'domcontentloaded' });
          await b.sleep(1500);
          const filled = await page.evaluate(() => {
            const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
            const ins = [...document.querySelectorAll('form input')];
            const by = (tp) => ins.filter((x) => x.type === tp);
            const text = by('text'); const email = by('email')[0]; const pw = by('password')[0];
            if (!email || !pw || text.length < 1) return false;
            set(text[0], '카나리'); set(email, 'health-check@planq.kr'); set(pw, 'Canary!2026x');
            if (text[1]) set(text[1], '카나리 워크스페이스');
            for (const id of ['terms-agree', 'privacy-agree']) { const c = document.getElementById(id); if (c && !c.checked) c.click(); }
            return true;
          });
          await b.sleep(300);
          await page.evaluate(() => { const btn = document.querySelector('form button[type="submit"]'); if (btn) btn.click(); });
          await b.sleep(2500);
          const msg = await page.evaluate(() => document.body.innerText);
          // 헤드리스는 영어 로캘로 뜰 수 있다 — ko/en 우리 문장 둘 다 본다
          const ours = ['이미 가입된 이메일이에요', '가입 시도가 많아요', 'This email is already registered', 'Too many sign-up attempts'].some((x) => msg.includes(x));
          const raw = /Email already registered|Too many registration attempts/.test(msg);
          P(`${tag} ③ 이미 있는 이메일 — 우리 문장(email_taken/rate_limit_register), 영문 원문 0`, filled && ours && !raw,
            filled ? `우리 문장 ${ours} · 영문 원문 ${raw}` : '🔴 폼을 못 채웠다(판정 불가)');
        }
      } finally { await browser.close().catch(() => {}); }
    }
  } finally {
    await db().query('DELETE FROM business_members WHERE id = ?', { replacements: [row.id] }).catch(() => null);
  }
  return { name: 'invite', results };
}

module.exports = { run: async () => (await run()).results, name: 'invite' };

if (require.main === module) {
  require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
  run().then((r) => {
    let fail = 0;
    console.log('\n=== 초대 경로 카나리 ===');
    for (const x of r.results) { console.log(`${x.fail ? '❌' : '✅'} ${x.name} — ${x.details[0]}`); fail += x.fail; }
    console.log(`\n검사 ${r.results.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.stack || e.message); process.exit(2); });
}
