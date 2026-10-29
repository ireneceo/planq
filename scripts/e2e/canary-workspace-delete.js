// scripts/e2e/canary-workspace-delete.js — 워크스페이스 삭제 화면·착지 (docs/WORKSPACE_DELETION_DESIGN.md)
//
// 재는 것 (3폭):
//   ① 대표: 설정 일반 탭 맨 아래 «워크스페이스 삭제» 칸이 보인다(elementFromPoint) · 가로 넘침 없음
//   ② 멤버: 같은 주소에서 그 칸이 DOM 에 **없다**(존재 여부 — 서버 preflight 403)
//   ③ 확인 창: 이름·비밀번호 전에는 [삭제] 비활성 · 이름 틀리면 비활성 그대로(음성 대조)
//   ④ 대표가 실제로 지운다 → 대표 창은 남은 워크스페이스로 착지(/me active)
//   ⑤ 열려 있던 멤버 창(소켓 경로)이 저절로 다시 부팅된다
//   ⑥ 소켓을 막은 멤버 창(안전망 경로)은 다음 요청의 404 workspace_deleted 로 다시 부팅된다
//   ⑦ 프로필 «삭제 예정 워크스페이스» 에 보이고 [되살리기] 로 돌아온다(스위처·/me)
//
// ★ 계정·워크스페이스는 Node 에서 만든다(약관 버전까지). 이름은 [확인용]. 끝나면 지운 상태가 아니라 «되살린» 상태로 남긴다.
const { launch, login, sleep, BASE } = require('./lib/browser');

const API = process.env.E2E_API || 'http://localhost:3003';
const VIEWPORTS = [
  { w: 375, h: 740, mobile: true },
  { w: 834, h: 1112, mobile: false },
  { w: 1440, h: 900, mobile: false },
];

let _seq = null;
async function sql(q, replacements) {
  if (!_seq) {
    require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
    ({ sequelize: _seq } = require('/opt/planq/dev-backend/config/database'));
  }
  const [rows] = await _seq.query(q, { replacements });
  return rows;
}
async function apiLogin(email, password) {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json().catch(() => ({}));
  return j.data && (j.data.token || j.data.accessToken);
}
async function call(tok, path, init = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  let body = null; try { body = await r.json(); } catch { /* */ }
  return { status: r.status, body };
}
async function visible(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { ok: false };
    const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 12), r.top + Math.min(r.height / 2, 12));
    return { ok: !!hit && (el === hit || el.contains(hit)), hscroll: document.documentElement.scrollWidth > window.innerWidth + 1 };
  }, sel);
}
async function makeUser(tag, password) {
  const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
  const [ps] = await sql('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1');
  const email = `wsdel-ui-${tag}-${Date.now()}@test.planq.kr`;
  await sql(
    `INSERT INTO users (email, password_hash, name, username, platform_role, status, email_verified_at,
       terms_accepted_at, terms_version, privacy_accepted_at, privacy_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'user', 'active', NOW(), NOW(), ?, NOW(), ?, NOW(), NOW())`,
    [email, await bcrypt.hash(password, 12), `[확인용] 삭제화면 ${tag}`, `wsdelui_${tag}_${Date.now()}`, ps?.terms_version || '1.0', ps?.privacy_version || '1.0']);
  const [u] = await sql('SELECT id FROM users WHERE email = ?', [email]);
  return { id: u.id, email, password };
}
const marker = (page) => page.evaluate(() => { window.__wsdelMark = 1; });
const markerGone = async (page, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await page.evaluate(() => !window.__wsdelMark)) return true; } catch { /* 부팅 중 */ }
    await sleep(300);
  }
  return false;
};

