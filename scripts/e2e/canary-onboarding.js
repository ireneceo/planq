// canary-onboarding — 시작 안내 체크리스트 (M3-d, docs/AI_AGENT_M3_DESIGN.md §3.3 · §9 #18)
//
//   서버 (실 HTTP · 새 워크스페이스 픽스처):
//     ① owner = 두 묶음(workspace 4 · me 4) · member = me 묶음만 · client = 403 · 옛 `steps` 평면 배열 유지
//     ② 단계별 양성/음성 — 데이터를 넣었다 지우며 done 이 뒤집히는가
//        connect_mail(활성 메일 계정 / 비활성은 아님) · connect_calendar(활성 개인 캘린더 / 비활성은 아님) ·
//        install_app(네이티브 구독 or 앱 세션 / 웹 구독·웹 세션은 아님) · connect_ai_app(동의 끝난 연결 / 미활성·끊은 것은 아님)
//     ③ 닫기 — 개인 닫기는 사람별(owner 가 닫아도 member 는 그대로) · member 는 워크스페이스 묶음 못 닫음(403) ·
//        옛 번들(scope 없음) = 워크스페이스 묶음만 · 잘못된 scope 400
//   화면 (폰 390 · 태블릿 820 · 데스크탑 1440):
//     ④ 대시보드·설정 첫 화면 최상단에 **같은 컴포넌트**(data-testid) 가 보인다(elementFromPoint)
//     ⑤ 행 버튼 위치 — 폰은 제목 아래로 감김 · 그 외는 같은 줄 오른쪽 · 데스크탑 행 높이 ≤ 37
//     ⑥ [사용법] 은 위키 글이 있는 단계에만 · member 에게는 «나» 묶음만
//     ⑦ 접기가 새로고침 뒤에도 유지 · 닫으면 사라지고 새로고침 뒤에도 없다(서버)
//   ★ 만든 사용자·워크스페이스·행은 판정 뒤 **create() 가 돌려준 id 로만** 지운다. 외부 발송 없음.
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
const b = require('./lib/browser');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const M = require('/opt/planq/dev-backend/models');

