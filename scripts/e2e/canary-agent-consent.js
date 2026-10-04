// canary-agent-consent — AI 앱 연결(#439) 화면 (2026-10-02)
//
//   재는 것 (폰 390 · 태블릿 834 · 데스크탑 1440):
//     ① 동의 화면(/connect/agent?request=…) 카드가 **보인다** · 앱 이름(ChatGPT)·워크스페이스 고르기·[연결] 이 보인다
//     ② 워크스페이스를 고르고 [연결] → 외부 AI 의 redirect_uri(chatgpt.com)로 **code·state 를 들고** 이동한다
//        (실제 chatgpt.com 으로는 나가지 않는다 — 요청을 가로채 주소만 잰다)
//     ③ «내 외부 연동» 의 «연결된 AI 앱» 칸이 보이고 방금 연결이 목록에 있다
//     ④ (M3-a, 설계 docs/AI_AGENT_M3_DESIGN.md §9 #17) «메일 읽기» 체크박스 — 기본 꺼짐 · 켜면 보일 계정 목록(공용/내 개인 뱃지)
//        · 「읽기만」+메일로 연결하면 grant scopes 에 mail:read 가 있고 tasks:write 는 없다 · 연결 목록에 「메일 포함」 칩
//     대조군: 만료된 요청 id → «만료» 문구 · [연결] 없음
//     대조군: 워크스페이스 메일 스위치 OFF → 체크박스 비활성 + 이유가 **보인다**
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

