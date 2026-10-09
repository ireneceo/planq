#!/usr/bin/env node
// canary-sign-inbox-open.js — 확인필요의 «서명» 항목을 누르면 **서명할 문서가 보이는가** (2026-10-09)
//
// Irene: *"확인필요에 이 업무가 있는데 눌러도 서명문서 안나와."*
// 원인: 확인필요는 우리 쪽 서명자를 `/sign/:token` 으로 보낸다(새 창). 웹은 새 브라우저 탭이라 멀쩡했지만
//   **앱(아이패드 = 데스크탑 탭 모드)** 은 nativeLinks 가 그 새 창을 앱 안 새 탭으로 돌리고, 탭 본문 표(TabPane)에
//   `/sign` 이 없어 **주소만 바뀌고 빈 탭**이었다. 웹만 재면 영영 초록이다 — 그래서 «앱 흉내» 를 같이 잰다.
//
// 판정: 문서 본문 문장이 **보이는가**(elementFromPoint) + 로그인한 본인이므로 «서명하기» 가 바로 있는가(로그인 요구 아님).
//   웹은 새 창(팝업)에서, 앱은 같은 화면(앱 안 탭/이동)에서 잰다. 폰 앱도 같이(미러 모드 — 다른 길).
const b = require('./lib/browser');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');

const API = (process.env.E2E_BASE || 'https://dev.planq.kr') + '/api';
const BODY = '카나리 확인필요 서명 본문 문장';
const results = [];
const P = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg], hasCanary: true });

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ENVS = [
  { name: '데스크탑 웹(1440)', vp: { width: 1440, height: 900 } },
  { name: '아이패드 앱(1180·탭 모드)', vp: { width: 1180, height: 820 }, native: true, ua: MAC_UA },
  { name: '폰 웹(390)', vp: { width: 390, height: 844, isMobile: true, hasTouch: true }, ua: IPHONE_UA + ' Safari/604.1' },
  { name: '폰 앱(390)', vp: { width: 390, height: 844, isMobile: true, hasTouch: true }, native: true, ua: IPHONE_UA },
];

async function api(path, opts = {}) {
  const r = await fetch(API + path, opts);
  let json = {};
  try { json = JSON.parse(await r.text()); } catch { /* 비 JSON */ }
  return { status: r.status, json };
}

// 앱 흉내 — 아이패드 앱 방식(canary-button-patrol 과 같은 스텁). 스텁 없이 하면 플러그인 호출이 실패해 다른 길을 잰다.
function nativeStub() {
  window.__nativeCalls = [];
  const rec = (pl, me, op) => { try { window.__nativeCalls.push({ p: pl, m: me, url: op && op.url }); } catch { /* */ } return Promise.resolve({}); };
  window.Capacitor = { nativePromise: rec, nativeCallback: (pl, me, op) => { rec(pl, me, op); return String(Math.random()); }, PluginHeaders: [{ name: 'Browser', methods: [{ name: 'open', rtype: 'promise' }] }] };
  window.webkit = { messageHandlers: { bridge: { postMessage(m) {
    try { window.__nativeCalls.push({ p: m.pluginId, m: m.methodName, url: m.options && m.options.url }); } catch { /* */ }
    setTimeout(() => { try { window.Capacitor.fromNative({ callbackId: m.callbackId, pluginId: m.pluginId, methodName: m.methodName, success: true, data: {} }); } catch { /* */ } }, 0);
  } } } };
}

const MEASURE = `((body) => {
  const el = [...document.querySelectorAll('p')].find((p) => p.textContent.includes(body) && p.getClientRects().length);
  let visible = 'none';
  if (el) {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const h = document.elementFromPoint(r.left + 5, r.top + r.height / 2);
    visible = (h && (h === el || el.contains(h))) ? 'yes' : 'covered';
  }
  const loginNeeded = !!document.querySelector('[data-testid="sign-login"],[data-testid="sign-login-needed"]');
  const signBtn = [...document.querySelectorAll('button')].some((x) => x.textContent.includes('서명하기') && x.getClientRects().length);
  return { url: location.pathname, visible, loginNeeded, signBtn };
})`;