async function run() {
  const results = [];
  // 러너 계약(run.js printSuite): 행마다 fail 수를 싣는다 — ok 만 실으면 실패가 ✅ 로 찍힌다(Fable 완료 검증 지적 1)
  const ok = (name, cond, detail = '') => { results.push({ name, fail: cond ? 0 : 1, detail: cond ? '' : String(detail || '') }); console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' ' + detail}`); };
  const PW = 'Wsdel!' + Date.now();
  const owner = await makeUser('owner', PW);
  const member = await makeUser('member', PW);
  const member2 = await makeUser('member2', PW);
  const tOwner = await apiLogin(owner.email, PW);
  const name = `[확인용] 삭제 화면 시험 ${Date.now()}`;
  const keep = await call(tOwner, '/api/businesses', { method: 'POST', body: JSON.stringify({ brand_name: name + ' 남는곳' }) });
  const keepId = keep.body?.data?.id || keep.body?.data?.business?.id;
  const made = await call(tOwner, '/api/businesses', { method: 'POST', body: JSON.stringify({ brand_name: name }) });
  const bizId = made.body?.data?.id || made.body?.data?.business?.id;
  for (const m of [member, member2]) {
    await sql("INSERT INTO business_members (business_id, user_id, role, joined_at, created_at, updated_at) VALUES (?, ?, 'member', NOW(), NOW(), NOW())", [bizId, m.id]);
  }
  ok('준비: 워크스페이스 2개', !!bizId && !!keepId, JSON.stringify(made.body).slice(0, 160));

  for (const vp of VIEWPORTS) {
    const tag = `${vp.w}`;
    // 매 폭마다 «살아 있는 상태» 로 되돌린다
    await sql('UPDATE businesses SET deleted_at=NULL, deletion_reason=NULL, deleted_by=NULL, purge_after=NULL WHERE id=?', [bizId]);
    await sql('UPDATE users SET active_business_id=? WHERE id IN (?, ?, ?)', [bizId, owner.id, member.id, member2.id]);
    require('/opt/planq/dev-backend/middleware/workspaceAlive').invalidate();   // 이 프로세스 캐시(서버 캐시는 복구 API 가 비운다)

    const O = await launch({ mobile: vp.mobile });
    const B = await launch({ mobile: vp.mobile });
    const C = await launch({ mobile: vp.mobile });
    try {
      for (const x of [O, B, C]) if (!vp.mobile) await x.page.setViewport({ width: vp.w, height: vp.h });
      await login(O.page, owner); await login(B.page, member); await login(C.page, member2);

      // ① 대표 — 칸이 보인다
      await O.page.goto(`${BASE}/business/settings/brand`, { waitUntil: 'networkidle2' });
      await O.page.waitForSelector('[data-testid="ws-delete-zone"]', { timeout: 20000 }).catch(() => null);
      const v = await visible(O.page, '[data-testid="ws-delete-zone"]');
      ok(`[${tag}] ① 대표: 삭제 칸 보임`, v && v.ok, JSON.stringify(v));
      ok(`[${tag}] ① 가로 넘침 없음`, v && !v.hscroll);

      // ② 멤버 — DOM 에 없다
      await B.page.goto(`${BASE}/business/settings/brand`, { waitUntil: 'networkidle2' });
      await sleep(1500);
      ok(`[${tag}] ② 멤버: 삭제 칸 DOM 없음`, !(await B.page.$('[data-testid="ws-delete-zone"]')));

      // ③ 확인 창 — 비활성 판정
      await O.page.click('[data-testid="ws-delete-open"]');
      await O.page.waitForSelector('[data-testid="ws-delete-name"]', { visible: true });
      const disabled = () => O.page.$eval('[data-testid="ws-delete-submit"]', (b) => b.disabled);
      ok(`[${tag}] ③ 입력 전 [삭제] 비활성`, await disabled());
      await O.page.type('[data-testid="ws-delete-name"]', name + 'x');
      await O.page.type('[data-testid="ws-delete-password"]', PW);
      ok(`[${tag}] ③ 이름 틀리면 비활성(음성 대조)`, await disabled());
      await O.page.$eval('[data-testid="ws-delete-name"]', (el) => { el.focus(); el.select(); });
      await O.page.keyboard.press('Backspace');
      await O.page.type('[data-testid="ws-delete-name"]', name);
      ok(`[${tag}] ③ 이름·비밀번호 맞으면 활성`, !(await disabled()));
      const sub = await visible(O.page, '[data-testid="ws-delete-submit"]');
      ok(`[${tag}] ③ [삭제] 버튼 보임`, sub && sub.ok, JSON.stringify(sub));

      // 멤버 창 준비 — B 는 소켓 경로, C 는 소켓을 막은 창(안전망)
      await B.page.goto(`${BASE}/talk`, { waitUntil: 'networkidle2' });
      // ★ 소켓은 웹소켓으로 먼저 붙는다(transports: websocket→polling) — 요청 가로채기는 웹소켓을 못 막는다.
      //   그래서 WebSocket 자체를 없애고(새 문서마다) 폴링 요청도 끊는다. 대조 «신호를 못 받았다» 가 이걸 증명한다.
      await C.page.evaluateOnNewDocument(() => { window.WebSocket = function BlockedWS() { throw new Error('blocked by canary'); }; });
      await C.page.setRequestInterception(true);
      C.page.on('request', (r) => { if (r.url().includes('/socket.io/')) r.abort(); else r.continue(); });
      await C.page.goto(`${BASE}/talk`, { waitUntil: 'domcontentloaded' });
      await sleep(2500);
      await marker(B.page); await marker(C.page);

      // ④ 지운다
      await Promise.all([
        O.page.waitForNavigation({ timeout: 20000 }).catch(() => null),
        O.page.click('[data-testid="ws-delete-submit"]'),
      ]);
      const [row] = await sql('SELECT deleted_at, deletion_reason FROM businesses WHERE id=?', [bizId]);
      ok(`[${tag}] ④ DB 삭제 표시(owner_request)`, row.deleted_at && row.deletion_reason === 'owner_request');
      const meO = await call(await apiLogin(owner.email, PW), '/api/auth/me');
      const actO = meO.body?.data?.active_business_id ?? meO.body?.data?.user?.active_business_id;
      ok(`[${tag}] ④ 대표 착지 = 남는 워크스페이스`, Number(actO) === Number(keepId), `${actO} vs ${keepId}`);
      ok(`[${tag}] ④ 대표 창이 /talk 로`, O.page.url().includes('/talk'), O.page.url());

      // ⑤ 소켓 경로
      ok(`[${tag}] ⑤ 열린 멤버 창(소켓) 다시 부팅`, await markerGone(B.page));
      // ⑥ 안전망 — 소켓 없는 창은 다음 요청에서
      const stillMarked = await C.page.evaluate(() => !!window.__wsdelMark).catch(() => false);
      ok(`[${tag}] ⑥ 소켓 막힌 창은 신호를 못 받았다(대조)`, stillMarked);
      await C.page.evaluate(() => { window.history.pushState({}, '', '/business/settings/brand'); window.dispatchEvent(new PopStateEvent('popstate')); });
      ok(`[${tag}] ⑥ 다음 요청 404 로 다시 부팅`, await markerGone(C.page));

      // ⑦ 복구 — 프로필
      await O.page.goto(`${BASE}/profile`, { waitUntil: 'networkidle2' });
      await O.page.waitForSelector('[data-testid="deleted-workspaces"]', { timeout: 15000 }).catch(() => null);
      const dv = await visible(O.page, `[data-testid="deleted-workspace-restore-${bizId}"]`);
      ok(`[${tag}] ⑦ 프로필 «삭제 예정» 되살리기 버튼 보임`, dv && dv.ok, JSON.stringify(dv));
      await O.page.click(`[data-testid="deleted-workspace-restore-${bizId}"]`);
      let restored = false;
      for (let i = 0; i < 20 && !restored; i++) { await sleep(500); const [r] = await sql('SELECT deleted_at FROM businesses WHERE id=?', [bizId]); restored = !r.deleted_at; }
      ok(`[${tag}] ⑦ 되살림(DB)`, restored);
      const gone = await O.page.waitForFunction((id) => !document.querySelector(`[data-testid="deleted-workspace-restore-${id}"]`), { timeout: 10000 }, bizId).then(() => true).catch(() => false);
      ok(`[${tag}] ⑦ 목록에서 빠짐`, gone);
    } finally {
      for (const x of [O, B, C]) await x.browser.close().catch(() => {});
    }
  }
  // DB 연결은 닫지 않는다 — 러너가 같은 연결을 뒤 스위트에 쓴다(카나리가 각자 닫으면 뒤가 죽는다)
  const failed = results.filter((r) => r.fail);
  console.log(`\n워크스페이스 삭제 화면: ${results.length - failed.length}/${results.length}`);
  return results;
}

module.exports = { run };
if (require.main === module) run().then((r) => process.exit(r.some((x) => x.fail) ? 1 : 0)).catch((e) => { console.error(e); process.exit(2); });
