// canary-file-index — Cue 가 **파일 내용으로** 답할 수 있는가 (2026-09-08)
//
//   Irene(세 번 요청): "cue가 파일들 검토해서 답변주고 파일도 찾아서 알려주는 것도 되어야 하는 거 아니야?
//                     워크스페이스에 최적화된 모든 걸 아는 직원이어야지"
//
//   여태 Cue 는 **파일 이름이 질문과 겹칠 때만** 본문을 읽었다. 이름을 모르면 못 찾고,
//   내용으로는 아예 못 찾았다. 업로드 시 본문을 색인해(kb_documents source_type='file')
//   hybridSearch 가 찾게 했다.
//
//   여기서 재는 계약 넷 — 세 번째·네 번째가 **음성 대조군**이다:
//     ① 일반 파일은 색인되고, 본문에만 있는 낱말로 **검색에 잡힌다**
//     ② 파일을 지우면 색인도 걷힌다 (목록에서 지운 것이 답변에 남으면 지운 게 아니다)
//     ③ 기밀(security_level≠general)·개인(L1) 파일은 **색인되지 않는다**
//     ④ 다른 워크스페이스에서는 그 내용이 검색되지 않는다 (business_id 격리)
//     ⑤ 자동 색인분은 Q info **목록에 안 나온다** (수백 건이 도배되면 그게 다음 신고다)
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const fs = require('fs');
const path = require('path');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const { File, KbDocument } = require('/opt/planq/dev-backend/models');
const fileIndex = require('/opt/planq/dev-backend/services/fileIndex');
const kbService = require('/opt/planq/dev-backend/services/kb_service');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');

const API = process.env.E2E_API || 'http://localhost:3003';

const BIZ = 5;
const OTHER_BIZ = 1;
// 본문에만 있고 **파일 이름에는 없는** 낱말이어야 한다 — 이름으로 찾은 것과 구별되지 않으면
//   이 카나리는 옛 동작에서도 초록이 된다(그러면 아무것도 증명하지 못한다).
const NEEDLE = `제니퍼호루스탄젤${Date.now().toString(36)}`;

