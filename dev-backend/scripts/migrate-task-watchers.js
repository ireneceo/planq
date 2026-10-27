// 업무 참조자 — task_watchers 테이블. 멱등 (매 배포 실행 안전). 2026-10-27
//
// sync-database 도 모델을 보고 만들지만, 조용히 실패하면(Failed to sync … 는 로그만 남긴다)
// 새 코드가 없는 테이블을 읽어 업무 상세·목록·볼 권한 판정이 전부 500 이 된다.
// 그래서 PM2 reload 앞에서 이 스크립트가 한 번 더 보장하고, **다시 조회해서** 판정한다.
//
// 롤백: 코드만 revert. 테이블은 남긴다(비어 있어도 무해).
require('dotenv').config();
const { sequelize } = require('../config/database');

async function exists() {
  const [rows] = await sequelize.query("SHOW TABLES LIKE 'task_watchers'");
  return rows.length > 0;
}

async function run() {
  if (await exists()) {
    console.log('[migration] task_watchers 이미 있음 — skip');
    return true;
  }
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS \`task_watchers\` (
      \`id\` BIGINT NOT NULL AUTO_INCREMENT,
      \`task_id\` INT NOT NULL,
      \`user_id\` INT NOT NULL,
      \`added_by_user_id\` INT NOT NULL,
      \`created_at\` DATETIME NOT NULL,
      \`updated_at\` DATETIME NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`task_watchers_task_id_user_id\` (\`task_id\`, \`user_id\`),
      KEY \`task_watchers_user_id\` (\`user_id\`),
      CONSTRAINT \`task_watchers_task_fk\` FOREIGN KEY (\`task_id\`) REFERENCES \`tasks\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`task_watchers_user_fk\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`task_watchers_added_by_fk\` FOREIGN KEY (\`added_by_user_id\`) REFERENCES \`users\` (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  if (!(await exists())) throw new Error('CREATE 는 돌았는데 테이블이 없다 — 판정 실패');
  console.log('[migration] task_watchers 생성 완료');
  return true;
}

run()
  .then(() => sequelize.close())
  .catch(async (e) => { console.error('[migration] task_watchers 실패:', e.message); await sequelize.close().catch(() => {}); process.exit(1); });
