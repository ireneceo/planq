// project_clients.contact_user_id 백필 — 멱등. 2026-10-06.
//   계정이 붙은(활성) 고객인데 연결된 프로젝트 행의 contact_user_id 가 빈 것을 채우고, 그 프로젝트 고객 채널에
//   role 'client' 로 들인다(services/clientOnboarding.linkClientToProjects — 초대 수락과 **같은 함수**).
//   Irene: "최정우 고객에게 채팅을 보냈는데 그 고객화면에 채팅리스트가 안 떠." (운영 실측 1행 — project_clients 9)
//   재조회로 판정하고 남은 행이 있으면 exit 1.
// 롤백: 데이터 채움이라 되돌릴 일이 없다(옛 코드도 같은 값을 «수락 시» 넣는다). 필요하면 출력된 id 로 되돌린다.
require('dotenv').config();
const { sequelize } = require('../config/database');
const COUNT_SQL = `SELECT pc.id, pc.project_id, pc.client_id, c.user_id
  FROM project_clients pc JOIN clients c ON c.id = pc.client_id
  WHERE pc.contact_user_id IS NULL AND c.user_id IS NOT NULL AND c.status = 'active'`;
// 쿼리 정본은 scripts/lib/clientLinkChecks.js(health-check clientlink 와 같은 것). 고객 채널 축 = 프로젝트 × 고객.
const NOT_JOINED_SQL = require('./lib/clientLinkChecks').SQL.notJoined;
(async () => {
  try {
    const { Client } = require('../models');
    const { linkClientToProjects } = require('../services/clientOnboarding');
    const [before] = await sequelize.query(COUNT_SQL);
    console.log(`[migrate-project-client-user] 대상 ${before.length}행`, before.map((r) => `pc${r.id}(client ${r.client_id}→user ${r.user_id})`).join(' '));
    const clientIds = [...new Set(before.map((r) => r.client_id))];
    for (const id of clientIds) {
      const cl = await Client.findByPk(id);
      const r = await sequelize.transaction((t) => linkClientToProjects(cl, { transaction: t }));
      console.log(`[migrate-project-client-user] client ${id}:`, JSON.stringify(r));
    }
    // ★ 2026-10-07 — 연결(contact_user_id)은 있는데 그 프로젝트 고객 채널에 참여자가 아닌 것.
    //   «이미 계정 있는 고객을 프로젝트에 추가» 문이 참여를 빠뜨려 생겼다(운영 민충기 — 프로젝트 6 · 방 18).
    //   위 대상(contact_user_id 빈 행)에는 안 걸려 첫 백필이 건너뛰었다.
    const { joinProjectCustomerChannels } = require('../services/clientOnboarding');
    const [notJoined] = await sequelize.query(NOT_JOINED_SQL);
    console.log(`[migrate-project-client-user] 연결됐는데 고객 채널 미참여 ${notJoined.length}건`, notJoined.map((r) => `pc${r.id}(user ${r.user_id}→client ${r.client_id})`).join(' '));
    for (const r of notJoined) {
      const { Project } = require('../models');
      const prj = await Project.findByPk(r.project_id, { attributes: ['business_id'] });
      if (!prj) continue;
      const out = await sequelize.transaction((t) => joinProjectCustomerChannels({ businessId: prj.business_id, projectIds: [r.project_id], userId: r.user_id, clientId: r.client_id, transaction: t }));
      console.log(`[migrate-project-client-user] pc${r.id}:`, JSON.stringify(out));
    }
    const [notJoinedAfter] = await sequelize.query(NOT_JOINED_SQL);
    if (notJoinedAfter.length) { console.error('[migrate-project-client-user] 미참여 남은 행', notJoinedAfter); process.exit(1); }
    // 고객이 member 로 들어간 참여자 → client (워크스페이스 멤버가 아닌 사람만). 내부 메시지 알림 제외가 role==='client' 로 판정한다.
    const ROLE_SQL = `FROM conversation_participants cp JOIN conversations cv ON cv.id = cp.conversation_id
      JOIN clients c ON c.user_id = cp.user_id AND c.business_id = cv.business_id
      LEFT JOIN business_members bm ON bm.user_id = cp.user_id AND bm.business_id = cv.business_id AND bm.removed_at IS NULL
      WHERE cp.role <> 'client' AND bm.id IS NULL`;
    const [roleRows] = await sequelize.query(`SELECT cp.id ${ROLE_SQL}`);
    if (roleRows.length) {
      await sequelize.query('UPDATE conversation_participants SET role = \'client\' WHERE id IN (?)', { replacements: [roleRows.map((r) => r.id)] });
    }
    console.log(`[migrate-project-client-user] 참여자 역할 client 로 ${roleRows.length}행`, roleRows.map((r) => r.id).join(','));
    const [roleAfter] = await sequelize.query(`SELECT cp.id ${ROLE_SQL}`);
    if (roleAfter.length) { console.error('[migrate-project-client-user] 역할 남은 행', roleAfter); process.exit(1); }
    const [after] = await sequelize.query(COUNT_SQL);
    if (after.length) { console.error('[migrate-project-client-user] 남은 행', after); process.exit(1); }
    console.log('[migrate-project-client-user] OK — 남은 행 0');
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-project-client-user] 실패:', e.message); process.exit(1); }
})();
