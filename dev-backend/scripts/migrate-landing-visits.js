// 랜딩 방문 집계 테이블 2개 — 멱등 (2026-09-21). sync-database 가 먼저 만들었으면 skip.
//   재조회로 판정하고 없으면 exit 1(alter 가 조용히 실패한 전례). 롤백: 코드만 — 표는 남겨도 무해.
require('dotenv').config();
const { sequelize } = require('../config/database');
const SQL = [
  `CREATE TABLE IF NOT EXISTS landing_visits (
     id BIGINT AUTO_INCREMENT PRIMARY KEY,
     visit_date DATE NOT NULL, path VARCHAR(200) NOT NULL,
     source VARCHAR(80) NOT NULL DEFAULT 'direct', device ENUM('mobile','desktop') NOT NULL DEFAULT 'desktop',
     views INT NOT NULL DEFAULT 0, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
     UNIQUE KEY uk_landing_visit (visit_date, path, source, device), KEY idx_lv_date (visit_date)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS landing_visitors (
     id BIGINT AUTO_INCREMENT PRIMARY KEY,
     visit_date DATE NOT NULL, visitor_hash CHAR(32) NOT NULL,
     created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
     UNIQUE KEY uk_landing_visitor (visit_date, visitor_hash)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];
(async () => {
  try {
    for (const q of SQL) await sequelize.query(q);
    const [r] = await sequelize.query(`SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('landing_visits','landing_visitors')`);
    if (r.length !== 2) { console.error('[migrate-landing-visits] 검증 실패', r); process.exit(1); }
    console.log('[migrate-landing-visits] OK', r.map((x) => x.t).join(','));
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-landing-visits] 실패:', e.message); process.exit(1); }
})();
