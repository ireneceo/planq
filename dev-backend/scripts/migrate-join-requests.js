// 워크스페이스 참여 신청 — workspace_join_requests 표 + businesses 참여 설정 4칸. 멱등 · additive.
//   설계 docs/SIGNUP_START_JOIN_DESIGN.md §5·§6 (Fable DESIGN-READY, 2026-11-06).
//   모델이 SELECT 하므로 코드보다 먼저(배포 슬롯). 롤백은 코드만 — 칸·표는 남긴다.
const { sequelize } = require('../config/database');

async function hasColumn(table, col) {
  const [r] = await sequelize.query(
    `SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t AND COLUMN_NAME=:c`,
    { replacements: { t: table, c: col } });
  return Number(r[0].n) > 0;
}
async function hasIndex(table, name) {
  const [r] = await sequelize.query(
    `SELECT COUNT(*) n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t AND INDEX_NAME=:n`,
    { replacements: { t: table, n: name } });
  return Number(r[0].n) > 0;
}

(async () => {
  let changed = 0;
  const cols = [
    ['join_by_domain', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['join_domain', 'VARCHAR(120) NULL'],
    ['join_code', 'VARCHAR(12) NULL'],
    ['join_code_rotated_at', 'DATETIME NULL'],
  ];
  for (const [c, def] of cols) {
    if (await hasColumn('businesses', c)) { console.log(`✓ businesses.${c} 이미 존재`); continue; }
    await sequelize.query(`ALTER TABLE businesses ADD COLUMN ${c} ${def}`);
    console.log(`+ businesses.${c}`); changed += 1;
  }
  if (!(await hasIndex('businesses', 'uq_businesses_join_code'))) {
    await sequelize.query('ALTER TABLE businesses ADD UNIQUE INDEX uq_businesses_join_code (join_code)');
    console.log('+ UNIQUE uq_businesses_join_code'); changed += 1;
  }
  await sequelize.query(`CREATE TABLE IF NOT EXISTS workspace_join_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    business_id INT NOT NULL,
    user_id INT NOT NULL,
    source ENUM('domain','code') NOT NULL,
    status ENUM('pending','approved','rejected','canceled') NOT NULL DEFAULT 'pending',
    message VARCHAR(300) NULL,
    requested_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    decided_at DATETIME NULL,
    decided_by INT NULL,
    decision_note VARCHAR(300) NULL,
    retry_after DATETIME NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uq_join_req_biz_user (business_id, user_id),
    KEY idx_join_req_biz_status (business_id, status),
    KEY idx_join_req_user (user_id),
    CONSTRAINT fk_join_req_biz FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_join_req_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  console.log('✓ workspace_join_requests (CREATE IF NOT EXISTS)');
  const [d] = await sequelize.query('SELECT COUNT(*) c FROM businesses WHERE join_by_domain = 1');
  console.log(`· 검산: 도메인 참여 켠 워크스페이스 ${d[0].c} (새 칸이면 0)`);
  console.log(`[migrate-join-requests] 완료 — 변경 ${changed}건 (멱등)`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
