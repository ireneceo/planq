// 워크스페이스 «전체» 대화방 — businesses.team_conversation_id INT NULL 칸(멱등, 매 배포 실행 안전). 2026-11-16
//   설계: Fable 설계 B(공지 = 전체 방 메시지 속성) · services/team_channel.js. 채울 값 없음 — 방은 처음 쓸 때 만든다(lazy).
//   ★ PM2 reload 앞 — Business 모델이 이 칸을 SELECT 하므로 없으면 워크스페이스 조회가 500.
//   되돌리기 = 코드 롤백 뒤 칸 삭제(만들어진 «전체» 방은 일반 내부 대화방으로 남는다).
// 사용: node scripts/migrate-team-channel.js
require('dotenv').config();
const { sequelize } = require('../config/database');

async function hasColumn() {
  const [rows] = await sequelize.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'businesses' AND COLUMN_NAME = 'team_conversation_id'`);
  return rows.length > 0;
}

(async () => {
  try {
    if (await hasColumn()) {
      console.log('[migrate-team-channel] team_conversation_id 이미 있음 — 할 일 없음');
    } else {
      await sequelize.query('ALTER TABLE businesses ADD COLUMN team_conversation_id INT NULL DEFAULT NULL');
      if (!(await hasColumn())) throw new Error('team_conversation_id 칸을 만들지 못했다');
      console.log('[migrate-team-channel] team_conversation_id 칸 추가 완료');
    }
    const [[c]] = await sequelize.query('SELECT COUNT(*) AS n FROM businesses WHERE team_conversation_id IS NOT NULL');
    console.log(`[migrate-team-channel] 전체 방 있는 워크스페이스 ${c.n}`);
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-team-channel] 실패:', e.message);
    process.exit(1);
  }
})();
