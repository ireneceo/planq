#!/usr/bin/env node
// canary-native-login — 앱(아이패드·아이폰) 구글 로그인 창 (2026-10-16)
//
// Irene(아이패드 앱): "구글계정 자동로그인하는데 팝업이 하얗게 나오고 다시 닫으니까 예전 이상한 코드 넣으라는
//   잘못된 UI 가 그대로 나와."
// 재는 것 — 앱 흉내(webkit bridge 스텁 + Mac UA + 1180×820):
//   새 앱(PlanqAuthSession 플러그인 있음)
//     ① 구글 버튼 → 로그인 창 플러그인이 client=native 시작 주소로 불린다 · 옛 창(Browser.open)·6자리 페어링 0
//     ② OS 가 planq://…?code=<진짜 일회용 code> 를 돌려주면 교환 → /inbox (로그인 끝)
//     ③ 사용자가 창을 취소하면 아무것도 묻지 않는다(코드 입력창 0 · 로그인 화면 그대로)
//   옛 앱(플러그인 없음)
//     ④ 옛 창은 팝오버가 아니라 전체 화면으로 연다
//     ⑤ 로그인 전에 창을 닫으면 코드 입력창이 안 뜬다
//     ⑥ 양성 대조군 — 브라우저에서 로그인이 끝났으면(서버 attach) 코드 입력창이 뜬다(⑤ 판정기가 살아 있다)
const b = require('./lib/browser');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');
const jwt = require('/opt/planq/dev-backend/node_modules/jsonwebtoken');

const results = [];
const P = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg], hasCanary: true });
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';

// 앱 흉내. withSession=true 면 새 앱(로그인 창 플러그인 있음). 로그인 창 결과는 window.__authResult 로 정한다.
function nativeStub(withSession) {
  window.__nativeCalls = [];
  const headers = [
    { name: 'Browser', methods: [{ name: 'open', rtype: 'promise' }, { name: 'close', rtype: 'promise' }, { name: 'addListener', rtype: 'callback' }] },
    { name: 'App', methods: [{ name: 'addListener', rtype: 'callback' }] },
  ];
  if (withSession) headers.push({ name: 'PlanqAuthSession', methods: [{ name: 'start', rtype: 'promise' }] });
  // core 는 nativePromise/nativeCallback 이 있으면 그것을 부른다(canary-sign-inbox-open 과 같은 스텁).
  // 페이지가 /inbox 로 넘어가면 window 기록이 사라진다 — Node 쪽(__recNative)에도 남긴다.
  const rec = (pl, me, op) => { try { const x = { p: pl, m: me, o: op || null }; window.__nativeCalls.push(x); if (window.__recNative) window.__recNative(x); } catch { /* */ } };
  window.Capacitor = {
    PluginHeaders: headers,
    nativePromise: (pl, me, op) => {
      rec(pl, me, op);
      if (pl === 'PlanqAuthSession') return new Promise((res, rej) => setTimeout(() => (window.__authResult === 'reject' ? rej(new Error('auth_session_not_started')) : res(window.__authResult || { canceled: true })), 300));
      return Promise.resolve({});
    },
    nativeCallback: (pl, me, op) => { rec(pl, me, op); return String(Math.random()); },
  };
  window.webkit = { messageHandlers: { bridge: { postMessage(m) {
    try { window.__nativeCalls.push({ p: m.pluginId, m: m.methodName, o: m.options || null }); } catch { /* */ }
    if (m.methodName === 'addListener') return;   // 이벤트 구독 — 응답하지 않는다(안 올 이벤트)
    const reply = (data) => { try { window.Capacitor.fromNative({ callbackId: m.callbackId, pluginId: m.pluginId, methodName: m.methodName, success: true, data }); } catch { /* */ } };
    if (m.pluginId === 'PlanqAuthSession') setTimeout(() => reply(window.__authResult || { canceled: true }), 300);
    else setTimeout(() => reply({}), 0);
  } } } };
}

