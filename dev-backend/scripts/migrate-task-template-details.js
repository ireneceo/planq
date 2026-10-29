// 업무 템플릿 디테일 — 날짜 없는 항목·본문·주요·분류·공개 범위·반복·태그·결과물 액션. 멱등. 2026-10-29.
//   설계 docs/TASK_TEMPLATE_DETAIL_DESIGN.md (Fable DESIGN-READY).
//   task_template_items: start_offset_days / duration_days → NULL 허용(NULL = 날짜 없음)
//                        + body LONGTEXT · is_milestone · category · vlevel · security_level · recurrence_rule · tag_names · action_items
//   task_templates: source_project_id INT NULL
//   재조회로 판정하고 미충족이면 exit 1. 배포 슬롯에서 PM2 reload 보다 먼저(모델이 SELECT 한다).
// 롤백: additive — 코드만 되돌리고 칸은 남긴다(옛 코드의 `|| 0` 이 NULL 을 견딘다).
require('dotenv').config();
const { sequelize } = require('../config/database');
const TAG = '[migrate-task-template-details]';
async function col(table, name) {
  const [r] = await sequelize.query(`SELECT COLUMN_TYPE t, COLUMN_DEFAULT d, IS_NULLABLE n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, { replacements: [table, name] });
  return r[0] || null;
}
const ADD = [
  ['task_template_items', 'body', 'LONGTEXT NULL'],
  ['task_template_items', 'is_milestone', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['task_template_items', 'category', 'VARCHAR(100) NULL'],
  ['task_template_items', 'vlevel', "ENUM('L1','L2','L3','L4') NOT NULL DEFAULT 'L3'"],
  ['task_template_items', 'security_level', "ENUM('general','internal','confidential') NOT NULL DEFAULT 'general'"],
  ['task_template_items', 'recurrence_rule', 'VARCHAR(500) NULL'],
  ['task_template_items', 'tag_names', 'JSON NULL'],
  ['task_template_items', 'action_items', 'JSON NULL'],
  ['task_templates', 'source_project_id', 'INT NULL'],
];
(async () => {
  try {
    for (const [table, name, def] of ADD) {
      if (!(await col(table, name))) {
        await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
        console.log(TAG, `${table}.${name} 추가`);
      } else console.log(TAG, `${table}.${name} 이미 있음 — skip`);
    }
    for (const [name, def] of [['start_offset_days', 'INT NULL DEFAULT 0'], ['duration_days', 'INT NULL DEFAULT 1']]) {
      const c = await col('task_template_items', name);
      if (c && c.n === 'NO') {
        await sequelize.query(`ALTER TABLE task_template_items MODIFY COLUMN ${name} ${def}`);
        console.log(TAG, `${name} NULL 허용`);
      } else console.log(TAG, `${name} 이미 NULL 허용 — skip`);
    }
    // 재조회 판정
    const bad = [];
    for (const [table, name] of ADD) if (!(await col(table, name))) bad.push(`${table}.${name}`);
    for (const name of ['start_offset_days', 'duration_days']) {
      const c = await col('task_template_items', name);
      if (!c || c.n !== 'YES') bad.push(`${name} nullable`);
    }
    if (bad.length) { console.error(TAG, '검증 실패', bad); process.exit(1); }
    console.log(TAG, 'OK');
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error(TAG, '실패:', e.message); process.exit(1); }
})();
