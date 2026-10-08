#!/usr/bin/env node
// health-check 접근·격리 카테고리 픽스처 러너 — docs/FIX_0CDEF_ACCESS_DESIGN.md (0-C·0-D·0-E·0-F)
//
//   사용: (cwd=/opt/planq/dev-backend) node /opt/planq/scripts/health-access.js <case> <backend>
//   출력: 마지막 줄 '@@' + JSON { ok, detail } | { ok:false, error }
//
//   원칙 (health-money.js 와 같다)
//   · 각 검사는 **그 검사 안에서 새로 만드는 1회용 워크스페이스·사용자**만 건드린다. 끝나면 전부 지운다.
//   · 사람 역할: 오너 O · 멤버 A · 멤버 B · 고객 C · 해제된 멤버 R. 토큰은 서버와 같은 함수로 만든다.
//   · 각 검사는 **대조군**(같은 사람이 허용돼야 하는 대상에는 200)을 같이 잰다 — 전부 403 이라 거짓 통과하는 것을 막는다.
//   · 외부 발송은 .invalid 주소로만(배달 불가 도메인). dev SMTP 설정과 무관하게 실제로 닿지 않는다.
'use strict';

const BE = '/opt/planq/dev-backend';
process.chdir(BE);
require(`${BE}/node_modules/dotenv`).config({ path: `${BE}/.env`, quiet: true });

const [, , CASE, BACKEND] = process.argv;

const platformNotify = require(`${BE}/services/platformNotify`);
platformNotify.notifyPlatformAdmins = async () => null;

const M = require(`${BE}/models`);
const { sequelize } = require(`${BE}/config/database`);
const { Op } = require(`${BE}/node_modules/sequelize`);
const { generateAccessToken } = require(`${BE}/services/authTokens`);
const crypto = require('crypto');
const fs = require('fs');

const stamp = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
const madeBiz = [];
const madeUsers = [];
const cleanups = [];   // 워크스페이스에 안 묶이는 행(위키 글 등) — 끝에 역순으로 지운다

let userSeq = 0;
async function makeUser(tag, attrs = {}) {
  userSeq += 1;
  const u = await M.User.create({
    email: `ha-${stamp}-${tag}${userSeq}@hm.invalid`, password_hash: 'x', name: `[ha] ${tag}`, status: 'active', ...attrs,
  }, { hooks: false });
  madeUsers.push(u.id);
  u.token = generateAccessToken(u);
  return u;
}

/** 오너 O · 멤버 A · 멤버 B (+선택: 고객 C · 해제 멤버 R) 가 있는 1회용 워크스페이스 */
async function makeWorld({ client = false, removed = false } = {}) {
  const O = await makeUser('owner');
  const A = await makeUser('a');
  const B = await makeUser('b');
  const biz = await M.Business.create({
    name: `[health-access] ${stamp}`, slug: `ha-${stamp}-${madeBiz.length}`, owner_id: O.id,
    plan: 'pro', subscription_status: 'active',
  });
  madeBiz.push(biz.id);
  await M.BusinessMember.create({ business_id: biz.id, user_id: O.id, role: 'owner' });
  await M.BusinessMember.create({ business_id: biz.id, user_id: A.id, role: 'member' });
  await M.BusinessMember.create({ business_id: biz.id, user_id: B.id, role: 'member' });
  for (const u of [O, A, B]) await M.User.update({ active_business_id: biz.id }, { where: { id: u.id }, hooks: false });
  const w = { biz, O, A, B };
  if (client) {
    w.C = await makeUser('client');
    w.clientRow = await M.Client.create({ business_id: biz.id, user_id: w.C.id, display_name: '[ha] client', status: 'active' }, { hooks: false });
    await M.User.update({ active_business_id: biz.id }, { where: { id: w.C.id }, hooks: false });
  }
  if (removed) {
    w.R = await makeUser('removed');
    await M.BusinessMember.create({ business_id: biz.id, user_id: w.R.id, role: 'member', removed_at: new Date() });
  }
  return w;
}

async function dropBiz(id) {
  await sequelize.transaction(async (t) => {
    const q = (sql, rep = []) => sequelize.query(sql, { replacements: rep, transaction: t }).catch((e) => {
      if (process.env.HA_DEBUG) console.warn('[dropBiz]', sql.slice(0, 80), e.message);
    });
    await q('SET FOREIGN_KEY_CHECKS = 0');
    await q('DELETE FROM post_attachments WHERE post_id IN (SELECT id FROM posts WHERE business_id = ?)', [id]);
    await q('DELETE FROM kb_chunks WHERE kb_document_id IN (SELECT id FROM kb_documents WHERE business_id = ?)', [id]);
    await q('DELETE FROM email_messages WHERE thread_id IN (SELECT id FROM email_threads WHERE business_id = ?)', [id]);
    const [cols] = await sequelize.query(
      "SELECT TABLE_NAME t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'business_id' AND TABLE_NAME <> 'businesses'",
      { transaction: t },
    );
    for (const { t: tb } of cols) await q(`DELETE FROM \`${tb}\` WHERE business_id = ?`, [id]);
    await q('DELETE FROM businesses WHERE id = ?', [id]);
    await q('SET FOREIGN_KEY_CHECKS = 1');
  });
}

async function dropUsers(ids) {
  if (!ids.length) return;
  await sequelize.transaction(async (t) => {
    const q = (sql, rep = []) => sequelize.query(sql, { replacements: rep, transaction: t }).catch(() => null);
    await q('SET FOREIGN_KEY_CHECKS = 0');
    for (const tb of ['refresh_tokens', 'notifications', 'business_members', 'business_member_permissions', 'agent_grants', 'clients', 'oauth_connections', 'push_logs']) {
      await q(`DELETE FROM \`${tb}\` WHERE user_id IN (?)`, [ids]);
    }
    await q('DELETE FROM users WHERE id IN (?)', [ids]);
    await q('SET FOREIGN_KEY_CHECKS = 1');
  });
}