async function openLogin(ctx, withSession, authResult) {
  const page = await ctx.newPage();
  await page.setViewport({ width: 1180, height: 820 });
  await page.setUserAgent(MAC_UA);
  await page.evaluateOnNewDocument(nativeStub, withSession);
  if (authResult) await page.evaluateOnNewDocument((r) => { window.__authResult = r; }, authResult);
  const reqs = [];
  const nodeCalls = [];
  await page.exposeFunction('__recNative', (x) => { nodeCalls.push(x); });
  page.on('request', (r) => { const u = r.url(); if (/\/api\/auth\/(google|apple)\//.test(u)) reqs.push(`${r.method()} ${new URL(u).pathname}`); });
  await page.goto(b.BASE + '/login', { waitUntil: 'networkidle2' });
  await b.sleep(1500);
  return { page, reqs, nodeCalls };
}
const calls = (page) => page.evaluate(() => window.__nativeCalls || []);
const pairDialog = (page) => page.evaluate(() => !![...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
  .find((d) => d.getClientRects().length && d.querySelector('input')));
const clickGoogle = async (page) => {
  const ok = await page.evaluate(() => { const x = document.querySelector('[data-testid="google-auth-btn"]'); if (!x) return false; x.click(); return true; });
  if (!ok) throw new Error('구글 버튼 없음');
};

async function run() {
  require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
  const { sequelize } = require('/opt/planq/dev-backend/config/database');
  const [[me]] = await sequelize.query('SELECT id FROM users WHERE email = ? LIMIT 1', { replacements: [b.CREDS.email] });
  const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 180000, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    // ①② 새 앱 — 진짜 일회용 code 를 OS 가 돌려준 것처럼
    {
      const ctx = await browser.createBrowserContext();
      try {
        const code = me ? jwt.sign({ uid: me.id, purpose: 'native_oauth', jti: `canary-${Date.now()}` }, process.env.JWT_SECRET, { expiresIn: '5m' }) : 'x';
        const { page, reqs, nodeCalls: c } = await openLogin(ctx, true, { url: `planq://oauth/native-return?code=${encodeURIComponent(code)}&new=0` });
        await clickGoogle(page);
        await b.sleep(5000);
        const start = c.find((x) => x.p === 'PlanqAuthSession' && x.m === 'start');
        const old = c.filter((x) => x.p === 'Browser' && x.m === 'open');
        P('① 새 앱 — 로그인 창 플러그인으로 연다(client=native)', !!start && /\/api\/auth\/google\/initiate\?client=native/.test(start.o?.url || '') && start.o?.callbackScheme === 'planq',
          `start ${start ? start.o.url.replace(/^https?:\/\/[^/]+/, '') : '없음'} · scheme ${start?.o?.callbackScheme}`);
        P('① 새 앱 — 옛 창·6자리 페어링을 쓰지 않는다', old.length === 0 && !reqs.some((r) => /pair\/start/.test(r)),
          `Browser.open ${old.length} · 요청 ${reqs.join(', ') || '없음'}`);
        const path = await page.evaluate(() => location.pathname);
        P('② 돌아온 code 를 교환해 로그인이 끝난다(/inbox)', reqs.includes('POST /api/auth/google/native-exchange') && path !== '/login',
          `교환 ${reqs.includes('POST /api/auth/google/native-exchange')} · 지금 ${path}`);
      } finally { await ctx.close().catch(() => {}); }
    }
    // ③ 새 앱 — 사용자가 취소
    {
      const ctx = await browser.createBrowserContext();
      try {
        const { page, reqs } = await openLogin(ctx, true, { canceled: true });
        await clickGoogle(page);
        await b.sleep(2500);
        const dlg = await pairDialog(page);
        const path = await page.evaluate(() => location.pathname);
        P('③ 창을 취소하면 아무것도 묻지 않는다', !dlg && path === '/login' && !reqs.some((r) => /native-exchange|claim/.test(r)),
          `코드 입력창 ${dlg} · 지금 ${path}`);
      } finally { await ctx.close().catch(() => {}); }
    }
    // ③' 새 앱 — 로그인 창이 못 뜨면(reject) 조용히 끝나지 않고 종전 창으로 연다
    {
      const ctx = await browser.createBrowserContext();
      try {
        const { page, reqs, nodeCalls: c } = await openLogin(ctx, true, 'reject');
        await clickGoogle(page);
        await b.sleep(2500);
        const open = c.find((x) => x.p === 'Browser' && x.m === 'open');
        P("③' 로그인 창이 못 뜨면 종전 창(전체 화면)으로 연다", !!open && open.o?.presentationStyle === 'fullscreen' && reqs.some((r) => /pair\/start/.test(r)),
          `Browser.open ${open ? open.o.presentationStyle : '없음'} · pair/start ${reqs.some((r) => /pair\/start/.test(r))}`);
      } finally { await ctx.close().catch(() => {}); }
    }
    // ④⑤⑥ 옛 앱
    {
      const ctx = await browser.createBrowserContext();
      try {
        const { page, reqs } = await openLogin(ctx, false);
        await clickGoogle(page);
        await b.sleep(2500);
        const c = await calls(page);
        const open = c.find((x) => x.p === 'Browser' && x.m === 'open');
        P('④ 옛 앱 — 로그인 창을 전체 화면으로 연다(팝오버 아님)', !!open && open.o?.presentationStyle === 'fullscreen',
          `presentationStyle ${open?.o?.presentationStyle || '없음'} · pair/start ${reqs.some((r) => /pair\/start/.test(r))}`);
        const pairId = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('planq.oauth.pair') || '{}').id || null; } catch { return null; } });
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('planq:oauth-dismissed')));
        await b.sleep(2000);
        const dlg1 = await pairDialog(page);
        P('⑤ 옛 앱 — 로그인 전에 창을 닫으면 코드 입력창이 안 뜬다', !!pairId && !dlg1, `페어링 ${pairId ? '있음' : '없음(판정 불가)'} · 코드 입력창 ${dlg1}`);
        let dlg2 = false;
        if (pairId && me) {
          await require('/opt/planq/dev-backend/services/oauthPairing').attach(pairId, me.id);
          await page.evaluate(() => window.dispatchEvent(new CustomEvent('planq:oauth-dismissed')));
          await b.sleep(2000);
          dlg2 = await pairDialog(page);
        }
        P('⑥ 양성 대조군 — 브라우저 로그인이 끝났으면 코드 입력창이 뜬다', dlg2, `코드 입력창 ${dlg2}`);
      } finally { await ctx.close().catch(() => {}); }
    }
  } finally {
    await browser.close().catch(() => {});
    // 공유 연결이다 — 러너 안에서는 닫지 않는다(뒤의 청소가 같은 연결을 쓴다). 단독 실행만 닫는다.
    if (require.main === module) await sequelize.close().catch(() => {});
  }
  return results;
}

module.exports = { run, name: 'nativelogin' };

if (require.main === module) {
  run().then((r) => {
    let fail = 0;
    console.log('\n=== 앱 구글 로그인 창 카나리 ===');
    for (const x of r) { console.log(`${x.fail ? '❌' : '✅'} ${x.name} — ${x.details[0]}`); fail += x.fail; }
    console.log(`\n검사 ${r.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.stack || e.message); process.exit(2); });
}
