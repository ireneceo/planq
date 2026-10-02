// canary-agent-consent — AI 앱 연결(#439) 화면 (2026-10-02)
//
//   재는 것 (폰 390 · 태블릿 834 · 데스크탑 1440):
//     ① 동의 화면(/connect/agent?request=…) 카드가 **보인다** · 앱 이름(ChatGPT)·워크스페이스 고르기·[연결] 이 보인다
//     ② 워크스페이스를 고르고 [연결] → 외부 AI 의 redirect_uri(chatgpt.com)로 **code·state 를 들고** 이동한다
//        (실제 chatgpt.com 으로는 나가지 않는다 — 요청을 가로채 주소만 잰다)
//     ③ «내 외부 연동» 의 «연결된 AI 앱» 칸이 보이고 방금 연결이 목록에 있다
//     대조군: 만료된 요청 id → «만료» 문구 · [연결] 없음
//   ★ 검사가 만든 클라이언트·연결·단기 상태는 판정 뒤 지운다. 외부 발송 없음.
const crypto = require('crypto');
const b = require('./lib/browser');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (s, r) => sequelize.query(s, { replacements: r }).then(([x]) => x);
const MCP = 'http://127.0.0.1:3005';
const RESOURCE = 'https://dev.planq.kr/agent/mcp';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VPS = [
  { key: '폰 390', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true },
  { key: '태블릿 834', vp: { width: 834, height: 1112, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true },
  { key: '데스크탑 1440', vp: { width: 1440, height: 900 }, touch: false },
];

const visible = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return { found: false };
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const h = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(10, r.height / 2));
  return { found: true, w: Math.round(r.width), vis: r.width > 0 && !!h && (h === el || el.contains(h)), text: el.textContent.slice(0, 160) };
}, sel);

async function newRequest(redirect) {
  const reg = await fetch(MCP + '/agent/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Canary ChatGPT', redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
  const clientId = (await reg.json()).client_id;
  const challenge = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('base64url');
  const qs = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', code_challenge: challenge,
    code_challenge_method: 'S256', state: 'canary', resource: RESOURCE });
  const a = await fetch(`${MCP}/agent/authorize?${qs}`, { redirect: 'manual' });
  const loc = a.headers.get('location') || '';
  return { clientId, requestId: new URL(loc, 'https://x').searchParams.get('request') };
}

