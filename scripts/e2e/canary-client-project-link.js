// canary-client-project-link — 워크스페이스 고객 초대를 수락한 고객이 **연결된 프로젝트·채팅방을 실제로 보는가** (2026-10-06)
//
//   Irene: "최정우 고객에게 내가 채팅을 보냈는데 그 고객화면에 채팅리스트가 안떠."
//   운영 실측: project_clients 에 client_id 만 있고 contact_user_id 가 비어 있었다. 고객이 볼 프로젝트는
//   contact_user_id = 나 로 판정하므로 그 프로젝트도, 그 프로젝트의 고객 채팅방도 고객 화면에서 사라졌다.
//   워크스페이스 고객 초대 수락이 clients.user_id 만 채우고 project_clients 를 두었기 때문이다.
//
//   잰다(서버 + 화면):
//     ① 수락 후 project_clients.contact_user_id = 그 계정
//     ② 고객 채널 참여자 role = client
//     ③ GET /api/projects 에 그 프로젝트가 있다 · GET /api/conversations/:biz 에 그 방이 있다
//     ④ 고객 화면 메뉴(3폭) — Q talk 목록에 방 제목이 **보인다**, 다른 메뉴는 오류·빈 화면 없이 열린다
//     ⑤ (2026-10-07) **이미 계정 있는 고객을 다른 프로젝트에 추가**(POST /api/projects/:id/clients {client_id})해도
//        그 프로젝트 고객 채널에 들어가 Q talk 목록에 보인다 — 이 문만 참여를 빠뜨려 운영 민충기가 방을 못 봤다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const crypto = require('crypto');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
const b = require('./lib/browser');

