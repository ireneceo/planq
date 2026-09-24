// scripts/e2e/lib/cleanup.js — 검사기가 만든 파일을 되돌린다. **단일 원천.**
//
// 왜: 카나리가 업로드해 놓고 안 지우면 워크스페이스에 쓰레기가 쌓인다.
//   실측 2026-09-02 — dev 에 `icon.png` 1033건(검사 계정)이 2026-05-26 부터 누적돼 있었다.
//   정리 코드는 canary-mail-image 에만 있었고, 베껴 쓰면 갈라지므로 여기 하나만 둔다.
//
// ★ soft delete 만으로는 바이트가 남는다(휴지통). purge 까지 불러야 되돌린 것이다.
const { BASE, CREDS } = require('./browser');

async function loginToken() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CREDS.email, password: CREDS.password }),
  });
  const j = await r.json().catch(() => ({}));
  return (j.data && (j.data.token || j.data.accessToken)) || null;
}

/**
 * 이름이 names 중 하나이고 since 이후에 만들어진 파일을 지운다(바이트까지).
 * @returns 러너 형태 한 줄 — 못 지웠으면 **실패로** 낸다(조용히 쌓이는 것이 지금까지의 문제였다).
 */
async function cleanupTestFiles(bizId, names, since) {
  const row = (fail, msg) => ({ name: 'cleanup', fail, details: [msg], hasCanary: true });
  try {
    const tok = await loginToken();
    if (!tok) return row(1, '🔴 원복용 로그인 실패 — 검사 파일이 남는다');
    const H = { Authorization: `Bearer ${tok}` };
    const r = await fetch(`${BASE}/api/files/${bizId}?limit=500`, { headers: H });
    const j = await r.json().catch(() => ({}));
    const rows = Array.isArray(j.data) ? j.data : [];
    const targets = rows.filter((f) => names.includes(f.file_name) && new Date(f.created_at).getTime() >= since);
    if (!targets.length) return row(0, '검사기가 남긴 파일 없음');
    let purged = 0;
    for (const f of targets) {
      await fetch(`${BASE}/api/files/${bizId}/${f.id}`, { method: 'DELETE', headers: H }).catch(() => null);
      const p = await fetch(`${BASE}/api/files/${bizId}/${f.id}/purge`, { method: 'DELETE', headers: H }).catch(() => null);
      if (p && p.ok) purged += 1;
    }
    return purged === targets.length
      ? row(0, `검사기가 올린 파일 ${purged}건을 지웠다 (바이트까지)`)
      : row(1, `🔴 ${targets.length}건 중 ${purged}건만 지워졌다 — 나머지는 휴지통에 바이트가 남는다`);
  } catch (e) {
    return row(1, `🔴 원복 중 오류: ${e.message}`);
  }
}

module.exports = { cleanupTestFiles };

// ─────────────────────────────────────────────────────────────────────────────
// 카나리 잔여 **일괄 청소** (2026-09-23 신설)
//
// 왜: 카나리가 각자 자기 것을 치우게 해 뒀는데 **쌓였다.** 2026-09-23 실측 —
//   복사 카나리가 5회 돌며 프로젝트 **10개**, 문서 카나리들이 **48건** 을 남겼다
//   (예외로 빠져나가거나, 러너가 중간에 끊기거나, 애초에 치우는 코드가 없었다).
//   Irene: *"치워. 그리고 틀리지 않게 조치하면서 해."*
//   → 각자 치우는 것은 그대로 두되, **러너 끝에서 한 번 더 쓸어낸다.**
//     이름 규약(`[카나리]` · `ZZ카나리` 접두어)을 쓰는 것만 지운다 — 사람 자료는 건드리지 않는다.
const CANARY_PREFIXES = ['[카나리]', 'ZZ카나리'];

