// 내 순서(사람별 업무 순서) 표 — 멱등 (2026-10-12, docs/TASK_USER_ORDER_DESIGN.md).
//   sync-database 가 먼저 만들었으면 skip. 재조회(표·FK 3·키 2)로 판정하고 모자라면 exit 1.
//   롤백: 코드만 — 표는 남겨도 무해.
require('dotenv').config();
const { sequelize } = require('../config/database');
const SQL = `CREATE TABLE IF NOT EXISTS task_user_orders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL, user_id INT NOT NULL, task_id INT NOT NULL,
  pos BIGINT NOT NULL,
  created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
  UNIQUE KEY uk_tuo_user_task (user_id, task_id),
  KEY idx_tuo_biz_user_pos (business_id, user_id, pos),
  CONSTRAINT fk_tuo_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_tuo_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tuo_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
(async () => {
  try {
    await sequelize.query(SQL);
    const [fk] = await sequelize.query(`SELECT COLUMN_NAME c, REFERENCED_TABLE_NAME r FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_user_orders' AND REFERENCED_TABLE_NAME IS NOT NULL`);
    const [ix] = await sequelize.query(`SELECT DISTINCT INDEX_NAME n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_user_orders' AND INDEX_NAME <> 'PRIMARY'`);
    const fkCols = fk.map((x) => x.c).sort().join(',');
    const ixNames = ix.map((x) => x.n);
    const keysOk = ['uk_tuo_user_task', 'idx_tuo_biz_user_pos'].every((n) => ixNames.includes(n));
    if (fkCols !== 'business_id,task_id,user_id' || !keysOk) {
      console.error('[migrate-task-user-order] 검증 실패', { fkCols, ixNames }); process.exit(1);
    }
    console.log('[migrate-task-user-order] OK fk=' + fkCols + ' idx=' + ixNames.join(','));
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-task-user-order] 실패:', e.message); process.exit(1); }
})();