async function run() {
  const results = [];
  const push = (name, ok, msg, extra = {}) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')], ...extra });
  const clients = [];
  let browser = null;
  try {
    const h = await fetch(MCP + '/health').then((r) => r.ok).catch(() => false);
    if (!h) { push('픽스처', false, 'MCP 프로세스(127.0.0.1:3005) 없음', { unmeasured: true }); return results; }
    browser = (await b.launch()).browser;
    for (const v of VPS) {
      const redirect = `https://chatgpt.com/connector/oauth/canary-${Date.now()}`;
      const { clientId, requestId } = await newRequest(redirect);
      clients.push(clientId);
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      try {
        await page.setViewport(v.vp);
        if (v.touch) await page.setUserAgent(UA);
        await b.login(page);
        // 외부로 나가는 이동은 가로채 주소만 잰다
        let landed = null;
        await page.setRequestInterception(true);
        const onReq = (rq) => {
          try {
            if (rq.url().startsWith('https://chatgpt.com/')) { landed = rq.url(); rq.abort(); } else rq.continue();
          } catch { /* 가로채기를 끈 뒤 남은 요청 */ }
        };
        page.on('request', onReq);
        await page.goto(`${b.BASE}/connect/agent?request=${encodeURIComponent(requestId)}`, { waitUntil: 'domcontentloaded' });
        let card = null;
        for (let i = 0; i < 14; i++) { await sleep(500); card = await visible(page, '[data-testid="agent-consent-approve"]'); if (card.vis) break; }
        const text = await page.evaluate(() => document.querySelector('[data-testid="agent-consent"]')?.textContent || '');
        push(`${v.key} · ① 동의 화면 · 앱 이름 · [연결] 보임`, !!card?.vis && /ChatGPT/.test(text), JSON.stringify({ card, hasName: /ChatGPT/.test(text) }));
        // 워크스페이스 고르기 — 하나뿐이면 이미 골라져 있다. 아니면 첫 항목을 고른다.
        const enabled = await page.evaluate(() => !document.querySelector('[data-testid="agent-consent-approve"]')?.disabled);
        if (!enabled) {
          await page.evaluate(() => {
            const ctl = document.querySelector('[data-testid="agent-consent"] [class*="control"]') || document.querySelector('[data-testid="agent-consent"] input');
            ctl?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          });
          await sleep(400);
          await page.evaluate(() => { const opt = document.querySelector('[class*="option"]'); opt?.click(); });
          await sleep(300);
        }
        await page.evaluate(() => document.querySelector('[data-testid="agent-consent-approve"]')?.click());
        for (let i = 0; i < 12 && !landed; i++) await sleep(400);
        const u = landed ? new URL(landed) : null;
        push(`${v.key} · ② [연결] → chatgpt.com 으로 code·state 와 함께`, !!u && u.searchParams.get('state') === 'canary' && !!u.searchParams.get('code'), landed || 'no redirect');
        page.off('request', onReq);
        await page.setRequestInterception(false);
        // ③ 내 외부 연동
        await b.goto(page, '/profile/integrations');
        await b.dismissBlockers(page);
        let sec = null;
        for (let i = 0; i < 14; i++) { await sleep(500); sec = await visible(page, '[data-testid="connected-ai-apps"]'); if (sec.vis) break; }
        const [g] = await sql('SELECT id FROM agent_grants WHERE client_id=? ORDER BY id DESC LIMIT 1', [clientId]);
        const listed = g ? await page.evaluate((id) => !!document.querySelector(`[data-testid="ai-app-${id}"]`), g.id) : false;
        push(`${v.key} · ③ «연결된 AI 앱» 칸 보임 · 방금 연결이 목록에`, !!sec?.vis && listed, JSON.stringify({ vis: sec?.vis, grant: g?.id, listed }));
      } catch (e) {
        push(`${v.key} · 오류`, false, e.message.slice(0, 160));
      } finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
    }
    // 대조군 — 만료된 요청
    {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      try {
        await page.setViewport(VPS[2].vp);
        await b.login(page);
        await page.goto(`${b.BASE}/connect/agent?request=expired-canary-xyz`, { waitUntil: 'domcontentloaded' });
        let txt = '';
        for (let i = 0; i < 12; i++) { await sleep(500); txt = await page.evaluate(() => document.querySelector('[data-testid="agent-consent"]')?.textContent || ''); if (/만료|expired/i.test(txt)) break; }
        const btn = await page.evaluate(() => !!document.querySelector('[data-testid="agent-consent-approve"]'));
        push('대조군 · 만료된 요청 → 만료 문구 · [연결] 없음', /만료|expired/i.test(txt) && !btn, JSON.stringify({ txt: txt.slice(0, 60), btn }));
      } catch (e) { push('대조군 오류', false, e.message.slice(0, 160)); } finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
    }
  } catch (e) {
    push('오류', false, e.message.slice(0, 200));
  } finally {
    if (browser) await browser.close().catch(() => {});
    const ids = clients.filter(Boolean).concat(['-']);
    await sql('DELETE FROM agent_grants WHERE client_id IN (?)', [ids]).catch(() => {});
    await sql('DELETE FROM agent_clients WHERE client_id IN (?)', [ids]).catch(() => {});
    await sql("DELETE FROM ephemeral_tokens WHERE kind LIKE 'agent_%'").catch(() => {});
  }
  return results;
}

module.exports = { name: 'AI 앱 연결 화면 (#439) — 3폭 동의·연결 이동·연결된 AI 앱 · 만료 대조군', run };
