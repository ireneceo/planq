// scripts/e2e/canary-client-info.js — 로그인 고객 홈 «자료» 칸 (docs/CLIENT_QINFO_VIEW_DESIGN.md ⑦ 9~12)
//
// 재는 것(폰 375 · 태블릿 768 · 데스크탑 1440):
//   ⑨ 자료 0건이면 탭이 없다(음성) · 1건 이상이면 «자료 N» 탭이 그려진다(elementFromPoint)
//   ⑩ 카드 → 시트 · 본문·항목 그려짐 · 화면 글자에 비밀 칸 값 0 · url 칸 링크는 새 탭 noopener · 편집/복사/공유 버튼 0 · Esc 로 닫힘
//   ⑪ 실시간(데스크탑) — 화면을 연 채 팀이 이 고객 자료를 만들면 새로고침 없이 카드·탭 수가 는다(양성) ·
//      다른 고객 자료는 화면 불변(음성) · 내부용으로 올리면 사라진다
// ★ 임시 고객 계정·고객 행은 Node 에서 만든다(약관 **버전까지** — 재동의 모달이 «열린 것처럼» 위조한다).
// ★ 팀 쪽 자료는 **화면과 같은 API**(POST /kb/documents)로 만든다 — 그래야 실시간 신호 길(kbSignal)을 실제로 탄다.
const { launch, login, sleep, BASE, CREDS } = require('./lib/browser');

const API = process.env.E2E_API || 'http://localhost:3003';
const VIEWPORTS = [
  { w: 375, h: 740, mobile: true },
  { w: 768, h: 1024, mobile: false },
  { w: 1440, h: 900, mobile: false },
];
const SECRET = `ci-secret-${Date.now()}`;

