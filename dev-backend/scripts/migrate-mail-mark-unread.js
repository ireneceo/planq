// Q mail «안 읽음으로 표시»(나만) — email_thread_participants.marked_unread TINYINT(1) NOT NULL DEFAULT 0. 멱등. 2026-11-13
//   설계 docs/QMAIL_MARK_UNREAD_DESIGN.md (Fable DESIGN-READY). 채울 값 없음(기본 0). 되돌리기 = 코드만(칸은 남겨도 무해).
//   ★ PM2 reload 앞 — 안 읽음 판정 SQL(services/mailRead.unreadExpr)이 이 칸을 읽으므로 없으면 메일 목록·수가 500.
// 사용: node scripts/migrate-mail-mark-unread.js
require('dotenv').config();
const { sequelize } = require('../config/database');

async function hasColumn() {
  const [rows] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_thread_participants' AND COLUMN_NAME = 'marked_unread'`);
  return rows.length > 0;
}

(async () => {
  try {
    if (await hasColumn()) {
      console.log('[migrate-mail-mark-unread] 이미 있음 — 할 일 없음');
    } else {
      await sequelize.query('ALTER TABLE email_thread_participants ADD COLUMN marked_unread TINYINT(1) NOT NULL DEFAULT 0 AFTER last_read_at');
      if (!(await hasColumn())) throw new Error('marked_unread 칸을 만들지 못했다');
      console.log('[migrate-mail-mark-unread] 추가함');
    }
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-mail-mark-unread] 실패:', e.message);
    process.exit(1);
  }
})();
