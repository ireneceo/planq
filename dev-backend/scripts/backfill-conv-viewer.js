// 옛 «열기만 해서 생긴» 참여자 행을 «보는 중»(is_viewer 1)으로 — 2026-10-15 Fable 설계 A 판정 4.
//
//   이 칸이 생기기 전에는 읽음(/read)·핀이 role member 참여자 행을 만들었고, 어느 행이 그렇게 생겼는지
//   기록이 없다. 그래서 **추정**한다 — 아래 조건을 **전부** 만족해야 viewer 로 내린다:
//     role 'member' · 지금 참여자(is_viewer 0) · Cue 아님 · 프로젝트 방이면 그 프로젝트 멤버 아님 ·
//     감사 `conversation.participant_add` 로 그 사람을 넣은 기록 없음 · 그 방에 보낸 메시지 0건 ·
//     행이 방보다 5초 넘게 늦게 생김(방을 만들 때 같이 들어간 사람이 아님).
//   오판 비용은 «참여자 목록·@·알림에서 빠짐» 뿐이다 — 방은 그대로 보이고 [초대] 한 번 또는 말 한 번이면 돌아온다.
//   ★ 사적 방(프로젝트·고객 없는 팀 대화)의 해당 행은 viewer 가 되면 그 방 접근권이 사라진다(D3 의 뜻) — 건수를 따로 보고한다.
//
//   node scripts/backfill-conv-viewer.js                 # 기본: 읽기만(워크스페이스·사유별 건수 + 표본 5)
//   node scripts/backfill-conv-viewer.js --apply         # 내리고 (conv,user) 장부를 scripts/out/ 에 남긴다
//   node scripts/backfill-conv-viewer.js --revert <장부> # 그 장부의 행을 다시 참여자로
//   운영은 배포 슬롯에서만(수동). migrate-conv-viewer.js 가 먼저 돌아 있어야 한다.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../config/database');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const revertIdx = args.indexOf('--revert');
const REVERT = revertIdx >= 0 ? args[revertIdx + 1] : null;

const CANDIDATES_SQL = `
  SELECT cp.id, cp.conversation_id, cp.user_id, c.business_id, c.project_id, c.client_id, c.channel_type,
         (c.project_id IS NULL AND c.client_id IS NULL AND c.channel_type IN ('internal','group')) AS is_private
    FROM conversation_participants cp /* own-row: 백필 대상 판정 — is_viewer = 0 행만 본다 */
    JOIN conversations c ON c.id = cp.conversation_id
    LEFT JOIN businesses b ON b.id = c.business_id
   WHERE cp.is_viewer = 0
     AND cp.role = 'member'
     AND (b.cue_user_id IS NULL OR cp.user_id <> b.cue_user_id)
     AND cp.created_at > c.created_at + INTERVAL 5 SECOND
     AND NOT (c.project_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM project_members pm WHERE pm.project_id = c.project_id AND pm.user_id = cp.user_id))
     AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = cp.conversation_id AND m.sender_id = cp.user_id)
     AND NOT EXISTS (
           SELECT 1 FROM audit_logs a
            WHERE a.action = 'conversation.participant_add' AND a.target_id = cp.conversation_id
              AND CAST(JSON_UNQUOTE(JSON_EXTRACT(a.new_value, '$.user_id')) AS UNSIGNED) = cp.user_id)
   ORDER BY c.business_id, cp.conversation_id, cp.user_id`;

(async () => {
  try {
    const [[col]] = await sequelize.query(`SELECT COUNT(*) n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversation_participants' AND COLUMN_NAME = 'is_viewer'`);
    if (!Number(col.n)) { console.error('[backfill-conv-viewer] is_viewer 칸 없음 — migrate-conv-viewer.js 먼저'); process.exit(1); }

    if (REVERT) {
      const ledger = JSON.parse(fs.readFileSync(REVERT, 'utf8'));
      let n = 0;
      for (const r of ledger.rows) {
        const [res] = await sequelize.query(
          'UPDATE conversation_participants SET is_viewer = 0 WHERE conversation_id = :c AND user_id = :u AND is_viewer = 1',
          { replacements: { c: r.conversation_id, u: r.user_id } });
        n += Number(res?.affectedRows || 0);
      }
      console.log(`[backfill-conv-viewer] revert ${n}/${ledger.rows.length}건 참여자로 되돌림`);
      await sequelize.close(); process.exit(0);
    }

    const [rows] = await sequelize.query(CANDIDATES_SQL);
    const byBiz = {};
    let priv = 0;
    for (const r of rows) {
      byBiz[r.business_id] = (byBiz[r.business_id] || 0) + 1;
      if (Number(r.is_private)) priv += 1;
    }
    const [[tot]] = await sequelize.query("SELECT COUNT(*) n FROM conversation_participants WHERE is_viewer = 0 AND role = 'member'");
    console.log(`[backfill-conv-viewer] ${APPLY ? 'APPLY' : 'DRY-RUN'} — 대상 ${rows.length}건 / member 참여자 ${tot.n}건`);
    console.log('  워크스페이스별:', JSON.stringify(byBiz));
    console.log(`  그중 사적 방(접근권이 사라지는 행): ${priv}건`);
    console.log('  표본:', JSON.stringify(rows.slice(0, 5).map((r) => ({ conv: r.conversation_id, user: r.user_id, biz: r.business_id, project: r.project_id, private: !!Number(r.is_private) }))));

    if (!APPLY) { await sequelize.close(); process.exit(0); }
    if (!rows.length) { console.log('  할 것 없음'); await sequelize.close(); process.exit(0); }

    const outDir = path.join(__dirname, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `conv-viewer-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), rows: rows.map((r) => ({ conversation_id: r.conversation_id, user_id: r.user_id })) }, null, 1));
    const ids = rows.map((r) => r.id);
    const [res] = await sequelize.query('UPDATE conversation_participants SET is_viewer = 1 WHERE id IN (:ids) AND is_viewer = 0', { replacements: { ids } });
    console.log(`  내림 ${res?.affectedRows ?? '?'}건 · 장부 ${file} (되돌리기: --revert ${file})`);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[backfill-conv-viewer] 실패:', e.message); process.exit(1); }
})();