const API = 'http://127.0.0.1:3003';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VPS = [
  { key: '폰 390', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true, phone: true },
  { key: '태블릿 820', vp: { width: 820, height: 1180, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true, phone: false },
  { key: '데스크탑 1440', vp: { width: 1440, height: 900 }, touch: false, phone: false },
];
// connect_ai_app: 2026-10-04 부터 [연결](내 외부 연동 «연결된 AI 앱» 칸) + [사용법](connect-chatgpt-claude) 둘 다
const WIKI_STEPS = new Set(['invite_client', 'start_conversation', 'create_task', 'connect_mail', 'connect_calendar', 'connect_ai_app']);
const PASSWORD = 'Onboarding2026!';

async function api(token, method, path, body) {
  const r = await fetch(API + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch { /* */ }
  return { status: r.status, data: j?.data, j };
}
async function login(email) {
  const r = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  const j = await r.json();
  if (!j?.data?.token) throw new Error('login failed ' + email + ' ' + r.status);
  return j.data.token;
}
const stepDone = (state, scope, key) => state?.groups?.find((g) => g.scope === scope)?.steps.find((s) => s.key === key)?.done;

async function run() {
  const results = [];
  const push = (name, ok, msg, extra = {}) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')], ...extra });
  const made = { users: [], biz: null, members: [], clients: [], mail: [], conns: [], push: [], rts: [], grants: [] };
  let browser = null;
  try {
    // ── 픽스처: 새 워크스페이스 + owner·member·client ──
    const [ps] = await sequelize.query('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1');
    const tv = ps[0]?.terms_version || '1.0';
    const pv = ps[0]?.privacy_version || '1.0';
    const stamp = Date.now();
    const hash = await bcrypt.hash(PASSWORD, 12);
    const mkUser = async (tag) => {
      const u = await M.User.create({
        email: `onb-${tag}-${stamp}@test.planq.kr`, username: `onb${tag}${stamp}`, password_hash: hash, name: `Onb ${tag}`,
        platform_role: 'user', terms_accepted_at: new Date(), terms_version: tv, privacy_accepted_at: new Date(), privacy_version: pv,
      });
      made.users.push(u.id);
      return u;
    };
    const owner = await mkUser('owner');
    const member = await mkUser('member');
    const clientU = await mkUser('client');
    const biz = await M.Business.create({ name: `Onb Canary ${stamp}`, slug: `onb-canary-${stamp}`, owner_id: owner.id });
    made.biz = biz.id;
    for (const [u, role] of [[owner, 'owner'], [member, 'member']]) {
      const m = await M.BusinessMember.create({ business_id: biz.id, user_id: u.id, role, joined_at: new Date() });
      made.members.push(m.id);
    }
    await M.User.update({ active_business_id: biz.id }, { where: { id: [owner.id, member.id, clientU.id] } });
    const tOwner = await login(owner.email);
    const tMember = await login(member.email);
    const P = `/api/businesses/${biz.id}/onboarding`;
    const get = async (t) => (await api(t, 'GET', P)).data;

    // ── ① 자격·모양 ──
    let so = await get(tOwner);
    const sm = await get(tMember);
    const scopesO = (so?.groups || []).map((g) => `${g.scope}:${g.steps.map((s) => s.key).join(',')}`);
    push('① owner — workspace 4 · me 4',
      JSON.stringify(scopesO) === JSON.stringify(['workspace:invite_client,start_conversation,create_task,connect_mail', 'me:enable_notifications,connect_calendar,install_app,connect_ai_app']),
      JSON.stringify(scopesO));
    push('① owner — 옛 steps 평면 4개 유지(key·순서)',
      (so?.steps || []).map((s) => s.key).join(',') === 'invite_client,start_conversation,create_task,enable_notifications' && so.total === 4 && so.dismissed === false,
      JSON.stringify({ steps: so?.steps, total: so?.total, dismissed: so?.dismissed }));
    push('① member — me 묶음만 · 옛 steps 비어 있음(옛 카드 안 뜸)',
      (sm?.groups || []).map((g) => g.scope).join(',') === 'me' && Array.isArray(sm.steps) && sm.steps.length === 0 && sm.total === 0,
      JSON.stringify({ groups: (sm?.groups || []).map((g) => g.scope), steps: sm?.steps }));
    push('① 새 워크스페이스 — 모든 단계 done=false(음성 기준선)',
      [...(so?.groups || []), ...(sm?.groups || [])].every((g) => g.steps.every((s) => !s.done)),
      JSON.stringify(so?.groups?.map((g) => g.steps)));

    // client — 고객 행을 만들면 invite_client 의 양성도 된다
    const cl = await M.Client.create({ business_id: biz.id, user_id: clientU.id, display_name: 'Onb Client', status: 'active' });
    made.clients.push(cl.id);
    const tClient = await login(clientU.email);
    const sc = await api(tClient, 'GET', P);
    push('① client — 403 (카드 없음)', sc.status === 403 || (sc.status === 200 && sc.data === null), `status ${sc.status}`);
    so = await get(tOwner);
    push('② invite_client — 고객 1명 → done', stepDone(so, 'workspace', 'invite_client') === true, JSON.stringify(so?.groups?.[0]?.steps));

    // ── ② connect_mail ──
    const mailOff = await M.EmailAccount.create({ business_id: biz.id, email: `onb-off-${stamp}@example.com`, is_active: false, imap_host: 'imap.invalid', imap_username: 'onb' });
    made.mail.push(mailOff.id);
    so = await get(tOwner);
    push('② connect_mail 음성 — 비활성 계정만 → false', stepDone(so, 'workspace', 'connect_mail') === false, String(stepDone(so, 'workspace', 'connect_mail')));
    // 활성 계정은 IMAP 동기화가 집을 수 있으므로 판정 직후 바로 지운다(잘못된 호스트 — 외부로 나가는 것은 없다).
    const mailOn = await M.EmailAccount.create({ business_id: biz.id, email: `onb-on-${stamp}@example.com`, is_active: true, imap_host: 'imap.invalid', imap_username: 'onb' });
    made.mail.push(mailOn.id);
    so = await get(tOwner);
    const mailOnDone = stepDone(so, 'workspace', 'connect_mail');
    await M.EmailAccount.destroy({ where: { id: mailOn.id } });
    made.mail = made.mail.filter((x) => x !== mailOn.id);
    push('② connect_mail 양성 — 활성 계정 → true', mailOnDone === true, String(mailOnDone));
    so = await get(tOwner);
    push('② connect_mail 지우면 다시 false', stepDone(so, 'workspace', 'connect_mail') === false, String(stepDone(so, 'workspace', 'connect_mail')));

    // ── ② connect_calendar (member 기준 — 개인 묶음은 모든 멤버) ──
    const calOff = await M.ExternalConnection.create({ owner_scope: 'user', business_id: biz.id, user_id: member.id, provider: 'google_calendar', auth_type: 'oauth', account_email: `onb-cal-${stamp}@example.com`, is_active: false });
    made.conns.push(calOff.id);
    let s2 = await get(tMember);
    push('② connect_calendar 음성 — 비활성 연결 → false', stepDone(s2, 'me', 'connect_calendar') === false, String(stepDone(s2, 'me', 'connect_calendar')));
    await M.ExternalConnection.update({ is_active: true }, { where: { id: calOff.id } });
    s2 = await get(tMember);
    const so2 = await get(tOwner);
    push('② connect_calendar 양성 — 활성 개인 캘린더 → true · 남(owner)에게는 false',
      stepDone(s2, 'me', 'connect_calendar') === true && stepDone(so2, 'me', 'connect_calendar') === false,
      JSON.stringify({ member: stepDone(s2, 'me', 'connect_calendar'), owner: stepDone(so2, 'me', 'connect_calendar') }));
    const drive = await M.ExternalConnection.create({ owner_scope: 'user', business_id: biz.id, user_id: owner.id, provider: 'google_drive', auth_type: 'oauth', account_email: `onb-drv-${stamp}@example.com`, is_active: true });
    made.conns.push(drive.id);
    push('② connect_calendar 음성 — 드라이브 연결은 캘린더 아님', stepDone(await get(tOwner), 'me', 'connect_calendar') === false, '');

    // ── ② enable_notifications / install_app ──
    const web = await M.PushSubscription.create({ user_id: member.id, kind: 'webpush', endpoint: `https://fcm.googleapis.com/onb-${stamp}`, p256dh: 'x'.repeat(88), auth: 'y'.repeat(22) });
    made.push.push(web.id);
    s2 = await get(tMember);
    push('② 웹 푸시 구독 → 알림 true · 앱 설치 false(음성)',
      stepDone(s2, 'me', 'enable_notifications') === true && stepDone(s2, 'me', 'install_app') === false,
      JSON.stringify({ n: stepDone(s2, 'me', 'enable_notifications'), app: stepDone(s2, 'me', 'install_app') }));
    const apns = await M.PushSubscription.create({ user_id: member.id, kind: 'apns', endpoint: `apns:onb-${stamp}`, device_token: `onb-${stamp}` });
    made.push.push(apns.id);
    s2 = await get(tMember);
    push('② install_app 양성 — 네이티브(apns) 구독 → true', stepDone(s2, 'me', 'install_app') === true, String(stepDone(s2, 'me', 'install_app')));
    await M.PushSubscription.update({ expired_at: new Date() }, { where: { id: apns.id } });
    s2 = await get(tMember);
    push('② install_app — 만료된 네이티브 구독은 false', stepDone(s2, 'me', 'install_app') === false, String(stepDone(s2, 'me', 'install_app')));
    // 로그인으로 생긴 세션은 'web' 이다 → 이미 위에서 false. 앱 세션(pwa)을 만들면 true.
    const rt = await M.RefreshToken.create({ user_id: member.id, token_hash: `onb-${stamp}-${Math.random()}`, client_kind: 'pwa', expires_at: new Date(Date.now() + 86400000) });
    made.rts.push(rt.id);
    s2 = await get(tMember);
    push('② install_app 양성 — 앱(pwa) 세션 → true', stepDone(s2, 'me', 'install_app') === true, String(stepDone(s2, 'me', 'install_app')));
    await M.RefreshToken.update({ revoked_at: new Date() }, { where: { id: rt.id } });
    s2 = await get(tMember);
    push('② install_app — 끊긴 앱 세션은 false', stepDone(s2, 'me', 'install_app') === false, String(stepDone(s2, 'me', 'install_app')));

    // ── ② connect_ai_app ──
    const g = await M.AgentGrant.create({ user_id: member.id, business_id: biz.id, client_id: `onb-canary-${stamp}`, scopes: ['tasks:read'] });
    made.grants.push(g.id);
    s2 = await get(tMember);
    push('② connect_ai_app 음성 — 동의 전(activated_at 없음) → false', stepDone(s2, 'me', 'connect_ai_app') === false, String(stepDone(s2, 'me', 'connect_ai_app')));
    await M.AgentGrant.update({ activated_at: new Date() }, { where: { id: g.id } });
    s2 = await get(tMember);
    push('② connect_ai_app 양성 — 연결 끝 → true', stepDone(s2, 'me', 'connect_ai_app') === true, String(stepDone(s2, 'me', 'connect_ai_app')));
    await M.AgentGrant.update({ revoked_at: new Date() }, { where: { id: g.id } });
    s2 = await get(tMember);
    push('② connect_ai_app — 끊은 연결은 false', stepDone(s2, 'me', 'connect_ai_app') === false, String(stepDone(s2, 'me', 'connect_ai_app')));

    // ── ③ 닫기 ──
    const D = `${P}/dismiss`;
    let r = await api(tOwner, 'PUT', D, { dismissed: true, scope: 'me' });
    so = await get(tOwner); s2 = await get(tMember);
    push('③ owner 개인 닫기 → owner me 닫힘 · workspace 그대로 · member me 그대로',
      r.status === 200 && so.groups.find((x) => x.scope === 'me').dismissed && !so.groups.find((x) => x.scope === 'workspace').dismissed && !s2.groups[0].dismissed,
      JSON.stringify({ st: r.status, o: so.groups.map((x) => [x.scope, x.dismissed]), m: s2.groups.map((x) => [x.scope, x.dismissed]) }));
    r = await api(tMember, 'PUT', D, { dismissed: true, scope: 'workspace' });
    push('③ member 워크스페이스 묶음 닫기 → 403', r.status === 403, `status ${r.status}`);
    r = await api(tMember, 'PUT', D, { dismissed: true, scope: 'all' });
    so = await get(tOwner); s2 = await get(tMember);
    push('③ member «전부» 닫기 → 자기 me 만 · owner workspace 그대로',
      r.status === 200 && s2.groups[0].dismissed && !so.groups.find((x) => x.scope === 'workspace').dismissed,
      JSON.stringify({ st: r.status, m: s2.groups[0].dismissed, ow: so.groups.find((x) => x.scope === 'workspace').dismissed }));
    r = await api(tOwner, 'PUT', D, { dismissed: true, scope: 'bogus' });
    push('③ 잘못된 scope → 400', r.status === 400, `status ${r.status}`);
    r = await api(tOwner, 'PUT', D, { dismissed: false, scope: 'all' });
    r = await api(tOwner, 'PUT', D, { dismissed: true });   // 옛 번들 — scope 없음
    so = await get(tOwner);
    push('③ 옛 번들(scope 없음) → 워크스페이스 묶음만 닫힘 · 최상위 dismissed true',
      r.status === 200 && so.dismissed === true && so.groups.find((x) => x.scope === 'workspace').dismissed && !so.groups.find((x) => x.scope === 'me').dismissed,
      JSON.stringify({ top: so.dismissed, g: so.groups.map((x) => [x.scope, x.dismissed]) }));
    // 화면 검사를 위해 원복
    await api(tOwner, 'PUT', D, { dismissed: false, scope: 'all' });
    await api(tMember, 'PUT', D, { dismissed: false, scope: 'all' });

    // 위키 검색어가 실제 글에 닿는가 (사용법 버튼이 가리키는 곳)
    const fs = require('fs');
    for (const lang of ['ko', 'en']) {
      const dict = JSON.parse(fs.readFileSync(`/opt/planq/dev-frontend/public/locales/${lang}/dashboard.json`, 'utf8')).onboarding.step;
      const want = { connect_mail: 'connect-mail', connect_calendar: 'google-calendar-meet', connect_ai_app: 'connect-chatgpt-claude' };
      for (const [k, slug] of Object.entries(want)) {
        const q = dict[k]?.wikiQuery;
        const w = await fetch(`${API}/api/wiki/articles?q=${encodeURIComponent(q || '')}&limit=5&lang=${lang}`, { headers: { Authorization: `Bearer ${tOwner}`, 'Accept-Language': lang } }).then((x) => x.json()).catch(() => null);
        const slugs = (w?.data || []).map((a) => a.slug);
        push(`위키 ${lang} · ${k} 검색어가 «${slug}» 글을 찾는다`, slugs.slice(0, 3).includes(slug), JSON.stringify({ q, top: slugs.slice(0, 3) }));
      }
    }

    // ── 화면 ──
    browser = (await b.launch()).browser;
    // ★ 데스크탑 탭 모드는 keep-alive 라 앞 화면(대시보드)의 카드가 숨은 채 DOM 에 남는다 —
    //   자리(variant)로 골라야 지금 보는 화면의 카드를 잰다.
    const SEL = (variant) => `[data-testid="onboarding-checklist"][data-variant="${variant}"]`;
    const openCard = async (page, path, variant) => {
      await page.goto(b.BASE + path, { waitUntil: 'domcontentloaded' });
      for (let i = 0; i < 24; i++) { await sleep(500); if (await page.$(SEL(variant))) break; }
      await sleep(400);
    };
    const cardInfo = (page, variant) => page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { found: false };
      el.scrollIntoView({ block: 'start' });
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + Math.min(40, r.width / 2), r.top + 12);
      const rows = [...el.querySelectorAll('[data-testid^="onboarding-step-"]')].map((row) => {
        const key = row.dataset.testid.replace('onboarding-step-', '');
        const lab = row.children[1]?.firstElementChild;   // Texts > Label
        const go = row.querySelector(`[data-testid="onboarding-go-${key}"]`);
        const rr = row.getBoundingClientRect();
        const lr = lab?.getBoundingClientRect();
        const gr = go?.getBoundingClientRect();
        return { key, done: row.dataset.done === '1', h: Math.round(rr.height), wiki: !!row.querySelector(`[data-testid="onboarding-wiki-${key}"]`),
          lab: lr && { l: lr.left, r: lr.right, t: lr.top, b: lr.bottom }, go: gr && { l: gr.left, r: gr.right, t: gr.top, b: gr.bottom, h: gr.height },
          rowR: rr.right };
      });
      // 최상단 — 본문(PageShell Body)에서 카드보다 위에 보이는 형제가 없다
      const parent = el.parentElement;
      const before = parent ? [...parent.children].slice(0, [...parent.children].indexOf(el)).filter((c) => c.getBoundingClientRect().height > 0) : [];
      return { found: true, vis: !!hit && el.contains(hit), w: Math.round(r.width), variant: el.dataset.variant,
        groups: [...el.querySelectorAll('[data-testid^="onboarding-group-"]')].map((x) => x.dataset.testid.replace('onboarding-group-', '')),
        rows, beforeCount: before.length, bannerUp: document.body.dataset.pushPromptVisible === '1' };
    }, SEL(variant));
    const judgeRows = (v, info, label) => {
      const undone = info.rows.filter((x) => !x.done);
      const posOk = undone.every((x) => {
        if (!x.go || !x.lab) return false;
        return v.phone ? x.go.t >= x.lab.b - 1 : (x.go.l > x.lab.r && Math.abs((x.go.t + x.go.b) / 2 - (x.lab.t + x.lab.b) / 2) < 12);
      });
      // 버튼 높이 — ActionButton sm = 36, 폰은 공용 규칙으로 터치 44(ActionButton.tsx @media ≤640)
      const wantH = v.phone ? 44 : 36;
      push(`${v.key} · ${label} ⑤ 버튼 위치(${v.phone ? '제목 아래' : '같은 줄 오른쪽'}) · 버튼 ${wantH}px`,
        undone.length > 0 && posOk && undone.every((x) => Math.round(x.go.h) === wantH),
        JSON.stringify(undone.map((x) => ({ k: x.key, lab: x.lab && [Math.round(x.lab.r), Math.round(x.lab.b)], go: x.go && [Math.round(x.go.l), Math.round(x.go.t)] }))));
      if (!v.phone) push(`${v.key} · ${label} ⑤ 행 높이 ≤ 37`, info.rows.every((x) => x.h <= 37), JSON.stringify(info.rows.map((x) => x.h)));
      const wikiOk = undone.every((x) => x.wiki === WIKI_STEPS.has(x.key));
      push(`${v.key} · ${label} ⑥ [사용법] 은 위키 글 있는 단계에만`, wikiOk, JSON.stringify(undone.map((x) => [x.key, x.wiki])));
    };

    for (const v of VPS) {
      for (const who of [{ u: owner, label: 'owner' }, { u: member, label: 'member' }]) {
        const ctx = await browser.createBrowserContext();
        const page = await ctx.newPage();
        try {
          await page.setViewport(v.vp);
          if (v.touch) await page.setUserAgent(UA);
          await b.login(page, { email: who.u.email, password: PASSWORD });
          for (const [path, variant] of [['/dashboard', 'dashboard'], ['/business/settings', 'settings']]) {
            await openCard(page, path, variant);
            const info = await cardInfo(page, variant);
            const expectGroups = who.label === 'owner' ? 'workspace,me' : 'me';
            push(`${v.key} · ${who.label} · ${variant} ④ 카드 보임(elementFromPoint) · 같은 컴포넌트 · 최상단`,
              info.found && info.vis && info.variant === variant && (variant === 'dashboard' || info.beforeCount === 0),
              JSON.stringify({ found: info.found, vis: info.vis, variant: info.variant, before: info.beforeCount }));
            push(`${v.key} · ${who.label} · ${variant} ⑥ 묶음 = ${expectGroups}`, (info.groups || []).join(',') === expectGroups, JSON.stringify(info.groups));
            if (info.found) judgeRows(v, info, `${who.label}·${variant}`);
          }
          // ⑦ 접기 유지 (owner 만 · 설정 화면)
          if (who.label === 'owner') {
            const sset = SEL('settings');
            await page.click(`${sset} [data-testid="onboarding-collapse"]`);
            await sleep(300);
            await page.reload({ waitUntil: 'domcontentloaded' });
            for (let i = 0; i < 20; i++) { await sleep(500); if (await page.$(sset)) break; }
            await sleep(300);
            const after = await cardInfo(page, 'settings');
            push(`${v.key} · ⑦ 접기 → 새로고침 뒤에도 접힘(묶음 0 · 카드는 보임)`, after.found && after.vis && after.groups.length === 0, JSON.stringify({ found: after.found, groups: after.groups }));
            await page.click(`${sset} [data-testid="onboarding-collapse"]`);
            await sleep(300);
            const again = await cardInfo(page, 'settings');
            push(`${v.key} · ⑦ 펼치기 → 묶음 다시 보임`, (again.groups || []).length === 2, JSON.stringify(again.groups));
            if (v.key === '데스크탑 1440') {
              await page.click(`${sset} [data-testid="onboarding-dismiss"]`);
              await sleep(800);
              const gone = await page.$(sset);
              await page.reload({ waitUntil: 'domcontentloaded' });
              await sleep(5000);
              const gone2 = await page.$('[data-testid="onboarding-checklist"]');   // 어느 자리든 없어야 한다
              const st = await get(tOwner);
              const sMem = await get(tMember);
              push('⑦ 닫기 → 사라짐 · 새로고침 뒤에도 없음 · 서버 owner 두 묶음 닫힘 · member 는 그대로',
                !gone && !gone2 && st.groups.every((x) => x.dismissed) && !sMem.groups[0].dismissed,
                JSON.stringify({ gone: !gone, gone2: !gone2, owner: st.groups.map((x) => x.dismissed), member: sMem.groups[0].dismissed }));
            }
          }
        } catch (e) {
          push(`${v.key} · ${who.label} 오류`, false, e.message.slice(0, 200));
        } finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
      }
    }
  } catch (e) {
    push('오류', false, e.message.slice(0, 300));
  } finally {
    if (browser) await browser.close().catch(() => {});
    const del = (model, ids) => (ids.length ? model.destroy({ where: { id: ids }, force: true }).catch((e) => console.warn('cleanup', e.message)) : null);
    await del(M.AgentGrant, made.grants);
    await del(M.RefreshToken, made.rts);
    await del(M.PushSubscription, made.push);
    await del(M.ExternalConnection, made.conns);
    await del(M.EmailAccount, made.mail);
    await del(M.Client, made.clients);
    if (made.users.length) await M.RefreshToken.destroy({ where: { user_id: made.users } }).catch(() => {});
    if (made.biz) {
      await sequelize.query('UPDATE users SET active_business_id = NULL WHERE id IN (?)', { replacements: [made.users] }).catch(() => {});
      await M.BusinessMember.unscoped().destroy({ where: { id: made.members } }).catch((e) => console.warn('cleanup bm', e.message));
      await M.Business.destroy({ where: { id: made.biz } }).catch((e) => console.warn('cleanup biz', e.message));
    }
    await del(M.User, made.users);
  }
  return results;
}

module.exports = { name: '시작 안내 체크리스트 (M3-d) — 묶음·자격·단계 양성/음성·사람별 닫기 · 대시보드/설정 3폭', run };
