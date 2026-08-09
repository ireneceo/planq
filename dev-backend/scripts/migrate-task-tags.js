// #250 ③청크 마이그레이션 — 업무 태그 2 테이블 신설. 멱등 (매 배포 실행 안전).
//
//   ① task_tags       — 워크스페이스 태그 사전. UNIQUE(business_id, name)
//   ② task_tag_links  — task ↔ tag M:N. UNIQUE(task_id, tag_id) + INDEX(tag_id)
//
//   ★ FK 제약에 **이름을 주지 않는다**(MySQL 이 `*_ibfk_*` 자동 부여). 이름을 직접 주면
//     `sync-database.js`(sync alter) 가 FK 를 재생성할 때 Sequelize 규칙명으로 갈아치워
//     DDL 과 실제 스키마가 갈라진다(Fable 실증 F3 계열). 무명으로 두면 양쪽이 같은 이름을 쓴다.
//     ON DELETE CASCADE 는 모델 attribute 의 onDelete 로도 선언해 alter 후에도 보존된다.
//
//   `sync-database.js`(sync alter) 를 쓰지 않는 이유: 이 저장소는 alter 경로에서
//   "Too many keys specified; max 64 keys allowed" 를 맞은 전례가 있다. 신규 테이블은
//   CREATE TABLE IF NOT EXISTS 로 명시 생성하는 편이 안전하고 결과가 예측 가능하다.
//
//   ★ 배포 순서: 이 스크립트(DB) → 백엔드 → 프론트.
//     역전하면 새 백엔드가 없는 테이블을 조회해 500 이 난다. 옛 백엔드는 이 테이블을
//     쓰지 않으므로 DB 선행은 언제나 안전하다.
//
//   롤백: DROP TABLE task_tag_links; DROP TABLE task_tags;
//     (링크가 CASCADE 라 순서를 지켜야 한다 — 링크 먼저)
require('dotenv').config();
const { sequelize } = require('../config/database');

const DDL = [
  {
    name: 'task_tags',
    sql: `CREATE TABLE IF NOT EXISTS task_tags (
      id INT AUTO_INCREMENT PRIMARY KEY,
      business_id INT NOT NULL,
      name VARCHAR(30) NOT NULL,
      color VARCHAR(7) NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_by INT NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      UNIQUE KEY task_tags_biz_name_unique (business_id, name),
      KEY task_tags_biz_sort (business_id, sort_order),
      FOREIGN KEY (business_id) REFERENCES businesses(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'task_tag_links',
    sql: `CREATE TABLE IF NOT EXISTS task_tag_links (
      id INT AUTO_INCREMENT PRIMARY KEY,
      task_id INT NOT NULL,
      tag_id INT NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      UNIQUE KEY task_tag_links_unique (task_id, tag_id),
      KEY task_tag_links_tag (tag_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES task_tags(id) ON DELETE CASCADE
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

async function run() {
  let created = 0;
  for (const { name, sql } of DDL) {
    if (await exists(name)) { console.log(`· ${name} 이미 존재 — skip`); continue; }
    console.log(`→ ${name} 생성`);
    await sequelize.query(sql);
    created += 1;
  }

  // 검증 — CREATE 성공 로그가 아니라 실제 스키마를 다시 읽어 판정한다.
  let ok = true;
  for (const { name } of DDL) {
    const present = await exists(name);
    const [idx] = await sequelize.query(
      `SELECT INDEX_NAME, NON_UNIQUE FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t GROUP BY INDEX_NAME, NON_UNIQUE`,
      { replacements: { t: name } }
    );
    console.log(`${present ? '✓' : '✗'} ${name} — 인덱스 ${idx.map(i => i.INDEX_NAME).join(', ')}`);
    if (!present) ok = false;
  }
  console.log(ok ? `완료 (신규 ${created}개)` : '실패 — 테이블이 생성되지 않았습니다');
  if (!ok) process.exitCode = 1;
}

run()
  .catch((e) => { console.error('마이그레이션 실패:', e.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
