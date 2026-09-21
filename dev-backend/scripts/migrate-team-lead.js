// 팀장 칸 — teams.lead_user_id INT NULL (FK users.id). 멱등. 2026-09-21.
//
// Irene: *"설정>조직에서 부서장이나 팀장 넣으면 자동으로 해당 멤버가 그 부서나 팀으로 들어가야 하는데"*
//   팀장이라는 개념이 시스템에 없었다(직책 자유 입력뿐). 부서의 lead_user_id 와 같은 모양으로 넣는다.
//
// sync-database(alter) 가 먼저 만들어도 여기서 skip 된다. 이 스크립트는 **스키마를 재조회해 판정**하고
//   미충족이면 exit 1 — alter 가 조용히 실패한 전례(64키 한도)가 있어서다.
// 롤백: additive nullable 컬럼이라 옛 코드에 무해하다. **코드만 되돌리고 컬럼은 남긴다**
//   (models/Team.js 의 선언까지 되돌리면 sync 가 컬럼을 DROP 해 지정한 팀장이 사라진다).
require('dotenv').config();
const { sequelize } = require('../config/database');

async function has(col) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teams' AND COLUMN_NAME = ?`, { replacements: [col] });
  return rows.length > 0;
}

(async () => {
  try {
    if (!(await has('lead_user_id'))) {
      await sequelize.query('ALTER TABLE teams ADD COLUMN lead_user_id INT NULL AFTER name_en');
      console.log('[migrate-team-lead] teams.lead_user_id 추가');
    } else {
      console.log('[migrate-team-lead] teams.lead_user_id 이미 있음 — skip');
    }
    if (!(await has('lead_user_id'))) { console.error('[migrate-team-lead] 검증 실패 — 컬럼 없음'); process.exit(1); }
    console.log('[migrate-team-lead] OK');
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-team-lead] 실패:', e.message);
    process.exit(1);
  }
})();
