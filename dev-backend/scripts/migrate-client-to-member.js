// 고객이었던 사람이 멤버가 된 옛 데이터 정리 — 2026-10-16 (docs/MEMBER_PROJECT_SCOPE_DESIGN.md A-3 · Fable 설계)
//   Irene: «어떤 프로젝트에서 고객이었는데 같은 이메일로 멤버 가입했는데 그대로 고객이야»
//
//   1) 컬럼 clients.member_converted_at DATETIME NULL 추가(멱등 — 모델이 SELECT 하므로 코드 배포 전, 배포 슬롯).
//   2) 기본은 **읽기만** — 활성 멤버(owner/admin/member) × 같은 워크스페이스에 남은 고객 자국
//      (① clients 활성 ② project_clients.contact_user_id ③ 대화 참여 role='client')을 센다.
//   3) --apply 면 쌍마다 services/clientToMember.promoteClientToMember(같은 함수 — 베끼지 않는다).
// 롤백: 감사 client.converted_to_member 의 old_value 에 원래 행이 있다. 컬럼은 남긴다.
require('dotenv').config();
const { sequelize } = require('../config/database');
const APPLY = process.argv.includes('--apply');

async function hasCol() {
  const [rows] = await sequelize.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'member_converted_at'`);
  return rows.length > 0;
}

(async () => {
  try {
    if (!(await hasCol())) {
      await sequelize.query('ALTER TABLE clients ADD COLUMN member_converted_at DATETIME NULL');
      console.log('[migrate-client-to-member] clients.member_converted_at 추가');
    } else console.log('[migrate-client-to-member] clients.member_converted_at 이미 있음 — skip');
    if (!(await hasCol())) { console.error('[migrate-client-to-member] 검증 실패 — 컬럼 없음'); process.exit(1); }

    const [pairs] = await sequelize.query(`
      SELECT bm.business_id, bm.user_id,
        (SELECT COUNT(*) FROM clients c WHERE c.business_id = bm.business_id AND c.user_id = bm.user_id AND c.status <> 'archived') AS clients,
        (SELECT COUNT(*) FROM project_clients pc JOIN projects p ON p.id = pc.project_id
          WHERE p.business_id = bm.business_id AND pc.contact_user_id = bm.user_id) AS project_clients,
        (SELECT GROUP_CONCAT(pc.project_id) FROM project_clients pc JOIN projects p ON p.id = pc.project_id
          WHERE p.business_id = bm.business_id AND pc.contact_user_id = bm.user_id) AS project_ids,
        (SELECT COUNT(*) FROM conversation_participants cp JOIN conversations cv ON cv.id = cp.conversation_id
          WHERE cv.business_id = bm.business_id AND cp.user_id = bm.user_id AND cp.role = 'client') AS participants
      FROM business_members bm
      WHERE bm.user_id IS NOT NULL AND bm.removed_at IS NULL AND bm.role IN ('owner','admin','member')
      HAVING clients > 0 OR project_clients > 0 OR participants > 0
      ORDER BY bm.business_id, bm.user_id`);
    console.log(`[migrate-client-to-member] 대상 쌍 ${pairs.length}`);
    for (const p of pairs) {
      console.log(`  ws ${p.business_id} · user ${p.user_id} — 고객 행 ${p.clients} · 프로젝트 고객 ${p.project_clients}${p.project_ids ? ` (프로젝트 ${p.project_ids})` : ''} · 대화 고객 역할 ${p.participants}`);
    }
    if (!APPLY) { console.log('[migrate-client-to-member] 읽기만 — 바꾸려면 --apply'); await sequelize.close(); process.exit(0); }

    const { promoteClientToMember, afterPromote } = require('../services/clientToMember');
    let n = 0;
    for (const p of pairs) {
      const t = await sequelize.transaction();
      try {
        const r = await promoteClientToMember({ businessId: p.business_id, userId: p.user_id, transaction: t });
        await t.commit();
        afterPromote(r, { businessId: p.business_id, userId: p.user_id, actorUserId: null, io: null });
        n += 1;
        console.log(`  ✓ ws ${p.business_id} user ${p.user_id} — 고객 보관 ${r.clients} · 프로젝트 고객→멤버 ${r.projectClients}(새 멤버 ${r.projectMembersAdded}) · 대화 역할 ${r.participants}`);
      } catch (e) { await t.rollback(); console.error(`  ✗ ws ${p.business_id} user ${p.user_id}: ${e.message}`); }
    }
    console.log(`[migrate-client-to-member] 적용 ${n}/${pairs.length}`);
    await new Promise((r) => setTimeout(r, 500));   // 감사 기록(setImmediate) 이 끝나게
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-client-to-member] 실패:', e.message);
    process.exit(1);
  }
})();
