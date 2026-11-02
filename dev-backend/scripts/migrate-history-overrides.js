// 자동 히스토리 «글 고치기» — history_overrides 테이블. 멱등 (매 배포 실행 안전). 2026-11-02
//   설계 docs/HISTORY_OVERRIDE_DESIGN.md (Fable 설계 판정).
//
// sync-database 도 모델을 보고 만들지만 조용히 실패할 수 있다 — 그러면 히스토리·업무 상세가
// 없는 테이블을 읽어 500 이 된다. PM2 reload 앞에서 한 번 더 보장하고 **다시 조회해서** 판정한다.
// 백필 없음 — 새 기능이라 옛 행이 없다. 롤백: 코드만 revert(테이블은 남겨도 무해).
require('dotenv').config();
const { sequelize } = require('../config/database');

async function exists() {
  const [rows] = await sequelize.query("SHOW TABLES LIKE 'history_overrides'");
  return rows.length > 0;
}

async function run() {
  if (await exists()) {
    console.log('[migration] history_overrides 이미 있음 — skip');
    return true;
  }
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS \`history_overrides\` (
      \`id\` BIGINT NOT NULL AUTO_INCREMENT,
      \`business_id\` INT NOT NULL,
      \`source_table\` VARCHAR(32) NOT NULL,
      \`source_id\` BIGINT NOT NULL,
      \`note\` TEXT NULL,
      \`title\` VARCHAR(200) NULL,
      \`edited_by\` INT NOT NULL,
      \`created_at\` DATETIME NOT NULL,
      \`updated_at\` DATETIME NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uq_hist_override\` (\`source_table\`, \`source_id\`),
      KEY \`idx_hist_override_biz\` (\`business_id\`, \`source_table\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  if (!(await exists())) throw new Error('CREATE 는 돌았는데 테이블이 없다 — 판정 실패');
  console.log('[migration] history_overrides 생성 완료');
  return true;
}

run()
  .then(() => sequelize.close())
  .catch(async (e) => { console.error('[migration] history_overrides 실패:', e.message); await sequelize.close().catch(() => {}); process.exit(1); });