async function sweepCanaryLeftovers() {
  const row = (fail, msg) => ({ name: 'cleanup:sweep', fail, details: [msg], hasCanary: true });
  let sequelize;
  try {
    require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
    ({ sequelize } = require('/opt/planq/dev-backend/config/database'));
  } catch (e) { return row(1, `🔴 DB 연결 실패 — 잔여를 못 치운다: ${e.message}`); }

  const like = CANARY_PREFIXES.map(() => 'name LIKE ?').join(' OR ');
  const args = CANARY_PREFIXES.map((p) => `${p}%`);
  let projects = 0, posts = 0;
  try {
    const [pj] = await sequelize.query(`SELECT id FROM projects WHERE ${like}`, { replacements: args });
    for (const { id } of pj) {
      for (const q of [
        'DELETE FROM project_stages WHERE project_id=?', 'DELETE FROM project_members WHERE project_id=?',
        'DELETE FROM project_clients WHERE project_id=?', 'DELETE FROM project_status_history WHERE project_id=?',
        'DELETE FROM project_history_entries WHERE project_id=?', 'DELETE FROM file_folders WHERE project_id=?',
        'UPDATE files SET project_id=NULL WHERE project_id=?', 'UPDATE tasks SET project_id=NULL WHERE project_id=?',
        'UPDATE posts SET project_id=NULL WHERE project_id=?', 'DELETE FROM projects WHERE id=?',
      ]) await sequelize.query(q, { replacements: [id] }).catch(() => null);
      projects += 1;
    }
    const titleLike = CANARY_PREFIXES.map(() => 'title LIKE ?').join(' OR ');
    const [po] = await sequelize.query(`SELECT id FROM posts WHERE ${titleLike}`, { replacements: args });
    for (const { id } of po) {
      for (const q of [
        'DELETE FROM post_attachments WHERE post_id=?', 'DELETE FROM post_revisions WHERE post_id=?',
        "DELETE FROM signature_requests WHERE entity_type='post' AND entity_id=?", 'DELETE FROM posts WHERE id=?',
      ]) await sequelize.query(q, { replacements: [id] }).catch(() => null);
      posts += 1;
    }
    // ── 파일·폴더 (2026-09-24 추가) ──────────────────────────────────────────
    // 왜: 업로드 카나리(dupname·folderops·uploadretry)는 끝에서 제 것을 치우지만, 중간에 끊기면
    //   **파일은 휴지통에 바이트째** 남는다. 2026-09-24 실측 dev 32건(전부 휴지통·미영구삭제) —
    //   지난 세션 타임아웃의 원인이 그 누적이었다. 폴더(`ZZ카나리-*`)도 이 청소 밖이었다.
    // ★ 사람 자료를 건드리지 않게 **세 겹**으로 좁힌다 — 검사 계정이 올렸고 · 이름이
    //   `zz<태그>-<실행id 6자>…` 모양이고 · 아직 영구삭제 안 된 것. `zz%` 만으로는 사람 파일과 겹친다.
    // ★ 바이트는 API(휴지통 → 영구삭제)로 지운다 — purgeFile 이 ref_count·원격·쿼터를 같이 다룬다.
    //   DB 행만 지우면 바이트가 고아로 남는다.
    const FILE_RE = '^zz[a-z0-9]*-[a-z0-9]{6}([- ].*)?\\.[a-z0-9]+$';
    const [[me]] = await sequelize.query('SELECT id FROM users WHERE email=?', { replacements: [CREDS.email] });
    let files = 0, folders = 0, fileFail = 0, leakedTags = '';
    if (me) {
      const fileWhere = 'uploader_id=? AND purged_at IS NULL AND file_name REGEXP ?';
      const [fs] = await sequelize.query(`SELECT id, business_id, deleted_at, file_name FROM files WHERE ${fileWhere}`,
        { replacements: [me.id, FILE_RE] });
      if (fs.length) {
        const tok = await loginToken();
        if (!tok) return row(1, `🔴 청소용 로그인 실패 — 카나리 파일 ${fs.length}건이 남는다`);
        const H = { Authorization: `Bearer ${tok}` };
        for (const f of fs) {
          if (!f.deleted_at) await fetch(`${BASE}/api/files/${f.business_id}/${f.id}`, { method: 'DELETE', headers: H }).catch(() => null);
          const p = await fetch(`${BASE}/api/files/${f.business_id}/${f.id}/purge`, { method: 'DELETE', headers: H }).catch(() => null);
          if (p && p.ok) files += 1; else fileFail += 1;
        }
        // 어느 카나리가 흘렸는지 보이게 — 이름 접두어(zz<태그>)가 곧 출처다. 흘린 쪽을 고칠 근거다.
        const tags = {};
        for (const f of fs) { const m = /^zz([a-z0-9]*)-/.exec(f.file_name || ''); const k = m ? m[1] : '?'; tags[k] = (tags[k] || 0) + 1; }
        leakedTags = Object.entries(tags).map(([k, n]) => `zz${k}×${n}`).join(' ');
      }
      const [fd] = await sequelize.query("SELECT id FROM file_folders WHERE created_by=? AND name LIKE 'ZZ카나리%'",
        { replacements: [me.id] });
      if (fd.length) {
        const ids = fd.map((x) => x.id);
        // 폴더 안에 사람 파일이 있을 리 없지만, 있다면 지우지 않고 루트로 내린다.
        await sequelize.query('UPDATE files SET folder_id=NULL WHERE folder_id IN (?)', { replacements: [ids] });
        await sequelize.query('DELETE FROM file_folders WHERE id IN (?)', { replacements: [ids] }); // parent_id 는 SET NULL
        folders = ids.length;
      }
    }
    const [[left]] = await sequelize.query(
      `SELECT (SELECT COUNT(*) FROM projects WHERE ${like}) p, (SELECT COUNT(*) FROM posts WHERE ${titleLike}) d,
              (SELECT COUNT(*) FROM files WHERE uploader_id=? AND purged_at IS NULL AND file_name REGEXP ?) f,
              (SELECT COUNT(*) FROM file_folders WHERE created_by=? AND name LIKE 'ZZ카나리%') ff`,
      { replacements: [...args, ...args, me ? me.id : 0, FILE_RE, me ? me.id : 0] });
    // ★ 여기서 닫지 않는다 — 러너(run.js)가 **마지막에 한 번만** 닫는 규약이다.
    //   각자 닫으면 뒤 스위트가 "connection manager was closed" 로 죽는다(2026-09-07 실측).
    const remaining = Number(left.p) + Number(left.d) + Number(left.f) + Number(left.ff);
    if (remaining > 0) {
      return row(1, `🔴 ${remaining}건이 남았다(프로젝트 ${left.p} · 문서 ${left.d} · 파일 ${left.f} · 폴더 ${left.ff}`
        + `${fileFail ? ` · 영구삭제 실패 ${fileFail}` : ''}) — 다음 실행에 또 쌓인다`);
    }
    return row(0, projects + posts + files + folders === 0 ? '카나리 잔여 없음'
      : `잔여 청소 — 프로젝트 ${projects} · 문서 ${posts} · 파일 ${files}${leakedTags ? ` (${leakedTags})` : ''} · 폴더 ${folders}`);
  } catch (e) {
    return row(1, `🔴 청소 중 오류: ${e.message}`);
  }
}

module.exports.sweepCanaryLeftovers = sweepCanaryLeftovers;
module.exports.CANARY_PREFIXES = CANARY_PREFIXES;
