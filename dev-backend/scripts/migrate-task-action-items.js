// 업무 «결과물 액션» 표 — task_action_items. 멱등 · --dry. 2026-10-12.
//   설계 docs/TASK_ACTIONS_DESIGN.md §2. 새 표 하나 + 인덱스 3. 기존 표는 건드리지 않는다.
//   재조회로 판정하고 미충족이면 exit 1.
// 롤백: 코드만 되돌린다(표는 남아도 무해 — 옛 코드는 이 표를 모른다).
require('dotenv').config();
const { sequelize } = require('../config/database');
const TAG = '[migrate-task-action-items]';
const DRY = process.argv.includes('--dry');
const DDL = `CREATE TABLE IF NOT EXISTS task_action_items (
  id INT NOT NULL AUTO_INCREMENT,
  business_id INT NOT NULL,
  task_id INT NOT NULL,
  order_index INT NOT NULL DEFAULT 0,
  kind ENUM('doc','event','mail','project') NOT NULL,
  label VARCHAR(200) NOT NULL,
  note VARCHAR(1000) NULL,
  meta JSON NULL,
  status ENUM('pending','active','completed','skipped') NOT NULL DEFAULT 'pending',
  linked_entity_type ENUM('post','calendar_event','email_thread','project') NULL,
  linked_entity_id INT NULL,
  linked_attachment_id INT NULL,
  fulfilled_by INT NULL,
  fulfilled_at DATETIME NULL,
  fulfilled_round INT NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY task_action_items_task_id_order_index (task_id, order_index),
  KEY task_action_items_task_id_status (task_id, status),
  KEY task_action_items_linked_entity (business_id, linked_entity_type, linked_entity_id),
  CONSTRAINT task_action_items_ibfk_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
  CONSTRAINT task_action_items_ibfk_business FOREIGN KEY (business_id) REFERENCES businesses (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
(async () => {
  try {
    const [[exists]] = await sequelize.query(`SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_action_items'`);
    if (Number(exists.n)) console.log(TAG, '표 이미 있음 — skip');
    else if (DRY) console.log(TAG, '[dry] 표를 만든다');
    else { await sequelize.query(DDL); console.log(TAG, '표 생성'); }
    if (DRY) { await sequelize.close(); process.exit(0); }
    const [cols] = await sequelize.query(`SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_action_items'`);
    const names = new Set(cols.map((r) => r.c));
    const need = ['business_id', 'task_id', 'order_index', 'kind', 'label', 'note', 'meta', 'status', 'linked_entity_type', 'linked_entity_id', 'linked_attachment_id', 'fulfilled_by', 'fulfilled_at', 'fulfilled_round', 'created_by', 'created_at', 'updated_at'];
    const missing = need.filter((n) => !names.has(n));
    if (missing.length) { console.error(TAG, '검증 실패 — 없는 칸', missing); process.exit(1); }
    const [idx] = await sequelize.query(`SELECT DISTINCT INDEX_NAME i FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_action_items'`);
    console.log(TAG, 'OK', `칸 ${names.size}개 · 인덱스 ${idx.length}개`);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error(TAG, '실패:', e.message); process.exit(1); }
})();
