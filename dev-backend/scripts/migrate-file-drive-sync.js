// Drive(파인더) 지우기·고치기 반영 — files.deleted_via VARCHAR(20) NULL · files.drive_sync_issue VARCHAR(40) NULL. 멱등. 2026-11-18
//   설계 docs/GDRIVE_FINDER_EDIT_SYNC_DESIGN.md §4 (Fable DESIGN-READY). 채울 값 없음(NULL = 종전).
//   ★ PM2 reload 앞 — File 모델이 두 칸을 SELECT 하므로 없으면 파일 목록·업로드가 500.
// 사용: node scripts/migrate-file-drive-sync.js
require('dotenv').config();
const { sequelize } = require('../config/database');

const COLS = [
  ['deleted_via', 'VARCHAR(20) NULL AFTER deleted_by'],
  ['drive_sync_issue', 'VARCHAR(40) NULL AFTER drive_md5'],
];

async function has(col) {
  const [rows] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'files' AND COLUMN_NAME = ?`, { replacements: [col] });
  return rows.length > 0;
}

(async () => {
  try {
    for (const [col, ddl] of COLS) {
      if (await has(col)) { console.log(`[migrate-file-drive-sync] ${col} 이미 있음`); continue; }
      await sequelize.query(`ALTER TABLE files ADD COLUMN ${col} ${ddl}`);
      if (!(await has(col))) throw new Error(`${col} 칸을 만들지 못했다`);
      console.log(`[migrate-file-drive-sync] ${col} 추가함`);
    }
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-file-drive-sync] 실패:', e.message);
    process.exit(1);
  }
})();
