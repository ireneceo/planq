// 표 열 설정(순서·폭·숨김) 계정별 — business_members.table_prefs JSON NULL. 멱등. 2026-10-27.
//
// sync-database(alter) 가 먼저 만들어도 여기서 skip 된다. 스키마를 재조회해 판정하고
//   미충족이면 exit 1 — alter 가 조용히 실패한 전례(64키 한도)가 있어서다.
// 롤백: additive nullable 컬럼이라 옛 코드에 무해하다. **코드만 되돌리고 컬럼은 남긴다**
//   (models/BusinessMember.js 선언까지 되돌리면 sync 가 컬럼을 DROP 해 사람들의 열 설정이 사라진다).
require('dotenv').config();
const { sequelize } = require('../config/database');

async function has(col) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_members' AND COLUMN_NAME = ?`, { replacements: [col] });
  return rows.length > 0;
}

(async () => {
  try {
    if (!(await has('table_prefs'))) {
      await sequelize.query('ALTER TABLE business_members ADD COLUMN table_prefs JSON NULL');
      console.log('[migrate-table-prefs] business_members.table_prefs 추가');
    } else {
      console.log('[migrate-table-prefs] business_members.table_prefs 이미 있음 — skip');
    }
    if (!(await has('table_prefs'))) { console.error('[migrate-table-prefs] 검증 실패 — 컬럼 없음'); process.exit(1); }
    console.log('[migrate-table-prefs] OK');
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-table-prefs] 실패:', e.message);
    process.exit(1);
  }
})();
