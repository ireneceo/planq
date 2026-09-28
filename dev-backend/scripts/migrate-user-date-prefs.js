// 날짜·시간 표시 형식 — users.date_format / time_format / week_start (ENUM NULL). 멱등. 2026-09-28.
//
// Irene 09-27 승인: *"승인해 fable 제안대로"* — 사용자별 날짜 형식. NULL = 화면 언어별 자동.
//
// sync-database(alter) 가 먼저 만들어도 여기서 skip 된다. **스키마를 재조회해 판정**하고
//   미충족이면 exit 1 — alter 가 조용히 실패한 전례(64키 한도)가 있어서다.
// 롤백: additive nullable 컬럼이라 옛 코드에 무해하다. **코드만 되돌리고 컬럼은 남긴다**
//   (models/User.js 의 선언까지 되돌리면 sync 가 컬럼을 DROP 해 고른 형식이 사라진다).
require('dotenv').config();
const { sequelize } = require('../config/database');

const COLS = [
  ['date_format', "ENUM('ymd','mdy','dmy') NULL"],
  ['time_format', "ENUM('24h','12h') NULL"],
  ['week_start', "ENUM('sun','mon') NULL"],
];

async function has(col) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = ?`, { replacements: [col] });
  return rows.length > 0;
}

(async () => {
  try {
    for (const [col, def] of COLS) {
      if (!(await has(col))) {
        await sequelize.query(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
        console.log(`[migrate-user-date-prefs] users.${col} 추가`);
      } else {
        console.log(`[migrate-user-date-prefs] users.${col} 이미 있음 — skip`);
      }
    }
    for (const [col] of COLS) {
      if (!(await has(col))) { console.error(`[migrate-user-date-prefs] 검증 실패 — ${col} 없음`); process.exit(1); }
    }
    console.log('[migrate-user-date-prefs] OK');
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-user-date-prefs] 실패:', e.message);
    process.exit(1);
  }
})();