// 워크스페이스 고르기 — 이름으로 고른다(두 워크스페이스를 가진 계정이라 «첫 항목» 은 어느 쪽인지 모른다)
async function pickWorkspace(page, name) {
  const already = await page.evaluate((n) => (document.querySelector('[data-testid="agent-consent"]')?.textContent || '').includes(n)
    && !document.querySelector('[data-testid="agent-consent-approve"]')?.disabled, name);
  if (already) return;
  await page.evaluate(() => {
    const ctl = document.querySelector('[data-testid="agent-consent"] [class*="control"]') || document.querySelector('[data-testid="agent-consent"] input');
    ctl?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await sleep(400);
  await page.evaluate((n) => {
    const opts = [...document.querySelectorAll('[class*="option"]')];
    (opts.find((o) => (o.textContent || '').trim() === n) || opts.find((o) => (o.textContent || '').includes(n)))?.click();
  }, name);
  await sleep(400);
}

async function run() {
  const results = [];
  const push = (name, ok, msg, extra = {}) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')], ...extra });
  const clients = [];
  let browser = null;
  let fixtureAccountId = null;
  let origPerm = null;
  try {
    const [biz] = await sql('SELECT brand_name, name, permissions FROM businesses WHERE id = 5');
    const BIZ_NAME = biz.brand_name || biz.name;
    origPerm = biz.permissions;
    // 개인 계정 픽스처(비활성 — IMAP 동기화가 건드리지 않는다). 동의 화면이 «내 개인» 뱃지를 그리는지 잰다.
    const { EmailAccount } = require('/opt/planq/dev-backend/models');
    const fx = await EmailAccount.create({ business_id: 5, email: `canary-personal-${Date.now()}@example.com`, owner_user_id: 5, is_active: false, imap_host: 'imap.invalid', imap_username: 'canary' });
    fixtureAccountId = fx.id;
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
        await pickWorkspace(page, BIZ_NAME);
        // ④ 메일 체크박스 — 기본 꺼짐
        const mailBox = await visible(page, '[data-testid="agent-consent-mail"]');
        const unchecked = await page.evaluate(() => { const c = document.querySelector('[data-testid="agent-consent-mail-check"]'); return c ? { checked: c.checked, disabled: c.disabled } : null; });
        const listBefore = await page.evaluate(() => !!document.querySelector('[data-testid="agent-consent-mail-accounts"]'));
        push(`${v.key} · ④ 메일 체크박스 보임 · 기본 꺼짐 · 계정 목록 숨김`, !!mailBox.vis && unchecked && !unchecked.checked && !unchecked.disabled && !listBefore, JSON.stringify({ vis: mailBox.vis, unchecked, listBefore }));
        await page.evaluate(() => document.querySelector('[data-testid="agent-consent-mail-check"]')?.click());
        await sleep(300);
        const acc = await visible(page, '[data-testid="agent-consent-mail-accounts"]');
        const rows = await page.evaluate((fid) => {
          const shared = document.querySelector('[data-testid="agent-consent-account-1"]')?.textContent || '';
          const mine = document.querySelector(`[data-testid="agent-consent-account-${fid}"]`)?.textContent || '';
          return { shared, mine };
        }, fixtureAccountId);
        const pv = await visible(page, `[data-testid="agent-consent-account-${fixtureAccountId}"]`);
        push(`${v.key} · ④ 켜면 보일 계정 목록 · 공용/내 개인 뱃지`, !!acc.vis && /공용|Shared/.test(rows.shared) && /내 개인|Personal/.test(rows.mine) && !!pv.vis, JSON.stringify({ vis: acc.vis, rows, pvis: pv.vis, w: acc.w }));
        // 「읽기만」 + 메일
        await page.evaluate(() => { const r = [...document.querySelectorAll('[data-testid="agent-consent"] input[type="radio"]')][0]; r?.click(); });
        await sleep(200);
        await page.evaluate(() => document.querySelector('[data-testid="agent-consent-approve"]')?.click());
        for (let i = 0; i < 12 && !landed; i++) await sleep(400);
        const u = landed ? new URL(landed) : null;
        push(`${v.key} · ② [연결] → chatgpt.com 으로 code·state 와 함께`, !!u && u.searchParams.get('state') === 'canary' && !!u.searchParams.get('code'), landed || 'no redirect');
        const [gs] = await sql('SELECT scopes FROM agent_grants WHERE client_id=? ORDER BY id DESC LIMIT 1', [clientId]);
        const scopes = gs ? (typeof gs.scopes === 'string' ? JSON.parse(gs.scopes) : gs.scopes) : [];
        push(`${v.key} · ④ 「읽기만」+메일 → scopes 에 mail:read · tasks:write 없음`, scopes.includes('mail:read') && !scopes.includes('tasks:write') && scopes.includes('tasks:read'), JSON.stringify(scopes));
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
        const chip = g ? await visible(page, `[data-testid="ai-app-mail-${g.id}"]`) : { vis: false };
        push(`${v.key} · ④ 연결 목록에 「메일 포함」 칩 보임`, !!chip.vis && /메일 포함|Includes email/.test(chip.text || ''), JSON.stringify(chip));
      } catch (e) {
        push(`${v.key} · 오류`, false, e.message.slice(0, 160));
      } finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
    }
    // 대조군 — 워크스페이스 메일 스위치 OFF → 체크박스 비활성 + 이유가 보인다(3폭 중 폰·데스크탑)
    await sql('UPDATE businesses SET permissions = ? WHERE id = 5', [JSON.stringify({ ...(typeof origPerm === 'string' ? JSON.parse(origPerm) : (origPerm || {})), ai_agent: { mail: false } })]);
    for (const v of [VPS[0], VPS[2]]) {
      const redirect = `https://chatgpt.com/connector/oauth/canary-off-${Date.now()}`;
      const { clientId, requestId } = await newRequest(redirect);
      clients.push(clientId);
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      try {
        await page.setViewport(v.vp);
        if (v.touch) await page.setUserAgent(UA);
        await b.login(page);
        await page.goto(`${b.BASE}/connect/agent?request=${encodeURIComponent(requestId)}`, { waitUntil: 'domcontentloaded' });
        for (let i = 0; i < 14; i++) { await sleep(500); if ((await visible(page, '[data-testid="agent-consent-approve"]')).vis) break; }
        await pickWorkspace(page, BIZ_NAME);
        const st = await page.evaluate(() => { const c = document.querySelector('[data-testid="agent-consent-mail-check"]'); return c ? { checked: c.checked, disabled: c.disabled } : null; });
        const reason = await visible(page, '[data-testid="agent-consent-mail-reason"]');
        push(`대조군 ${v.key} · 스위치 OFF → 체크박스 비활성 · 이유 보임`, st && st.disabled && !st.checked && !!reason.vis && /꺼 두었|turned off/.test(reason.text || ''), JSON.stringify({ st, reason }));
      } catch (e) { push(`대조군 ${v.key} 오류`, false, e.message.slice(0, 160)); } finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
    }
    await sql('UPDATE businesses SET permissions = ? WHERE id = 5', [typeof origPerm === 'string' ? origPerm : JSON.stringify(origPerm)]);
    origPerm = null;
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
    if (origPerm !== null && origPerm !== undefined) await sql('UPDATE businesses SET permissions = ? WHERE id = 5', [typeof origPerm === 'string' ? origPerm : JSON.stringify(origPerm)]).catch(() => {});
    if (fixtureAccountId) await sql('DELETE FROM email_accounts WHERE id = ? AND email LIKE ?', [fixtureAccountId, 'canary-personal-%']).catch(() => {});
    const ids = clients.filter(Boolean).concat(['-']);
    await sql('DELETE FROM agent_grants WHERE client_id IN (?)', [ids]).catch(() => {});
    await sql('DELETE FROM agent_clients WHERE client_id IN (?)', [ids]).catch(() => {});
    await sql("DELETE FROM ephemeral_tokens WHERE kind LIKE 'agent_%'").catch(() => {});
  }
  return results;
}

module.exports = { name: 'AI 앱 연결 화면 (#439·M3-a) — 3폭 동의·메일 체크박스·연결 이동·연결된 AI 앱 · 스위치 OFF/만료 대조군', run };
