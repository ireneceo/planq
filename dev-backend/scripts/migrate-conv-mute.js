// Q talk 대화방 알림 끄기 — conversation_participants.muted_at 칸(DATETIME NULL). 멱등(매 배포 실행 안전). 2026-11-13
//   설계 docs/QTALK_MUTE_DESIGN.md (Fable DESIGN-READY). 채울 값 없음(전부 NULL = 켜짐). 되돌리기 = 칸 삭제(코드 롤백 뒤).
//   ★ PM2 reload 앞 — 모델이 이 칸을 SELECT 하므로 없으면 대화 목록·참여자 조회가 500.
// 사용: node scripts/migrate-conv-mute.js
require('dotenv').config();
const { sequelize } = require('../config/database');

async function hasColumn() {
  const [rows] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversation_participants' AND COLUMN_NAME = 'muted_at'`);
  return rows.length > 0;
}

(async () => {
  try {
    if (await hasColumn()) {
      console.log('[migrate-conv-mute] muted_at 이미 있음 — 할 일 없음');
    } else {
      await sequelize.query('ALTER TABLE conversation_participants ADD COLUMN muted_at DATETIME NULL DEFAULT NULL AFTER pinned_at');
      if (!(await hasColumn())) throw new Error('muted_at 칸을 만들지 못했다');
      console.log('[migrate-conv-mute] muted_at 칸 추가 완료');
    }
    const [[c]] = await sequelize.query('SELECT COUNT(*) AS n FROM conversation_participants WHERE muted_at IS NOT NULL');
    console.log(`[migrate-conv-mute] 끈 행 ${c.n}`);
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-conv-mute] 실패:', e.message);
    process.exit(1);
  }
})();
