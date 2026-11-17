// 메일 한국 중계 — email_accounts.connect_route ENUM('direct','relay') NULL · connect_route_checked_at DATETIME NULL. 멱등. 2026-11-17
//   설계 docs/MAIL_KR_RELAY_DESIGN.md (Fable 설계 검토 반영). 채울 값 없음(NULL = 모름 → 처음 연결 때 정해진다).
//   ★ PM2 reload 앞 — 모델이 이 칸을 SELECT 하므로 없으면 메일 계정 목록·수신이 500. 되돌리기 = 코드만(칸은 남겨도 무해).
// 사용: node scripts/migrate-mail-connect-route.js
require('dotenv').config();
const { sequelize } = require('../config/database');

async function has(col) {
  const [rows] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_accounts' AND COLUMN_NAME = ?`, { replacements: [col] });
  return rows.length > 0;
}

(async () => {
  try {
    let added = 0;
    if (!(await has('connect_route'))) {
      await sequelize.query("ALTER TABLE email_accounts ADD COLUMN connect_route ENUM('direct','relay') NULL DEFAULT NULL");
      added += 1;
    }
    if (!(await has('connect_route_checked_at'))) {
      await sequelize.query('ALTER TABLE email_accounts ADD COLUMN connect_route_checked_at DATETIME NULL DEFAULT NULL');
      added += 1;
    }
    if (!(await has('connect_route')) || !(await has('connect_route_checked_at'))) throw new Error('칸을 만들지 못했다');
    console.log(added ? `[migrate-mail-connect-route] 칸 ${added}개 추가함` : '[migrate-mail-connect-route] 이미 있음 — 할 일 없음');
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-mail-connect-route] 실패:', e.message);
    process.exit(1);
  }
})();
