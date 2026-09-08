// canary-qnote-cue — Cue 가 **내 회의록만** 읽는가 (2026-09-08)
//
//   Q Note 를 Cue 범위에 넣었다. 여기는 그 문이 **얼마나 좁은지**를 재는 곳이다.
//   Q Note 는 사적 공간이다(PERMISSION_MATRIX §5.8 · memory feedback_qnote_personal_tool) —
//   owner 도 admin 도 남의 노트를 못 본다. 그리고 Cue 답변은 **대화방으로 나가는 경로**가
//   따로 있다(cue_orchestrator). 그 경로로 개인 회의록이 흘러가면 되돌릴 수 없다.
//
//   여기서 재는 계약 — ②③④⑤가 전부 **음성 대조군**이다:
//     ① 본인 노트는 본문(요약) 낱말로 뜬다
//     ② **다른 사람**이 같은 낱말로 물으면 안 뜬다 (owner 여도)
//     ③ `personalScope` 기본값('none')이면 안 뜬다 — cue_orchestrator 가 타는 경로가 이것이다
//     ④ `audience='client_facing'` 이면 `personalScope='self'` 여도 안 뜬다 (문이 둘 다 열려야 한다)
//     ⑤ 다른 워크스페이스에서는 안 뜬다
//     ⑥ q-note 내부 엔드포인트는 키가 틀리면 401, user_id 가 다르면 그 사람 것만 준다
//     ⑦ 커버리지 문구가 거짓말하지 않는다 — 안 실은 턴에 "조회함" 이라고 말하지 않는다
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
const { getUserScope } = require('/opt/planq/dev-backend/middleware/access_scope');
const cueCtx = require('/opt/planq/dev-backend/services/cue_context');

const QNOTE_DB = '/opt/planq/q-note/data/qnote.db';
const QNOTE_BASE = process.env.QNOTE_INTERNAL_URL || 'http://localhost:8000';
const BIZ = 5;
const OTHER_BIZ = 1;

/** q-note SQLite 는 별도 서비스 소유다 — 카나리가 직접 쓰고 **반드시 지운다**. */
function qnoteExec(sql, params = []) {
  const sqlite3 = require('node:child_process');
  const script = `
import sqlite3, json, sys
c = sqlite3.connect(${JSON.stringify(QNOTE_DB)})
cur = c.execute(sys.argv[1], json.loads(sys.argv[2]))
rows = cur.fetchall()
c.commit()
print(json.dumps({ 'rows': rows, 'lastrowid': cur.lastrowid }))
`;
  const out = sqlite3.execFileSync('python3', ['-c', script, sql, JSON.stringify(params)], { encoding: 'utf-8' });
  return JSON.parse(out);
}