const BIZ = 5;
const OWNER = 5;
const API = 'http://127.0.0.1:3003';
const STAMP = Date.now();
const CONV_TITLE = `고객연결 카나리 대화 ${STAMP}`;
const CONV2_TITLE = `고객추가 카나리 대화 ${STAMP}`;
const MENUS = ['/home', '/talk', '/tasks', '/projects', '/calendar', '/bills'];
const VPS = [{ n: 'phone', w: 390, h: 844 }, { n: 'tablet', w: 820, h: 1180 }, { n: 'desktop', w: 1440, h: 900 }];

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  const ids = { user: null, client: null, project: null, pc: null, conv: null, project2: null, conv2: null };
  let browser = null;
  try {
    const cred = { email: `cpl-canary-${STAMP}@test.planq.kr`, password: 'ClientLinkCanary2026!' };
    const [ver] = await sequelize.query('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1',
      { type: sequelize.QueryTypes.SELECT }).then((r) => [r]).catch(() => [{}]);
    // 고객 계정(아직 초대 수락 전 — 일반 사용자)
    const [uid] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role,
                          terms_accepted_at, terms_version, privacy_accepted_at, privacy_version, created_at, updated_at)
       VALUES (?, ?, 'CPL 고객', ?, 'user', NOW(), ?, NOW(), ?, NOW(), NOW())`,
      { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `cpl${STAMP}`,
        (ver && ver.terms_version) || '1.0', (ver && ver.privacy_version) || '1.0'] });
    ids.user = uid;
    // 워크스페이스 고객(계정 없음) + 초대 토큰
    const token = crypto.randomBytes(24).toString('hex');
    const [cid] = await sequelize.query(
      `INSERT INTO clients (business_id, display_name, invite_email, invite_token, invited_at, invited_by, status, created_at, updated_at)
       VALUES (?, 'CPL 고객', ?, ?, NOW(), ?, 'invited', NOW(), NOW())`,
      { replacements: [BIZ, cred.email, token, OWNER] });
    ids.client = cid;
    // 프로젝트 + client_id 로만 연결(contact_user_id 없음 — 운영 행 9 와 같은 모양) + 고객 채널
    const [pid] = await sequelize.query(
      `INSERT INTO projects (business_id, name, status, owner_user_id, created_at, updated_at)
       VALUES (?, ?, 'active', ?, NOW(), NOW())`, { replacements: [BIZ, `고객연결 카나리 ${STAMP}`, OWNER] });
    ids.project = pid;
    const [pcid] = await sequelize.query(
      'INSERT INTO project_clients (project_id, client_id) VALUES (?, ?)', { replacements: [pid, cid] });
    ids.pc = pcid;
    const [cvid] = await sequelize.query(
      `INSERT INTO conversations (business_id, project_id, title, channel_type, status, last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, 'customer', 'active', NOW(), NOW(), NOW())`, { replacements: [BIZ, pid, CONV_TITLE] });
    ids.conv = cvid;
    await sequelize.query("INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at, created_at) VALUES (?, ?, 'owner', NOW(), NOW())",
      { replacements: [cvid, OWNER] });

    // 고객이 로그인해 초대를 수락
    const lr = await (await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cred) })).json();
    const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${lr.data.token}` };
    const acc = await fetch(`${API}/api/invites/${token}/accept`, { method: 'POST', headers: H });
    const [pc] = await sequelize.query('SELECT contact_user_id FROM project_clients WHERE id = ?', { replacements: [pcid], type: sequelize.QueryTypes.SELECT });
    push('① 수락 후 프로젝트 연결에 계정이 들어간다', acc.status === 200 && Number(pc.contact_user_id) === Number(uid),
      `accept ${acc.status} · contact_user_id ${pc.contact_user_id} (기대 ${uid})`);
    const [part] = await sequelize.query('SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      { replacements: [cvid, uid], type: sequelize.QueryTypes.SELECT });
    push('② 고객 채널에 client 로 참여한다', part && part.role === 'client', `참여자 role ${part ? part.role : '없음'}`);

    // 다시 로그인(고객 역할로 토큰 갱신) 후 목록 API
    const lr2 = await (await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cred) })).json();
    const H2 = { Authorization: `Bearer ${lr2.data.token}`, 'X-Workspace-Id': String(BIZ) };
    const pj = await (await fetch(`${API}/api/projects?business_id=${BIZ}`, { headers: H2 })).json();
    const cv = await (await fetch(`${API}/api/conversations/${BIZ}`, { headers: H2 })).json();
    const hasP = (pj.data || []).some((p) => p.id === pid);
    const hasC = (cv.data || []).some((c) => c.id === cvid);
    push('③ 고객 API 에 프로젝트·채팅방이 있다', hasP && hasC, `projects ${hasP} · conversations ${hasC}`);

    // ⑤ 이미 계정 있는(수락한) 고객을 **다른 프로젝트에 추가** — 오너가 붙인다
    const [pid2] = await sequelize.query(
      `INSERT INTO projects (business_id, name, status, owner_user_id, created_at, updated_at)
       VALUES (?, ?, 'active', ?, NOW(), NOW())`, { replacements: [BIZ, `고객추가 카나리 ${STAMP}`, OWNER] });
    ids.project2 = pid2;
    await sequelize.query('INSERT INTO project_members (project_id, user_id, is_pm, created_at, updated_at) VALUES (?, ?, 1, NOW(), NOW())', { replacements: [pid2, OWNER] }).catch(() => {});
    const [cvid2] = await sequelize.query(
      `INSERT INTO conversations (business_id, project_id, title, channel_type, status, last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, 'customer', 'active', NOW(), NOW(), NOW())`, { replacements: [BIZ, pid2, CONV2_TITLE] });
    ids.conv2 = cvid2;
    const olr = await (await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: b.CREDS.email, password: b.CREDS.password }) })).json();
    const add = await fetch(`${API}/api/projects/${pid2}/clients`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${olr.data.token}`, 'X-Workspace-Id': String(BIZ) },
      body: JSON.stringify({ client_id: cid }) });
    const [part2] = await sequelize.query('SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      { replacements: [cvid2, uid], type: sequelize.QueryTypes.SELECT });
    const cv2 = await (await fetch(`${API}/api/conversations/${BIZ}`, { headers: H2 })).json();
    const hasC2 = (cv2.data || []).some((c) => c.id === cvid2);
    push('⑤ 계정 고객을 프로젝트에 추가하면 그 고객 채널에 들어가 목록 API 에 뜬다', add.status === 200 && part2 && part2.role === 'client' && hasC2,
      `add ${add.status} · 참여자 ${part2 ? part2.role : '없음'} · conversations ${hasC2}`);

    // ④ 고객 화면 메뉴
    const launched = await b.launch();
    browser = launched.browser;
    const page = launched.page;
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
    await b.login(page, cred);
    for (const vp of VPS) {
      await page.setViewport({ width: vp.w, height: vp.h });
      const bad = [];
      for (const m of MENUS) {
        const before = errs.length;
        await b.goto(page, m);
        await b.sleep(3500);
        const st = await page.evaluate((title) => {
          const txt = document.body.innerText || '';
          const fallback = /찾을 수 없|권한이 없|문제가 발생|Something went wrong|Not Found/i.test(txt);
          let titleSeen = null;
          if (location.pathname.startsWith('/talk')) {
            const el = [...document.querySelectorAll('body *')].find((x) => x.childElementCount === 0 && (x.textContent || '').includes(title));
            if (el) {
              const r = el.getBoundingClientRect();
              const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 20), r.top + r.height / 2);
              titleSeen = r.width > 0 && r.height > 0 && !!hit && (el === hit || el.contains(hit) || hit.contains(el));
            } else titleSeen = false;
          }
          return { len: txt.trim().length, fallback, titleSeen, path: location.pathname };
        }, CONV_TITLE);
        if (st.path.startsWith('/talk')) {
          const seen2 = await page.evaluate((title) => {
            const el = [...document.querySelectorAll('body *')].find((x) => x.childElementCount === 0 && (x.textContent || '').includes(title));
            if (!el) return false;
            el.scrollIntoView({ block: 'nearest' });
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 20), r.top + r.height / 2);
            return r.width > 0 && r.height > 0 && !!hit && (el === hit || el.contains(hit) || hit.contains(el));
          }, CONV2_TITLE);
          if (!seen2) bad.push(`${m}: 추가된 프로젝트 대화방 «${CONV2_TITLE}» 이 목록에 안 보인다`);
        }
        if (errs.length > before) bad.push(`${m}: 화면 오류 ${errs.slice(before).join(' | ')}`);
        if (st.fallback) bad.push(`${m}: 오류·없음 문구`);
        if (st.len < 10) bad.push(`${m}: 빈 화면`);
        if (st.titleSeen === false) bad.push(`${m}: 대화방 «${CONV_TITLE}» 이 목록에 안 보인다`);
      }
      push(`④ 고객 화면 메뉴 (${vp.n} ${vp.w})`, bad.length === 0, bad.length ? bad.join(' / ') : `${MENUS.join(' ')} — 열림 · Q talk 목록에 방 보임`);
    }
  } catch (e) {
    push('실행', false, e.stack || String(e));
  } finally {
    if (browser) await browser.close().catch(() => {});
    const q = (sql, r) => sequelize.query(sql, { replacements: r }).catch(() => {});
    if (ids.conv) { await q('DELETE FROM conversation_participants WHERE conversation_id = ?', [ids.conv]); await q('DELETE FROM messages WHERE conversation_id = ?', [ids.conv]); await q('DELETE FROM conversations WHERE id = ?', [ids.conv]); }
    // 수락이 만든 환영 대화방(있으면)
    if (ids.client) {
      const rows = await sequelize.query('SELECT id FROM conversations WHERE client_id = ?', { replacements: [ids.client], type: sequelize.QueryTypes.SELECT }).catch(() => []);
      for (const r of rows) { await q('DELETE FROM conversation_participants WHERE conversation_id = ?', [r.id]); await q('DELETE FROM messages WHERE conversation_id = ?', [r.id]); await q('DELETE FROM conversations WHERE id = ?', [r.id]); }
    }
    if (ids.conv2) { await q('DELETE FROM conversation_participants WHERE conversation_id = ?', [ids.conv2]); await q('DELETE FROM messages WHERE conversation_id = ?', [ids.conv2]); await q('DELETE FROM conversations WHERE id = ?', [ids.conv2]); }
    if (ids.project2) { await q('DELETE FROM project_clients WHERE project_id = ?', [ids.project2]); await q('DELETE FROM project_members WHERE project_id = ?', [ids.project2]); await q('DELETE FROM projects WHERE id = ?', [ids.project2]); }
    if (ids.pc) await q('DELETE FROM project_clients WHERE id = ?', [ids.pc]);
    if (ids.project) { await q('DELETE FROM project_members WHERE project_id = ?', [ids.project]); await q('DELETE FROM projects WHERE id = ?', [ids.project]); }
    if (ids.client) await q('DELETE FROM clients WHERE id = ?', [ids.client]);
    if (ids.user) {
      await q('DELETE FROM notifications WHERE user_id = ?', [ids.user]);
      await q('DELETE FROM refresh_tokens WHERE user_id = ?', [ids.user]);
      await q('DELETE FROM users WHERE id = ?', [ids.user]);
    }
  }
  return results;
}

if (require.main === module) {
  run().then((r) => {
    r.forEach((x) => console.log(x.fail ? 'FAIL' : 'PASS', x.name, '—', x.details.join(' ')));
    process.exit(r.some((x) => x.fail) ? 1 : 0);
  }).finally(() => sequelize.close().catch(() => {}));
}
module.exports = { run };
