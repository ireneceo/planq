// 직접 정렬(사람별·보기별 업무 순서) 표 — 멱등 (2026-10-12, docs/TASK_USER_ORDER_DESIGN.md).
//   sync-database 가 먼저 만들었으면 skip. 보기 축(view_key)이 없는 옛 dev 표면 칸·키를 더한다
//   (운영에는 이 표가 아직 없어 CREATE 만 탄다). 재조회(FK 3·키 2·view_key)로 판정하고 모자라면 exit 1.
//   롤백: 코드만 — 표는 남겨도 무해.
require('dotenv').config();
const { sequelize } = require('../config/database');
const SQL = `CREATE TABLE IF NOT EXISTS task_user_orders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL, user_id INT NOT NULL, task_id INT NOT NULL,
  view_key VARCHAR(16) NOT NULL,
  pos BIGINT NOT NULL,
  created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
  UNIQUE KEY uk_tuo_user_task_view (user_id, task_id, view_key),
  KEY idx_tuo_biz_user_view_pos (business_id, user_id, view_key, pos),
  CONSTRAINT fk_tuo_business FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT fk_tuo_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tuo_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
const q1 = async (sql) => (await sequelize.query(sql))[0];
const indexes = async () => (await q1(`SELECT DISTINCT INDEX_NAME n FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_user_orders'`)).map((x) => x.n);
(async () => {
  try {
    await sequelize.query(SQL);
    // 옛 dev 표(보기 축 없음) — 옛 행은 «마감일별» 순서로 본다. 새 키를 먼저 만들고 옛 키를 지운다(FK 가 기댈 인덱스가 끊기지 않게).
    const cols = (await q1(`SELECT COLUMN_NAME c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_user_orders'`)).map((x) => x.c);
    if (!cols.includes('view_key')) await sequelize.query("ALTER TABLE task_user_orders ADD COLUMN view_key VARCHAR(16) NOT NULL DEFAULT 'due' AFTER task_id");
    let ix = await indexes();
    if (!ix.includes('uk_tuo_user_task_view')) await sequelize.query('ALTER TABLE task_user_orders ADD UNIQUE KEY uk_tuo_user_task_view (user_id, task_id, view_key)');
    if (!ix.includes('idx_tuo_biz_user_view_pos')) await sequelize.query('ALTER TABLE task_user_orders ADD KEY idx_tuo_biz_user_view_pos (business_id, user_id, view_key, pos)');
    ix = await indexes();
    for (const old of ['uk_tuo_user_task', 'idx_tuo_biz_user_pos']) if (ix.includes(old)) await sequelize.query(`ALTER TABLE task_user_orders DROP INDEX ${old}`);

    const fk = await q1(`SELECT COLUMN_NAME c FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_user_orders' AND REFERENCED_TABLE_NAME IS NOT NULL`);
    const fkCols = [...new Set(fk.map((x) => x.c))].sort().join(',');
    ix = await indexes();
    const keysOk = ['uk_tuo_user_task_view', 'idx_tuo_biz_user_view_pos'].every((n) => ix.includes(n))
      && !ix.includes('uk_tuo_user_task');
    const hasView = (await q1(`SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'task_user_orders' AND COLUMN_NAME = 'view_key'`))[0].n > 0;
    if (fkCols !== 'business_id,task_id,user_id' || !keysOk || !hasView) {
      console.error('[migrate-task-user-order] 검증 실패', { fkCols, ix, hasView }); process.exit(1);
    }
    console.log('[migrate-task-user-order] OK fk=' + fkCols + ' idx=' + ix.join(',') + ' view_key=yes');
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-task-user-order] 실패:', e.message); process.exit(1); }
})();
