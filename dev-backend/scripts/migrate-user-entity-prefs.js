// 2026-10-23 사람별 즐겨찾기·직접 정렬 (docs/PROJECT_PREFS_DESIGN.md · Fable DESIGN-OK) — 멱등.
//
//   ① user_entity_prefs 표 (CREATE TABLE IF NOT EXISTS) + UNIQUE(user_id,entity_type,entity_id) + idx(user_id,business_id,entity_type)
//   ★ **코드보다 먼저** 돈다(배포 슬롯 PM2 reload 앞) — 프로젝트 목록(GET /api/projects)이 이 표를 읽는다(없으면 목록 500).
//   백필 없음. 롤백: 코드 revert 만(표 잔존 무해).
//
//   사용: node scripts/migrate-user-entity-prefs.js [--dry]
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const TAG = '[migrate-user-entity-prefs]';

(async () => {
  try {
    const [t] = await sequelize.query("SHOW TABLES LIKE 'user_entity_prefs'");
    if (t.length) { console.log(`${TAG} user_entity_prefs 이미 있음 — skip`); process.exit(0); }
    const sql = `CREATE TABLE IF NOT EXISTS user_entity_prefs (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      business_id INT NOT NULL,
      entity_type ENUM('project') NOT NULL,
      entity_id INT NOT NULL,
      pinned_at DATETIME NULL,
      sort_order INT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      UNIQUE KEY user_entity_prefs_user_id_entity_type_entity_id (user_id, entity_type, entity_id),
      INDEX user_entity_prefs_user_id_business_id_entity_type (user_id, business_id, entity_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
    if (DRY) { console.log(`${TAG} (dry) CREATE TABLE user_entity_prefs`); process.exit(0); }
    await sequelize.query(sql);
    console.log(`${TAG} user_entity_prefs 생성`);
    process.exit(0);
  } catch (err) {
    console.error(`${TAG} 실패:`, err.message);
    process.exit(1);
  }
})();