async function run() {
  let postId = null;
  try {
    const lj = await api('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: b.CREDS.email, password: b.CREDS.password }) });
    const H = { Authorization: `Bearer ${lj.json?.data?.token}`, 'Content-Type': 'application/json' };
    const bizId = (await api('/businesses', { headers: H })).json?.data?.[0]?.id;
    const meId = (await api('/auth/me', { headers: H })).json?.data?.id;
    const title = `[카나리] 확인필요 서명 열기 ${Date.now()}`;
    const cr = await api('/posts', { method: 'POST', headers: H, body: JSON.stringify({
      business_id: bizId, title, kind: 'doc', status: 'published', visibility: 'public', category: 'contract',
      content_json: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: BODY }] },
        { type: 'signatureField', attrs: { slot: 1, party: 'us', label: null } },
        { type: 'signatureField', attrs: { slot: 2, party: 'them', label: null } },
      ] },
    }) });
    postId = cr.json?.data?.id || null;
    const sr = postId ? await api(`/posts/${postId}/signatures`, { method: 'POST', headers: H, body: JSON.stringify({
      signers: [{ slot: 1, party: 'us', user_id: meId, email: '' }, { slot: 2, party: 'them', email: 'canary-signinbox@example.com', name: '카나리 고객' }],
      kind: 'sign', expires_in_days: 10, send_chat: false,
    }) }) : null;
    if (!postId || sr?.status !== 200) {
      P('픽스처 — 우리 쪽 서명 대기 1건 (0건 = 판정 불가)', false, `만들지 못했다 (post=${postId}, sr=${sr?.status}) — 통과로 세지 않는다`);
      return { name: 'signinbox', results };
    }

    const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 300000, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      for (const env of ENVS) {
        const ctx = await browser.createBrowserContext();
        try {
          const page = await ctx.newPage();
          await page.setViewport(env.vp);
          if (env.ua) await page.setUserAgent(env.ua);
          if (env.native) await page.evaluateOnNewDocument(nativeStub);
          page.on('dialog', (d) => d.accept().catch(() => {}));
          const popups = [];
          ctx.on('targetcreated', (t) => { if (t.type() === 'page') popups.push(t); });
          await b.login(page);
          await page.goto(b.BASE + '/inbox', { waitUntil: 'networkidle2' });
          await b.sleep(3000);
          await b.dismissBlockers(page).catch(() => {});
          const card = await page.evaluateHandle((t) => [...document.querySelectorAll('[data-testid="todo-card-title"]')].find((e) => e.textContent.includes(t)) || null, title);
          if (!card || !(await card.evaluate((e) => !!e))) {
            P(`${env.name} — 확인필요에 서명 항목이 있다`, false, '목록에서 못 찾았다 — 누르기 판정 불가');
            continue;
          }
          await card.evaluate((e) => e.scrollIntoView({ block: 'center' }));
          await card.click();
          await b.sleep(4000);
          let target = page;
          let where = '같은 화면';
          if (!env.native && popups.length) { target = await popups[0].page(); where = '새 창'; await b.sleep(3000); }
          const m = await target.evaluate(`${MEASURE}(${JSON.stringify(BODY)})`);
          P(`${env.name} — 누르면 서명할 문서가 보인다`, m.visible === 'yes' && /^\/sign\//.test(m.url),
            `${where} ${m.url.slice(0, 16)}… · 본문 ${m.visible}`);
          P(`${env.name} — 로그인한 본인이라 바로 «서명하기» (로그인 요구 아님)`, m.signBtn && !m.loginNeeded,
            `서명하기 ${m.signBtn} · 로그인 요구 ${m.loginNeeded}`);
        } finally { await ctx.close().catch(() => {}); }
      }
    } finally { await browser.close().catch(() => {}); }
  } finally {
    if (postId) {
      try {
        const { sequelize } = require('/opt/planq/dev-backend/config/database');
        await sequelize.query(`DELETE FROM signature_requests WHERE entity_type='post' AND entity_id=${Number(postId)}`);
        await sequelize.query(`DELETE FROM posts WHERE id=${Number(postId)}`);
      } catch (e) { P('정리 — 픽스처 삭제', false, e.message); }
    }
  }
  return { name: 'signinbox', results };
}

module.exports = { run: async () => (await run()).results, name: 'signinbox' };

if (require.main === module) {
  require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
  run().then((r) => {
    let fail = 0;
    console.log('\n=== 확인필요 → 서명 화면 카나리 ===');
    for (const x of r.results) { console.log(`${x.fail ? '❌' : '✅'} ${x.name} — ${x.details[0]}`); fail += x.fail; }
    console.log(`\n검사 ${r.results.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.stack || e.message); process.exit(2); });
}