async function run() {
  const results = [];
  const push = (n, ok, m) => results.push({ name: n, fail: ok ? 0 : 1, details: [m] });
  const stamp = Date.now();
  // 본문(요약)에만 있고 제목에는 없는 낱말이어야 한다 — 제목으로 찾은 것과 구별되지 않으면
  //   이 카나리는 아무것도 증명하지 못한다.
  const NEEDLE = `노트카나리${stamp.toString(36)}`;
  let mineId = null; let otherId = null; let sessId = null; let crossSessId = null;
  try {
    const mk = async (tag) => {
      const email = `qnc-${tag}-${stamp}@test.planq.kr`;
      const [uid] = await sequelize.query(
        `INSERT INTO users (email, password_hash, name, username, platform_role, terms_accepted_at, privacy_accepted_at, created_at, updated_at)
         VALUES (?,?,?,?,'user',NOW(),NOW(),NOW(),NOW())`,
        { replacements: [email, await bcrypt.hash('QnoteCue2026!', 12), `QnoteCue ${tag}`, `qnc${tag}${stamp}`.slice(0, 30)] });
      // owner 로 넣는다 — "직급이 높으면 남의 노트가 보이는가" 를 같이 반증하기 위해서다.
      await sequelize.query("INSERT INTO business_members (business_id,user_id,role,created_at,updated_at) VALUES (?,?,'owner',NOW(),NOW())",
        { replacements: [BIZ, uid] });
      return uid;
    };
    mineId = await mk('mine');
    otherId = await mk('other');

    // 내 노트 하나 — 요약에만 NEEDLE
    sessId = qnoteExec(
      "INSERT INTO sessions (business_id, user_id, title, status, visibility, summary_full, created_at, updated_at) VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))",
      [BIZ, mineId, `카나리 회의 ${stamp}`, 'completed', 'L1', `이번 회의에서 정한 코드명은 ${NEEDLE} 이다. 다음 회의는 다음 주 화요일.`],
    ).lastrowid;
    // 다른 워크스페이스에 같은 낱말 — 격리 반증용
    crossSessId = qnoteExec(
      "INSERT INTO sessions (business_id, user_id, title, status, visibility, summary_full, created_at, updated_at) VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))",
      [OTHER_BIZ, mineId, `타 워크스페이스 회의 ${stamp}`, 'completed', 'L1', `여기서도 ${NEEDLE} 라고 부른다.`],
    ).lastrowid;

    const scopeMine = await getUserScope(mineId, BIZ);
    const scopeOther = await getUserScope(otherId, BIZ);
    const ask = (opts) => cueCtx.getWorkspaceMatches({
      businessId: BIZ, query: `${NEEDLE} 뭐였지`, audience: 'internal', personalScope: 'self', ...opts,
    });
    const noteIds = (m) => (m && m.notes ? m.notes.map((n) => n.id) : []);

    // ① 본인 노트는 뜬다
    const m1 = await ask({ scope: scopeMine, userId: mineId });
    push('① 내 회의록이 **요약 본문** 낱말로 뜬다',
      noteIds(m1).includes(sessId), `notes=${JSON.stringify(noteIds(m1))} (기대 ${sessId})`);

    // ② 음성 대조군 — 같은 워크스페이스 owner 라도 남의 노트는 안 뜬다
    const m2 = await ask({ scope: scopeOther, userId: otherId });
    push('② 다른 사람(owner)에게는 안 뜬다 — Q Note 는 사적 공간',
      !noteIds(m2).includes(sessId), `notes=${JSON.stringify(noteIds(m2))} — 비어 있어야 한다`);

    // ③ 음성 대조군 — personalScope 기본값이면 안 뜬다 (cue_orchestrator 경로)
    const m3 = await cueCtx.getWorkspaceMatches({
      businessId: BIZ, scope: scopeMine, userId: mineId, query: `${NEEDLE} 뭐였지`, audience: 'internal',
    });
    push('③ personalScope 기본값(none)이면 안 뜬다 — 대화방 경로 보호',
      !noteIds(m3).includes(sessId), `notes=${JSON.stringify(noteIds(m3))} — 비어 있어야 한다`);

    // ④ 음성 대조군 — 고객행 답변이면 personalScope='self' 여도 안 뜬다
    const m4 = await ask({ scope: scopeMine, userId: mineId, audience: 'client_facing' });
    push('④ 고객행(client_facing) 이면 안 뜬다 — 문이 둘 다 열려야 한다',
      !noteIds(m4).includes(sessId), `notes=${JSON.stringify(noteIds(m4))} — 비어 있어야 한다`);

    // ⑤ 음성 대조군 — 다른 워크스페이스에서는 안 뜬다
    const m5 = await cueCtx.getWorkspaceMatches({
      businessId: OTHER_BIZ, scope: scopeMine, userId: mineId,
      query: `${NEEDLE} 뭐였지`, audience: 'internal', personalScope: 'self',
    });
    push('⑤ 다른 워크스페이스에서는 이 노트가 안 뜬다 (격리)',
      !noteIds(m5).includes(sessId), `notes=${JSON.stringify(noteIds(m5))} — 비어 있어야 한다`);

    // ⑥ q-note 내부 엔드포인트 — 키·소유자
    const url = (uid) => `${QNOTE_BASE}/api/sessions/internal/search?business_id=${BIZ}&user_id=${uid}&q=${encodeURIComponent(NEEDLE)}`;
    const badKey = await fetch(url(mineId), { headers: { 'x-internal-api-key': 'wrong-key' } });
    const okKey = await fetch(url(mineId), { headers: { 'x-internal-api-key': process.env.INTERNAL_API_KEY } });
    const asOther = await fetch(url(otherId), { headers: { 'x-internal-api-key': process.env.INTERNAL_API_KEY } });
    const okJson = okKey.ok ? await okKey.json() : null;
    const otherJson = asOther.ok ? await asOther.json() : null;
    push('⑥ 내부 엔드포인트 — 키 틀리면 401 · user_id 가 다르면 0건',
      badKey.status === 401 && (okJson?.data || []).length >= 1 && (otherJson?.data || []).length === 0,
      `badKey=${badKey.status} · mine=${(okJson?.data || []).length} · other=${(otherJson?.data || []).length}`);

    // ⑦ 커버리지 문구가 거짓말하지 않는다
    const withNotes = cueCtx.composeMarkdown({ matches: m1 });
    const withoutNotes = cueCtx.composeMarkdown({ matches: m3 });
    push('⑦ 실었을 때만 "조회함" — 안 실은 턴엔 본인 노트뿐이라고 말한다',
      withNotes.includes('내 회의록') && !withoutNotes.includes('내 회의록('),
      `실음=${withNotes.includes('내 회의록')} · 안실음에 조회선언=${withoutNotes.includes('내 회의록(')}`);
  } catch (e) {
    push('카나리 실행', false, String((e && e.stack) || e).slice(0, 300));
  } finally {
    // ★ 남기면 다음 검사를 죽인다(memory: feedback_canary_pollutes_next_suite).
    for (const sid of [sessId, crossSessId]) {
      if (sid) { try { qnoteExec('DELETE FROM utterances WHERE session_id = ?', [sid]); qnoteExec('DELETE FROM sessions WHERE id = ?', [sid]); } catch { /* 이미 정리됨 */ } }
    }
    for (const uid of [mineId, otherId]) {
      if (uid) {
        await sequelize.query('DELETE FROM business_members WHERE user_id = ?', { replacements: [uid] }).catch(() => {});
        await sequelize.query('DELETE FROM refresh_tokens WHERE user_id = ?', { replacements: [uid] }).catch(() => {});
        await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [uid] }).catch(() => {});
      }
    }
  }
  return results;
}

module.exports = { run };
