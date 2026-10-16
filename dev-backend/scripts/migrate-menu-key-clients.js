// 메뉴 권한 키 'clients' → 'qsale' 이관 (2026-10-16, docs/CLIENT_SCREENS_MERGE_DESIGN.md)
//
//   설정 > 고객 화면을 Q sale 로 합치면서 고객 라우트가 requireMenu('qsale') 로 바뀌었다.
//   멤버마다 'clients' 에 따로 준 수준이 있으면 그것을 'qsale' 에 반영한다 — **더 좁은 쪽**(fail-closed):
//     qsale 행이 없으면 clients 와 같은 수준으로 만들고, 있으면 none < read < write 중 작은 쪽으로 맞춘다.
//     보던 것을 넓히지 않는다(옛날엔 둘 중 하나만 막혀 있어도 그 화면이 막혀 있었다).
//   옛 'clients' 행은 **지우지 않는다** — 되돌리기는 코드 되돌리기로 끝난다(행이 남아 있으면 옛 코드가 그대로 읽는다).
//
//   기본은 읽기만(무엇이 바뀌는지 출력). 적용은 --apply. 멱등(두 번째 실행은 바뀔 것 0).
//   사용: node scripts/migrate-menu-key-clients.js [--apply]
require('dotenv').config();
const { sequelize } = require('../config/database');

const APPLY = process.argv.includes('--apply');
const TAG = 'migrate-menu-key-clients';
const RANK = { none: 0, read: 1, write: 2 };

async function main() {
  const [rows] = await sequelize.query(
    `SELECT c.business_id, c.user_id, c.level AS clients_level, q.id AS qsale_id, q.level AS qsale_level
       FROM business_member_permissions c
       LEFT JOIN business_member_permissions q
         ON q.business_id = c.business_id AND q.user_id = c.user_id AND q.menu_key = 'qsale'
      WHERE c.menu_key = 'clients'
      ORDER BY c.business_id, c.user_id`,
  );
  const plan = [];
  for (const r of rows) {
    if (!r.qsale_id) {
      // qsale 행 없음 = 기본 write. clients 가 write 면 바꿀 것이 없다
      if (r.clients_level !== 'write') plan.push({ ...r, action: 'insert', to: r.clients_level });
    } else if (RANK[r.clients_level] < RANK[r.qsale_level]) {
      plan.push({ ...r, action: 'narrow', to: r.clients_level });
    }
  }
  console.log(`[${TAG}] clients 행 ${rows.length}건 · 바꿀 것 ${plan.length}건`);
  for (const p of plan) {
    console.log(`[${TAG}]   biz ${p.business_id} user ${p.user_id}: qsale ${p.qsale_level || '(없음=write)'} → ${p.to} (clients=${p.clients_level}, ${p.action})`);
  }
  if (APPLY && plan.length) {
    const t = await sequelize.transaction();
    try {
      for (const p of plan) {
        if (p.action === 'insert') {
          await sequelize.query(
            `INSERT INTO business_member_permissions (business_id, user_id, menu_key, level, created_at, updated_at)
             VALUES (?, ?, 'qsale', ?, NOW(), NOW())`,
            { replacements: [p.business_id, p.user_id, p.to], transaction: t },
          );
        } else {
          await sequelize.query(
            "UPDATE business_member_permissions SET level = ?, updated_at = NOW() WHERE id = ? AND menu_key = 'qsale'",
            { replacements: [p.to, p.qsale_id], transaction: t },
          );
        }
      }
      await t.commit();
      console.log(`[${TAG}] 적용 ${plan.length}건`);
    } catch (e) { await t.rollback(); throw e; }
  } else if (plan.length) {
    console.log(`[${TAG}] 읽기만 했다 — 적용하려면 --apply`);
  }
  await sequelize.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
