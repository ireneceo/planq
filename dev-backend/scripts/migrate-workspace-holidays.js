// #424 근무일·휴일 통합 — businesses.holiday_country + workspace_holidays 표. 멱등. 2026-10-02.
//   설계 docs/WORKDAY_HOLIDAY_DESIGN.md §6.1. **백필 없음** — holiday_country NULL(= 공휴일 안 씀)이
//   "켜기 전까지 어떤 숫자도 변하지 않는다" 의 근거다.
// ★ 순서: PM2 reload 보다 먼저 — 모델이 이 칸·표를 선언하므로 없으면 my-week·워크스페이스 조회가 500.
// 롤백: 코드만 되돌린다. 칸·표는 남아도 무해(읽는 코드가 없다). 모델 선언까지 되돌리면 sync 가 칸을 DROP 한다.
require('dotenv').config();
const { sequelize } = require('../config/database');
const TAG = '[migrate-workspace-holidays]';
async function col() {
  const [r] = await sequelize.query(`SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'businesses' AND COLUMN_NAME = 'holiday_country'`);
  return r[0] ? r[0].t : null;
}
async function tbl() {
  const [r] = await sequelize.query(`SELECT COUNT(*) n FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace_holidays' AND INDEX_NAME = 'ws_holiday_biz_date'`);
  return Number(r[0].n) > 0;
}
(async () => {
  try {
    let changed = 0;
    if (!(await col())) {
      await sequelize.query('ALTER TABLE businesses ADD COLUMN holiday_country VARCHAR(2) NULL');
      console.log(TAG, 'businesses.holiday_country 추가'); changed += 1;
    } else console.log(TAG, 'holiday_country 이미 있음 — skip');
    if (!(await tbl())) {
      await sequelize.query(`CREATE TABLE IF NOT EXISTS workspace_holidays (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        business_id INT NOT NULL,
        date DATE NOT NULL,
        name VARCHAR(100) NOT NULL,
        name_en VARCHAR(100) NULL,
        source ENUM('national','custom') NOT NULL DEFAULT 'custom',
        is_off TINYINT(1) NOT NULL DEFAULT 1,
        created_by INT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE KEY ws_holiday_biz_date (business_id, date),
        CONSTRAINT fk_ws_holiday_biz FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
        CONSTRAINT fk_ws_holiday_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      console.log(TAG, 'workspace_holidays 생성'); changed += 1;
    } else console.log(TAG, 'workspace_holidays 이미 있음 — skip');
    const t = await col();
    if (!t || !/varchar\(2\)/i.test(t) || !(await tbl())) { console.error(TAG, '검증 실패', t); process.exit(1); }
    console.log(TAG, 'OK', { changed });
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error(TAG, '실패:', e.message); process.exit(1); }
})();
