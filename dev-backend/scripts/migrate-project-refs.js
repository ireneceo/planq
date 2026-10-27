// 프로젝트 연결(참조) — project_refs 테이블. 멱등 (매 배포 실행 안전). 2026-10-27
//
// sync-database 도 모델을 보고 만들지만, 조용히 실패하면(Failed to sync … 는 로그만 남긴다)
// 새 코드가 없는 테이블을 읽어 프로젝트 파일 탭·문서 상세의 연결 칩이 500 이 된다.
// 그래서 PM2 reload 앞에서 이 스크립트가 한 번 더 보장하고, **다시 조회해서** 판정한다.
// 백필 없음 — 새 기능이라 옛 행이 없다.
//
// 롤백: 코드만 revert. 테이블은 남긴다(비어 있어도 무해).
require('dotenv').config();
const { sequelize } = require('../config/database');

async function exists() {
  const [rows] = await sequelize.query("SHOW TABLES LIKE 'project_refs'");
  return rows.length > 0;
}

async function run() {
  if (await exists()) {
    console.log('[migration] project_refs 이미 있음 — skip');
    return true;
  }
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS \`project_refs\` (
      \`id\` BIGINT NOT NULL AUTO_INCREMENT,
      \`business_id\` INT NOT NULL,
      \`project_id\` BIGINT NOT NULL,
      \`entity_type\` VARCHAR(16) NOT NULL,
      \`entity_id\` BIGINT NOT NULL,
      \`created_by\` INT NULL,
      \`created_at\` DATETIME NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`project_refs_project_id_entity_type_entity_id\` (\`project_id\`, \`entity_type\`, \`entity_id\`),
      KEY \`project_refs_entity_type_entity_id\` (\`entity_type\`, \`entity_id\`),
      KEY \`project_refs_business_id\` (\`business_id\`),
      CONSTRAINT \`project_refs_project_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`projects\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  if (!(await exists())) throw new Error('CREATE 는 돌았는데 테이블이 없다 — 판정 실패');
  console.log('[migration] project_refs 생성 완료');
  return true;
}

run()
  .then(() => sequelize.close())
  .catch(async (e) => { console.error('[migration] project_refs 실패:', e.message); await sequelize.close().catch(() => {}); process.exit(1); });
