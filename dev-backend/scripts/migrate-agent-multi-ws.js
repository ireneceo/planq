// AI 앱 연결 — 여러 워크스페이스(2026-10-15, docs/AI_AGENT_MULTI_WORKSPACE_DESIGN.md). 멱등.
//   agent_grants.extra_business_ids JSON NULL 추가. **코드 배포 전에** 실행한다(모델이 SELECT 한다 — 없으면 연결 전체가 500).
//   롤백: 코드만 되돌린다(컬럼은 NULL 이면 옛 코드에 무해).
require('dotenv').config();
const { sequelize } = require('../config/database');

(async () => {
  try {
    const q = async () => (await sequelize.query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agent_grants' AND COLUMN_NAME = 'extra_business_ids'`))[0].length > 0;
    if (!(await q())) {
      await sequelize.query('ALTER TABLE agent_grants ADD COLUMN extra_business_ids JSON NULL AFTER scopes');
      console.log('[migrate-agent-multi-ws] agent_grants.extra_business_ids 추가');
    } else console.log('[migrate-agent-multi-ws] 이미 있음 — skip');
    if (!(await q())) { console.error('[migrate-agent-multi-ws] 검증 실패'); process.exit(1); }
    console.log('[migrate-agent-multi-ws] OK');
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-agent-multi-ws] 실패:', e.message);
    process.exit(1);
  }
})();
