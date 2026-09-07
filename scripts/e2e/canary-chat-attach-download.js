// canary-chat-attach-download — 채팅 첨부는 **저장소가 어디든** 열려야 한다 (2026-09-07)
//
//   Irene: "채팅에 이 첨부된 파일들 미리보기도 안돼." (PDF 1 · PNG 2)
//
//   근본원인: `GET /api/message-attachments/:id/download` 이 **로컬 디스크만** 봤다.
//   Drive 에 저장된 첨부는 file_path 에 Drive 파일 ID 가 들어 있어서 `fs.existsSync` 가
//   언제나 거짓 → 전부 404 `file_missing`. 미리보기도 이 라우트로 본문을 받으므로
//   화면에서는 "눌러도 아무 일이 없다" 로 보인다(운영 실측: 첨부 #36 PDF).
//
//   계약 두 줄 — 양성/음성 대조군을 같이 잰다:
//     ① 로컬(planq) 첨부 → 200 + 바이트 일치        (고치면서 깨뜨리지 않았는가)
//     ② Drive(gdrive) 첨부 → **404 file_missing 이 아니다**
//        (저장소 분기를 탔다는 증거. Drive 토큰이 없는 환경에서는 409 drive_not_connected 가 정상)
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const fs = require('fs');
const path = require('path');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');

const API = process.env.E2E_API || 'http://localhost:3003';
const BIZ = 5;
const BODY = 'planq chat attachment canary\n';

async function login(email, password) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  const tok = j?.data?.token || j?.data?.accessToken;
  if (!tok) throw new Error('login failed: ' + JSON.stringify(j).slice(0, 120));
  return tok;
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  // 만든 것만 지운다 — 무엇을 만들었는지 기억해 두지 않으면 정리가 조용히 새어나간다.
  const created = { userId: null, convId: null, msgId: null, attIds: [], localFile: null };
  try {
    const stamp = Date.now();
    const cred = { email: `cad-canary-${stamp}@test.planq.kr`, password: 'ChatAttachDl2026!' };
    const hash = await bcrypt.hash(cred.password, 12);
    const [uid] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role, terms_accepted_at, privacy_accepted_at, created_at, updated_at)
       VALUES (?, ?, 'ChatAttach Canary', ?, 'user', NOW(), NOW(), NOW(), NOW())`,
      { replacements: [cred.email, hash, `cadcan${stamp}`] });
    created.userId = uid;
    await sequelize.query(
      "INSERT INTO business_members (business_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'member', NOW(), NOW())",
      { replacements: [BIZ, uid] });

    const [convId] = await sequelize.query(
      "INSERT INTO conversations (business_id, title, created_at, updated_at) VALUES (?, ?, NOW(), NOW())",
      { replacements: [BIZ, `chat-attach 카나리 ${stamp}`] });
    created.convId = convId;
    await sequelize.query(
      'INSERT INTO conversation_participants (conversation_id, user_id, created_at) VALUES (?, ?, NOW())',
      { replacements: [convId, uid] });
    const [msgId] = await sequelize.query(
      "INSERT INTO messages (conversation_id, sender_id, content, created_at, updated_at) VALUES (?, ?, '카나리', NOW(), NOW())",
      { replacements: [convId, uid] });
    created.msgId = msgId;

    // ① 로컬 첨부 — 진짜 바이트를 디스크에 둔다(빈 fixture 로 "0건=정상" 을 만들지 않는다)
    const dir = path.join('/opt/planq/dev-backend/uploads', String(BIZ), 'canary');
    fs.mkdirSync(dir, { recursive: true });
    const localAbs = path.join(dir, `cad-${stamp}.txt`);
    fs.writeFileSync(localAbs, BODY);
    created.localFile = localAbs;
    const [localAttId] = await sequelize.query(
      `INSERT INTO message_attachments (message_id, file_name, file_path, file_size, mime_type, storage_provider, created_at)
       VALUES (?, ?, ?, ?, 'text/plain', 'planq', NOW())`,
      { replacements: [msgId, `cad-${stamp}.txt`, localAbs, Buffer.byteLength(BODY)] });
    created.attIds.push(localAttId);

    // ② Drive 첨부 — file_path 에 Drive 파일 ID 가 들어 있는 운영과 같은 모양
    const [driveAttId] = await sequelize.query(
      `INSERT INTO message_attachments (message_id, file_name, file_path, file_size, mime_type, storage_provider, external_id, created_at)
       VALUES (?, ?, ?, 1024, 'application/pdf', 'gdrive', ?, NOW())`,
      { replacements: [msgId, `cad-${stamp}.pdf`, `1CanaryDriveId${stamp}`, `1CanaryDriveId${stamp}`] });
    created.attIds.push(driveAttId);

    const token = await login(cred.email, cred.password);
    const get = (id) => fetch(`${API}/api/message-attachments/${id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const rLocal = await get(localAttId);
    const bodyLocal = await rLocal.text();
    push('로컬(planq) 첨부는 그대로 내려온다',
      rLocal.status === 200 && bodyLocal === BODY,
      `status=${rLocal.status} · ${bodyLocal.length}바이트 (기대 200 · ${BODY.length}바이트)`);

    const rDrive = await get(driveAttId);
    const jDrive = await rDrive.json().catch(() => ({}));
    const msg = String(jDrive.message || jDrive.error || '');
    const isOldBug = rDrive.status === 404 && msg.includes('file_missing');
    push('Drive 첨부는 저장소 분기를 탄다 (404 file_missing 이 아니다)',
      !isOldBug,
      `status=${rDrive.status} · "${msg}" — 404 file_missing 이면 로컬 디스크만 본 옛 코드다`);
  } catch (e) {
    push('카나리 실행', false, String((e && e.message) || e));
  } finally {
    for (const id of created.attIds) {
      await sequelize.query('DELETE FROM message_attachments WHERE id = ?', { replacements: [id] }).catch(() => {});
    }
    if (created.msgId) await sequelize.query('DELETE FROM messages WHERE id = ?', { replacements: [created.msgId] }).catch(() => {});
    if (created.convId) {
      await sequelize.query('DELETE FROM conversation_participants WHERE conversation_id = ?', { replacements: [created.convId] }).catch(() => {});
      await sequelize.query('DELETE FROM conversations WHERE id = ?', { replacements: [created.convId] }).catch(() => {});
    }
    if (created.userId) {
      await sequelize.query('DELETE FROM business_members WHERE user_id = ?', { replacements: [created.userId] }).catch(() => {});
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [created.userId] }).catch(() => {});
    }
    if (created.localFile) { try { fs.unlinkSync(created.localFile); } catch { /* 이미 없음 */ } }
  }
  return results;
}

module.exports = { run };