let _seq = null;
async function sql(q, replacements) {
  if (!_seq) {
    require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
    ({ sequelize: _seq } = require('/opt/planq/dev-backend/config/database'));
  }
  const [rows] = await _seq.query(q, { replacements });
  return rows;
}
async function loginToken(email, password) {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json().catch(() => ({}));
  return j.data && (j.data.token || j.data.accessToken);
}
async function call(tok, path, init = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body, text };
}
async function visible(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { ok: false };
    const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 12), r.top + r.height / 2);
    return { ok: !!hit && (el === hit || el.contains(hit)), hscroll: document.documentElement.scrollWidth > window.innerWidth + 1 };
  }, sel);
}
async function waitFor(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await sleep(150); }
  return -1;
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')] });
  const unmeasured = (name, msg) => results.push({ name, unmeasured: true, details: [`⚪ ${msg}`] });
  const st = { biz: null, uid: null, clientId: null, otherClientId: null, docs: [] };
  const cred = { email: `clientinfo-canary-${Date.now()}@example.com`, password: 'ClientInfo2026!x' };
  let browser = null;
  let ownerTok = null;
  const makeDoc = async (title, clientId, extra = {}) => {
    const r = await call(ownerTok, `/api/businesses/${st.biz}/kb/documents`, { method: 'POST', body: JSON.stringify({
      title, body: '<p>안내 본문 <a href="https://example.com/guide">가이드</a></p>', vlevel: 'L4', client_id: clientId,
      custom_columns: [{ id: 'u1', name: '접속 주소', type: 'url' }, { id: 's1', name: '비밀번호', type: 'secret' }, { id: 't1', name: '메모', type: 'text' }],
      custom_values: { u1: 'https://example.com/login', s1: SECRET, t1: '평문 메모' }, categories: ['안내'], ...extra,
    }) });
    const id = r.body?.data?.id;
    if (id) st.docs.push(id);
    return { id, status: r.status };
  };

  try {
    ownerTok = await loginToken(CREDS.email, CREDS.password);
    const me = await call(ownerTok, '/api/auth/me');
    st.biz = me.body?.data?.active_business_id ?? me.body?.data?.user?.active_business_id ?? null;
    if (!st.biz) { unmeasured('고객 자료 픽스처', '워크스페이스 없음'); return results; }

    const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
    const [ps] = await sql('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1');
    const [uidRow] = await _seq.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role, email_verified_at, active_business_id,
         terms_accepted_at, terms_version, privacy_accepted_at, privacy_version, created_at, updated_at)
       VALUES (?, ?, 'ClientInfo Canary', ?, 'user', NOW(), ?, NOW(), ?, NOW(), ?, NOW(), NOW())`,
      { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `cic${Date.now()}`, st.biz, ps?.terms_version || '1.0', ps?.privacy_version || '1.0'] });
    st.uid = uidRow;
    const [cid] = await _seq.query(
      `INSERT INTO clients (business_id, user_id, display_name, invite_email, kind, status, created_at, updated_at)
       VALUES (?, ?, '자료검사 고객', ?, 'customer', 'active', NOW(), NOW())`, { replacements: [st.biz, st.uid, cred.email] });
    st.clientId = cid;
    const [cid2] = await _seq.query(
      `INSERT INTO clients (business_id, display_name, kind, status, created_at, updated_at)
       VALUES (?, '자료검사 다른 고객', 'customer', 'managed', NOW(), NOW())`, { replacements: [st.biz] });
    st.otherClientId = cid2;

    browser = (await launch()).browser;

    // ── ⑨ 음성 — 자료 0건이면 탭 없음 (데스크탑 한 번)
    {
      const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      await login(page, cred); await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' }); await sleep(2500);
      const tab = await page.$('[data-testid="home-tab-kb"]');
      const home = await page.$('[data-testid="client-home"]');
      push('⑨ 자료 0건 → «자료» 탭 없음(음성)', !!home && !tab, `home=${!!home} tab=${!!tab}`);
      await ctx.close();
    }

    const d1 = await makeDoc('자료검사 — 접속 안내', st.clientId);
    if (!d1.id) { unmeasured('고객 자료', `자료 생성 실패 ${d1.status}`); return results; }

    for (const vp of VIEWPORTS) {
      const key = `${vp.w}px`;
      const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
      await page.setViewport({ width: vp.w, height: vp.h, isMobile: vp.mobile, hasTouch: vp.mobile });
      await login(page, cred); await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="home-tab-kb"]', { timeout: 15000 }).catch(() => {});
      const tv = await visible(page, '[data-testid="home-tab-kb"]');
      const tabText = await page.$eval('[data-testid="home-tab-kb"]', (e) => e.innerText).catch(() => '');
      push(`⑨ ${key} «자료 N» 탭이 그려진다`, !!tv?.ok && /1/.test(tabText), `${JSON.stringify(tv)} «${tabText.replace(/\s+/g, ' ')}»`);
      await page.click('[data-testid="home-tab-kb"]');
      await page.waitForSelector(`[data-testid="home-kb-${d1.id}"]`, { timeout: 10000 }).catch(() => {});
      const cv = await visible(page, `[data-testid="home-kb-${d1.id}"]`);
      push(`⑩ ${key} 카드 보임 · 가로 넘침 없음`, !!cv?.ok && !cv.hscroll, JSON.stringify(cv));
      await page.click(`[data-testid="home-kb-${d1.id}"]`).catch(() => {});
      await page.waitForSelector('[data-testid="home-kb-body"]', { timeout: 10000 }).catch(() => {});
      const sheet = await page.evaluate((secret) => {
        const box = document.querySelector('[data-testid="home-kb-sheet"]');
        const body = document.querySelector('[data-testid="home-kb-body"]');
        if (!box || !body) return null;
        const r = box.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 60));
        const links = [...body.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), t: a.target, rel: a.rel }));
        const btns = [...box.querySelectorAll('button')].map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim());
        return { drawn: !!hit && box.contains(hit), text: body.innerText, secret: document.body.innerText.includes(secret) || document.documentElement.outerHTML.includes(secret),
          links, btns, url: location.search };
      }, SECRET);
      push(`⑩ ${key} 시트 그려짐 · 본문·항목 보임`, !!sheet?.drawn && /안내 본문/.test(sheet.text) && /평문 메모/.test(sheet.text) && /접속 주소/.test(sheet.text),
        sheet ? `drawn=${sheet.drawn} text=${sheet.text.slice(0, 60).replace(/\s+/g, ' ')}` : '시트 없음');
      push(`⑩ ${key} 화면 어디에도 비밀 칸 값·라벨 없음`, !!sheet && !sheet.secret && !/비밀번호/.test(sheet.text), sheet ? `secret=${sheet.secret}` : '');
      const loginLink = sheet?.links.find((l) => l.href === 'https://example.com/login');
      const bodyLink = sheet?.links.find((l) => l.href === 'https://example.com/guide');
      push(`⑩ ${key} 링크는 새 탭·noopener`, !!loginLink && loginLink.t === '_blank' && /noopener/.test(loginLink.rel) && !!bodyLink && bodyLink.t === '_blank' && /noopener/.test(bodyLink.rel),
        JSON.stringify(sheet?.links));
      push(`⑩ ${key} 시트 버튼은 닫기 하나뿐(편집·복사·공유 0)`, !!sheet && sheet.btns.length === 1, JSON.stringify(sheet?.btns));
      push(`⑩ ${key} 주소에 ?doc= 실림`, !!sheet && sheet.url.includes(`doc=${d1.id}`), sheet?.url);
      await page.keyboard.press('Escape'); await sleep(600);
      const closed = await page.$('[data-testid="home-kb-sheet"]');
      push(`⑩ ${key} Esc 로 닫힘`, !closed, `open=${!!closed}`);

      if (vp.w === 1440) {
        // ── ⑪ 실시간
        const cards = () => page.$$eval('[data-testid^="home-kb-"]', (els) => els.map((e) => e.getAttribute('data-testid')).filter((x) => /^home-kb-\d+$/.test(x)).length);
        const before = await cards();
        const d2 = await makeDoc('자료검사 — 실시간 추가', st.clientId);
        const ms = await waitFor(async () => !!(await page.$(`[data-testid="home-kb-${d2.id}"]`)), 5000);
        const tabNow = await page.$eval('[data-testid="home-tab-kb"]', (e) => e.innerText).catch(() => '');
        push('⑪ 팀이 이 고객 자료를 만들면 새로고침 없이 카드·탭 수가 는다(양성)', ms >= 0 && /2/.test(tabNow), `ms=${ms} tab=«${tabNow.replace(/\s+/g, ' ')}»`);
        const d3 = await makeDoc('자료검사 — 다른 고객', st.otherClientId);
        await sleep(2000);
        const after = await cards();
        push('⑪ 다른 고객 자료는 화면 불변(음성)', !(await page.$(`[data-testid="home-kb-${d3.id}"]`)) && after === before + 1, `before=${before} after=${after}`);
        await call(ownerTok, `/api/kb-documents/${d2.id}/security-level`, { method: 'PUT', body: JSON.stringify({ level: 'internal' }) });
        const gone = await waitFor(async () => !(await page.$(`[data-testid="home-kb-${d2.id}"]`)), 5000);
        push('⑪ 내부용으로 올리면 화면에서 사라진다', gone >= 0, `ms=${gone}`);
      }
      await ctx.close();
    }

    // ⑫ 음성 대조 — 오너가 /home 을 열면 /dashboard
    {
      const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      await login(page); await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' }); await sleep(2500);
      push('⑫ 오너가 /home → /dashboard(고객 문이 아니다)', !page.url().includes('/home'), page.url());
      await ctx.close();
    }
  } catch (e) {
    results.push({ name: 'clientinfo', fail: 1, details: [`🔴 ${e.message}`] });
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      if (st.docs.length) await sql('DELETE FROM kb_documents WHERE id IN (?) AND business_id=?', [st.docs, st.biz]);
      if (st.clientId) await sql('DELETE FROM clients WHERE id IN (?) AND business_id=?', [[st.clientId, st.otherClientId].filter(Boolean), st.biz]);
      if (st.uid) {
        await sql('DELETE FROM refresh_tokens WHERE user_id=?', [st.uid]).catch(() => {});
        await sql('DELETE FROM notifications WHERE user_id=?', [st.uid]).catch(() => {});
        await sql('DELETE FROM users WHERE id=? AND email=?', [st.uid, cred.email]);
      }
      const left = await sql('SELECT COUNT(*) n FROM users WHERE email=?', [cred.email]);
      results.push({ name: 'cleanup:clientinfo', fail: Number(left[0].n) ? 1 : 0, hasCanary: true, details: [`남은 임시 계정 ${left[0].n}`] });
    } catch (e) { results.push({ name: 'cleanup:clientinfo', fail: 1, details: [`🔴 정리 실패: ${e.message}`] }); }
  }
  return results;
}

module.exports = { run };