async function seedFile(businessId, { security_level = 'general', vlevel = 'L3', name }) {
  const dir = path.join('/opt/planq/dev-backend/uploads', String(businessId), 'canary');
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, `이 문서의 담당 코드명은 ${NEEDLE} 이며 2026년 정산 기준을 설명한다.\n`);
  const f = await File.create({
    business_id: businessId, file_name: name, file_path: abs,
    file_size: fs.statSync(abs).size, mime_type: 'text/plain',
    storage_provider: 'planq', uploader_id: 5, vlevel, security_level,
  });
  return { file: f, abs };
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  const made = [];
  let tmpUserId = null;
  try {
    const stamp = Date.now();
    const normal = await seedFile(BIZ, { name: `fi-normal-${stamp}.txt` });
    const secret = await seedFile(BIZ, { name: `fi-secret-${stamp}.txt`, security_level: 'confidential' });
    const personal = await seedFile(BIZ, { name: `fi-personal-${stamp}.txt`, vlevel: 'L1' });
    made.push(normal, secret, personal);

    const rNormal = await fileIndex.indexFile(normal.file.id);
    const rSecret = await fileIndex.indexFile(secret.file.id);
    const rPersonal = await fileIndex.indexFile(personal.file.id);

    push('일반 파일은 색인된다',
      rNormal.indexed === true && !!rNormal.doc_id,
      `${JSON.stringify(rNormal)}`);

    // ③ 음성 대조군 — 색인하면 안 되는 것들
    push('기밀 파일은 색인하지 않는다',
      rSecret.indexed === false && rSecret.reason === 'restricted',
      `${JSON.stringify(rSecret)} (reason 이 restricted 여야 한다)`);
    push('개인(L1) 파일은 색인하지 않는다',
      rPersonal.indexed === false && rPersonal.reason === 'personal',
      `${JSON.stringify(rPersonal)} — hybridSearch 스코프에 private 가 없어 넣어도 안 읽힌다`);

    // 임베딩은 백그라운드다. 여기서는 **본문 LIKE 폴백**으로 검색되는지를 잰다
    //   (OPENAI 키가 없는 환경에서도 판정이 성립해야 한다).
    await kbService.indexDocument(rNormal.doc_id).catch(() => {});

    // ① 본문에만 있는 낱말로 잡히는가
    const hit = await kbService.hybridSearch(BIZ, NEEDLE, { limit: 5 });
    const fromFile = (hit.kb_chunks || []).filter((c) => c.source_type === 'file' && c.document_id === rNormal.doc_id);
    push('이름이 아니라 **내용**으로 파일이 검색된다',
      fromFile.length > 0,
      `kb 청크 ${(hit.kb_chunks || []).length}건 중 이 파일 ${fromFile.length}건 — 0 이면 내용 검색이 안 되는 것`);

    // ④ 음성 대조군 — 다른 워크스페이스에서는 안 보인다
    const other = await kbService.hybridSearch(OTHER_BIZ, NEEDLE, { limit: 5 });
    const leaked = (other.kb_chunks || []).filter((c) => c.document_id === rNormal.doc_id);
    push('다른 워크스페이스에서는 검색되지 않는다 (격리)',
      leaked.length === 0,
      `타 워크스페이스 결과에 ${leaked.length}건 — 0 이어야 한다`);

    // ⑤ Q info 목록에 자동 색인분이 섞이지 않는가 — 실 HTTP 로 본다
    try {
      const cred = { email: `fi-canary-${stamp}@test.planq.kr`, password: 'FileIndexCanary2026!' };
      const [uid] = await sequelize.query(
        `INSERT INTO users (email, password_hash, name, username, platform_role, terms_accepted_at, privacy_accepted_at, created_at, updated_at)
         VALUES (?,?,'FileIndex Canary',?,'user',NOW(),NOW(),NOW(),NOW())`,
        { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `ficn${stamp}`] });
      tmpUserId = uid;
      await sequelize.query("INSERT INTO business_members (business_id,user_id,role,created_at,updated_at) VALUES (?,?,'member',NOW(),NOW())",
        { replacements: [BIZ, uid] });
      const lr = await fetch(`${API}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cred),
      });
      const lj = await lr.json();
      const token = lj?.data?.token || lj?.data?.accessToken;
      const listR = await fetch(`${API}/api/businesses/${BIZ}/kb/documents?limit=2000`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const listJ = await listR.json();
      const rows = Array.isArray(listJ?.data) ? listJ.data : [];
      const shown = rows.some((d) => d.id === rNormal.doc_id);
      push('자동 색인분은 Q info 목록에 안 나온다',
        listR.status === 200 && !shown,
        `status=${listR.status} · 목록 ${rows.length}건 중 이 문서 노출 ${shown ? '됨' : '안 됨'} — 노출되면 파일로 도배된다`);

      const listR2 = await fetch(`${API}/api/businesses/${BIZ}/kb/documents?limit=2000&include_auto=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const listJ2 = await listR2.json();
      const rows2 = Array.isArray(listJ2?.data) ? listJ2.data : [];
      push('양성 대조군 — include_auto=1 이면 보인다',
        rows2.some((d) => d.id === rNormal.doc_id),
        `include_auto 목록 ${rows2.length}건 — 여기서도 안 보이면 숨긴 게 아니라 못 만든 것이다`);
    } catch (e) {
      push('Q info 목록 검사', false, String((e && e.message) || e));
    }

    // ② 지우면 색인도 걷힌다
    const removed = await fileIndex.removeFileIndex(normal.file.id, BIZ);
    const after = await KbDocument.findOne({
      where: { business_id: BIZ, source_type: 'file', source_file_id: normal.file.id },
    });
    push('파일을 지우면 색인도 걷힌다',
      removed >= 1 && !after,
      `걷은 문서 ${removed}건 · 남은 문서 ${after ? after.id : '없음'}`);
  } catch (e) {
    push('카나리 실행', false, String((e && e.message) || e));
  } finally {
    for (const m of made) {
      try {
        await fileIndex.removeFileIndex(m.file.id, m.file.business_id);
        await m.file.destroy({ force: true });
        fs.unlinkSync(m.abs);
      } catch { /* 이미 정리됨 */ }
    }
    if (tmpUserId) {
      await sequelize.query('DELETE FROM business_members WHERE user_id = ?', { replacements: [tmpUserId] }).catch(() => {});
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [tmpUserId] }).catch(() => {});
    }
  }
  return results;
}

module.exports = { run };