async function call(user, method, path, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let data; try { data = JSON.parse(raw); } catch { data = raw; }
  return { status: res.status, data, raw };
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function expect(r, status, what) { assert(r.status === status, `${what}: 기대 ${status} 인데 ${r.status} ${String(r.raw).slice(0, 160)}`); }
const DAY = 86400e3;

async function makePost(biz, author, vlevel, extra = {}) {
  return M.Post.create({
    business_id: biz.id, title: `[ha] ${vlevel} ${stamp}`, author_id: author.id, vlevel, status: 'published',
    // 서명 칸(1번) — 서명 요청은 서명자 번호마다 서명 칸이 있어야 만들어진다(services/signatureItems)
    content_json: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ha' }] }, { type: 'signatureField', attrs: { slot: 1 } }] }),
    ...extra,
  }, { hooks: false });
}
async function makeKb(biz, author, vlevel, extra = {}) {
  return M.KbDocument.create({
    business_id: biz.id, title: `[ha] kb ${vlevel} ${stamp}`, uploaded_by: author.id, vlevel, scope: 'workspace', status: 'ready', ...extra,
  }, { hooks: false });
}
async function makeFile(biz, uploader, extra = {}) {
  return M.File.create({
    business_id: biz.id, uploader_id: uploader.id, file_name: `ha-${stamp}.txt`, file_path: `/tmp/ha-${stamp}-none.txt`, file_size: 1, ...extra,
  }, { hooks: false });
}

const cases = {
  async sweep() {
    const rows = await M.Business.findAll({
      where: { name: { [Op.like]: '[health-access]%' }, created_at: { [Op.lt]: new Date(Date.now() - 10 * 60e3) } }, attributes: ['id'],
    });
    for (const r of rows) await dropBiz(r.id);
    const us = await M.User.findAll({ where: { email: { [Op.like]: 'ha-%@hm.invalid' }, created_at: { [Op.lt]: new Date(Date.now() - 10 * 60e3) } }, attributes: ['id'] });
    await dropUsers(us.map((u) => u.id));
    await sequelize.query("DELETE FROM help_articles WHERE slug LIKE 'ha-%' AND created_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)").catch(() => null);
    return `잔여 워크스페이스 ${rows.length} · 사용자 ${us.length} 정리`;
  },

  // ─── C-1 secrets: 서명 진행표·생성 응답에 토큰이 없다 ───
  async sig_notoken() {
    const { biz, A } = await makeWorld();
    const post = await makePost(biz, A, 'L3');
    const cr = await call(A, 'POST', `/api/posts/${post.id}/signatures`, { signers: [{ email: `signer-${stamp}@hm.invalid`, name: 'S', slot: 1 }] });
    expect(cr, 200, '서명 요청 생성');
    const sr = await M.SignatureRequest.findOne({ where: { entity_type: 'post', entity_id: post.id } });
    assert(sr && sr.token && sr.token.length >= 32, '요청 행/토큰 없음 — 검사 준비 실패');
    const list = await call(A, 'GET', `/api/posts/${post.id}/signatures`);
    expect(list, 200, '진행표');
    const raw = cr.raw + list.raw;
    assert(!raw.includes(sr.token), '응답 원문에 실제 서명 토큰이 있다 — 멤버 전원이 서명 링크를 얻는다');
    assert(!raw.includes('"token"') && !raw.includes('sign_url'), '응답에 token/sign_url 키가 있다');
    assert(raw.includes(`signer-${stamp}@hm.invalid`) && raw.includes('"status"'), 'signer_email·status 도 없다 — 응답이 비었을 가능성(거짓 통과)');
    return `생성·진행표 원문 — 토큰(${sr.token.length}자) 0 · token/sign_url 키 0 · signer_email·status 유지`;
  },

  // ─── C-1 secrets 양성: 받는 사람 본인에게는 자기 링크가 온다 ───
  async sig_received() {
    const { biz, A } = await makeWorld();
    const post = await makePost(biz, A, 'L3');
    const cr = await call(A, 'POST', `/api/posts/${post.id}/signatures`, { signers: [{ email: A.email, name: 'self', slot: 1 }] });
    expect(cr, 200, '자기에게 서명 요청');
    const sr = await M.SignatureRequest.findOne({ where: { entity_type: 'post', entity_id: post.id } });
    const rec = await call(A, 'GET', '/api/signatures/received?status=all');
    expect(rec, 200, '받은 서명');
    assert(rec.raw.includes(sr.token), '받는 사람 본인 목록에 자기 서명 토큰이 없다 — 받은 서명의 [서명하기] 가 죽는다');
    return '받은 목록에 본인 토큰 있음';
  },

  // ─── C-1 signauth: 서명 멤버 라우트 = 문서 읽기/편집 술어 ───
  async signauth() {
    const { biz, A, B } = await makeWorld();
    const l1 = await makePost(biz, A, 'L1');
    const l3 = await makePost(biz, A, 'L3');
    const mk = await call(A, 'POST', `/api/posts/${l1.id}/signatures`, { signers: [{ email: `s1-${stamp}@hm.invalid`, slot: 1 }] });
    expect(mk, 200, '작성자 A 의 L1 요청 생성(대조군)');
    const sr = await M.SignatureRequest.findOne({ where: { entity_type: 'post', entity_id: l1.id } });
    expect(await call(B, 'GET', `/api/posts/${l1.id}/signatures`), 403, 'B → A 의 L1 진행표');
    expect(await call(B, 'POST', `/api/posts/${l1.id}/signatures`, { signers: [{ email: `s2-${stamp}@hm.invalid`, slot: 1 }] }), 403, 'B → A 의 L1 요청 생성');
    expect(await call(B, 'GET', `/api/posts/${l1.id}/signature-scope`), 403, 'B → A 의 L1 signature-scope');
    expect(await call(B, 'DELETE', `/api/signatures/${sr.id}`), 403, 'B → A 의 L1 요청 취소');
    expect(await call(B, 'POST', `/api/signatures/${sr.id}/reminder`), 403, 'B → A 의 L1 요청 재발송');
    // 대조군 — 같은 B 가 L3 에는 연다
    expect(await call(B, 'GET', `/api/posts/${l3.id}/signatures`), 200, 'B → L3 진행표(대조군)');
    const mk3 = await call(B, 'POST', `/api/posts/${l3.id}/signatures`, { signers: [{ email: `s3-${stamp}@hm.invalid`, slot: 1 }] });
    expect(mk3, 200, 'B → L3 요청 생성(대조군)');
    const left = await M.SignatureRequest.findByPk(sr.id);
    assert(left.status !== 'canceled', 'B 의 403 취소가 실제로는 요청을 취소했다');
    return 'B→A의 L1: 목록·생성·범위·취소·재발송 403 · B→L3: 목록·생성 200';
  },

  // ─── C-6: 옛 Document 공개 서명 라우트 없음 · 공개 보기는 그대로 ───
  async docsign() {
    const { biz, A } = await makeWorld();
    const tok = crypto.randomBytes(16).toString('hex');
    const doc = await M.Document.create({ business_id: biz.id, kind: 'contract', title: `[ha] doc ${stamp}`, created_by: A.id, status: 'sent', share_token: tok, body_html: '<p>본문</p>' }, { hooks: false });
    const s = await call(null, 'POST', `/api/docs/public/${tok}/sign`, { signer_name: 'x', accept: true });
    expect(s, 404, '공개 서명 POST');
    const fresh = await M.Document.findByPk(doc.id);
    assert(!fresh.signed_at, '404 인데 문서가 서명됐다');
    const g = await call(null, 'GET', `/api/docs/public/${tok}`);
    expect(g, 200, '공개 보기(대조군)');
    return '공개 서명 404 · signed_at 그대로 · 공개 보기 200';
  },

  // ─── C-2 secrets: 단계 변경 방송은 신호만 ───
  async bcast() {
    const { biz, A } = await makeWorld();
    const cl = await M.Client.create({ business_id: biz.id, display_name: '[ha] lead', status: 'prospect', sales_stage: 'inquiry', invite_token: `inv${crypto.randomBytes(8).toString('hex')}`, lost_note: 'secret-note' }, { hooks: false });
    const { io } = require(require.resolve('socket.io-client', { paths: ['/opt/planq/dev-frontend/node_modules'] }));
    const sock = io(BACKEND, { auth: { token: A.token }, transports: ['websocket'], reconnection: false });
    const got = [];
    await new Promise((res, rej) => { sock.on('connect', res); sock.on('connect_error', rej); setTimeout(() => rej(new Error('socket 연결 시간 초과')), 8000); });
    sock.on('client:updated', (p) => got.push(p));
    sock.emit('join:business', biz.id);
    await new Promise((r) => setTimeout(r, 700));
    try {
      const r = await call(A, 'POST', `/api/sale/${biz.id}/clients/${cl.id}/stage`, { to: 'consulting' });
      expect(r, 200, '단계 변경');
      for (let i = 0; i < 20 && !got.length; i++) await new Promise((x) => setTimeout(x, 150));
      assert(got.length > 0, '방송을 받지 못했다 — 검사 준비 실패(거짓 통과 방지)');
      const raw = JSON.stringify(got);
      assert(!raw.includes('invite_token') && !raw.includes('secret-note') && !raw.includes('lost_note'), `방송 payload 에 행 전체가 실렸다: ${raw.slice(0, 160)}`);
      const keys = Object.keys(got[0]).sort().join(',');
      assert(keys === 'business_id,id', `payload 키가 {id,business_id} 가 아니다: ${keys}`);
      return `방송 ${got.length}건 — 키 {${keys}} · invite_token·lost_note 0`;
    } finally { sock.close(); }
  },

  // ─── C-9 secrets: 통합검색·AI get_document 응답에 서명 토큰 없음 ───
  async sig_search() {
    const { biz, A } = await makeWorld();
    const post = await makePost(biz, A, 'L3', { title: `[ha] 검색서명 ${stamp}` });
    expect(await call(A, 'POST', `/api/posts/${post.id}/signatures`, { signers: [{ email: `ss-${stamp}@hm.invalid`, slot: 1 }] }), 200, '요청 생성');
    const sr = await M.SignatureRequest.findOne({ where: { entity_type: 'post', entity_id: post.id } });
    const s = await call(A, 'GET', `/api/search?business_id=${biz.id}&q=${encodeURIComponent(stamp)}`);
    expect(s, 200, '통합검색');
    assert(s.raw.includes(String(post.id)), '검색 결과에 그 문서가 없다 — 거짓 통과 방지');
    let agent = '건너뜀(MCP 꺼짐)';
    try {
      const g = require(`${BE}/services/agent_oauth/grants`);
      const grant = await M.AgentGrant.create({ user_id: A.id, business_id: biz.id, client_id: 'health-access', provider: 'local', scopes: ['projects:read'], activated_at: new Date() });
      const r = await fetch('http://127.0.0.1:3005/agent/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${g.signAccess(grant)}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_document', arguments: { post_id: post.id } } }),
      });
      const raw = await r.text();
      assert(!raw.includes(sr.token) && !raw.includes('sign_url'), 'AI get_document 응답에 서명 토큰이 있다');
      assert(raw.includes(stamp), 'AI get_document 응답에 문서 제목이 없다 — 거짓 통과 방지');
      agent = 'get_document 원문 토큰 0';
    } catch (e) {
      if (/거짓 통과|토큰이 있다/.test(e.message)) throw e;
      agent = `건너뜀(${e.message.slice(0, 60)})`;
    }
    assert(!s.raw.includes(sr.token) && !s.raw.includes('sign_url'), '통합검색 응답에 서명 토큰이 있다');
    return `통합검색 원문 토큰 0 · ${agent}`;
  },

  // ─── C-3 kbauth ───
  async kbauth() {
    const { biz, A, B, C } = await makeWorld({ client: true });
    const aL1 = await makeKb(biz, A, 'L1', { share_token: `kbt${crypto.randomBytes(8).toString('hex')}`, shared_at: new Date() });
    const aL3 = await makeKb(biz, A, 'L3');
    const bL1 = await makeKb(biz, B, 'L1');
    expect(await call(B, 'PUT', `/api/kb-documents/${aL1.id}/security-level`, { level: 'internal' }), 403, 'B → A 의 L1 등급 변경');
    expect(await call(B, 'DELETE', `/api/kb-documents/${aL1.id}/share`), 403, 'B → A 의 L1 공유 해제');
    const still = await M.KbDocument.findByPk(aL1.id);
    assert(still.share_token && still.security_level !== 'internal', '403 인데 실제로 바뀌었다');
    expect(await call(C, 'POST', `/api/businesses/${biz.id}/kb/search`, { query: 'x' }), 403, '고객 → Q info 검색');
    // 대조군
    expect(await call(B, 'PUT', `/api/kb-documents/${bL1.id}/security-level`, { level: 'internal' }), 200, 'B → 자기 L1 등급(대조군)');
    expect(await call(B, 'PUT', `/api/kb-documents/${aL3.id}/security-level`, { level: 'internal' }), 200, 'B → A 의 L3 등급(대조군)');
    expect(await call(B, 'DELETE', `/api/kb-documents/${aL3.id}/share`), 200, 'B → A 의 L3 공유 해제(대조군)');
    return 'B→A의 L1: 등급·공유해제 403(값 불변) · 고객 검색 403 · B→자기 L1·A의 L3 200';
  },

  // ─── C-4 folderauth ───
  async folderauth() {
    const { biz, A, B, R } = await makeWorld({ removed: true });
    const mixed = await M.FileFolder.create({ business_id: biz.id, name: `[ha] mixed ${stamp}`, created_by: B.id }, { hooks: false });
    const fa = await makeFile(biz, A, { folder_id: mixed.id });
    const fb = await makeFile(biz, B, { folder_id: mixed.id });
    const r = await call(B, 'DELETE', `/api/folders/${mixed.id}?contents=delete`);
    expect(r, 403, 'B → A 파일 섞인 폴더 같이 삭제');
    assert(r.data && r.data.message === 'folder_has_files_you_cannot_delete' && r.data.blocked_count === 1, `거절 모양 ${r.raw.slice(0, 120)}`);
    const [a1, b1, f1] = await Promise.all([M.File.findByPk(fa.id, { paranoid: false }), M.File.findByPk(fb.id, { paranoid: false }), M.FileFolder.findByPk(mixed.id)]);
    assert(!a1.deleted_at && !b1.deleted_at && f1, '거절했는데 무언가 지워졌다(원자성 깨짐)');
    // 대조군 — B 파일만 있으면 통과
    const mine = await M.FileFolder.create({ business_id: biz.id, name: `[ha] mine ${stamp}`, created_by: B.id }, { hooks: false });
    const fb2 = await makeFile(biz, B, { folder_id: mine.id });
    expect(await call(B, 'DELETE', `/api/folders/${mine.id}?contents=delete`), 200, 'B → 자기 파일만 든 폴더(대조군)');
    const b2 = await M.File.findByPk(fb2.id, { paranoid: false });
    assert(b2.deleted_at, '대조군 파일이 휴지통으로 안 갔다');
    // 해제된 멤버
    expect(await call(R, 'POST', `/api/folders/workspace/${biz.id}`, { name: 'x' }), 403, '해제 멤버 폴더 생성');
    expect(await call(B, 'POST', `/api/folders/workspace/${biz.id}`, { name: `[ha] ok ${stamp}` }), 201, 'B 폴더 생성(대조군)');
    return '섞인 폴더 403 blocked_count 1 · 두 파일·폴더 그대로 · B 단독 폴더 200 + deleted_at · 해제 멤버 403 · B 생성 201';
  },

  // ─── C-7 mailscope ───
  async mailscope() {
    const { biz, A, B } = await makeWorld();
    const priv = await M.EmailAccount.create({ business_id: biz.id, email: `a-${stamp}@hm.invalid`, imap_host: 'imap.hm.invalid', imap_username: 'a', owner_user_id: A.id }, { hooks: false });
    const shared = await M.EmailAccount.create({ business_id: biz.id, email: `team-${stamp}@hm.invalid`, imap_host: 'imap.hm.invalid', imap_username: 't', owner_user_id: null }, { hooks: false });
    const tp = await M.EmailThread.create({ business_id: biz.id, account_id: priv.id, subject: '[ha] private' }, { hooks: false });
    const ts = await M.EmailThread.create({ business_id: biz.id, account_id: shared.id, subject: '[ha] shared' }, { hooks: false });
    const g = await call(B, 'GET', `/api/sale/${biz.id}/consults/email_thread/${tp.id}/notes`);
    expect(g, 404, 'B → A 개인 메일 스레드 메모 읽기');
    const p = await call(B, 'POST', `/api/sale/${biz.id}/consults/email_thread/${tp.id}/notes`, { body: 'x' });
    expect(p, 404, 'B → A 개인 메일 스레드 메모 쓰기');
    expect(await call(B, 'GET', `/api/sale/${biz.id}/consults/email_thread/${ts.id}/notes`), 200, 'B → 공용 계정 스레드(대조군)');
    expect(await call(A, 'GET', `/api/sale/${biz.id}/consults/email_thread/${tp.id}/notes`), 200, 'A → 자기 개인 스레드(대조군)');
    return 'B→A 개인 스레드 GET/POST 404 · 공용 스레드 B 200 · 본인 A 200';
  },

  // ─── C-8 clientsmenu ───
  async clientsmenu() {
    const { biz, B } = await makeWorld();
    const setLevel = async (level) => {
      await M.BusinessMemberPermission.destroy({ where: { business_id: biz.id, user_id: B.id, menu_key: 'clients' } });
      if (level) await M.BusinessMemberPermission.create({ business_id: biz.id, user_id: B.id, menu_key: 'clients', level });
    };
    await setLevel('none');
    const n = await call(B, 'GET', `/api/clients/${biz.id}`);
    expect(n, 403, 'none → 목록');
    assert(n.data.code === 'forbidden_menu_hidden', `코드 ${n.data.code}`);
    await setLevel('read');
    expect(await call(B, 'GET', `/api/clients/${biz.id}`), 200, 'read → 목록');
    const w = await call(B, 'POST', `/api/clients/${biz.id}/invite`, {});
    expect(w, 403, 'read → 초대');
    assert(w.data.code === 'forbidden_read_only', `코드 ${w.data.code}`);
    await setLevel(null);
    expect(await call(B, 'GET', `/api/clients/${biz.id}`), 200, '기본(write) → 목록(대조군)');
    const w2 = await call(B, 'POST', `/api/clients/${biz.id}/invite`, {});
    assert(w2.status !== 403, `기본(write) 인데 초대가 403: ${w2.raw.slice(0, 120)}`);
    return `none 403 forbidden_menu_hidden · read GET 200 / 초대 403 forbidden_read_only · 기본 GET 200 / 초대 ${w2.status}(메뉴 통과)`;
  },

  // ─── C-5 wiki: 이미지 서빙은 정확한 file_id 만 ───
  async wikiimg() {
    // 앞자리가 같은 두 파일(P 와 P·10+d)이 둘 다 디스크에 있어야 옛 LIKE 결함이 «200» 으로 드러난다(양성 조건).
    const [rows] = await sequelize.query("SELECT id, file_path FROM files WHERE deleted_at IS NULL AND file_path IS NOT NULL AND file_path <> '' ORDER BY id DESC LIMIT 20000");
    const onDisk = new Map();
    for (const r of rows) if (r.file_path && fs.existsSync(r.file_path)) onDisk.set(Number(r.id), r.file_path);
    let X = null; let P = null;
    for (const id of onDisk.keys()) {
      const p = Math.floor(id / 10);
      if (p >= 10 && onDisk.has(p)) { X = id; P = p; break; }
    }
    assert(X, '앞자리가 같은 디스크 파일 쌍을 못 찾았다 — 양성 조건을 만들 수 없다');
    const art = await M.HelpArticle.create({
      slug: `ha-${stamp}`, category_id: 1, title_ko: '[ha]', title_en: '[ha]', is_published: true,
      body_ko: [{ type: 'image', file_id: X, caption: 'c' }], body_en: [],
    }, { hooks: false });
    cleanups.push(() => M.HelpArticle.destroy({ where: { id: art.id }, force: true }));
    const bad = await fetch(`${BACKEND}/api/wiki/image/${P}`);
    assert(bad.status === 404, `앞자리 id ${P} 가 ${bad.status} — 다른 파일을 무인증으로 내준다`);
    const good = await fetch(`${BACKEND}/api/wiki/image/${X}`);
    assert(good.status === 200, `참조된 id ${X} 가 ${good.status}(대조군)`);
    return `참조 ${X} → 200 · 앞자리 ${P}(디스크에 있음) → 404`;
  },

  // ─── 0-D retention: 휴지통 하한 30일 — 값(plans.js)과 래칫(resolveRetention) 두 겹 ───
  async trash_floor() {
    const { PLANS } = require(`${BE}/config/plans`);
    const { resolveRetention, TRASH_MIN_DAYS } = require(`${BE}/services/retentionPolicy`);
    assert(TRASH_MIN_DAYS === 30, `TRASH_MIN_DAYS=${TRASH_MIN_DAYS}`);
    const low = Object.entries(PLANS).filter(([, p]) => !(p.limits && p.limits.trash_retention_days >= 30)).map(([k, p]) => `${k}=${p.limits && p.limits.trash_retention_days}`);
    assert(!low.length, `30일 미만 플랜: ${low.join(', ')}`);
    const { biz } = await makeWorld();
    await biz.update({ plan: 'free' });
    const r = await resolveRetention(biz.id, 'trash');
    assert(r.ok && r.days >= 30, `free 워크스페이스 resolveRetention ${JSON.stringify(r)}`);
    // 래칫 — plans.js 값이 다시 7 로 내려가도 지우는 쪽은 30 아래로 안 간다(같은 프로세스 안에서 값만 바꿔 본다)
    const orig = PLANS.free.limits.trash_retention_days;
    PLANS.free.limits.trash_retention_days = 7;
    let r7;
    try { r7 = await resolveRetention(biz.id, 'trash'); } finally { PLANS.free.limits.trash_retention_days = orig; }
    assert(r7.ok && r7.days >= 30, `plans.js 가 7 이면 resolveRetention 이 ${r7.days} — 래칫 없음`);
    return `전 플랜 ≥30 · free 워크스페이스 ${r.days}일 · plans 7 로 내려도 ${r7.days}일(래칫)`;
  },

  // ─── 0-D retention: 문서·정보 휴지통 회차가 만료 행을 지운다 · 라우트와 같은 함수 ───
  async content_purge() {
    const { runContentTrashPurge } = require(`${BE}/services/contentTrash`);
    const { biz, A } = await makeWorld();
    await biz.update({ plan: 'free' });
    const now = Date.now();
    const oldP = await makePost(biz, A, 'L3');
    const oldK = await makeKb(biz, A, 'L3');
    const newP = await makePost(biz, A, 'L3');
    const newK = await makeKb(biz, A, 'L3');
    await sequelize.query('UPDATE posts SET deleted_at = ?, purge_after = ? WHERE id = ?', { replacements: [new Date(now - 400 * DAY), new Date(now - DAY), oldP.id] });
    await sequelize.query('UPDATE kb_documents SET deleted_at = ?, purge_after = ? WHERE id = ?', { replacements: [new Date(now - 400 * DAY), new Date(now - DAY), oldK.id] });
    await sequelize.query('UPDATE posts SET deleted_at = ?, purge_after = ? WHERE id = ?', { replacements: [new Date(now - DAY), new Date(now + 29 * DAY), newP.id] });
    await sequelize.query('UPDATE kb_documents SET deleted_at = ?, purge_after = ? WHERE id = ?', { replacements: [new Date(now - DAY), new Date(now + 29 * DAY), newK.id] });
    // 리포트 모드(기본 플래그 꺼짐)는 지우지 않는다
    const rep = await runContentTrashPurge(new Date(), { onlyBusinessIds: [biz.id] });
    if (process.env.CONTENT_TRASH_PURGE_APPLY !== '1') {
      assert(rep.mode === 'report' && rep.would_remove === 2 && rep.removed === 0, `리포트 모드 ${JSON.stringify(rep)}`);
    }
    const stillAfterReport = await M.Post.findByPk(oldP.id, { paranoid: false });
    if (process.env.CONTENT_TRASH_PURGE_APPLY !== '1') assert(stillAfterReport, '리포트 모드인데 행이 지워졌다');
    const r = await runContentTrashPurge(new Date(), { apply: true, onlyBusinessIds: [biz.id] });
    const [p1, k1, p2, k2] = await Promise.all([
      M.Post.findByPk(oldP.id, { paranoid: false }), M.KbDocument.findByPk(oldK.id, { paranoid: false }),
      M.Post.findByPk(newP.id, { paranoid: false }), M.KbDocument.findByPk(newK.id, { paranoid: false }),
    ]);
    assert(!p1 && !k1, `만료 행이 남았다 post=${!!p1} kb=${!!k1} (${JSON.stringify(r)})`);
    assert(p2 && k2, '아직 안 만료된 행(1일 전 삭제)이 지워졌다(음성 대조군)');
    const [[{ n }]] = await sequelize.query("SELECT COUNT(*) n FROM audit_logs WHERE business_id = ? AND action IN ('post.purge','kb.document_purge') AND target_id IN (?, ?)", { replacements: [biz.id, oldP.id, oldK.id] });
    assert(Number(n) === 2, `감사 행 ${n} (기대 2)`);
    const src = fs.readFileSync(`${BE}/routes/content_trash.js`, 'utf8');
    assert(!/destroy\(\{\s*force:\s*true/.test(src), 'routes/content_trash.js 가 영구삭제를 직접 한다 — cron 과 갈라진다');
    assert(src.includes('purgeContentRow'), 'routes/content_trash.js 가 purgeContentRow 를 안 쓴다');
    return `리포트 모드 would_remove ${rep.would_remove}·삭제 0 → 적용: 만료 2건 삭제 + 감사 2행 · 1일 전 삭제분 유지 · 라우트=같은 함수`;
  },

  // ─── 0-E me: /me 에 menu_levels · 권한 변경 신호 ───
  async me_menu() {
    const { biz, O, B } = await makeWorld();
    const m0 = await call(B, 'GET', '/api/auth/me');
    expect(m0, 200, 'B /me');
    const lv0 = m0.data.data && m0.data.data.menu_levels;
    assert(lv0 && lv0.qmail === 'write', `기본 menu_levels.qmail=${lv0 && lv0.qmail} (기대 write)`);
    // 소켓 — B 의 user 방에 permissions:updated 가 오는가
    const { io } = require(require.resolve('socket.io-client', { paths: ['/opt/planq/dev-frontend/node_modules'] }));
    const sock = io(BACKEND, { auth: { token: B.token }, transports: ['websocket'], reconnection: false });
    const got = [];
    await new Promise((res, rej) => { sock.on('connect', res); sock.on('connect_error', rej); setTimeout(() => rej(new Error('socket 시간 초과')), 8000); });
    sock.on('permissions:updated', (p) => got.push(p));
    await new Promise((r) => setTimeout(r, 400));
    try {
      const put = await call(O, 'PUT', `/api/businesses/${biz.id}/members/${B.id}/permissions`, { menu_key: 'qmail', level: 'none' });
      expect(put, 200, '오너가 B qmail=none');
      for (let i = 0; i < 20 && !got.length; i++) await new Promise((x) => setTimeout(x, 150));
      assert(got.length && Number(got[0].business_id) === biz.id && Object.keys(got[0]).join(',') === 'business_id', `permissions:updated 신호 ${JSON.stringify(got)}`);
    } finally { sock.close(); }
    const m1 = await call(B, 'GET', '/api/auth/me');
    assert(m1.data.data.menu_levels.qmail === 'none', `none 반영 안 됨: ${m1.data.data.menu_levels.qmail}`);
    const mo = await call(O, 'GET', '/api/auth/me');
    assert(mo.data.data.menu_levels && mo.data.data.menu_levels.qmail === 'write', '오너는 전부 write 여야 한다(대조군)');
    return `B 기본 write → none 반영 · 신호 {business_id} 수신 · 오너 write`;
  },

  // ─── 0-E admin: 채팅 관리 판정 owner·admin 한 함수 ───
  async admin_chat() {
    const { biz, A, B } = await makeWorld();
    await M.BusinessMember.update({ role: 'admin' }, { where: { business_id: biz.id, user_id: A.id } });
    const mk = async () => {
      const c = await M.Conversation.create({ business_id: biz.id, title: `[ha] conv ${stamp}`, status: 'active' }, { hooks: false });
      for (const u of [A, B]) await M.ConversationParticipant.create({ conversation_id: c.id, user_id: u.id, role: 'member' }, { hooks: false });
      return c;
    };
    const c1 = await mk();
    expect(await call(B, 'POST', `/api/conversations/${biz.id}/${c1.id}/archive`), 403, '멤버 B 보관(대조군)');
    expect(await call(A, 'POST', `/api/conversations/${biz.id}/${c1.id}/archive`), 200, '관리자 A 보관');
    const c2 = await mk();
    const rB = await call(B, 'DELETE', `/api/conversations/${biz.id}/${c2.id}/participants/${A.id}`);
    expect(rB, 403, '멤버 B 가 A 내보내기');
    assert(rB.data.message === 'self_or_admin_only', `거절 코드 ${rB.data.message}`);
    expect(await call(A, 'DELETE', `/api/conversations/${biz.id}/${c2.id}/participants/${B.id}`), 200, '관리자 A 가 B 내보내기');
    return '관리자 보관 200 · 멤버 403 · 관리자 내보내기 200 · 멤버 403 self_or_admin_only';
  },

  // ─── 0-F invite 1: 기존 계정 멤버 초대 수락 → 활성 워크스페이스가 바뀐다 ───
  async invite_land() {
    const X = await makeWorld();
    const Y = await makeWorld();
    const B = X.B;
    const tok = `ha${crypto.randomBytes(16).toString('hex')}`;
    const tokOld = `ha${crypto.randomBytes(16).toString('hex')}`;
    await M.BusinessMember.create({ business_id: Y.biz.id, user_id: null, role: 'member', invite_token: tokOld, invite_email: B.email, invited_at: new Date(Date.now() - 40 * DAY) });
    const old = await call(B, 'POST', `/api/invites/${tokOld}/accept`);
    expect(old, 410, '만료 초대 수락(음성 대조군)');
    let u = await M.User.findByPk(B.id);
    assert(u.active_business_id === X.biz.id, `만료 거절 뒤 active ${u.active_business_id} (기대 ${X.biz.id})`);
    const bm = await M.BusinessMember.create({ business_id: Y.biz.id, user_id: null, role: 'member', invite_token: tok, invite_email: B.email, invited_at: new Date() });
    const r = await call(B, 'POST', `/api/invites/${tok}/accept`);
    expect(r, 200, '초대 수락');
    assert(r.data.data.business_id === Y.biz.id, `응답 business_id ${r.data.data.business_id}`);
    u = await M.User.findByPk(B.id);
    assert(u.active_business_id === Y.biz.id, `users.active_business_id ${u.active_business_id} (기대 ${Y.biz.id})`);
    const me = await call(B, 'GET', '/api/auth/me');
    assert(me.data.data.business_id === Y.biz.id, `/me business_id ${me.data.data.business_id}`);
    const again = await call(B, 'POST', `/api/invites/${tok}/accept`);
    expect(again, 200, '같은 사람 재수락(멱등)');
    assert(again.data.data.already === true, '재수락이 already 가 아니다');
    const other = await call(X.A, 'POST', `/api/invites/${tok}/accept`);
    expect(other, 400, '다른 사람이 이미 수락된 초대');
    const row = await M.BusinessMember.findByPk(bm.id);
    assert(row.user_id === B.id && row.joined_at, '멤버십 행이 B 로 안 붙었다');
    return '만료 410·active 그대로 → 수락 200·active=Y·/me=Y · 본인 재수락 already · 남 400';
  },

  // ─── 0-F invite 2: 초대 모드 OAuth 신규 가입은 워크스페이스를 만들지 않는다 ───
  async invite_oauth() {
    const Y = await makeWorld();
    const tok = `ha${crypto.randomBytes(16).toString('hex')}`;
    await M.BusinessMember.create({ business_id: Y.biz.id, user_id: null, role: 'member', invite_token: tok, invite_email: `x-${stamp}@hm.invalid`, invited_at: new Date() });
    const { finishOauthLogin } = require(`${BE}/routes/oauth/finish`);
    const run = async (tag, redirect) => {
      const email = `ha-${stamp}-${tag}@hm.invalid`;
      const req = {
        headers: { 'accept-language': 'ko-KR', 'user-agent': 'health-access' }, body: {}, query: {}, cookies: {},
        ip: '127.0.0.1', protocol: 'https', secure: false,
        get: (h) => ({ 'user-agent': 'health-access', host: 'localhost' })[String(h).toLowerCase()] || '',
        app: { get: () => null },
      };
      let target = null;
      const res = { req, cookie() {}, clearCookie() {}, redirect(a, b) { target = b === undefined ? a : b; return this; }, status() { return this; }, json() { return this; }, send() { return this; }, set() { return this; } };
      const before = (await sequelize.query('SELECT COUNT(*) n FROM businesses'))[0][0].n;
      await finishOauthLogin(req, res, { provider: 'google', profile: { subject: `ha-${stamp}-${tag}`, email, name: `ha ${tag}` }, native: false, pairId: null, logTag: 'health-access', redirect });
      const after = (await sequelize.query('SELECT COUNT(*) n FROM businesses'))[0][0].n;
      const user = await M.User.findOne({ where: { email } });
      if (user) {
        madeUsers.push(user.id);
        const owned = await M.Business.findAll({ where: { owner_id: user.id }, attributes: ['id', 'cue_user_id'] });
        for (const b of owned) { madeBiz.push(b.id); if (b.cue_user_id) madeUsers.push(b.cue_user_id); }
      }
      return { target, delta: Number(after) - Number(before), user };
    };
    const inv = await run('inv', `/invite/${tok}`);
    assert(inv.user, '초대 모드 가입 사용자가 없다');
    assert(inv.delta === 0, `초대 모드 가입이 워크스페이스를 ${inv.delta}개 만들었다`);
    assert(inv.target === `/invite/${tok}`, `착지 ${inv.target}`);
    const bm = await M.BusinessMember.findOne({ where: { invite_token: tok } });
    assert(bm && bm.user_id === inv.user.id, '초대 멤버십에 새 사용자가 안 붙었다');
    const u = await M.User.findByPk(inv.user.id);
    assert(u.active_business_id === Y.biz.id, `active ${u.active_business_id} (기대 ${Y.biz.id})`);
    const ctl = await run('ctl', null);
    assert(ctl.delta === 1 && ctl.target === '/inbox', `대조군 — redirect 없으면 워크스페이스 +1·/inbox 여야: +${ctl.delta} ${ctl.target}`);
    return `초대 모드: 워크스페이스 +0 · 멤버십 연결 · active=초대 워크스페이스 · 착지 /invite/… | 대조군: +1 · /inbox`;
  },

  // ─── 0-F invite 3: state 가 redirect 를 나른다 · 열린 리다이렉트 차단 ───
  async invite_state() {
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'health-access-dummy';
    const g = require(`${BE}/services/google_oauth_login`);
    const { safeRedirectPath, buildRedirectTarget } = require(`${BE}/routes/oauth/core`);
    const { url } = await g.buildAuthUrl(null, { redirect: '/invite/abcdefghijklmnop' });
    const st = new URL(url).searchParams.get('state');
    const e = await g.consumeStateEntry(st);
    assert(e && e.redirect === '/invite/abcdefghijklmnop', `state 가 redirect 를 안 나른다: ${JSON.stringify(e)}`);
    const bad = ['//evil.com', 'https://x', '/login', '/register', '/a b', 'javascript:alert(1)', '/x\\y'];
    const leaked = bad.filter((v) => safeRedirectPath(v) !== null);
    assert(!leaked.length, `열린 리다이렉트 통과: ${leaked.join(' ')}`);
    assert(buildRedirectTarget({ ok: true, redirect: '//evil.com' }) === '/inbox', '착지 함수가 바깥 주소로 보낸다');
    assert(buildRedirectTarget({ ok: true, redirect: '/public/files/x' }) === '/public/files/x', '정상 상대경로가 버려진다(대조군)');
    return `state.redirect 왕복 · 음성 ${bad.length}종 null · 착지 함수 차단/통과`;
  },

  // ─── 0-F invite 4: 초대 메일 실패가 응답에 보인다 ───
  async invite_mail() {
    const { biz, O } = await makeWorld();
    const express = require(`${BE}/node_modules/express`);
    const app = express(); app.use(express.json()); app.set('io', null);
    app.use('/api/clients', require(`${BE}/routes/clients`));
    app.use((err, req, res, next) => { res.status(500).json({ success: false, message: err.message }); });   // eslint-disable-line no-unused-vars
    const srv = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
    const base = `http://127.0.0.1:${srv.address().port}`;
    const post = async (email) => {
      const res = await fetch(`${base}/api/clients/${biz.id}/invite`, { method: 'POST', headers: { Authorization: `Bearer ${O.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '[ha] 고객', email }) });
      return { status: res.status, data: await res.json() };
    };
    const emailService = require(`${BE}/services/emailService`);
    const orig = emailService.sendInviteEmail;
    try {
      const f = await post(`fail-${stamp}@hm.invalid`);   // 예약 TLD — sendEmail 이 보내지 않고 false 를 돌려준다(실패 경로)
      assert(f.status === 201 && f.data.data && f.data.data.invite_email_sent === false, `실패 경로 ${f.status} ${JSON.stringify(f.data).slice(0, 160)}`);
      assert(!JSON.stringify(f.data).includes('invite_token'), '응답에 초대 토큰');
      emailService.sendInviteEmail = async () => true;   // 대조군 — 발송 성공을 흉내(외부 발송 없음)
      const ok = await post(`ok-${stamp}@hm.invalid`);
      assert(ok.status === 201 && ok.data.data.invite_email_sent === true, `성공 경로 ${ok.status} ${JSON.stringify(ok.data).slice(0, 160)}`);
      return '보내지 못함 → invite_email_sent:false (201, 토큰 없음) · 보냄 → true(대조군)';
    } finally { emailService.sendInviteEmail = orig; srv.close(); }
  },
};

(async () => {
  let result;
  try {
    if (!cases[CASE]) throw new Error(`알 수 없는 케이스 ${CASE}`);
    if (!BACKEND) throw new Error('인자 부족(backend)');
    const detail = await cases[CASE]();
    result = { ok: true, detail };
  } catch (e) {
    result = { ok: false, error: e.message };
  } finally {
    for (const fn of cleanups.reverse()) { try { await fn(); } catch (e) { result.cleanup_error = e.message; } }
    for (const id of madeBiz) {
      try { await dropBiz(id); } catch (e) { result = result || {}; result.cleanup_error = `${id}: ${e.message}`; }
    }
    try { await dropUsers(madeUsers); } catch (e) { result.cleanup_error = `users: ${e.message}`; }
  }
  process.stdout.write(`\n@@${JSON.stringify(result)}\n`);
  setTimeout(() => process.exit(0), 300);
})();
