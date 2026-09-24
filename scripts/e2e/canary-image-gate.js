// canary-image-gate — 이미지 보안 Stage 2a: **개인(L1) 이미지는 올린 사람만** (docs/IMAGE_STAGE2_DECISIONS.md §5)
//
// 재는 것 (HTTP 만 — 브라우저 없음)
//   ① 익명 L1 → 404 · 킬스위치(시각을 미래로) → 200 · 되돌리면 다시 404 — 양성 대조군
//   ② 올린 사람 쿠키 200 · 다른 멤버 쿠키 404 · platform_admin 쿠키 200 (= 목록과 같은 술어 3분기)
//   ③ 익명 L3·L4 → 200 (범위 밖 불변 — 음성 대조군)
//   ④ ?w=320 을 올린 사람이 먼저 받아 캐시를 만든 뒤 익명 → 404 (게이트가 캐시 **앞**)
//   ⑤ 만료된 pq_img → 404 · pq_img 를 Bearer 로 → 401 (이미지 토큰이 일반 인증으로 안 통한다)
//   ⑥ editor-image 도 같은 함수(L1 픽스처가 있으면)
// ★ 픽스처(임시 사용자·파일·vlevel·킬스위치)는 끝에서 **전부 되돌린다.**
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const { CREDS } = require('./lib/browser');
const API = process.env.E2E_API || 'http://localhost:3003';
const RUN = Date.now().toString(36).slice(-6);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let _seq = null;
function db() { if (!_seq) ({ sequelize: _seq } = require('/opt/planq/dev-backend/config/database')); return _seq; }
const q = async (s, r) => (await db().query(s, { replacements: r }))[0];

