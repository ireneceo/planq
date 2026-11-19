// 업무 «산출물» 2 테이블 신설 (docs/TASK_DELIVERABLES_DESIGN.md §2) — 멱등 (매 배포 실행 안전). 데이터 쓰기 0.
//
//   ① task_output_kinds       — 워크스페이스 산출물 사전. UNIQUE(business_id, name) · UNIQUE(business_id, preset_key)
//   ② task_output_kind_links  — task ↔ 산출물 M:N. UNIQUE(task_id, output_kind_id) + INDEX(output_kind_id)
//
//   기본 목록(22개)은 코드(services/taskOutputKindPresets.js)에 있고, 처음 고를 때 행이 생긴다 — 백필 없음.
//   FK 무명·CASCADE 를 모델 attribute 에도 — migrate-task-tags.js 머리말과 같은 이유.
//   ★ 배포 순서: 이 스크립트(DB) → 백엔드 → 프론트. 롤백: links → kinds 순 DROP.
require('dotenv').config();
const { sequelize } = require('../config/database');

const DDL = [
  {
    name: 'task_output_kinds',
    indexes: ['task_output_kinds_biz_name_unique', 'task_output_kinds_biz_preset_unique'],
    sql: `CREATE TABLE IF NOT EXISTS task_output_kinds (
      id INT AUTO_INCREMENT PRIMARY KEY,
      business_id INT NOT NULL,
      name VARCHAR(40) NOT NULL,
      preset_key VARCHAR(40) NULL,
      created_by INT NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      UNIQUE KEY task_output_kinds_biz_name_unique (business_id, name),
      UNIQUE KEY task_output_kinds_biz_preset_unique (business_id, preset_key),
      FOREIGN KEY (business_id) REFERENCES businesses(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'task_output_kind_links',
    indexes: ['task_output_kind_links_unique', 'task_output_kind_links_kind'],
    sql: `CREATE TABLE IF NOT EXISTS task_output_kind_links (
      id INT AUTO_INCREMENT PRIMARY KEY,
      task_id INT NOT NULL,
      output_kind_id INT NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      UNIQUE KEY task_output_kind_links_unique (task_id, output_kind_id),
      KEY task_output_kind_links_kind (output_kind_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (output_kind_id) REFERENCES task_output_kinds(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
];

async function exists(table) {
  const [rows] = await sequelize.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`,
    { replacements: { t: table } }
  );
  return Number(rows[0]?.c || 0) > 0;
}

async function hasColumn(table, col) {
  const [rows] = await sequelize.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c`,
    { replacements: { t: table, c: col } }
  );
  return Number(rows[0]?.c || 0) > 0;
}

async function run() {
  let created = 0;
  for (const { name, sql } of DDL) {
    if (await exists(name)) { console.log(`· ${name} 이미 존재 — skip`); continue; }
    console.log(`→ ${name} 생성`);
    await sequelize.query(sql);
    created += 1;
  }
  // ③ 템플릿 항목에 산출물 이름(task_template_items.output_names JSON) — 템플릿 저장·적용이 따라가게(설계 §5)
  if (await hasColumn('task_template_items', 'output_names')) console.log('· task_template_items.output_names 이미 존재 — skip');
  else { console.log('→ task_template_items.output_names 추가'); await sequelize.query('ALTER TABLE task_template_items ADD COLUMN output_names JSON NULL'); created += 1; }

  // 검증 — 실제 스키마를 다시 읽어 표·인덱스 이름을 판정한다.
  let ok = true;
  if (!(await hasColumn('task_template_items', 'output_names'))) { console.log('✗ task_template_items.output_names 없음'); ok = false; }
  for (const { name, indexes } of DDL) {
    const present = await exists(name);
    const [idx] = await sequelize.query(
      `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`,
      { replacements: { t: name } }
    );
    const have = new Set(idx.map((i) => i.INDEX_NAME));
    const missing = indexes.filter((n) => !have.has(n));
    console.log(`${present && !missing.length ? '✓' : '✗'} ${name} — 인덱스 ${[...have].join(', ')}${missing.length ? ` (없음: ${missing.join(', ')})` : ''}`);
    if (!present || missing.length) ok = false;
  }
  console.log(ok ? `완료 (신규 ${created}개)` : '실패 — 표·인덱스가 설계와 다릅니다');
  if (!ok) process.exitCode = 1;
}

run()
  .catch((e) => { console.error('마이그레이션 실패:', e.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
