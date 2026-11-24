// 프로젝트 대화방 «프로젝트 멤버 자동 참여» — conversations.project_auto_join TINYINT(1) NOT NULL DEFAULT 0 + 한 번만 백필.
//   docs/PROJECT_ROOM_MEMBERSHIP_DESIGN.md «Fable 판정» 12·13 (2026-11-24).
//
// ① 칸 추가 — 멱등(있으면 skip). 기본 0 = 모든 방 «직접 초대한 사람만».
// ② 백필(프로젝트마다 최대 1개 켬) — 보관 안 된 내부 방 중 id 가 가장 작은 방이고, 지금 그 프로젝트 사람 멤버 전원을 덮을 때만.
//    그 밖의 내부 방·고객방은 0. **아무도 빼지 않는다**(참여 행은 건드리지 않는다).
//    ★ 한 번만 — 표시는 «칸이 있는가» 가 아니라 audit_logs action='migration.project_auto_join_backfill' 행이다
//      (sync-database 가 칸을 먼저 만들면 칸 존재로는 백필이 영영 안 돈다 · 다시 돌려도 사람이 끈 방을 켜지 않는다).
// ③ 읽기 전용 보고 — 11-16 이후 via project_member 로 고객방에 들어갔고 그 방에서 말한 적 없는 (방, 사람). 대표가 보고 직접 내보낸다.
//
// 사용: 기본 = dry-run(켜질 방 수·켜진 방 0개 프로젝트 수·③ 목록) · `--apply` = 백필 기록.
// 되돌리기: UPDATE conversations SET project_auto_join = 0 (참여 행은 안 건드렸으므로 그것으로 끝).
require('dotenv').config();
const { sequelize } = require('../config/database');

const APPLY = process.argv.includes('--apply');
const MARK = 'migration.project_auto_join_backfill';
const TAG = '[migrate-project-auto-join]';

async function hasCol() {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversations' AND COLUMN_NAME = 'project_auto_join'`);
  return rows.length > 0;
}