async function login(email, password) {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const cookies = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => c.split(';')[0]);
  const img = cookies.find((c) => c.startsWith('pq_img=')) || '';
  const j = await r.json().catch(() => ({}));
  return { token: j.data?.token, img };
}
const get = (path, cookie, headers = {}) => fetch(`${API}${path}`, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers }, redirect: 'manual' });

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')] });
  const made = { users: [], files: [], bm: [] };
  let origOff, editorRow = null, psId = null;
  try {
    const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
    const me = await login(CREDS.email, CREDS.password);
    if (!me.img) { results.push({ name: '이미지 쿠키', unmeasured: true, details: ['⚪ 로그인 응답에 pq_img 없음'] }); return results; }
    const [[meRow]] = [await q('SELECT id FROM users WHERE email=?', [CREDS.email])];
    const biz = (await q('SELECT business_id FROM business_members WHERE user_id=? ORDER BY id LIMIT 1', [meRow.id]))[0].business_id;
    const H = { Authorization: `Bearer ${me.token}` };

    // 임시 사용자 — 같은 워크스페이스 멤버 1 · platform_admin 1
    const pw = `Pw!${RUN}zz`; const hash = await bcrypt.hash(pw, 12);
    const mk = async (tag, extra = {}) => {
      await q('INSERT INTO users (email, password_hash, name, status, platform_role, created_at, updated_at) VALUES (?,?,?,?,?,NOW(),NOW())',
        [`zzimg-${tag}-${RUN}@example.com`, hash, `ZZ이미지 ${tag}`, 'active', extra.platform_role || 'user']);
      const [[u]] = [await q('SELECT id, email FROM users WHERE email=?', [`zzimg-${tag}-${RUN}@example.com`])];
      made.users.push(u.id); return u;
    };
    const other = await mk('member');
    await q("INSERT INTO business_members (business_id, user_id, role, created_at, updated_at) VALUES (?,?, 'member', NOW(), NOW())", [biz, other.id]);
    made.bm.push([biz, other.id]);
    const admin = await mk('admin', { platform_role: 'platform_admin' });
    const O = await login(other.email, pw);
    const A = await login(admin.email, pw);

    // 파일 3장 — L1 · L3 · L4 (내가 올림)
    const up = async (tag, vlevel) => {
      const fd = new FormData();
      fd.append('file', new Blob([PNG, Buffer.from(RUN + tag)], { type: 'image/png' }), `zzimg-${RUN}-${tag}.png`);
      const r = await fetch(`${API}/api/files/${biz}`, { method: 'POST', headers: H, body: fd });
      const id = (await r.json()).data?.id; made.files.push(id);
      await q('UPDATE files SET vlevel=?, security_level=? WHERE id=?', [vlevel, 'general', id]);
      const [[f]] = [await q('SELECT file_path FROM files WHERE id=?', [id])];
      return `/api/files/public-image/${require('path').basename(f.file_path)}`;
    };
    const L1 = await up('l1', 'L1'); const L3 = await up('l3', 'L3'); const L4 = await up('l4', 'L4');

    const [[ps]] = [await q('SELECT id, image_gate_l1_off_until o FROM platform_settings ORDER BY id LIMIT 1')];
    psId = ps.id; origOff = ps.o;
    await q('UPDATE platform_settings SET image_gate_l1_off_until=NULL WHERE id=?', [psId]);
    await sleep(31000);   // 서버 30초 캐시가 «켬» 을 읽게

    // ①②③
    const s = async (p, c) => (await get(p, c)).status;
    push('① 익명 L1 → 404', (await s(L1, '')) === 404, String(await s(L1, '')));
    push('② 올린 사람 L1 → 200', (await s(L1, me.img)) === 200, String(await s(L1, me.img)));
    push('② 다른 멤버 L1 → 404', (await s(L1, O.img)) === 404, String(await s(L1, O.img)));
    push('② platform_admin L1 → 200', (await s(L1, A.img)) === 200, String(await s(L1, A.img)));
    push('③ 익명 L3 → 200 (범위 밖 불변)', (await s(L3, '')) === 200, String(await s(L3, '')));
    push('③ 익명 L4 → 200', (await s(L4, '')) === 200, String(await s(L4, '')));
    const r404 = await get(L1, '');
    push('① 거부 응답은 no-store', /no-store/.test(r404.headers.get('cache-control') || ''), r404.headers.get('cache-control'));

    // ④ 캐시 앞 게이트
    const w1 = await s(`${L1}?w=320`, me.img);
    const w2 = await s(`${L1}?w=320`, '');
    push('④ 올린 사람이 ?w=320 캐시를 만든 뒤에도 익명은 404', w1 === 200 && w2 === 404, `${w1} → 익명 ${w2}`);

    // ⑤ 만료 쿠키 · Bearer 오용
    const jwt = require('/opt/planq/dev-backend/node_modules/jsonwebtoken');
    const { IMAGE_TOKEN_SECRET } = require('/opt/planq/dev-backend/services/authTokens');
    const expired = jwt.sign({ kind: 'img', userId: meRow.id, exp: Math.floor(Date.now() / 1000) - 60 }, IMAGE_TOKEN_SECRET);
    push('⑤ 만료된 pq_img → 404', (await s(L1, `pq_img=${expired}`)) === 404, String(await s(L1, `pq_img=${expired}`)));
    const imgVal = me.img.split('=').slice(1).join('=');
    const bear = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${imgVal}` } });
    push('⑤ pq_img 를 Bearer 로 → 401', bear.status === 401, String(bear.status));

    // ⑥ editor-image — 있는 파일 하나를 잠깐 L1 로(끝에 되돌린다)
    const eds = await q("SELECT id, file_path, vlevel, uploader_id FROM files WHERE file_path LIKE '%editor-images%' AND deleted_at IS NULL AND security_level='general' AND mime_type LIKE 'image/%' LIMIT 1");
    if (eds.length) {
      editorRow = eds[0];
      await q("UPDATE files SET vlevel='L1' WHERE id=?", [editorRow.id]);
      const ep = `/api/posts/editor-image/${require('path').basename(editorRow.file_path)}`;
      const e1 = await s(ep, ''); const e2 = await s(ep, A.img);
      push('⑥ editor-image 도 같은 함수 — 익명 L1 404 · platform_admin 200', e1 === 404 && e2 === 200, `익명 ${e1} · admin ${e2}`);
    } else results.push({ name: '⑥ editor-image', unmeasured: true, optional: true, details: ['⚪ dev 에 editor-image 파일 없음'] });

    // ① 킬스위치 — 미래로 끄면 30초 안에 익명 200, 되돌리면 404
    await q('UPDATE platform_settings SET image_gate_l1_off_until=DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id=?', [psId]);
    await sleep(31000);
    const k1 = await s(L1, '');
    await q('UPDATE platform_settings SET image_gate_l1_off_until=NULL WHERE id=?', [psId]);
    await sleep(31000);
    const k2 = await s(L1, '');
    push('① 킬스위치 끄면 익명 L1 200 → 되돌리면 404 (재시작 없이)', k1 === 200 && k2 === 404, `끔 ${k1} → 켬 ${k2}`);
    return results;
  } catch (e) {
    push('카나리 실행', false, e.message);
    return results;
  } finally {
    try {
      if (psId != null) await q('UPDATE platform_settings SET image_gate_l1_off_until=? WHERE id=?', [origOff || null, psId]);
      if (editorRow) await q('UPDATE files SET vlevel=? WHERE id=?', [editorRow.vlevel, editorRow.id]);
      const me = await login(CREDS.email, CREDS.password);
      for (const id of made.files.filter(Boolean)) {
        const [[f]] = [await q('SELECT business_id FROM files WHERE id=?', [id])];
        if (!f) continue;
        await fetch(`${API}/api/files/${f.business_id}/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${me.token}` } });
        await fetch(`${API}/api/files/${f.business_id}/${id}/purge`, { method: 'DELETE', headers: { Authorization: `Bearer ${me.token}` } });
      }
      for (const [b, u] of made.bm) await q('DELETE FROM business_members WHERE business_id=? AND user_id=?', [b, u]);
      if (made.users.length) {
        await q('DELETE FROM audit_logs WHERE user_id IN (?)', [made.users]);
        await q('DELETE FROM refresh_tokens WHERE user_id IN (?)', [made.users]);
        await q('DELETE FROM users WHERE id IN (?)', [made.users]);
      }
      const [[left]] = [await q('SELECT (SELECT COUNT(*) FROM users WHERE email LIKE ?) u, (SELECT image_gate_l1_off_until FROM platform_settings WHERE id=?) o', [`zzimg-%-${RUN}@%`, psId])];
      results.push({ name: 'cleanup:image-gate', hasCanary: true, fail: Number(left.u) ? 1 : 0,
        details: [`임시 사용자 남음 ${left.u} · 킬스위치 ${left.o ?? 'NULL'}(원래 ${origOff ?? 'NULL'}) · editor 파일 vlevel 원복 ${editorRow ? editorRow.vlevel : '-'}`] });
    } catch (e) { results.push({ name: 'cleanup:image-gate', fail: 1, details: [`🔴 ${e.message}`] }); }
  }
}

module.exports = { run };
