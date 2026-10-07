// 고객 ↔ 프로젝트 ↔ 고객 채널 정합 검사 — health-check(clientlink)와 백필 스크립트가 **같은 쿼리**를 쓴다.
//   (쿼리를 두 곳에 베껴 두면 한쪽만 바뀐다 — 2026-10-07 채널 축을 «프로젝트 × 고객» 으로 바꾸며 한 곳에 모았다)
//
//   unlinked        계정 고객인데 contact_user_id 가 빈 연결 행 → 고객 화면에서 프로젝트·방이 통째로 사라진다
//   clientAsMember  고객이 member 로 들어간 참여자 → 내부 메시지 알림 제외(role==='client')를 빠져나간다
//   notJoined       고객 채팅을 쓰는 프로젝트인데 연결 고객이 **자기 고객사의 방**에 없다
//   crossClient     프로젝트 고객 채널에 **다른 고객사**의 사람이 들어가 있다(서로의 청구서·첨부를 본다)
const SQL = {
  unlinked: `SELECT pc.id FROM project_clients pc JOIN clients c ON c.id = pc.client_id
    WHERE pc.contact_user_id IS NULL AND c.user_id IS NOT NULL AND c.status = 'active'`,
  clientAsMember: `SELECT cp.id FROM conversation_participants cp JOIN conversations cv ON cv.id = cp.conversation_id
    JOIN clients c ON c.user_id = cp.user_id AND c.business_id = cv.business_id
    LEFT JOIN business_members bm ON bm.user_id = cp.user_id AND bm.business_id = cv.business_id AND bm.removed_at IS NULL
    WHERE cp.role <> 'client' AND bm.id IS NULL`,
  notJoined: `SELECT pc.id, pc.project_id, pc.client_id, pc.contact_user_id AS user_id FROM project_clients pc
    WHERE pc.contact_user_id IS NOT NULL AND pc.client_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM conversations cv0 WHERE cv0.project_id = pc.project_id AND cv0.channel_type = 'customer')
      AND NOT EXISTS (SELECT 1 FROM conversations cv JOIN conversation_participants cp ON cp.conversation_id = cv.id
        WHERE cv.project_id = pc.project_id AND cv.channel_type = 'customer' AND cv.client_id = pc.client_id
          AND cp.user_id = pc.contact_user_id)`,
  crossClient: `SELECT DISTINCT cp.id FROM conversation_participants cp
    JOIN conversations cv ON cv.id = cp.conversation_id AND cv.channel_type = 'customer' AND cv.project_id IS NOT NULL
    JOIN project_clients pc ON pc.project_id = cv.project_id AND pc.contact_user_id = cp.user_id AND pc.client_id IS NOT NULL
    LEFT JOIN business_members bm ON bm.user_id = cp.user_id AND bm.business_id = cv.business_id AND bm.removed_at IS NULL
    WHERE bm.id IS NULL
      AND NOT EXISTS (SELECT 1 FROM project_clients pc2 WHERE pc2.project_id = cv.project_id
        AND pc2.contact_user_id = cp.user_id AND pc2.client_id = cv.client_id)`,
};

async function runChecks(sequelize) {
  const out = {};
  for (const [k, q] of Object.entries(SQL)) {
    const [rows] = await sequelize.query(q);
    out[k] = rows;
  }
  return out;
}

module.exports = { SQL, runChecks };

// health-check 가 별도 프로세스로 부른다: node scripts/lib/clientLinkChecks.js → "@@{...}"
if (require.main === module) {
  require('dotenv').config();
  const { sequelize } = require('../../config/database');
  runChecks(sequelize)
    .then(async (r) => {
      const ids = Object.fromEntries(Object.entries(r).map(([k, rows]) => [k, rows.map((x) => x.id)]));
      console.log('@@' + JSON.stringify(ids));
      await sequelize.close(); process.exit(0);
    })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