(async () => {
  try {
    if (!(await hasCol())) {
      await sequelize.query('ALTER TABLE conversations ADD COLUMN project_auto_join TINYINT(1) NOT NULL DEFAULT 0');
      console.log(`${TAG} conversations.project_auto_join 추가`);
    } else {
      console.log(`${TAG} conversations.project_auto_join 이미 있음 — skip`);
    }
    if (!(await hasCol())) { console.error(`${TAG} 검증 실패 — 칸 없음`); process.exit(1); }

    // 한 번 돌았는가 = 표시 행 ∨ 켜진 방이 하나라도 있음(표시 행이 보관기간으로 정리된 뒤에도 사람이 끈 방을 다시 켜지 않게 — Fable 비차단 3)
    const [[done0]] = await sequelize.query('SELECT COUNT(*) AS n FROM audit_logs WHERE action = ?', { replacements: [MARK] });
    const [[anyOn]] = await sequelize.query('SELECT COUNT(*) AS n FROM conversations WHERE project_auto_join = 1');
    const done = { n: Number(done0.n) + Number(anyOn.n) };
    // 후보: 프로젝트마다 보관 안 된 내부 방 중 id 최소
    const [firsts] = await sequelize.query(`
      SELECT c.project_id, MIN(c.id) AS conv_id
        FROM conversations c
       WHERE c.project_id IS NOT NULL AND c.channel_type = 'internal' AND c.archived_at IS NULL
       GROUP BY c.project_id`);
    const [[projCnt]] = await sequelize.query('SELECT COUNT(DISTINCT project_id) AS n FROM conversations WHERE project_id IS NOT NULL');
    const turnOn = [];
    for (const r of firsts) {
      // 사람 멤버(워크스페이스 owner·admin·member, 활성) 중 그 방 참여자(보는 중 제외)가 아닌 사람 수
      const [[miss]] = await sequelize.query(`
        SELECT COUNT(*) AS n
          FROM project_members pm
          JOIN projects p ON p.id = pm.project_id
          JOIN business_members bm ON bm.business_id = p.business_id AND bm.user_id = pm.user_id
               AND bm.role IN ('owner','admin','member') AND bm.removed_at IS NULL
         WHERE pm.project_id = ?
           AND NOT EXISTS (SELECT 1 FROM conversation_participants cp
                            WHERE cp.conversation_id = ? AND cp.user_id = pm.user_id AND COALESCE(cp.is_viewer, 0) = 0)`,
      { replacements: [r.project_id, r.conv_id] });
      if (Number(miss.n) === 0) turnOn.push(Number(r.conv_id));
    }
    const noRoom = Number(projCnt.n) - turnOn.length;
    console.log(`${TAG} 켤 방 ${turnOn.length} · 켜진 방 0개가 될 프로젝트 ${noRoom} (프로젝트 방 있는 프로젝트 ${projCnt.n})`);

    // ③ 읽기 전용 — 11-16 이후 자동 참여로 고객방에 들어갔고 말한 적 없는 (방, 사람)
    const [silent] = await sequelize.query(`
      SELECT DISTINCT a.target_id AS conv_id, JSON_UNQUOTE(JSON_EXTRACT(a.new_value, '$.user_id')) AS user_id
        FROM audit_logs a
        JOIN conversations c ON c.id = a.target_id AND c.channel_type = 'customer'
       WHERE a.action = 'conversation.participant_add'
         AND JSON_UNQUOTE(JSON_EXTRACT(a.new_value, '$.via')) = 'project_member'
         AND a.created_at >= '2026-11-16'
         AND EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = a.target_id
                      AND cp.user_id = JSON_UNQUOTE(JSON_EXTRACT(a.new_value, '$.user_id')) AND COALESCE(cp.is_viewer, 0) = 0)
         AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = a.target_id
                          AND m.sender_id = JSON_UNQUOTE(JSON_EXTRACT(a.new_value, '$.user_id')))
       ORDER BY conv_id`);
    console.log(`${TAG} 자동으로 고객방에 들어갔고 말한 적 없는 (방, 사람) ${silent.length}건 — 읽기만, 빼지 않음`);
    for (const s of silent.slice(0, 50)) console.log(`  # conv ${s.conv_id} user ${s.user_id}`);

    if (Number(done.n) > 0) {
      console.log(`${TAG} 백필은 이미 한 번 돌았다(${MARK}) — 아무것도 켜지 않음`);
    } else if (!APPLY) {
      console.log(`${TAG} dry-run — 적용하려면 --apply`);
    } else {
      await sequelize.transaction(async (t) => {
        if (turnOn.length) {
          await sequelize.query('UPDATE conversations SET project_auto_join = 1 WHERE id IN (?)', { replacements: [turnOn], transaction: t });
        }
        // 감사 행은 단일 입구(writeAudit — 보관 스탬프·마스킹)로만 쓴다
        await require('../services/auditService').writeAudit({
          userId: null, businessId: null, action: MARK, targetType: 'migration', targetId: null,   // 플랫폼 행 — 대화방(워크스페이스) 행이 아니다
          newValue: { turned_on: turnOn.length, conv_ids: turnOn.slice(0, 500) },
        }, { transaction: t });
      });
      console.log(`${TAG} 적용 — 켬 ${turnOn.length}`);
    }
    const [[after]] = await sequelize.query(
      `SELECT SUM(project_auto_join = 1) AS on_cnt, SUM(project_auto_join = 1 AND channel_type = 'customer') AS on_customer,
              (SELECT COUNT(*) FROM (SELECT project_id FROM conversations WHERE project_auto_join = 1 GROUP BY project_id HAVING COUNT(*) > 1) x) AS multi
         FROM conversations`);
    console.log(`${TAG} OK — 켜진 방 ${after.on_cnt || 0} · 그중 고객방 ${after.on_customer || 0} · 켜진 방 2개 이상 프로젝트 ${after.multi || 0}`);
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error(`${TAG} 실패:`, e.message);
    process.exit(1);
  }
})();
